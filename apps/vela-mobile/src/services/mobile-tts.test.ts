import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TtsApiErrorCode, TtsSettings } from '@vela/common';
import { MobileApiError, type MobileApiClient } from './mobile-api-client';
import {
  MOBILE_TTS_GENERATE_TIMEOUT_MS,
  MobileTtsError,
  createMobileTtsService,
  type MobilePronunciationInput,
  type MobileTtsErrorCode,
} from './mobile-tts';

const HTTPS_AUDIO = 'https://audio.example.test/mizu.mp3?signature=temporary';
const INPUT: MobilePronunciationInput = {
  userId: 'user-1',
  vocabularyId: '水:ミズ',
  text: '水',
};
const CONFIGURED_SETTINGS: TtsSettings = {
  provider: 'openai',
  voiceId: 'alloy',
  model: 'tts-1',
  hasApiKey: true,
};

type MockApiClient = {
  getJson: ReturnType<typeof vi.fn<MobileApiClient['getJson']>>;
  postJson: ReturnType<typeof vi.fn<MobileApiClient['postJson']>>;
};

function createApi(): MockApiClient {
  return {
    getJson: vi.fn<MobileApiClient['getJson']>(),
    postJson: vi.fn<MobileApiClient['postJson']>(),
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function captureError(promise: Promise<unknown>): Promise<MobileTtsError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(MobileTtsError);
    return error as MobileTtsError;
  }
  throw new Error('Expected promise to reject');
}

function generated(audioUrl = HTTPS_AUDIO, cached = false) {
  return { audioUrl, cached };
}

describe('MobileTtsService', () => {
  let api: MockApiClient;

  beforeEach(() => {
    api = createApi();
    api.getJson.mockResolvedValue(CONFIGURED_SETTINGS);
    api.postJson.mockResolvedValue(generated());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the default settings timeout and exactly 45 seconds for generation', async () => {
    const service = createMobileTtsService(api);

    await service.preparePronunciation(INPUT);

    expect(MOBILE_TTS_GENERATE_TIMEOUT_MS).toBe(45_000);
    expect(api.getJson).toHaveBeenCalledWith('tts/settings', {
      signal: expect.any(AbortSignal),
    });
    expect(api.postJson).toHaveBeenCalledWith(
      'tts/generate',
      { vocabularyId: '水:ミズ', text: '水' },
      { signal: expect.any(AbortSignal), timeoutMs: 45_000 },
    );
  });

  it('validates and trims input without sending the cache-only user ID', async () => {
    const service = createMobileTtsService(api);

    await service.preparePronunciation({
      userId: ' user-1 ',
      vocabularyId: ' 水:ミズ ',
      text: ' 水 ',
    });

    expect(api.postJson).toHaveBeenCalledWith(
      'tts/generate',
      { vocabularyId: '水:ミズ', text: '水' },
      expect.any(Object),
    );
    expect(api.postJson.mock.calls[0]?.[1]).not.toHaveProperty('userId');
  });

  it.each([
    ['userId', { ...INPUT, userId: ' ' }],
    ['vocabularyId', { ...INPUT, vocabularyId: '' }],
    ['text', { ...INPUT, text: '\t' }],
  ])('rejects a blank %s before making a request', async (_field, input) => {
    const service = createMobileTtsService(api);

    await expect(service.preparePronunciation(input)).rejects.toMatchObject({
      code: 'invalid_input',
    });
    expect(api.getJson).not.toHaveBeenCalled();
  });

  it('short-circuits generation when settings are not configured', async () => {
    api.getJson.mockResolvedValue({ ...CONFIGURED_SETTINGS, hasApiKey: false });
    const service = createMobileTtsService(api);

    await expect(service.preparePronunciation(INPUT)).rejects.toMatchObject({
      code: 'not_configured',
    });
    expect(api.postJson).not.toHaveBeenCalled();
  });

  it.each<[TtsApiErrorCode, MobileTtsErrorCode]>([
    ['tts_not_configured', 'not_configured'],
    ['tts_invalid_provider_configuration', 'generation_failed'],
    ['tts_audio_service_unavailable', 'service_unavailable'],
    ['tts_generation_timeout', 'generation_timeout'],
    ['tts_generation_failed', 'generation_failed'],
    ['tts_audio_storage_failed', 'generation_failed'],
    ['tts_audio_access_failed', 'generation_failed'],
  ])('maps stable backend code %s to %s before status fallback', async (backendCode, code) => {
    api.postJson.mockRejectedValue(
      new MobileApiError('client', {
        status: 400,
        serverBody: { error: 'opaque backend message', code: backendCode },
      }),
    );
    const service = createMobileTtsService(api);

    await expect(service.preparePronunciation(INPUT)).rejects.toMatchObject({ code });
  });

  it.each([
    ['TTS API key not configured. Please configure in Settings.', 'not_configured'],
    ['Invalid TTS provider configuration', 'generation_failed'],
  ] as const)('maps the exact legacy 400 message %s to %s', async (legacyMessage, code) => {
    api.postJson.mockRejectedValue(
      new MobileApiError('client', {
        status: 400,
        serverBody: { error: legacyMessage },
      }),
    );
    const service = createMobileTtsService(api);

    await expect(service.preparePronunciation(INPUT)).rejects.toMatchObject({ code });
  });

  it('does not treat a legacy message as compatibility evidence outside status 400', async () => {
    api.postJson.mockRejectedValue(
      new MobileApiError('server', {
        status: 500,
        serverBody: { error: 'TTS API key not configured. Please configure in Settings.' },
      }),
    );
    const service = createMobileTtsService(api);

    await expect(service.preparePronunciation(INPUT)).rejects.toMatchObject({
      code: 'generation_failed',
    });
  });

  it('maps an uncoded validator 400 to invalid_input', async () => {
    api.postJson.mockRejectedValue(
      new MobileApiError('client', {
        status: 400,
        serverBody: { success: false, error: { issues: [] } },
      }),
    );
    const service = createMobileTtsService(api);

    await expect(service.preparePronunciation(INPUT)).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });

  it.each([
    [503, 'service_unavailable'],
    [504, 'generation_timeout'],
    [500, 'generation_failed'],
  ] as const)('maps status-only HTTP %i to %s', async (status, code) => {
    api.postJson.mockRejectedValue(new MobileApiError('server', { status }));
    const service = createMobileTtsService(api);

    await expect(service.preparePronunciation(INPUT)).rejects.toMatchObject({ code });
  });

  it.each([
    ['session_unavailable', 'session_unavailable'],
    ['session_changed', 'session_changed'],
    ['session_recovery_pending', 'session_recovery_pending'],
    ['unauthorized', 'unauthorized'],
    ['forbidden', 'forbidden'],
    ['network', 'network'],
  ] as const)('preserves API classification %s as %s', async (apiCode, code) => {
    api.postJson.mockRejectedValue(new MobileApiError(apiCode));
    const service = createMobileTtsService(api);

    await expect(service.preparePronunciation(INPUT)).rejects.toMatchObject({ code });
  });

  it('maps an API invalid-response failure to invalid_response', async () => {
    api.getJson.mockRejectedValue(new MobileApiError('invalid_response'));
    const service = createMobileTtsService(api);

    await expect(service.preparePronunciation(INPUT)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it.each([
    ['settings', { provider: 'unsupported', voiceId: null, model: null, hasApiKey: true }],
    ['generation', { audioUrl: 'http://audio.example.test/mizu.mp3', cached: false }],
  ])(
    'maps a structurally invalid successful %s response to invalid_response',
    async (kind, value) => {
      if (kind === 'settings') api.getJson.mockResolvedValue(value);
      else api.postJson.mockResolvedValue(value);
      const service = createMobileTtsService(api);

      await expect(service.preparePronunciation(INPUT)).rejects.toMatchObject({
        code: 'invalid_response',
      });
    },
  );

  it('keeps unknown and raw server details private', async () => {
    const rawBody = { error: 'provider credential rejected', code: 'future_server_code' };
    api.postJson.mockRejectedValue(
      new MobileApiError('server', { status: 500, serverBody: rawBody }),
    );
    const service = createMobileTtsService(api);

    const error = await captureError(service.preparePronunciation(INPUT));

    expect(error).toMatchObject({ code: 'generation_failed', message: 'generation_failed' });
    expect(error).not.toHaveProperty('details');
    expect(error).not.toHaveProperty('serverBody');
    expect(error.cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain('provider credential rejected');
    expect(JSON.stringify(error)).not.toContain('future_server_code');
  });

  it('reports server-cache, generated, and memory-cache sources without exposing the URL in errors', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T12:00:00.000Z'));
    api.postJson.mockResolvedValueOnce(generated(HTTPS_AUDIO, true));
    const service = createMobileTtsService(api);

    const serverCached = await service.preparePronunciation(INPUT);
    const memoryCached = await service.preparePronunciation(INPUT);

    expect(serverCached).toEqual({
      audioUrl: HTTPS_AUDIO,
      source: 'server-cache',
      expiresAt: Date.now() + 14 * 60_000,
      timings: { settingsMs: 0, generateMs: 0 },
    });
    expect(memoryCached).toMatchObject({
      audioUrl: HTTPS_AUDIO,
      source: 'memory-cache',
      expiresAt: serverCached.expiresAt,
      timings: { settingsMs: 0, generateMs: 0 },
    });

    service.invalidatePronunciation(INPUT.userId, INPUT.vocabularyId);
    api.postJson.mockResolvedValueOnce(generated(HTTPS_AUDIO, false));
    await expect(service.preparePronunciation(INPUT)).resolves.toMatchObject({
      source: 'generated',
    });
  });

  it('records settings and generation timings separately', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const settings = deferred<unknown>();
    const generation = deferred<unknown>();
    api.getJson.mockReturnValue(settings.promise);
    api.postJson.mockReturnValue(generation.promise);
    const service = createMobileTtsService(api);

    const prepared = service.preparePronunciation(INPUT);
    await vi.advanceTimersByTimeAsync(12);
    settings.resolve(CONFIGURED_SETTINGS);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(34);
    generation.resolve(generated());

    await expect(prepared).resolves.toMatchObject({
      timings: { settingsMs: 12, generateMs: 34 },
    });
  });

  it('shares generation only after resolving the same settings-derived key', async () => {
    const generation = deferred<unknown>();
    api.postJson.mockReturnValue(generation.promise);
    const service = createMobileTtsService(api);

    const first = service.preparePronunciation(INPUT);
    const second = service.preparePronunciation(INPUT);
    await vi.waitFor(() => expect(api.postJson).toHaveBeenCalledTimes(1));
    generation.resolve(generated());

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(api.getJson).toHaveBeenCalledTimes(2);
    expect(api.postJson).toHaveBeenCalledTimes(1);
  });

  it('uses distinct keys when user, vocabulary, provider, voice, or model changes', async () => {
    const service = createMobileTtsService(api);
    const settings = [
      CONFIGURED_SETTINGS,
      CONFIGURED_SETTINGS,
      CONFIGURED_SETTINGS,
      { ...CONFIGURED_SETTINGS, provider: 'gemini' },
      { ...CONFIGURED_SETTINGS, voiceId: 'nova' },
      { ...CONFIGURED_SETTINGS, model: 'tts-2' },
    ] satisfies TtsSettings[];
    api.getJson.mockImplementation(async () => settings.shift() ?? CONFIGURED_SETTINGS);

    await service.preparePronunciation(INPUT);
    await service.preparePronunciation({ ...INPUT, userId: 'user-2' });
    await service.preparePronunciation({ ...INPUT, vocabularyId: '火:ヒ', text: '火' });
    await service.preparePronunciation(INPUT);
    await service.preparePronunciation(INPUT);
    await service.preparePronunciation(INPUT);

    expect(api.postJson).toHaveBeenCalledTimes(6);
  });

  it('does not include text in the full cache key for a fixed vocabulary/text pair', async () => {
    const service = createMobileTtsService(api);

    await service.preparePronunciation(INPUT);
    await service.preparePronunciation({ ...INPUT, text: '別の読み' });

    expect(api.postJson).toHaveBeenCalledTimes(1);
  });

  it('cleans up failed pending generation so an explicit retry starts new work', async () => {
    api.postJson.mockRejectedValueOnce(new MobileApiError('network'));
    const service = createMobileTtsService(api);

    await expect(service.preparePronunciation(INPUT)).rejects.toMatchObject({ code: 'network' });
    api.postJson.mockResolvedValueOnce(generated());
    await expect(service.preparePronunciation(INPUT)).resolves.toMatchObject({
      source: 'generated',
    });

    expect(api.postJson).toHaveBeenCalledTimes(2);
  });

  it('keeps underlying preparation useful when one caller aborts', async () => {
    const generation = deferred<unknown>();
    api.postJson.mockReturnValue(generation.promise);
    const controller = new AbortController();
    const service = createMobileTtsService(api);

    const first = service.preparePronunciation(INPUT, { signal: controller.signal });
    await vi.waitFor(() => expect(api.postJson).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    generation.resolve(generated());
    await vi.waitFor(() => expect(api.postJson).toHaveBeenCalledTimes(1));
    await expect(service.preparePronunciation(INPUT)).resolves.toMatchObject({
      source: 'memory-cache',
    });
  });

  it('expires cache entries after exactly 14 minutes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const service = createMobileTtsService(api);

    await service.preparePronunciation(INPUT);
    await vi.advanceTimersByTimeAsync(14 * 60_000 - 1);
    await service.preparePronunciation(INPUT);
    expect(api.postJson).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await service.preparePronunciation(INPUT);
    expect(api.postJson).toHaveBeenCalledTimes(2);
  });

  it('refreshes LRU order when a live entry is read', async () => {
    const service = createMobileTtsService(api);

    for (let index = 0; index < 300; index += 1) {
      await service.preparePronunciation({ ...INPUT, vocabularyId: `vocab-${index}` });
    }
    await service.preparePronunciation({ ...INPUT, vocabularyId: 'vocab-0' });
    await service.preparePronunciation({ ...INPUT, vocabularyId: 'vocab-new' });
    await service.preparePronunciation({ ...INPUT, vocabularyId: 'vocab-0' });
    await service.preparePronunciation({ ...INPUT, vocabularyId: 'vocab-1' });

    expect(api.postJson).toHaveBeenCalledTimes(302);
  });

  it('bounds the cache at 300 entries by evicting the least recently used entry', async () => {
    const service = createMobileTtsService(api);

    for (let index = 0; index < 301; index += 1) {
      await service.preparePronunciation({ ...INPUT, vocabularyId: `vocab-${index}` });
    }
    await service.preparePronunciation({ ...INPUT, vocabularyId: 'vocab-0' });

    expect(api.postJson).toHaveBeenCalledTimes(302);
  });

  it('sweeps expired entries at five-minute activity boundaries before LRU eviction', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const service = createMobileTtsService(api);

    await service.preparePronunciation({ ...INPUT, vocabularyId: 'expired-but-recent' });
    await vi.advanceTimersByTimeAsync(1);
    for (let index = 0; index < 299; index += 1) {
      await service.preparePronunciation({ ...INPUT, vocabularyId: `live-${index}` });
    }
    await service.preparePronunciation({ ...INPUT, vocabularyId: 'expired-but-recent' });

    await vi.advanceTimersByTimeAsync(14 * 60_000 - 1);
    await service.preparePronunciation({ ...INPUT, vocabularyId: 'new-after-sweep' });
    await service.preparePronunciation({ ...INPUT, vocabularyId: 'live-0' });

    expect(api.postJson).toHaveBeenCalledTimes(301);
  });

  it('removes every settings partition for one user and vocabulary', async () => {
    const service = createMobileTtsService(api);
    api.getJson
      .mockResolvedValueOnce(CONFIGURED_SETTINGS)
      .mockResolvedValueOnce({ ...CONFIGURED_SETTINGS, voiceId: 'nova' })
      .mockResolvedValueOnce(CONFIGURED_SETTINGS)
      .mockResolvedValueOnce({ ...CONFIGURED_SETTINGS, voiceId: 'nova' });

    await service.preparePronunciation(INPUT);
    await service.preparePronunciation(INPUT);
    service.invalidatePronunciation('user-1', '水:ミズ');
    await service.preparePronunciation(INPUT);
    await service.preparePronunciation(INPUT);

    expect(api.postJson).toHaveBeenCalledTimes(4);
  });

  it('clearUser removes only that user cache', async () => {
    const service = createMobileTtsService(api);

    await service.preparePronunciation(INPUT);
    await service.preparePronunciation({ ...INPUT, userId: 'user-2' });
    service.clearUser('user-1');
    await service.preparePronunciation(INPUT);
    await service.preparePronunciation({ ...INPUT, userId: 'user-2' });

    expect(api.postJson).toHaveBeenCalledTimes(3);
  });

  it('clearAll removes all cached users', async () => {
    const service = createMobileTtsService(api);

    await service.preparePronunciation(INPUT);
    await service.preparePronunciation({ ...INPUT, userId: 'user-2' });
    service.clearAll();
    await service.preparePronunciation(INPUT);
    await service.preparePronunciation({ ...INPUT, userId: 'user-2' });

    expect(api.postJson).toHaveBeenCalledTimes(4);
  });

  it('does not cache a stale completion after vocabulary invalidation', async () => {
    const generation = deferred<unknown>();
    api.postJson.mockReturnValueOnce(generation.promise);
    const service = createMobileTtsService(api);

    const first = service.preparePronunciation(INPUT);
    await vi.waitFor(() => expect(api.postJson).toHaveBeenCalledTimes(1));
    service.invalidatePronunciation('user-1', '水:ミズ');
    generation.resolve(generated());
    await expect(first).resolves.toMatchObject({ source: 'generated' });

    api.postJson.mockResolvedValueOnce(generated(HTTPS_AUDIO, true));
    await service.preparePronunciation(INPUT);
    expect(api.postJson).toHaveBeenCalledTimes(2);
  });

  it('detaches invalidated pending work without aborting its existing awaiters', async () => {
    const oldGeneration = deferred<unknown>();
    const newGeneration = deferred<unknown>();
    api.postJson
      .mockReturnValueOnce(oldGeneration.promise)
      .mockReturnValueOnce(newGeneration.promise);
    const service = createMobileTtsService(api);

    const oldCaller = service.preparePronunciation(INPUT);
    await vi.waitFor(() => expect(api.postJson).toHaveBeenCalledTimes(1));
    service.invalidatePronunciation('user-1', '水:ミズ');
    const newCaller = service.preparePronunciation(INPUT);
    await vi.waitFor(() => expect(api.postJson).toHaveBeenCalledTimes(2));

    oldGeneration.resolve(generated('https://audio.example.test/old.mp3'));
    newGeneration.resolve(generated('https://audio.example.test/new.mp3'));
    await expect(oldCaller).resolves.toMatchObject({
      audioUrl: 'https://audio.example.test/old.mp3',
    });
    await expect(newCaller).resolves.toMatchObject({
      audioUrl: 'https://audio.example.test/new.mp3',
    });
  });

  it.each(['invalidatePronunciation', 'clearUser', 'clearAll'] as const)(
    'does not publish pre-boundary settings work into the current join index after %s',
    async (boundary) => {
      const oldSettings = deferred<unknown>();
      const freshSettings = deferred<unknown>();
      const oldGeneration = deferred<unknown>();
      const freshGeneration = deferred<unknown>();
      api.getJson
        .mockReturnValueOnce(oldSettings.promise)
        .mockReturnValueOnce(freshSettings.promise);
      api.postJson
        .mockReturnValueOnce(oldGeneration.promise)
        .mockReturnValueOnce(freshGeneration.promise);
      const service = createMobileTtsService(api);

      const oldCaller = service.preparePronunciation(INPUT);
      await vi.waitFor(() => expect(api.getJson).toHaveBeenCalledTimes(1));
      if (boundary === 'invalidatePronunciation') {
        service.invalidatePronunciation(INPUT.userId, INPUT.vocabularyId);
      } else if (boundary === 'clearUser') {
        service.clearUser(INPUT.userId);
      } else {
        service.clearAll();
      }

      const freshCaller = service.preparePronunciation(INPUT);
      await vi.waitFor(() => expect(api.getJson).toHaveBeenCalledTimes(2));
      oldSettings.resolve(CONFIGURED_SETTINGS);
      await vi.waitFor(() => expect(api.postJson).toHaveBeenCalledTimes(1));
      freshSettings.resolve(CONFIGURED_SETTINGS);
      await vi.waitFor(() => expect(api.postJson).toHaveBeenCalledTimes(2));

      oldGeneration.resolve(generated('https://audio.example.test/pre-boundary.mp3'));
      freshGeneration.resolve(generated('https://audio.example.test/post-boundary.mp3'));
      await expect(oldCaller).resolves.toMatchObject({
        audioUrl: 'https://audio.example.test/pre-boundary.mp3',
      });
      await expect(freshCaller).resolves.toMatchObject({
        audioUrl: 'https://audio.example.test/post-boundary.mp3',
      });
    },
  );

  it('does not cache a stale completion after clearUser', async () => {
    const generation = deferred<unknown>();
    api.postJson.mockReturnValueOnce(generation.promise);
    const service = createMobileTtsService(api);

    const first = service.preparePronunciation(INPUT);
    await vi.waitFor(() => expect(api.postJson).toHaveBeenCalledTimes(1));
    service.clearUser('user-1');
    generation.resolve(generated());
    await first;

    api.postJson.mockResolvedValueOnce(generated());
    await service.preparePronunciation(INPUT);
    expect(api.postJson).toHaveBeenCalledTimes(2);
  });

  it('does not cache a stale completion after clearAll', async () => {
    const generation = deferred<unknown>();
    api.postJson.mockReturnValueOnce(generation.promise);
    const service = createMobileTtsService(api);

    const first = service.preparePronunciation(INPUT);
    await vi.waitFor(() => expect(api.postJson).toHaveBeenCalledTimes(1));
    service.clearAll();
    generation.resolve(generated());
    await first;

    api.postJson.mockResolvedValueOnce(generated());
    await service.preparePronunciation(INPUT);
    expect(api.postJson).toHaveBeenCalledTimes(2);
  });
});

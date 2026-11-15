import { describe, test, expect, beforeEach, vi } from 'bun:test';
import { createHash } from 'crypto';
import { Hono } from 'hono';
import type { Env } from '../../src/types';

const mockTtsSettingsDB = {
  get: vi.fn(),
  put: vi.fn(),
  putRetainingKey: vi.fn(),
};

const mockS3Client = {
  send: vi.fn(),
};

const mockGetSignedUrl = vi.fn();

const mockTTSProvider = {
  name: 'elevenlabs',
  generate: vi.fn(),
};

vi.mock('../../src/dynamodb', () => ({
  ttsSettings: mockTtsSettingsDB,
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => mockS3Client),
  PutObjectCommand: vi.fn().mockImplementation((params) => ({ ...params, _type: 'PutObject' })),
  GetObjectCommand: vi.fn().mockImplementation((params) => ({ ...params, _type: 'GetObject' })),
  HeadObjectCommand: vi.fn().mockImplementation((params) => ({ ...params, _type: 'HeadObject' })),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));

vi.mock('../../src/tts/factory', () => ({
  createTTSProvider: vi.fn().mockReturnValue(mockTTSProvider),
}));

const mockAuthConfig = {
  userId: 'test-user-id',
  userEmail: 'test@example.com',
};

vi.mock('../../src/middleware/auth', () => ({
  requireAuth: async (_c: any, next: any) => {
    _c.set('userId', mockAuthConfig.userId);
    _c.set('userEmail', mockAuthConfig.userEmail);
    await next();
  },
  AuthContext: {},
}));

// Import AFTER mocks
const { default: createTTSRoute } = await import('../../src/routes/tts');

const TEST_ENV: Env = {
  TTS_AUDIO_BUCKET_NAME: 'test-bucket',
  AWS_REGION: 'us-east-1',
};

function createTestApp(env: Env = TEST_ENV) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    c.env = c.env || {};
    Object.assign(c.env, env);
    await next();
  });
  const ttsRoute = createTTSRoute(env);
  app.route('/', ttsRoute);
  return app;
}

// Mirrors generateCacheKey in src/routes/tts.ts so route tests can prove the
// resolved effective selection is what the S3 cache identity uses.
function expectedCacheKey(provider: string, voiceId: string, model: string): string {
  const settingsHash = createHash('sha256')
    .update(`${provider}:${voiceId}:${model}`)
    .digest('hex')
    .substring(0, 16);
  return `tts/${mockAuthConfig.userId}/vocab-1/${settingsHash}`;
}

// Mirrors the conditional settings-only write the DynamoDB helper performs, so
// interleaving tests can prove a blank-key save does not overwrite a newer row.
function installConditionalRetention(state: { current: Record<string, any> }) {
  mockTtsSettingsDB.putRetainingKey.mockImplementation(
    async (settings: {
      provider: string;
      expected_api_key: string;
      voice_id: string | null;
      model: string | null;
    }) => {
      const current = state.current;
      if (current.provider !== settings.provider || current.api_key !== settings.expected_api_key) {
        return 'stale';
      }
      state.current = {
        ...current,
        provider: settings.provider,
        voice_id: settings.voice_id,
        model: settings.model,
      };
      return 'retained';
    },
  );
}

// Serialize every argument of a console call to a single string so a test can
// assert that a secret or identity-bearing value does not appear anywhere in
// the logged payload (not just as a top-level property).
//
// Error objects have non-enumerable `name`/`message`/`stack`, so
// JSON.stringify(new Error('secret')) returns '{}' and would hide any secret
// embedded in those properties from the leak assertions. Serialize Error
// arguments via their own properties first, then fall back to JSON.stringify
// for everything else.
//
// The JSON.stringify fallback uses a replacer so a nested Error (e.g.
// `{ provider, userId, error: new Error('secret') }`) is also expanded —
// without the replacer JSON.stringify renders a nested Error as `{}` and the
// secret leaks past the assertion. This guards against a regression that
// restores the raw error object inside a logged payload.
function serializeError(error: Error): string {
  return [error.name, error.message, error.stack].filter(Boolean).join('\n');
}

function serializeLogArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return serializeError(arg);
      return JSON.stringify(arg, (_key, value) =>
        value instanceof Error
          ? { name: value.name, message: value.message, stack: value.stack }
          : value,
      );
    })
    .join('\n');
}

describe('serializeLogArgs', () => {
  // The unsafe logging pattern these tests guard against used objects such as
  // `{ provider, userId, error }`. A nested Error's own properties are
  // non-enumerable, so plain JSON.stringify renders it as `{}` and a secret
  // embedded in the error would slip past the leak assertions. The replacer
  // must expand nested Errors so a regression that restores a raw nested
  // error is caught.
  test('expands a nested Error and exposes its message', () => {
    const SECRET_MARKER = 'sk-leaked-nested-secret-XYZ';
    const serialized = serializeLogArgs([
      'TTS provider error',
      { provider: 'elevenlabs', userId: 'test-user-id', error: new Error(SECRET_MARKER) },
    ]);
    expect(serialized).toContain(SECRET_MARKER);
  });

  test('expands a top-level Error argument', () => {
    const serialized = serializeLogArgs([new Error('top-level secret')]);
    expect(serialized).toContain('top-level secret');
  });
});

describe('TTS Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `clearAllMocks` keeps implementations and one-shot queues. POST /settings
    // now reads before writing, so a leaked `...Once` value from a failing test
    // would silently change the next test's stored settings. Reset these mocks
    // to a clean slate per test.
    mockTtsSettingsDB.get.mockReset();
    mockTtsSettingsDB.put.mockReset();
    mockTtsSettingsDB.putRetainingKey.mockReset();
    mockS3Client.send.mockReset();
    mockGetSignedUrl.mockReset();
    mockTTSProvider.generate.mockReset();
    mockAuthConfig.userId = 'test-user-id';
    mockAuthConfig.userEmail = 'test@example.com';
  });

  describe('GET /settings - Get TTS settings', () => {
    test('returns default settings when no settings found', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce(null);

      const app = createTestApp();
      const res = await app.request('/settings');

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        hasApiKey: boolean;
        provider: string;
        voiceId: string;
        model: string;
      };
      expect(body.hasApiKey).toBe(false);
      expect(body.provider).toBe('elevenlabs');
      // Unconfigured users see the same resolved defaults generation would use.
      expect(body.voiceId).toBe('ErXwobaYiN019PkySvjV');
      expect(body.model).toBe('eleven_v4');
    });

    test('returns settings without exposing api key', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'openai',
        api_key: 'secret-key',
        voice_id: 'alloy',
        model: 'gpt-realtime-2.1-mini',
      });

      const app = createTestApp();
      const res = await app.request('/settings');

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        hasApiKey: boolean;
        provider: string;
        voiceId: string;
        model: string;
      };
      expect(body.hasApiKey).toBe(true);
      expect(body.provider).toBe('openai');
      expect(body.voiceId).toBe('alloy');
      expect(body.model).toBe('gpt-realtime-2.1-mini');
      expect((body as any).api_key).toBeUndefined();
    });

    test('resolves legacy stored model and voice to current defaults', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'openai',
        api_key: 'secret-key',
        voice_id: 'nova',
        model: 'tts-1',
      });

      const app = createTestApp();
      const res = await app.request('/settings');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { voiceId: string; model: string };
      expect(body.voiceId).toBe('alloy');
      expect(body.model).toBe('gpt-realtime-2.1-mini');
    });

    test('falls back to elevenlabs for invalid provider value', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'invalid-provider',
        api_key: 'key',
        voice_id: null,
        model: null,
      });

      const app = createTestApp();
      const res = await app.request('/settings');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { provider: string };
      expect(body.provider).toBe('elevenlabs');
    });

    test('invalid provider value warns with the stored value but without the userId', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'invalid-provider',
        api_key: 'key',
        voice_id: null,
        model: null,
      });

      const app = createTestApp();
      await app.request('/settings');

      expect(warnSpy).toHaveBeenCalled();
      const loggedArg = warnSpy.mock.calls[0][1] as Record<string, unknown>;
      expect(loggedArg).toHaveProperty('storedValue', 'invalid-provider');
      expect(loggedArg).not.toHaveProperty('userId');
      expect(serializeLogArgs(warnSpy.mock.calls[0])).not.toContain('test-user-id');
      warnSpy.mockRestore();
    });

    test('resolves malformed stored model and voice to provider defaults', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'gemini',
        api_key: 'gemini-key',
        voice_id: {},
        model: 42,
      });

      const app = createTestApp();
      const res = await app.request('/settings');

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        hasApiKey: true,
        provider: 'gemini',
        voiceId: 'Kore',
        model: 'gemini-3.8-flash-tts',
      });
    });

    test('returns 500 on database error', async () => {
      mockTtsSettingsDB.get.mockRejectedValueOnce(new Error('DDB error'));

      const app = createTestApp();
      const res = await app.request('/settings');

      expect(res.status).toBe(500);
    });

    test('returns gemini settings correctly', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'gemini',
        api_key: 'gemini-key',
        voice_id: 'Kore',
        model: 'gemini-3.8-flash-tts',
      });

      const app = createTestApp();
      const res = await app.request('/settings');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { provider: string; voiceId: string };
      expect(body.provider).toBe('gemini');
      expect(body.voiceId).toBe('Kore');
    });
  });

  describe('POST /settings - Save TTS settings', () => {
    test('saves settings successfully', async () => {
      mockTtsSettingsDB.put.mockResolvedValueOnce(undefined);

      const app = createTestApp();
      const res = await app.request('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'elevenlabs',
          apiKey: 'test-api-key',
          voiceId: 'ErXwobaYiN019PkySvjV',
          model: 'eleven_multilingual_v2',
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; message: string };
      expect(body.success).toBe(true);
      expect(body.message).toContain('saved');
      expect(mockTtsSettingsDB.put).toHaveBeenCalledWith({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'test-api-key',
        voice_id: 'ErXwobaYiN019PkySvjV',
        model: 'eleven_multilingual_v2',
      });
    });

    test('retains the stored key when apiKey is omitted for the same provider', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'stored-secret-key',
        voice_id: 'ErXwobaYiN019PkySvjV',
        model: 'eleven_v4',
      });
      mockTtsSettingsDB.putRetainingKey.mockResolvedValueOnce('retained');

      const app = createTestApp();
      const res = await app.request('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'elevenlabs',
          voiceId: 'ErXwobaYiN019PkySvjV',
          model: 'eleven_multilingual_v2',
        }),
      });

      expect(res.status).toBe(200);
      // The settings-only conditional write leaves the credential untouched.
      expect(mockTtsSettingsDB.put).not.toHaveBeenCalled();
      expect(mockTtsSettingsDB.putRetainingKey).toHaveBeenCalledWith({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        expected_api_key: 'stored-secret-key',
        voice_id: 'ErXwobaYiN019PkySvjV',
        model: 'eleven_multilingual_v2',
      });
      expect(JSON.stringify(await res.json())).not.toContain('stored-secret-key');
    });

    test('retains the stored key when apiKey is blank for the same provider', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'openai',
        api_key: 'stored-openai-key',
        voice_id: 'alloy',
        model: 'gpt-realtime-2.1-mini',
      });
      mockTtsSettingsDB.putRetainingKey.mockResolvedValueOnce('retained');

      const app = createTestApp();
      const res = await app.request('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai',
          apiKey: '   ',
          voiceId: 'alloy',
          model: 'gpt-realtime-2.1-mini',
        }),
      });

      expect(res.status).toBe(200);
      expect(mockTtsSettingsDB.put).not.toHaveBeenCalled();
      expect(mockTtsSettingsDB.putRetainingKey).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'openai', expected_api_key: 'stored-openai-key' }),
      );
    });

    test('rejects a provider switch without an API key and keeps the old secret', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'stored-secret-key',
        voice_id: 'ErXwobaYiN019PkySvjV',
        model: 'eleven_v4',
      });

      const app = createTestApp();
      const res = await app.request('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai',
          voiceId: 'alloy',
          model: 'gpt-realtime-2.1-mini',
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toEqual({
        error: 'TTS API key required. Enter a key for this provider.',
        code: 'tts_not_configured',
      });
      expect(JSON.stringify(body)).not.toContain('stored-secret-key');
      expect(mockTtsSettingsDB.put).not.toHaveBeenCalled();
    });

    test('rejects a first-time save without an API key', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce(null);

      const app = createTestApp();
      const res = await app.request('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'elevenlabs',
          voiceId: 'ErXwobaYiN019PkySvjV',
          model: 'eleven_v4',
        }),
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'TTS API key required. Enter a key for this provider.',
        code: 'tts_not_configured',
      });
      expect(mockTtsSettingsDB.put).not.toHaveBeenCalled();
    });

    test('rejects a same-provider save when the stored row has no key', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: '',
        voice_id: null,
        model: null,
      });

      const app = createTestApp();
      const res = await app.request('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'elevenlabs' }),
      });

      expect(res.status).toBe(400);
      expect(mockTtsSettingsDB.put).not.toHaveBeenCalled();
      expect(mockTtsSettingsDB.putRetainingKey).not.toHaveBeenCalled();
    });

    test('rejects a same-provider save when the stored key is whitespace only', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: '   ',
        voice_id: null,
        model: null,
      });

      const app = createTestApp();
      const res = await app.request('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'elevenlabs' }),
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'TTS API key required. Enter a key for this provider.',
        code: 'tts_not_configured',
      });
      expect(mockTtsSettingsDB.put).not.toHaveBeenCalled();
      expect(mockTtsSettingsDB.putRetainingKey).not.toHaveBeenCalled();
    });

    test('rejects a same-provider save when the stored key is not a string', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 42,
        voice_id: null,
        model: null,
      });

      const app = createTestApp();
      const res = await app.request('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'elevenlabs' }),
      });

      expect(res.status).toBe(400);
      expect(mockTtsSettingsDB.put).not.toHaveBeenCalled();
      expect(mockTtsSettingsDB.putRetainingKey).not.toHaveBeenCalled();
    });

    test('a supplied key replaces the stored key for the same provider', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'old-secret-key',
        voice_id: null,
        model: null,
      });
      mockTtsSettingsDB.put.mockResolvedValueOnce(undefined);

      const app = createTestApp();
      const res = await app.request('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'elevenlabs', apiKey: 'new-secret-key' }),
      });

      expect(res.status).toBe(200);
      expect(mockTtsSettingsDB.put).toHaveBeenCalledWith(
        expect.objectContaining({ api_key: 'new-secret-key' }),
      );
    });

    test('a retained key is used by generation and never exposed by GET /settings', async () => {
      mockTtsSettingsDB.get.mockResolvedValue({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'stored-secret-key',
        voice_id: 'ErXwobaYiN019PkySvjV',
        model: 'eleven_v4',
      });
      mockTtsSettingsDB.putRetainingKey.mockResolvedValueOnce('retained');
      const notFoundError = new Error('Not found');
      (notFoundError as any).name = 'NotFound';
      mockS3Client.send.mockRejectedValueOnce(notFoundError);
      mockTTSProvider.generate.mockResolvedValueOnce({
        audioBuffer: Buffer.from('audio-data'),
        contentType: 'audio/mpeg',
      });
      mockS3Client.send.mockResolvedValueOnce({});
      mockGetSignedUrl.mockResolvedValueOnce('https://s3.example.com/new-audio.mp3');

      const app = createTestApp();
      const saveRes = await app.request('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'elevenlabs', model: 'eleven_v4' }),
      });
      expect(saveRes.status).toBe(200);
      expect(mockTtsSettingsDB.put).not.toHaveBeenCalled();
      expect(mockTtsSettingsDB.putRetainingKey).toHaveBeenCalledWith(
        expect.objectContaining({ expected_api_key: 'stored-secret-key' }),
      );

      const settingsRes = await app.request('/settings');
      const settingsBody = (await settingsRes.json()) as Record<string, unknown>;
      expect(settingsBody).toEqual({
        hasApiKey: true,
        provider: 'elevenlabs',
        voiceId: 'ErXwobaYiN019PkySvjV',
        model: 'eleven_v4',
      });
      expect(JSON.stringify(settingsBody)).not.toContain('stored-secret-key');

      const generateRes = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });
      expect(generateRes.status).toBe(200);
      expect(mockTTSProvider.generate).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'stored-secret-key' }),
      );
    });

    test('a key replacement completed after the read is not overwritten', async () => {
      const state = {
        current: {
          user_id: 'test-user-id',
          provider: 'elevenlabs',
          api_key: 'old-key',
          voice_id: 'ErXwobaYiN019PkySvjV',
          model: 'eleven_v4',
        } as Record<string, any>,
      };
      installConditionalRetention(state);
      mockTtsSettingsDB.put.mockImplementationOnce(async (settings: Record<string, any>) => {
        state.current = { ...settings };
      });

      // Hold the blank-key save after it has read the row, so the replacement
      // can commit before its conditional write runs.
      let releaseRead!: () => void;
      const readGate = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      let readObserved!: () => void;
      const readDone = new Promise<void>((resolve) => {
        readObserved = resolve;
      });
      mockTtsSettingsDB.get.mockImplementationOnce(async () => {
        const observed = { ...state.current };
        readObserved();
        await readGate;
        return observed;
      });

      const app = createTestApp();
      const blankSave = app.request('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'elevenlabs', model: 'eleven_multilingual_v2' }),
      });
      await readDone;

      const replacement = await app.request('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'elevenlabs', apiKey: 'new-key' }),
      });
      expect(replacement.status).toBe(200);

      releaseRead();
      const blankRes = await blankSave;

      expect(blankRes.status).toBe(409);
      expect(await blankRes.json()).toEqual({
        error: 'TTS settings changed while saving. Please reload and try again.',
      });
      expect(state.current.api_key).toBe('new-key');
      expect(mockTtsSettingsDB.put).toHaveBeenCalledTimes(1);
    });

    test('a provider switch completed after the read is not restored without a key', async () => {
      const state = {
        current: {
          user_id: 'test-user-id',
          provider: 'elevenlabs',
          api_key: 'old-key',
          voice_id: 'ErXwobaYiN019PkySvjV',
          model: 'eleven_v4',
        } as Record<string, any>,
      };
      installConditionalRetention(state);
      mockTtsSettingsDB.put.mockImplementationOnce(async (settings: Record<string, any>) => {
        state.current = { ...settings };
      });

      let releaseRead!: () => void;
      const readGate = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      let readObserved!: () => void;
      const readDone = new Promise<void>((resolve) => {
        readObserved = resolve;
      });
      mockTtsSettingsDB.get.mockImplementationOnce(async () => {
        const observed = { ...state.current };
        readObserved();
        await readGate;
        return observed;
      });

      const app = createTestApp();
      const blankSave = app.request('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'elevenlabs', model: 'eleven_multilingual_v2' }),
      });
      await readDone;

      const replacement = await app.request('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai',
          apiKey: 'openai-key',
          voiceId: 'alloy',
          model: 'gpt-realtime-2.1-mini',
        }),
      });
      expect(replacement.status).toBe(200);

      releaseRead();
      const blankRes = await blankSave;

      expect(blankRes.status).toBe(409);
      expect(state.current.provider).toBe('openai');
      expect(state.current.api_key).toBe('openai-key');
    });

    test('rejects retention when the observed row is already stale', async () => {
      const state = {
        current: {
          user_id: 'test-user-id',
          provider: 'elevenlabs',
          api_key: 'new-key',
          voice_id: 'ErXwobaYiN019PkySvjV',
          model: 'eleven_v4',
        } as Record<string, any>,
      };
      installConditionalRetention(state);
      // A stale (eventually consistent) read hands the route an obsolete row.
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'old-key',
        voice_id: 'ErXwobaYiN019PkySvjV',
        model: 'eleven_v4',
      });

      const app = createTestApp();
      const res = await app.request('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'elevenlabs', model: 'eleven_multilingual_v2' }),
      });

      expect(res.status).toBe(409);
      expect(state.current.api_key).toBe('new-key');
      expect(state.current.model).toBe('eleven_v4');
      expect(mockTtsSettingsDB.put).not.toHaveBeenCalled();
      expect(mockTtsSettingsDB.putRetainingKey).toHaveBeenCalledWith(
        expect.objectContaining({ expected_api_key: 'old-key' }),
      );
    });

    test('saves settings with null voiceId and model', async () => {
      mockTtsSettingsDB.put.mockResolvedValueOnce(undefined);

      const app = createTestApp();
      const res = await app.request('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai',
          apiKey: 'test-api-key',
        }),
      });

      expect(res.status).toBe(200);
      expect(mockTtsSettingsDB.put).toHaveBeenCalledWith(
        expect.objectContaining({
          voice_id: null,
          model: null,
        }),
      );
    });

    test('saves an optional custom ElevenLabs voice ID', async () => {
      mockTtsSettingsDB.put.mockResolvedValueOnce(undefined);

      const app = createTestApp();
      const res = await app.request('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'elevenlabs',
          apiKey: 'test-api-key',
          voiceId: '21m00Tcm4TlvDq8ikWAM',
          model: 'eleven_v4',
        }),
      });

      expect(res.status).toBe(200);
      expect(mockTtsSettingsDB.put).toHaveBeenCalledWith(
        expect.objectContaining({ voice_id: '21m00Tcm4TlvDq8ikWAM', model: 'eleven_v4' }),
      );
    });

    test('rejects an unsupported model for the provider', async () => {
      const app = createTestApp();
      const res = await app.request('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai',
          apiKey: 'test-api-key',
          voiceId: 'alloy',
          model: 'tts-1',
        }),
      });

      expect(res.status).toBe(400);
      expect(mockTtsSettingsDB.put).not.toHaveBeenCalled();
    });

    test('rejects an unsupported voice for the provider', async () => {
      const app = createTestApp();
      const res = await app.request('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'gemini',
          apiKey: 'test-api-key',
          voiceId: 'Iocaste',
          model: 'gemini-3.8-flash-tts',
        }),
      });

      expect(res.status).toBe(400);
      expect(mockTtsSettingsDB.put).not.toHaveBeenCalled();
    });

    test('rejects a model that belongs to another provider', async () => {
      const app = createTestApp();
      const res = await app.request('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'elevenlabs',
          apiKey: 'test-api-key',
          voiceId: '21m00Tcm4TlvDq8ikWAM',
          model: 'gpt-realtime-2.1-mini',
        }),
      });

      expect(res.status).toBe(400);
      expect(mockTtsSettingsDB.put).not.toHaveBeenCalled();
    });

    test('returns 400 for invalid provider', async () => {
      const app = createTestApp();
      const res = await app.request('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'invalid-provider',
          apiKey: 'test-api-key',
        }),
      });

      expect(res.status).toBe(400);
    });

    test('returns 400 when apiKey is missing for a user with no stored settings', async () => {
      const app = createTestApp();
      const res = await app.request('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'elevenlabs',
        }),
      });

      expect(res.status).toBe(400);
    });

    test('returns 500 on database error', async () => {
      mockTtsSettingsDB.put.mockRejectedValueOnce(new Error('DDB error'));

      const app = createTestApp();
      const res = await app.request('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'elevenlabs',
          apiKey: 'test-api-key',
        }),
      });

      expect(res.status).toBe(500);
    });
  });

  describe('POST /generate - Generate TTS audio', () => {
    test('returns cached audio URL when already cached in S3', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'test-api-key',
        voice_id: null,
        model: null,
      });
      mockS3Client.send.mockResolvedValueOnce({}); // HeadObject succeeds (cache hit)
      mockGetSignedUrl.mockResolvedValueOnce('https://s3.example.com/audio.mp3');

      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        audioUrl: string;
        cached: boolean;
        effectiveSettings?: { provider: string; voiceId: string | null; model: string | null };
      };
      expect(body.audioUrl).toBe('https://s3.example.com/audio.mp3');
      expect(body.cached).toBe(true);
      // The cache-hit response echoes the effective settings used to derive the
      // S3 key so clients can detect a GET/POST settings race. Legacy nulls are
      // resolved to the current provider defaults.
      expect(body.effectiveSettings).toEqual({
        provider: 'elevenlabs',
        voiceId: 'ErXwobaYiN019PkySvjV',
        model: 'eleven_v4',
      });
      expect(mockTTSProvider.generate).not.toHaveBeenCalled();
    });

    test('generates new audio when not cached', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'test-api-key',
        voice_id: null,
        model: null,
      });
      // HeadObject throws NotFound (cache miss)
      const notFoundError = new Error('Not found');
      (notFoundError as any).name = 'NotFound';
      mockS3Client.send.mockRejectedValueOnce(notFoundError);
      // TTS generation succeeds
      mockTTSProvider.generate.mockResolvedValueOnce({
        audioBuffer: Buffer.from('audio-data'),
        contentType: 'audio/mpeg',
      });
      // S3 upload succeeds
      mockS3Client.send.mockResolvedValueOnce({});
      // Get signed URL after upload
      mockGetSignedUrl.mockResolvedValueOnce('https://s3.example.com/new-audio.mp3');

      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        audioUrl: string;
        cached: boolean;
        effectiveSettings?: { provider: string; voiceId: string | null; model: string | null };
      };
      expect(body.audioUrl).toBe('https://s3.example.com/new-audio.mp3');
      expect(body.cached).toBe(false);
      // The generation response reports the effective settings the backend
      // used, so the mobile client can skip caching on a GET/POST race.
      expect(body.effectiveSettings).toEqual({
        provider: 'elevenlabs',
        voiceId: 'ErXwobaYiN019PkySvjV',
        model: 'eleven_v4',
      });
      // Adapters receive resolved, non-null values and never choose defaults.
      expect(mockTTSProvider.generate).toHaveBeenCalledWith({
        text: '日本語',
        apiKey: 'test-api-key',
        voiceId: 'ErXwobaYiN019PkySvjV',
        model: 'eleven_v4',
      });
      expect(mockTTSProvider.generate).toHaveBeenCalledTimes(1);
    });

    test('resolves malformed stored model and voice and uses one effective selection', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'gemini',
        api_key: 'gemini-key',
        voice_id: {},
        model: 42,
      });
      const notFoundError = new Error('Not found');
      (notFoundError as any).name = 'NotFound';
      mockS3Client.send.mockRejectedValueOnce(notFoundError);
      mockTTSProvider.generate.mockResolvedValueOnce({
        audioBuffer: Buffer.from('audio-data'),
        contentType: 'audio/wav',
      });
      mockS3Client.send.mockResolvedValueOnce({});
      mockGetSignedUrl.mockResolvedValueOnce('https://s3.example.com/new-audio.wav');

      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        effectiveSettings?: { provider: string; voiceId: string; model: string };
      };
      expect(body.effectiveSettings).toEqual({
        provider: 'gemini',
        voiceId: 'Kore',
        model: 'gemini-3.8-flash-tts',
      });
      expect(mockTTSProvider.generate).toHaveBeenCalledWith({
        text: '日本語',
        apiKey: 'gemini-key',
        voiceId: 'Kore',
        model: 'gemini-3.8-flash-tts',
      });
      const headCommand = mockS3Client.send.mock.calls[0][0] as { Key: string };
      expect(headCommand.Key).toBe(expectedCacheKey('gemini', 'Kore', 'gemini-3.8-flash-tts'));
    });

    test('reuses the same cache key for the same resolved model and reports the hit', async () => {
      const settings = {
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'test-api-key',
        voice_id: null,
        model: 'eleven_v4',
      };
      mockTtsSettingsDB.get.mockResolvedValue(settings);
      const notFoundError = new Error('Not found');
      (notFoundError as any).name = 'NotFound';
      mockS3Client.send
        .mockRejectedValueOnce(notFoundError) // first request: cache miss
        .mockResolvedValueOnce({}) // first request: upload
        .mockResolvedValueOnce({}); // second request: cache hit
      mockTTSProvider.generate.mockResolvedValueOnce({
        audioBuffer: Buffer.from('audio-data'),
        contentType: 'audio/mpeg',
      });
      mockGetSignedUrl
        .mockResolvedValueOnce('https://s3.example.com/generated.mp3')
        .mockResolvedValueOnce('https://s3.example.com/cached.mp3');

      const app = createTestApp();
      const generate = () =>
        app.request('/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
        });

      const firstRes = await generate();
      expect(firstRes.status).toBe(200);
      expect(((await firstRes.json()) as { cached: boolean }).cached).toBe(false);

      const secondRes = await generate();
      expect(secondRes.status).toBe(200);
      const secondBody = (await secondRes.json()) as { cached: boolean };
      expect(secondBody.cached).toBe(true);
      expect(mockTTSProvider.generate).toHaveBeenCalledTimes(1);

      const commands = mockS3Client.send.mock.calls.map(
        ([command]) => command as { _type: string; Key: string },
      );
      expect(commands.map(({ _type }) => _type)).toEqual(['HeadObject', 'PutObject', 'HeadObject']);
      const expectedKey = expectedCacheKey('elevenlabs', 'ErXwobaYiN019PkySvjV', 'eleven_v4');
      expect(commands[0].Key).toBe(expectedKey);
      expect(commands[1].Key).toBe(expectedKey);
      expect(commands[2].Key).toBe(expectedKey);
    });

    test('a changed model uses a distinct cache key and misses the old cached object', async () => {
      mockTtsSettingsDB.get
        .mockResolvedValueOnce({
          user_id: 'test-user-id',
          provider: 'elevenlabs',
          api_key: 'test-api-key',
          voice_id: null,
          model: 'eleven_v4',
        })
        .mockResolvedValueOnce({
          user_id: 'test-user-id',
          provider: 'elevenlabs',
          api_key: 'test-api-key',
          voice_id: null,
          model: 'eleven_multilingual_v2',
        });
      const notFoundError = new Error('Not found');
      (notFoundError as any).name = 'NotFound';
      // The changed model is a different S3 object, so it also misses.
      mockS3Client.send
        .mockRejectedValueOnce(notFoundError)
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(notFoundError)
        .mockResolvedValueOnce({});
      mockTTSProvider.generate.mockResolvedValue({
        audioBuffer: Buffer.from('audio-data'),
        contentType: 'audio/mpeg',
      });
      mockGetSignedUrl
        .mockResolvedValueOnce('https://s3.example.com/v4.mp3')
        .mockResolvedValueOnce('https://s3.example.com/multilingual.mp3');

      const app = createTestApp();
      const generate = () =>
        app.request('/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
        });

      const firstBody = (await (await generate()).json()) as {
        cached: boolean;
        effectiveSettings: { model: string };
      };
      const secondBody = (await (await generate()).json()) as {
        cached: boolean;
        effectiveSettings: { model: string };
      };
      expect(firstBody.cached).toBe(false);
      expect(firstBody.effectiveSettings.model).toBe('eleven_v4');
      expect(secondBody.cached).toBe(false);
      expect(secondBody.effectiveSettings.model).toBe('eleven_multilingual_v2');

      const headKeys = mockS3Client.send.mock.calls
        .map(([command]) => command as { _type: string; Key: string })
        .filter(({ _type }) => _type === 'HeadObject')
        .map(({ Key }) => Key);
      expect(headKeys).toHaveLength(2);
      expect(headKeys[0]).toBe(expectedCacheKey('elevenlabs', 'ErXwobaYiN019PkySvjV', 'eleven_v4'));
      expect(headKeys[1]).toBe(
        expectedCacheKey('elevenlabs', 'ErXwobaYiN019PkySvjV', 'eleven_multilingual_v2'),
      );
      expect(headKeys[0]).not.toBe(headKeys[1]);
    });

    test('generation then lookup share the cache key and report matching effectiveSettings', async () => {
      const settings = {
        user_id: 'test-user-id',
        provider: 'gemini',
        api_key: 'gemini-key',
        voice_id: null,
        model: null,
      };
      mockTtsSettingsDB.get.mockResolvedValue(settings);
      const notFoundError = new Error('Not found');
      (notFoundError as any).name = 'NotFound';
      mockS3Client.send
        .mockRejectedValueOnce(notFoundError) // generate: cache miss
        .mockResolvedValueOnce({}) // generate: upload
        .mockResolvedValueOnce({}); // lookup: cache hit
      mockTTSProvider.generate.mockResolvedValueOnce({
        audioBuffer: Buffer.from('audio-data'),
        contentType: 'audio/wav',
      });
      mockGetSignedUrl
        .mockResolvedValueOnce('https://s3.example.com/generated.wav')
        .mockResolvedValueOnce('https://s3.example.com/looked-up.wav');

      const app = createTestApp();
      const generateRes = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });
      const generateBody = (await generateRes.json()) as {
        cached: boolean;
        effectiveSettings: { provider: string; voiceId: string; model: string };
      };
      expect(generateBody.cached).toBe(false);
      expect(generateBody.effectiveSettings).toEqual({
        provider: 'gemini',
        voiceId: 'Kore',
        model: 'gemini-3.8-flash-tts',
      });

      const lookupRes = await app.request('/audio/vocab-1');
      expect(lookupRes.status).toBe(200);
      const lookupBody = (await lookupRes.json()) as {
        effectiveSettings: { provider: string; voiceId: string; model: string };
      };
      expect(lookupBody.effectiveSettings).toEqual(generateBody.effectiveSettings);

      const headKeys = mockS3Client.send.mock.calls
        .map(([command]) => command as { _type: string; Key: string })
        .filter(({ _type }) => _type === 'HeadObject')
        .map(({ Key }) => Key);
      expect(headKeys).toEqual([
        expectedCacheKey('gemini', 'Kore', 'gemini-3.8-flash-tts'),
        expectedCacheKey('gemini', 'Kore', 'gemini-3.8-flash-tts'),
      ]);
    });

    test('concurrent generations under different settings keep separate cache identities', async () => {
      mockTtsSettingsDB.get
        .mockResolvedValueOnce({
          user_id: 'test-user-id',
          provider: 'openai',
          api_key: 'openai-key',
          voice_id: 'alloy',
          model: 'gpt-realtime-2.1-mini',
        })
        .mockResolvedValueOnce({
          user_id: 'test-user-id',
          provider: 'gemini',
          api_key: 'gemini-key',
          voice_id: 'Puck',
          model: 'gemini-3.8-flash-lite-tts',
        });
      const notFoundError = new Error('Not found');
      (notFoundError as any).name = 'NotFound';
      // Concurrent requests interleave, so key each response by command type
      // instead of relying on a fixed call order.
      mockS3Client.send.mockImplementation(async (command: { _type: string }) => {
        if (command._type === 'HeadObject') throw notFoundError;
        return {};
      });
      mockTTSProvider.generate.mockResolvedValue({
        audioBuffer: Buffer.from('audio-data'),
        contentType: 'audio/wav',
      });
      mockGetSignedUrl.mockResolvedValue('https://s3.example.com/audio.wav');

      const app = createTestApp();
      const generate = () =>
        app.request('/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
        });

      const [openAiRes, geminiRes] = await Promise.all([generate(), generate()]);
      const openAiBody = (await openAiRes.json()) as {
        cached: boolean;
        effectiveSettings: { provider: string; voiceId: string; model: string };
      };
      const geminiBody = (await geminiRes.json()) as {
        cached: boolean;
        effectiveSettings: { provider: string; voiceId: string; model: string };
      };
      expect(openAiBody.cached).toBe(false);
      expect(geminiBody.cached).toBe(false);
      expect(openAiBody.effectiveSettings).toEqual({
        provider: 'openai',
        voiceId: 'alloy',
        model: 'gpt-realtime-2.1-mini',
      });
      expect(geminiBody.effectiveSettings).toEqual({
        provider: 'gemini',
        voiceId: 'Puck',
        model: 'gemini-3.8-flash-lite-tts',
      });

      const headKeys = new Set(
        mockS3Client.send.mock.calls
          .map(([command]) => command as { _type: string; Key: string })
          .filter(({ _type }) => _type === 'HeadObject')
          .map(({ Key }) => Key),
      );
      expect(headKeys.size).toBe(2);
    });

    test('a rejected transcript fails without uploading audio and without leaking the body', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'openai',
        api_key: 'openai-key',
        voice_id: 'alloy',
        model: 'gpt-realtime-2.1-mini',
      });
      const notFoundError = new Error('Not found');
      (notFoundError as any).name = 'NotFound';
      mockS3Client.send.mockRejectedValueOnce(notFoundError);
      mockTTSProvider.generate.mockRejectedValueOnce(
        new Error('OpenAI Realtime TTS transcript was missing or implausible'),
      );

      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: 'Failed to generate TTS audio',
        code: 'tts_generation_failed',
      });
      expect(mockS3Client.send).toHaveBeenCalledTimes(1);
      expect((mockS3Client.send.mock.calls[0][0] as { _type: string })._type).toBe('HeadObject');
      expect(mockGetSignedUrl).not.toHaveBeenCalled();
      expect(serializeLogArgs(errorSpy.mock.calls[0])).not.toContain('transcript was missing');
      errorSpy.mockRestore();
    });

    test('returns a stable code when TTS is not configured', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce(null);

      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'TTS API key not configured. Please configure in Settings.',
        code: 'tts_not_configured',
      });
    });

    test('returns 500 when TTS_AUDIO_BUCKET_NAME is not configured', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'test-api-key',
        voice_id: null,
        model: null,
      });

      const app = createTestApp({ AWS_REGION: 'us-east-1' }); // No bucket name
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: 'TTS audio bucket not configured',
        code: 'tts_audio_bucket_not_configured',
      });
    });

    test('returns 400 for invalid provider in settings', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'invalid-provider',
        api_key: 'test-api-key',
        voice_id: null,
        model: null,
      });

      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'Invalid TTS provider configuration',
        code: 'tts_invalid_provider_configuration',
      });
    });

    test('returns 400 when vocabularyId is missing', async () => {
      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '日本語' }),
      });

      expect(res.status).toBe(400);
    });

    test('returns 400 when text is missing', async () => {
      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1' }),
      });

      expect(res.status).toBe(400);
    });

    test('leaves request-validator failures uncoded', async () => {
      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: '', text: '' }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { success: boolean; code?: string };
      expect(body).toMatchObject({ success: false });
      expect(body).not.toHaveProperty('code');
    });

    test('returns 503 when S3 cache check fails with unexpected error', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'test-api-key',
        voice_id: null,
        model: null,
      });
      const serviceError = new Error('Service unavailable');
      (serviceError as any).name = 'ServiceUnavailable';
      mockS3Client.send.mockRejectedValueOnce(serviceError);

      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({
        error: 'Audio service temporarily unavailable. Please try again.',
        code: 'tts_audio_service_unavailable',
      });
    });

    test('returns 504 when TTS provider times out', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'test-api-key',
        voice_id: null,
        model: null,
      });
      const notFoundError = new Error('Not found');
      (notFoundError as any).name = 'NotFound';
      mockS3Client.send.mockRejectedValueOnce(notFoundError);
      const timeoutError = new Error('The operation was aborted');
      timeoutError.name = 'TimeoutError';
      mockTTSProvider.generate.mockRejectedValueOnce(timeoutError);

      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      expect(res.status).toBe(504);
      expect(await res.json()).toEqual({
        error: 'TTS generation timed out',
        code: 'tts_generation_timeout',
      });
    });

    test('returns 500 when a provider error only mentions timeout in its message', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'test-api-key',
        voice_id: null,
        model: null,
      });
      const notFoundError = new Error('Not found');
      (notFoundError as any).name = 'NotFound';
      mockS3Client.send.mockRejectedValueOnce(notFoundError);
      mockTTSProvider.generate.mockRejectedValueOnce(new Error('upstream said timeout'));

      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: 'Failed to generate TTS audio',
        code: 'tts_generation_failed',
      });
    });

    test('returns 500 when TTS provider fails', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'test-api-key',
        voice_id: null,
        model: null,
      });
      const notFoundError = new Error('Not found');
      (notFoundError as any).name = 'NotFound';
      mockS3Client.send.mockRejectedValueOnce(notFoundError);
      mockTTSProvider.generate.mockRejectedValueOnce(new Error('API error'));

      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: 'Failed to generate TTS audio',
        code: 'tts_generation_failed',
      });
    });

    test('returns 500 when S3 upload fails', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'test-api-key',
        voice_id: null,
        model: null,
      });
      const notFoundError = new Error('Not found');
      (notFoundError as any).name = 'NotFound';
      mockS3Client.send.mockRejectedValueOnce(notFoundError);
      mockTTSProvider.generate.mockResolvedValueOnce({
        audioBuffer: Buffer.from('audio-data'),
        contentType: 'audio/mpeg',
      });
      mockS3Client.send.mockRejectedValueOnce(new Error('S3 upload failed'));

      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: 'Audio was generated but could not be saved. Please try again.',
        code: 'tts_audio_storage_failed',
      });
    });

    test('S3 cache check failure logs sanitized error without s3Key, userId, bucket, or error message', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'test-api-key',
        voice_id: null,
        model: null,
      });
      mockS3Client.send.mockRejectedValueOnce(new Error('S3 connection reset'));

      const app = createTestApp();
      await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      const loggedArg = errorSpy.mock.calls[0][1] as Record<string, unknown>;
      expect(loggedArg).not.toHaveProperty('s3Key');
      expect(loggedArg).not.toHaveProperty('userId');
      expect(loggedArg).not.toHaveProperty('bucket');
      expect(loggedArg).not.toHaveProperty('error');
      expect(loggedArg).not.toHaveProperty('errorMessage');
      expect(loggedArg).toHaveProperty('errorName', 'Error');
      expect(loggedArg).toHaveProperty('category', 's3_cache_lookup');
      // The raw error message must not leak into any serialized log argument.
      expect(serializeLogArgs(errorSpy.mock.calls[0])).not.toContain('S3 connection reset');
      expect(serializeLogArgs(errorSpy.mock.calls[0])).not.toContain('test-user-id');
      expect(serializeLogArgs(errorSpy.mock.calls[0])).not.toContain('test-bucket');
      errorSpy.mockRestore();
    });

    test('provider error logs no upstream body, userId, bucket, or s3 key', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'test-api-key',
        voice_id: null,
        model: null,
      });
      const notFoundError = new Error('Not found');
      (notFoundError as any).name = 'NotFound';
      mockS3Client.send.mockRejectedValueOnce(notFoundError);
      // Mirrors OpenAIProvider/ElevenLabsProvider/GeminiProvider, which embed the
      // full upstream response body in error.message. The secret and user id
      // embedded here must not reach application logs.
      const SECRET_MARKER = 'sk-leaked-upstream-secret-XYZ';
      mockTTSProvider.generate.mockRejectedValueOnce(
        new Error(`OpenAI TTS API error 401: {"secret":"${SECRET_MARKER}","user":"test-user-id"}`),
      );

      const app = createTestApp();
      await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      const loggedArg = errorSpy.mock.calls[0][1] as Record<string, unknown>;
      expect(loggedArg).not.toHaveProperty('userId');
      expect(loggedArg).not.toHaveProperty('bucket');
      expect(loggedArg).not.toHaveProperty('s3Key');
      expect(loggedArg).not.toHaveProperty('error');
      expect(loggedArg).not.toHaveProperty('errorMessage');
      expect(loggedArg).toHaveProperty('errorName', 'Error');
      expect(loggedArg).toHaveProperty('category', 'provider_generate');
      const serialized = serializeLogArgs(errorSpy.mock.calls[0]);
      expect(serialized).not.toContain(SECRET_MARKER);
      expect(serialized).not.toContain('test-user-id');
      expect(serialized).not.toContain('test-bucket');
      errorSpy.mockRestore();
    });

    test('outer catch logs sanitized error and returns unexpected-error code', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockTtsSettingsDB.get.mockRejectedValueOnce(new Error('DynamoDB connection lost'));

      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: 'Failed to generate TTS audio',
        code: 'tts_unexpected_error',
      });
      const loggedArg = errorSpy.mock.calls[0][1] as Record<string, unknown>;
      expect(loggedArg).toHaveProperty('errorName', 'Error');
      expect(loggedArg).toHaveProperty('category', 'unexpected');
      expect(loggedArg).not.toHaveProperty('errorMessage');
      expect(serializeLogArgs(errorSpy.mock.calls[0])).not.toContain('DynamoDB connection lost');
      errorSpy.mockRestore();
    });

    test('sanitizeError maps an unknown error name to UnknownError and does not leak the raw name', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const SECRET_MARKER = 'sk-leaked-name-secret-XYZ';
      // error.name is writable; a hostile or third-party error can place
      // arbitrary content (secrets, response bodies, object keys) in it.
      // The sanitizer must normalize it through the allowlist and never emit
      // the raw value.
      const hostileError = new Error('upstream body');
      hostileError.name = `HostileError:${SECRET_MARKER}`;
      mockTtsSettingsDB.get.mockRejectedValueOnce(hostileError);

      const app = createTestApp();
      await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      const loggedArg = errorSpy.mock.calls[0][1] as Record<string, unknown>;
      expect(loggedArg).toHaveProperty('errorName', 'UnknownError');
      expect(loggedArg).not.toHaveProperty('errorMessage');
      expect(serializeLogArgs(errorSpy.mock.calls[0])).not.toContain(SECRET_MARKER);
      errorSpy.mockRestore();
    });
  });

  describe('GET /audio/:vocabularyId - Get cached audio URL', () => {
    test('returns presigned URL when audio is cached', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'test-api-key',
        voice_id: null,
        model: null,
      });
      mockS3Client.send.mockResolvedValueOnce({}); // HeadObject succeeds
      mockGetSignedUrl.mockResolvedValueOnce('https://s3.example.com/cached-audio.mp3');

      const app = createTestApp();
      const res = await app.request('/audio/vocab-1');

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        audioUrl: string;
        effectiveSettings?: { provider: string; voiceId: string | null; model: string | null };
      };
      expect(body.audioUrl).toBe('https://s3.example.com/cached-audio.mp3');
      // The audio lookup response echoes the effective settings used to derive
      // the S3 key so clients can detect a GET settings / GET audio race.
      expect(body.effectiveSettings).toEqual({
        provider: 'elevenlabs',
        voiceId: 'ErXwobaYiN019PkySvjV',
        model: 'eleven_v4',
      });
    });

    test('echoes effective settings with non-null voice and model', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'openai',
        api_key: 'test-api-key',
        voice_id: 'alloy',
        model: 'gpt-realtime-2.1-mini',
      });
      mockS3Client.send.mockResolvedValueOnce({}); // HeadObject succeeds
      mockGetSignedUrl.mockResolvedValueOnce('https://s3.example.com/cached-audio.mp3');

      const app = createTestApp();
      const res = await app.request('/audio/vocab-1');

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        audioUrl: string;
        effectiveSettings?: { provider: string; voiceId: string | null; model: string | null };
      };
      expect(body.effectiveSettings).toEqual({
        provider: 'openai',
        voiceId: 'alloy',
        model: 'gpt-realtime-2.1-mini',
      });
    });

    test('resolves legacy stored audio settings to current defaults', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'gemini',
        api_key: 'test-api-key',
        voice_id: 'Iocaste',
        model: 'gemini-2.5-flash-preview-tts',
      });
      mockS3Client.send.mockResolvedValueOnce({}); // HeadObject succeeds
      mockGetSignedUrl.mockResolvedValueOnce('https://s3.example.com/cached-audio.mp3');

      const app = createTestApp();
      const res = await app.request('/audio/vocab-1');

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        effectiveSettings?: { provider: string; voiceId: string; model: string };
      };
      expect(body.effectiveSettings).toEqual({
        provider: 'gemini',
        voiceId: 'Kore',
        model: 'gemini-3.8-flash-tts',
      });
    });

    test('resolves malformed stored settings on audio lookup to the same effective selection', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'gemini',
        api_key: 'test-api-key',
        voice_id: 99,
        model: true,
      });
      mockS3Client.send.mockResolvedValueOnce({}); // HeadObject succeeds
      mockGetSignedUrl.mockResolvedValueOnce('https://s3.example.com/cached-audio.wav');

      const app = createTestApp();
      const res = await app.request('/audio/vocab-1');

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        effectiveSettings?: { provider: string; voiceId: string; model: string };
      };
      expect(body.effectiveSettings).toEqual({
        provider: 'gemini',
        voiceId: 'Kore',
        model: 'gemini-3.8-flash-tts',
      });
      const headCommand = mockS3Client.send.mock.calls[0][0] as { Key: string };
      expect(headCommand.Key).toBe(expectedCacheKey('gemini', 'Kore', 'gemini-3.8-flash-tts'));
    });

    test('returns 404 when audio is not cached', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'test-api-key',
        voice_id: null,
        model: null,
      });
      const notFoundError = new Error('Not found');
      (notFoundError as any).name = 'NotFound';
      mockS3Client.send.mockRejectedValueOnce(notFoundError);

      const app = createTestApp();
      const res = await app.request('/audio/vocab-1');

      expect(res.status).toBe(404);
    });

    test('returns 400 when TTS settings not found', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce(null);

      const app = createTestApp();
      const res = await app.request('/audio/vocab-1');

      expect(res.status).toBe(400);
    });

    test('returns 500 on S3 error', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'test-api-key',
        voice_id: null,
        model: null,
      });
      mockS3Client.send.mockRejectedValueOnce(new Error('S3 error'));

      const app = createTestApp();
      const res = await app.request('/audio/vocab-1');

      expect(res.status).toBe(500);
    });

    test('returns 500 when presigned URL generation fails after upload', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'test-api-key',
        voice_id: null,
        model: null,
      });
      const notFoundError = new Error('Not found');
      (notFoundError as any).name = 'NotFound';
      mockS3Client.send.mockRejectedValueOnce(notFoundError);
      mockTTSProvider.generate.mockResolvedValueOnce({
        audioBuffer: Buffer.from('audio-data'),
        contentType: 'audio/mpeg',
      });
      mockS3Client.send.mockResolvedValueOnce({});
      mockGetSignedUrl.mockRejectedValueOnce(new Error('Signing service unavailable'));

      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: 'Audio was saved but could not be accessed. Please try again.',
        code: 'tts_audio_access_failed',
      });
    });

    test('returns 500 when settings lookup fails during generate', async () => {
      mockTtsSettingsDB.get.mockRejectedValueOnce(new Error('Settings DB error'));

      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Failed to generate TTS audio');
    });

    test('returns 401 when userId is missing on generate', async () => {
      mockAuthConfig.userId = '';

      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Unauthorized');
    });

    test('returns 401 when userId is missing on get audio', async () => {
      mockAuthConfig.userId = '';

      const app = createTestApp();
      const res = await app.request('/audio/vocab-1');

      expect(res.status).toBe(401);
    });

    test('returns 500 when TTS audio bucket not configured on get audio', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'test-api-key',
        voice_id: null,
        model: null,
      });

      const app = createTestApp({ AWS_REGION: 'us-east-1' });
      const res = await app.request('/audio/vocab-1');

      expect(res.status).toBe(500);
    });

    test('returns 400 when invalid provider in get audio settings', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'invalid-provider',
        api_key: 'test-api-key',
        voice_id: null,
        model: null,
      });

      const app = createTestApp();
      const res = await app.request('/audio/vocab-1');

      expect(res.status).toBe(400);
    });

    test('returns 500 when settings lookup fails on get audio', async () => {
      mockTtsSettingsDB.get.mockRejectedValueOnce(new Error('Settings DB error'));

      const app = createTestApp();
      const res = await app.request('/audio/vocab-1');

      expect(res.status).toBe(500);
    });

    test('returns 401 when userId is missing on save settings', async () => {
      mockAuthConfig.userId = '';

      const app = createTestApp();
      const res = await app.request('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'elevenlabs',
          apiKey: 'test-api-key',
        }),
      });

      expect(res.status).toBe(401);
    });
  });
});

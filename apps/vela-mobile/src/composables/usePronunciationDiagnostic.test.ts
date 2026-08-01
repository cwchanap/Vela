import { flushPromises } from '@vue/test-utils';
import { nextTick, reactive, ref, type Ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MobileAuthState } from '../auth/mobile-auth-contract';
import {
  MobileAudioError,
  type MobileAudioPlaybackHandle,
  type MobileAudioPlaybackOutcome,
  type MobileAudioPlayer,
} from '../audio/mobile-audio-contract';
import {
  MobileTtsError,
  type MobileTtsErrorCode,
  type MobileTtsService,
  type PreparedPronunciation,
} from '../services/mobile-tts';
import {
  INVALID_PRONUNCIATION_DIAGNOSTIC_URL,
  usePronunciationDiagnostic,
} from './usePronunciationDiagnostic';

const INPUT = { vocabularyId: '水:ミズ', text: '水' } as const;
const PREPARED: PreparedPronunciation = {
  audioUrl: 'https://audio.example.test/mizu.mp3',
  source: 'generated',
  expiresAt: 10_000,
  timings: { settingsMs: 12, generateMs: 34 },
};
const REFRESHED: PreparedPronunciation = {
  audioUrl: 'https://audio.example.test/mizu-refreshed.mp3',
  source: 'server-cache',
  expiresAt: 20_000,
  timings: { settingsMs: 7, generateMs: 0 },
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function controllablePlaybackHandle() {
  const result = deferred<MobileAudioPlaybackOutcome>();
  const stop = vi.fn((reason: 'restart' | 'user' | 'dispose' = 'user') => {
    result.resolve({ kind: 'stopped', reason });
  });
  const publicHandle: MobileAudioPlaybackHandle = { finished: result.promise, stop };
  return { ...result, publicHandle, stop };
}

function resolvedPlaybackHandle(
  outcome: MobileAudioPlaybackOutcome = { kind: 'ended' },
): MobileAudioPlaybackHandle {
  return { finished: Promise.resolve(outcome), stop: vi.fn() };
}

function rejectedPlaybackHandle(error: MobileAudioError): MobileAudioPlaybackHandle {
  return { finished: Promise.reject(error), stop: vi.fn() };
}

function usableAuthState(userId = 'user-1'): MobileAuthState {
  return {
    phase: 'authenticated',
    operation: 'idle',
    sessionUsable: true,
    errorCode: null,
    retryAction: null,
    notice: null,
    user: { userId, email: null },
  };
}

function setUsable(state: MobileAuthState, userId = 'user-1'): void {
  Object.assign(state, usableAuthState(userId));
}

function setRecovering(state: MobileAuthState, userId = 'user-1'): void {
  Object.assign(state, {
    ...usableAuthState(userId),
    operation: 'refreshing' as const,
    sessionUsable: false,
  });
}

function setSignedOut(state: MobileAuthState): void {
  Object.assign(state, {
    phase: 'signedOut' as const,
    operation: 'idle' as const,
    sessionUsable: false,
    errorCode: null,
    retryAction: null,
    notice: null,
    user: null,
  });
}

describe('usePronunciationDiagnostic', () => {
  let now: number;
  let authState: MobileAuthState;
  let isActive: Ref<boolean>;
  let tts: {
    preparePronunciation: ReturnType<typeof vi.fn<MobileTtsService['preparePronunciation']>>;
    invalidatePronunciation: ReturnType<typeof vi.fn<MobileTtsService['invalidatePronunciation']>>;
    clearUser: ReturnType<typeof vi.fn<MobileTtsService['clearUser']>>;
    clearAll: ReturnType<typeof vi.fn<MobileTtsService['clearAll']>>;
  };
  let audio: {
    play: ReturnType<typeof vi.fn<MobileAudioPlayer['play']>>;
    interruptActive: ReturnType<typeof vi.fn<MobileAudioPlayer['interruptActive']>>;
    dispose: ReturnType<typeof vi.fn<MobileAudioPlayer['dispose']>>;
  };

  function createController() {
    return usePronunciationDiagnostic({
      input: INPUT,
      authState,
      ttsService: tts,
      audioPlayer: audio,
      lifecycleState: { isActive },
      now: () => now,
    });
  }

  beforeEach(() => {
    now = 1_000;
    authState = reactive(usableAuthState());
    isActive = ref(true);
    tts = {
      preparePronunciation: vi.fn<MobileTtsService['preparePronunciation']>(),
      invalidatePronunciation: vi.fn<MobileTtsService['invalidatePronunciation']>(),
      clearUser: vi.fn<MobileTtsService['clearUser']>(),
      clearAll: vi.fn<MobileTtsService['clearAll']>(),
    };
    audio = {
      play: vi.fn<MobileAudioPlayer['play']>(),
      interruptActive: vi.fn<MobileAudioPlayer['interruptActive']>(),
      dispose: vi.fn<MobileAudioPlayer['dispose']>(),
    };
  });

  it('moves idle to preparing to playing to ready', async () => {
    tts.preparePronunciation.mockResolvedValue(PREPARED);
    const handle = controllablePlaybackHandle();
    audio.play.mockReturnValue(handle.publicHandle);
    const controller = createController();

    expect(controller.state.value).toEqual({ kind: 'idle' });
    const action = controller.playOrRetry();
    expect(controller.state.value).toEqual({
      kind: 'preparing',
      attempt: 1,
      recoveringSession: false,
    });
    await flushPromises();
    expect(controller.state.value.kind).toBe('playing');

    handle.resolve({ kind: 'ended' });
    await action;
    expect(controller.state.value).toEqual({
      kind: 'ready',
      pronunciation: PREPARED,
      notice: null,
    });
    expect(controller.counters.completedPlays.value).toBe(1);
    expect(controller.counters.preparations.value).toBe(1);
    expect(controller.counters.playbackAttempts.value).toBe(1);
    expect(controller.counters.tapToPlayAttemptMs.value).toBe(0);
  });

  it('retains prepared audio after gesture rejection', async () => {
    tts.preparePronunciation.mockResolvedValue(PREPARED);
    audio.play.mockReturnValue(rejectedPlaybackHandle(new MobileAudioError('gesture_required')));
    const controller = createController();

    await controller.playOrRetry();

    expect(controller.state.value).toMatchObject({
      kind: 'ready',
      pronunciation: PREPARED,
      notice: 'gesture_required',
    });
    expect(controller.counters.gestureRejections.value).toBe(1);
    expect(controller.counters.lastError.value).toBe('gesture_required');
  });

  it('ignores a second tap while preparation is pending', async () => {
    const preparation = deferred<PreparedPronunciation>();
    tts.preparePronunciation.mockReturnValue(preparation.promise);
    audio.play.mockReturnValue(resolvedPlaybackHandle());
    const controller = createController();

    const first = controller.playOrRetry();
    const second = controller.playOrRetry();

    expect(tts.preparePronunciation).toHaveBeenCalledTimes(1);
    expect(controller.state.value.kind).toBe('preparing');

    preparation.resolve(PREPARED);
    await Promise.all([first, second]);
    expect(controller.counters.completedPlays.value).toBe(1);
  });

  it('restarts active playback before starting a replacement', async () => {
    tts.preparePronunciation.mockResolvedValue(PREPARED);
    const firstHandle = controllablePlaybackHandle();
    const secondHandle = controllablePlaybackHandle();
    audio.play.mockReturnValueOnce(firstHandle.publicHandle).mockImplementationOnce(() => {
      firstHandle.stop('restart');
      return secondHandle.publicHandle;
    });
    const controller = createController();

    const firstAction = controller.playOrRetry();
    await flushPromises();
    expect(controller.state.value.kind).toBe('playing');

    const secondAction = controller.playOrRetry();
    expect(firstHandle.stop).toHaveBeenCalledWith('restart');
    expect(firstHandle.stop).toHaveBeenCalledTimes(1);
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(controller.state.value.kind).toBe('playing');

    secondHandle.resolve({ kind: 'ended' });
    await Promise.all([firstAction, secondAction]);
    expect(controller.state.value).toMatchObject({ kind: 'ready', pronunciation: PREPARED });
    expect(controller.counters.completedPlays.value).toBe(1);
  });

  it('replays a live ready URL directly without preparing again', async () => {
    tts.preparePronunciation.mockResolvedValue(PREPARED);
    audio.play.mockReturnValue(resolvedPlaybackHandle());
    const controller = createController();

    await controller.playOrRetry();
    const replay = controller.playOrRetry();

    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(audio.play).toHaveBeenLastCalledWith(PREPARED.audioUrl);
    expect(tts.preparePronunciation).toHaveBeenCalledTimes(1);
    await replay;
  });

  it.each<MobileTtsErrorCode>([
    'invalid_input',
    'not_configured',
    'unauthorized',
    'forbidden',
    'network',
    'service_unavailable',
    'generation_timeout',
    'generation_failed',
    'invalid_response',
  ])('keeps %s failure manual-retry only', async (code) => {
    tts.preparePronunciation.mockRejectedValue(new MobileTtsError(code));
    const controller = createController();

    await controller.playOrRetry();

    expect(tts.preparePronunciation).toHaveBeenCalledTimes(1);
    expect(controller.state.value).toEqual({
      kind: 'error',
      error: code,
      pronunciation: null,
    });
  });

  it('starts a fresh logical action only after an explicit manual retry', async () => {
    tts.preparePronunciation
      .mockRejectedValueOnce(new MobileTtsError('network'))
      .mockResolvedValueOnce(PREPARED);
    audio.play.mockReturnValue(resolvedPlaybackHandle());
    const controller = createController();

    await controller.playOrRetry();

    expect(tts.preparePronunciation).toHaveBeenCalledTimes(1);
    expect(controller.state.value).toEqual({
      kind: 'error',
      error: 'network',
      pronunciation: null,
    });

    await controller.playOrRetry();
    expect(tts.preparePronunciation).toHaveBeenCalledTimes(2);
    expect(controller.counters.completedPlays.value).toBe(1);
  });

  it.each(['session_changed', 'session_unavailable'] as const)(
    'retries one same-user %s control race',
    async (code) => {
      tts.preparePronunciation
        .mockRejectedValueOnce(new MobileTtsError(code))
        .mockResolvedValueOnce(PREPARED);
      audio.play.mockReturnValue(resolvedPlaybackHandle());
      const controller = createController();

      await controller.playOrRetry();

      expect(tts.preparePronunciation).toHaveBeenCalledTimes(2);
      expect(controller.state.value.kind).toBe('ready');
    },
  );

  it.each(['session_changed', 'session_unavailable'] as const)(
    'surfaces a second same-user %s control failure for manual retry',
    async (code) => {
      tts.preparePronunciation.mockRejectedValue(new MobileTtsError(code));
      const controller = createController();

      await controller.playOrRetry();

      expect(tts.preparePronunciation).toHaveBeenCalledTimes(2);
      expect(controller.state.value).toEqual({
        kind: 'error',
        error: code,
        pronunciation: null,
      });
    },
  );

  it('waits for same-user pending recovery and continues once when usable', async () => {
    const firstPreparation = deferred<PreparedPronunciation>();
    tts.preparePronunciation
      .mockReturnValueOnce(firstPreparation.promise)
      .mockResolvedValueOnce(PREPARED);
    audio.play.mockReturnValue(resolvedPlaybackHandle());
    const controller = createController();

    const action = controller.playOrRetry();
    setRecovering(authState);
    firstPreparation.reject(new MobileTtsError('session_recovery_pending'));
    await flushPromises();

    expect(controller.state.value).toEqual({
      kind: 'preparing',
      attempt: 1,
      recoveringSession: true,
    });
    expect(tts.preparePronunciation).toHaveBeenCalledTimes(1);

    setUsable(authState);
    await nextTick();
    await action;
    expect(tts.preparePronunciation).toHaveBeenCalledTimes(2);
    expect(controller.state.value.kind).toBe('ready');
  });

  it('continues once when recovery completed before the pending error settles', async () => {
    tts.preparePronunciation
      .mockRejectedValueOnce(new MobileTtsError('session_recovery_pending'))
      .mockResolvedValueOnce(PREPARED);
    audio.play.mockReturnValue(resolvedPlaybackHandle());
    const controller = createController();

    await controller.playOrRetry();

    expect(tts.preparePronunciation).toHaveBeenCalledTimes(2);
    expect(controller.state.value.kind).toBe('ready');
  });

  it('surfaces a second recovery-pending failure without a third request', async () => {
    const firstPreparation = deferred<PreparedPronunciation>();
    tts.preparePronunciation
      .mockReturnValueOnce(firstPreparation.promise)
      .mockRejectedValueOnce(new MobileTtsError('session_recovery_pending'));
    const controller = createController();

    const action = controller.playOrRetry();
    setRecovering(authState);
    firstPreparation.reject(new MobileTtsError('session_recovery_pending'));
    await flushPromises();
    setUsable(authState);
    await nextTick();
    await action;

    expect(tts.preparePronunciation).toHaveBeenCalledTimes(2);
    expect(controller.state.value).toEqual({
      kind: 'error',
      error: 'session_recovery_pending',
      pronunciation: null,
    });
  });

  it('cancels pending recovery after identity replacement', async () => {
    const preparation = deferred<PreparedPronunciation>();
    tts.preparePronunciation.mockReturnValue(preparation.promise);
    const controller = createController();

    const action = controller.playOrRetry();
    setRecovering(authState);
    preparation.reject(new MobileTtsError('session_recovery_pending'));
    await flushPromises();
    setUsable(authState, 'user-2');
    await nextTick();
    await action;

    expect(tts.preparePronunciation).toHaveBeenCalledTimes(1);
    expect(controller.state.value).toEqual({ kind: 'idle' });
  });

  it('invalidates every settings partition before proactively refreshing an expired URL', async () => {
    tts.preparePronunciation.mockResolvedValueOnce(PREPARED).mockResolvedValueOnce(REFRESHED);
    audio.play.mockReturnValue(resolvedPlaybackHandle());
    const controller = createController();
    await controller.playOrRetry();

    now = PREPARED.expiresAt;
    await controller.playOrRetry();

    expect(tts.invalidatePronunciation).toHaveBeenCalledWith('user-1', '水:ミズ');
    expect(tts.invalidatePronunciation).toHaveBeenCalledTimes(1);
    expect(tts.preparePronunciation).toHaveBeenCalledTimes(2);
    expect(audio.play).toHaveBeenLastCalledWith(REFRESHED.audioUrl);
    expect(controller.counters.urlRefreshes.value).toBe(1);
  });

  it('refreshes once after media failure and requires a new tap to play', async () => {
    tts.preparePronunciation.mockResolvedValueOnce(PREPARED).mockResolvedValueOnce(REFRESHED);
    audio.play.mockReturnValue(rejectedPlaybackHandle(new MobileAudioError('media_unavailable')));
    const controller = createController();

    await controller.playOrRetry();

    expect(tts.invalidatePronunciation).toHaveBeenCalledWith('user-1', '水:ミズ');
    expect(tts.invalidatePronunciation).toHaveBeenCalledTimes(1);
    expect(tts.preparePronunciation).toHaveBeenCalledTimes(2);
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(controller.state.value).toEqual({
      kind: 'ready',
      pronunciation: REFRESHED,
      notice: 'audio_refreshed',
    });
    expect(controller.counters.urlRefreshes.value).toBe(1);
  });

  it('does not perform a second automatic refresh in one expired-URL tap', async () => {
    tts.preparePronunciation.mockResolvedValueOnce(PREPARED).mockResolvedValueOnce(REFRESHED);
    audio.play
      .mockReturnValueOnce(resolvedPlaybackHandle())
      .mockReturnValueOnce(rejectedPlaybackHandle(new MobileAudioError('media_unavailable')));
    const controller = createController();
    await controller.playOrRetry();

    now = PREPARED.expiresAt;
    await controller.playOrRetry();

    expect(tts.preparePronunciation).toHaveBeenCalledTimes(2);
    expect(tts.invalidatePronunciation).toHaveBeenCalledTimes(2);
    expect(controller.state.value).toEqual({
      kind: 'error',
      error: 'media_unavailable',
      pronunciation: null,
    });
  });

  it('surfaces refresh transport failure without automatically retrying it', async () => {
    tts.preparePronunciation
      .mockResolvedValueOnce(PREPARED)
      .mockRejectedValueOnce(new MobileTtsError('network'));
    audio.play.mockReturnValue(rejectedPlaybackHandle(new MobileAudioError('media_unavailable')));
    const controller = createController();

    await controller.playOrRetry();

    expect(tts.preparePronunciation).toHaveBeenCalledTimes(2);
    expect(controller.state.value).toEqual({
      kind: 'error',
      error: 'network',
      pronunciation: null,
    });
  });

  it('interrupts playback in the background and never auto-resumes', async () => {
    tts.preparePronunciation.mockResolvedValue(PREPARED);
    const handle = controllablePlaybackHandle();
    audio.play.mockReturnValue(handle.publicHandle);
    audio.interruptActive.mockImplementation(() => {
      handle.resolve({ kind: 'interrupted', reason: 'background' });
    });
    const controller = createController();
    const action = controller.playOrRetry();
    await flushPromises();

    isActive.value = false;
    await nextTick();
    await action;
    expect(audio.interruptActive).toHaveBeenCalledWith('background');
    expect(controller.state.value).toEqual({
      kind: 'interrupted',
      pronunciation: PREPARED,
      reason: 'background',
    });
    expect(controller.counters.interruptions.value).toBe(1);

    isActive.value = true;
    await nextTick();
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(controller.state.value.kind).toBe('interrupted');
  });

  it('stops active playback and discards stale settlement after sign-out', async () => {
    tts.preparePronunciation.mockResolvedValue(PREPARED);
    const handle = controllablePlaybackHandle();
    audio.play.mockReturnValue(handle.publicHandle);
    const controller = createController();
    const action = controller.playOrRetry();
    await flushPromises();

    setSignedOut(authState);
    await nextTick();
    await action;

    expect(handle.stop).toHaveBeenCalledWith('dispose');
    expect(controller.state.value).toEqual({ kind: 'idle' });
  });

  it('aborts preparation and rejects stale completion after dispose', async () => {
    const preparation = deferred<PreparedPronunciation>();
    tts.preparePronunciation.mockReturnValue(preparation.promise);
    const controller = createController();
    const action = controller.playOrRetry();
    const signal = tts.preparePronunciation.mock.calls[0]?.[1]?.signal;

    controller.dispose();
    preparation.resolve(PREPARED);
    await action;

    expect(signal?.aborted).toBe(true);
    expect(audio.dispose).toHaveBeenCalledTimes(1);
    expect(audio.play).not.toHaveBeenCalled();
    expect(controller.state.value).toEqual({ kind: 'idle' });
  });

  it('provides targeted diagnostic invalidation without clearing another user', async () => {
    tts.preparePronunciation.mockResolvedValue(PREPARED);
    audio.play.mockReturnValue(resolvedPlaybackHandle());
    const controller = createController();
    await controller.playOrRetry();

    controller.invalidatePronunciation();

    expect(tts.invalidatePronunciation).toHaveBeenCalledWith('user-1', '水:ミズ');
    expect(tts.clearUser).not.toHaveBeenCalled();
    expect(tts.clearAll).not.toHaveBeenCalled();
    expect(controller.state.value).toEqual({ kind: 'idle' });
  });

  it('replaces only the diagnostic URL copy when simulating invalid media', async () => {
    tts.preparePronunciation.mockResolvedValue(PREPARED);
    audio.play.mockReturnValue(resolvedPlaybackHandle());
    const controller = createController();
    await controller.playOrRetry();

    controller.simulateInvalidUrl();

    expect(controller.state.value).toMatchObject({
      kind: 'ready',
      pronunciation: { ...PREPARED, audioUrl: INVALID_PRONUNCIATION_DIAGNOSTIC_URL },
    });
    expect(PREPARED.audioUrl).toBe('https://audio.example.test/mizu.mp3');
    expect(tts.invalidatePronunciation).not.toHaveBeenCalled();
  });

  it('clears diagnostic counters without changing prepared state', async () => {
    tts.preparePronunciation.mockResolvedValue(PREPARED);
    audio.play.mockReturnValue(resolvedPlaybackHandle());
    const controller = createController();
    await controller.playOrRetry();
    expect(controller.counters.completedPlays.value).toBe(1);

    controller.clearCounters();

    expect(controller.counters.preparations.value).toBe(0);
    expect(controller.counters.playbackAttempts.value).toBe(0);
    expect(controller.counters.completedPlays.value).toBe(0);
    expect(controller.counters.gestureRejections.value).toBe(0);
    expect(controller.counters.interruptions.value).toBe(0);
    expect(controller.counters.urlRefreshes.value).toBe(0);
    expect(controller.counters.tapToPlayAttemptMs.value).toBeNull();
    expect(controller.counters.lastError.value).toBeNull();
    expect(controller.state.value.kind).toBe('ready');
  });
});

import { flushPromises } from '@vue/test-utils';
import { nextTick, reactive, ref, type Ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MobileAuthState } from '../../auth/mobile-auth-contract';
import {
  MobileAudioError,
  type MobileAudioPlaybackHandle,
  type MobileAudioPlaybackOutcome,
  type MobileAudioPlayer,
  type MobileAudioStopReason,
} from '../../audio/mobile-audio-contract';
import {
  MobileTtsError,
  type MobilePronunciationInput,
  type MobileTtsService,
  type PreparedPronunciation,
} from '../../services/mobile-tts';
import { MYSTERY_MESSENGER_VERTICAL_SLICE as chapter } from './content';
import { getMysteryScene, type MysteryChoiceScene, type MysteryMessageScene } from './model';
import { useMysteryAudio } from './useMysteryAudio';

const MESSAGE_SCENE = getMysteryScene(chapter, 'scene-01') as MysteryMessageScene;
const CHOICE_SCENE = getMysteryScene(chapter, 'scene-03') as MysteryChoiceScene;
const PREPARED: PreparedPronunciation = {
  audioUrl: 'https://audio.example.test/scene-01.mp3',
  source: 'generated',
  expiresAt: 10_000,
  timings: { settingsMs: 12, generateMs: 34 },
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
  const stop = vi.fn((reason: MobileAudioStopReason = 'user') => {
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

function signalAborted(signal: AbortSignal | null): boolean {
  return signal?.aborted ?? false;
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

describe('useMysteryAudio', () => {
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
    return useMysteryAudio({
      authState,
      ttsService: tts,
      audioPlayer: audio,
      lifecycleState: { isActive },
    });
  }

  beforeEach(() => {
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

  it('prepares with the exact TTS input and plays to idle on natural end', async () => {
    tts.preparePronunciation.mockResolvedValue(PREPARED);
    const handle = controllablePlaybackHandle();
    audio.play.mockReturnValue(handle.publicHandle);
    const controller = createController();

    expect(controller.state.value).toEqual({ kind: 'idle' });
    const action = controller.play(MESSAGE_SCENE);
    expect(controller.state.value).toEqual({ kind: 'preparing', sceneId: MESSAGE_SCENE.id });

    await flushPromises();
    expect(controller.state.value).toEqual({ kind: 'playing', sceneId: MESSAGE_SCENE.id });
    expect(tts.preparePronunciation).toHaveBeenCalledWith(
      { userId: 'user-1', vocabularyId: MESSAGE_SCENE.ttsId, text: MESSAGE_SCENE.text },
      { signal: expect.any(AbortSignal) },
    );
    expect(audio.play).toHaveBeenCalledWith(PREPARED.audioUrl);

    handle.resolve({ kind: 'ended' });
    await action;
    expect(controller.state.value).toEqual({ kind: 'idle' });
  });

  const settlementOutcomes: [string, MobileAudioPlaybackOutcome][] = [
    ['ended', { kind: 'ended' }],
    ['stopped', { kind: 'stopped', reason: 'user' }],
    ['interrupted', { kind: 'interrupted', reason: 'external' }],
  ];

  it.each(settlementOutcomes)('settles %s playback to idle', async (_label, outcome) => {
    tts.preparePronunciation.mockResolvedValue(PREPARED);
    const handle = controllablePlaybackHandle();
    audio.play.mockReturnValue(handle.publicHandle);
    const controller = createController();

    const action = controller.play(MESSAGE_SCENE);
    await flushPromises();
    expect(controller.state.value.kind).toBe('playing');

    handle.resolve(outcome);
    await action;
    expect(controller.state.value).toEqual({ kind: 'idle' });
  });

  it('uses the choice prompt as TTS text', async () => {
    tts.preparePronunciation.mockResolvedValue(PREPARED);
    audio.play.mockReturnValue(resolvedPlaybackHandle());
    const controller = createController();

    await controller.play(CHOICE_SCENE);

    expect(tts.preparePronunciation).toHaveBeenCalledWith(
      { userId: 'user-1', vocabularyId: CHOICE_SCENE.ttsId, text: CHOICE_SCENE.prompt },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('keeps the prepared URL ready after a gesture rejection and replays it without preparing again', async () => {
    tts.preparePronunciation.mockResolvedValue(PREPARED);
    audio.play.mockReturnValue(rejectedPlaybackHandle(new MobileAudioError('gesture_required')));
    const controller = createController();

    await controller.play(MESSAGE_SCENE);

    expect(controller.state.value).toEqual({
      kind: 'ready',
      sceneId: MESSAGE_SCENE.id,
      audioUrl: PREPARED.audioUrl,
    });

    audio.play.mockReturnValue(resolvedPlaybackHandle({ kind: 'ended' }));
    await controller.play(MESSAGE_SCENE);

    expect(tts.preparePronunciation).toHaveBeenCalledTimes(1);
    expect(audio.play).toHaveBeenCalledTimes(2);
    expect(audio.play).toHaveBeenLastCalledWith(PREPARED.audioUrl);
    expect(controller.state.value).toEqual({ kind: 'idle' });
  });

  it('invalidates only the (userId, scene.ttsId) identity when audio is unavailable', async () => {
    tts.preparePronunciation.mockResolvedValue(PREPARED);
    audio.play.mockReturnValue(rejectedPlaybackHandle(new MobileAudioError('media_unavailable')));
    const controller = createController();

    await controller.play(MESSAGE_SCENE);

    expect(tts.invalidatePronunciation).toHaveBeenCalledTimes(1);
    expect(tts.invalidatePronunciation).toHaveBeenCalledWith('user-1', MESSAGE_SCENE.ttsId);
    expect(tts.preparePronunciation).toHaveBeenCalledTimes(1);
    expect(controller.state.value).toEqual({
      kind: 'error',
      sceneId: MESSAGE_SCENE.id,
      message: 'media_unavailable',
    });
  });

  it('surfaces a preparation failure as an inline error without retrying', async () => {
    tts.preparePronunciation.mockRejectedValue(new MobileTtsError('network'));
    const controller = createController();

    await controller.play(MESSAGE_SCENE);

    expect(tts.preparePronunciation).toHaveBeenCalledTimes(1);
    expect(controller.state.value).toEqual({
      kind: 'error',
      sceneId: MESSAGE_SCENE.id,
      message: 'network',
    });
  });

  it('ignores a second play while preparation is pending', async () => {
    const preparation = deferred<PreparedPronunciation>();
    tts.preparePronunciation.mockReturnValue(preparation.promise);
    audio.play.mockReturnValue(resolvedPlaybackHandle());
    const controller = createController();

    const first = controller.play(MESSAGE_SCENE);
    const second = controller.play(MESSAGE_SCENE);

    expect(tts.preparePronunciation).toHaveBeenCalledTimes(1);
    expect(controller.state.value.kind).toBe('preparing');

    preparation.resolve(PREPARED);
    await Promise.all([first, second, flushPromises()]);
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(controller.state.value).toEqual({ kind: 'idle' });
  });

  it('does nothing without a usable session', async () => {
    setRecovering(authState);
    const controller = createController();

    await controller.play(MESSAGE_SCENE);

    expect(tts.preparePronunciation).not.toHaveBeenCalled();
    expect(controller.state.value).toEqual({ kind: 'idle' });
  });

  it('aborts an in-flight preparation when the app goes inactive', async () => {
    const preparation = deferred<PreparedPronunciation>();
    let capturedSignal: AbortSignal | null = null;
    tts.preparePronunciation.mockImplementation(
      (_input: MobilePronunciationInput, options?: { signal?: AbortSignal }) => {
        capturedSignal = options?.signal ?? null;
        return preparation.promise;
      },
    );
    const controller = createController();

    const action = controller.play(MESSAGE_SCENE);
    expect(controller.state.value.kind).toBe('preparing');

    isActive.value = false;
    await nextTick();

    expect(signalAborted(capturedSignal)).toBe(true);
    expect(audio.interruptActive).toHaveBeenCalledWith('background');
    expect(controller.state.value).toEqual({ kind: 'idle' });

    preparation.resolve(PREPARED);
    await Promise.all([action, flushPromises()]);
    expect(controller.state.value).toEqual({ kind: 'idle' });
    expect(audio.play).not.toHaveBeenCalled();
  });

  it('interrupts playback without stopping the owned handle when the app goes inactive', async () => {
    tts.preparePronunciation.mockResolvedValue(PREPARED);
    const handle = controllablePlaybackHandle();
    audio.play.mockReturnValue(handle.publicHandle);
    const controller = createController();

    const action = controller.play(MESSAGE_SCENE);
    await flushPromises();
    expect(controller.state.value.kind).toBe('playing');

    isActive.value = false;
    await nextTick();

    expect(audio.interruptActive).toHaveBeenCalledWith('background');
    expect(handle.stop).not.toHaveBeenCalled();
    expect(controller.state.value).not.toEqual({ kind: 'playing', sceneId: MESSAGE_SCENE.id });

    handle.resolve({ kind: 'interrupted', reason: 'background' });
    await action;
    expect(controller.state.value).toEqual({ kind: 'idle' });
  });

  it('aborts an in-flight preparation and ignores its completion when the user changes', async () => {
    const preparation = deferred<PreparedPronunciation>();
    let capturedSignal: AbortSignal | null = null;
    tts.preparePronunciation.mockImplementation(
      (_input: MobilePronunciationInput, options?: { signal?: AbortSignal }) => {
        capturedSignal = options?.signal ?? null;
        return preparation.promise;
      },
    );
    const controller = createController();

    const action = controller.play(MESSAGE_SCENE);
    expect(controller.state.value.kind).toBe('preparing');

    setUsable(authState, 'user-2');
    await nextTick();

    expect(signalAborted(capturedSignal)).toBe(true);
    expect(controller.state.value).toEqual({ kind: 'idle' });

    preparation.resolve(PREPARED);
    await Promise.all([action, flushPromises()]);
    expect(controller.state.value).toEqual({ kind: 'idle' });
    expect(audio.play).not.toHaveBeenCalled();
  });

  it('stops owned playback when the session is signed out', async () => {
    tts.preparePronunciation.mockResolvedValue(PREPARED);
    const handle = controllablePlaybackHandle();
    audio.play.mockReturnValue(handle.publicHandle);
    const controller = createController();

    const action = controller.play(MESSAGE_SCENE);
    await flushPromises();
    expect(controller.state.value.kind).toBe('playing');

    setSignedOut(authState);
    await nextTick();

    expect(handle.stop).toHaveBeenCalledWith('dispose');
    expect(controller.state.value).toEqual({ kind: 'idle' });

    handle.resolve({ kind: 'ended' });
    await action;
    expect(controller.state.value).toEqual({ kind: 'idle' });
  });

  it('clears a prepared replay URL when the user changes', async () => {
    tts.preparePronunciation.mockResolvedValue(PREPARED);
    audio.play.mockReturnValue(rejectedPlaybackHandle(new MobileAudioError('gesture_required')));
    const controller = createController();

    await controller.play(MESSAGE_SCENE);
    expect(controller.state.value.kind).toBe('ready');

    setUsable(authState, 'user-2');
    await nextTick();
    expect(controller.state.value).toEqual({ kind: 'idle' });

    audio.play.mockReturnValue(resolvedPlaybackHandle({ kind: 'ended' }));
    await controller.play(MESSAGE_SCENE);
    expect(tts.preparePronunciation).toHaveBeenCalledTimes(2);
    expect(tts.preparePronunciation).toHaveBeenLastCalledWith(
      { userId: 'user-2', vocabularyId: MESSAGE_SCENE.ttsId, text: MESSAGE_SCENE.text },
      { signal: expect.any(AbortSignal) },
    );
  });

  it('dispose aborts an in-flight preparation and ignores its completion', async () => {
    const preparation = deferred<PreparedPronunciation>();
    let capturedSignal: AbortSignal | null = null;
    tts.preparePronunciation.mockImplementation(
      (_input: MobilePronunciationInput, options?: { signal?: AbortSignal }) => {
        capturedSignal = options?.signal ?? null;
        return preparation.promise;
      },
    );
    const controller = createController();

    const action = controller.play(MESSAGE_SCENE);
    controller.dispose();

    expect(signalAborted(capturedSignal)).toBe(true);
    expect(audio.dispose).toHaveBeenCalled();
    expect(controller.state.value).toEqual({ kind: 'idle' });

    preparation.resolve(PREPARED);
    await Promise.all([action, flushPromises()]);
    expect(controller.state.value).toEqual({ kind: 'idle' });
    expect(audio.play).not.toHaveBeenCalled();
  });

  it('dispose stops playback, disposes the player, and stops watching', async () => {
    tts.preparePronunciation.mockResolvedValue(PREPARED);
    const handle = controllablePlaybackHandle();
    audio.play.mockReturnValue(handle.publicHandle);
    const controller = createController();

    const action = controller.play(MESSAGE_SCENE);
    await flushPromises();
    expect(controller.state.value.kind).toBe('playing');

    controller.dispose();

    expect(handle.stop).toHaveBeenCalledWith('dispose');
    expect(audio.dispose).toHaveBeenCalled();
    expect(controller.state.value).toEqual({ kind: 'idle' });

    // Late settlement from the stopped playback is ignored.
    handle.resolve({ kind: 'ended' });
    await action;
    expect(controller.state.value).toEqual({ kind: 'idle' });

    // play() is a no-op after dispose.
    await controller.play(MESSAGE_SCENE);
    expect(tts.preparePronunciation).toHaveBeenCalledTimes(1);

    // Both watches are stopped: later lifecycle/auth changes do nothing.
    isActive.value = false;
    await nextTick();
    expect(audio.interruptActive).not.toHaveBeenCalled();

    setUsable(authState, 'user-2');
    await nextTick();
    expect(controller.state.value).toEqual({ kind: 'idle' });
  });
});

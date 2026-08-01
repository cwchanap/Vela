import { computed, readonly, ref, watch, type ComputedRef, type Ref } from 'vue';
import {
  selectMobileFeatureSessionStatus,
  type MobileFeatureSessionStatus,
} from '../auth/mobile-feature-session-status';
import type { MobileAuthState } from '../auth/mobile-auth-contract';
import {
  MobileAudioError,
  type MobileAudioErrorCode,
  type MobileAudioPlaybackHandle,
  type MobileAudioPlayer,
} from '../audio/mobile-audio-contract';
import { mobileLifecycleState } from '../services/mobile-lifecycle';
import {
  MobileTtsError,
  type MobilePronunciationInput,
  type MobileTtsErrorCode,
  type MobileTtsService,
  type PreparedPronunciation,
} from '../services/mobile-tts';

export const INVALID_PRONUNCIATION_DIAGNOSTIC_URL =
  'https://example.invalid/vela-tts-diagnostic.mp3';

export type ReadyNotice = 'gesture_required' | 'audio_refreshed';

export type PronunciationDiagnosticError = MobileTtsErrorCode | MobileAudioErrorCode;

export type PronunciationDiagnosticState =
  | { kind: 'idle' }
  | { kind: 'preparing'; attempt: number; recoveringSession: boolean }
  | { kind: 'ready'; pronunciation: PreparedPronunciation; notice: ReadyNotice | null }
  | { kind: 'playing'; pronunciation: PreparedPronunciation }
  | {
      kind: 'interrupted';
      pronunciation: PreparedPronunciation;
      reason: 'background' | 'external';
    }
  | {
      kind: 'error';
      error: PronunciationDiagnosticError;
      pronunciation: PreparedPronunciation | null;
    };

export type PronunciationDiagnosticCounters = {
  preparations: Readonly<Ref<number>>;
  playbackAttempts: Readonly<Ref<number>>;
  completedPlays: Readonly<Ref<number>>;
  gestureRejections: Readonly<Ref<number>>;
  interruptions: Readonly<Ref<number>>;
  urlRefreshes: Readonly<Ref<number>>;
  tapToPlayAttemptMs: Readonly<Ref<number | null>>;
  lastError: Readonly<Ref<PronunciationDiagnosticError | null>>;
};

export type PronunciationDiagnosticController = {
  state: Readonly<Ref<PronunciationDiagnosticState>>;
  sessionStatus: ComputedRef<MobileFeatureSessionStatus>;
  counters: PronunciationDiagnosticCounters;
  playOrRetry(): Promise<void>;
  invalidatePronunciation(): void;
  simulateInvalidUrl(): void;
  clearCounters(): void;
  dispose(): void;
};

export type UsePronunciationDiagnosticOptions = {
  input: Omit<MobilePronunciationInput, 'userId'>;
  authState: Readonly<MobileAuthState>;
  ttsService: MobileTtsService;
  audioPlayer: MobileAudioPlayer;
  lifecycleState?: { isActive: Readonly<Ref<boolean>> };
  now?: () => number;
};

type ActionContext = {
  generation: number;
  userId: string;
  tapStartedAt: number;
  continuationConsumed: boolean;
  urlRefreshConsumed: boolean;
};

type RecoveryWaiter = {
  generation: number;
  userId: string;
  resolve(canContinue: boolean): void;
};

function statusUserId(status: MobileFeatureSessionStatus): string | null {
  return status.kind === 'unavailable' ? null : status.userId;
}

function isUsableForUser(status: MobileFeatureSessionStatus, userId: string): boolean {
  return status.kind === 'usable' && status.userId === userId;
}

function ttsErrorCode(error: unknown): MobileTtsErrorCode {
  return error instanceof MobileTtsError ? error.code : 'generation_failed';
}

function audioErrorCode(error: unknown): MobileAudioErrorCode {
  return error instanceof MobileAudioError ? error.code : 'playback_failed';
}

function statePronunciation(state: PronunciationDiagnosticState): PreparedPronunciation | null {
  switch (state.kind) {
    case 'ready':
    case 'playing':
    case 'interrupted':
      return state.pronunciation;
    case 'error':
      return state.pronunciation;
    case 'idle':
    case 'preparing':
      return null;
  }
}

export function usePronunciationDiagnostic(
  options: UsePronunciationDiagnosticOptions,
): PronunciationDiagnosticController {
  const now = options.now ?? Date.now;
  const lifecycle = options.lifecycleState ?? mobileLifecycleState;
  const sessionStatus = computed(() => selectMobileFeatureSessionStatus(options.authState));
  const state = ref<PronunciationDiagnosticState>({ kind: 'idle' });

  const preparations = ref(0);
  const playbackAttempts = ref(0);
  const completedPlays = ref(0);
  const gestureRejections = ref(0);
  const interruptions = ref(0);
  const urlRefreshes = ref(0);
  const tapToPlayAttemptMs = ref<number | null>(null);
  const lastError = ref<PronunciationDiagnosticError | null>(null);

  let operationGeneration = 0;
  let disposed = false;
  let requestController: AbortController | null = null;
  let activeHandle: MobileAudioPlaybackHandle | null = null;
  let recoveryWaiter: RecoveryWaiter | null = null;
  let preparedUserId: string | null = null;

  function isCurrent(context: ActionContext): boolean {
    return !disposed && context.generation === operationGeneration;
  }

  function resolveRecoveryWaiter(canContinue: boolean): void {
    const waiter = recoveryWaiter;
    recoveryWaiter = null;
    waiter?.resolve(canContinue);
  }

  function cancelOwnedOperation(stopReason: 'user' | 'dispose', resetState: boolean): void {
    operationGeneration += 1;
    requestController?.abort();
    requestController = null;
    resolveRecoveryWaiter(false);
    const handle = activeHandle;
    activeHandle = null;
    handle?.stop(stopReason);
    if (resetState) {
      preparedUserId = null;
      state.value = { kind: 'idle' };
    }
  }

  function waitForSameUserSession(context: ActionContext): Promise<boolean> {
    if (!isCurrent(context)) return Promise.resolve(false);
    if (isUsableForUser(sessionStatus.value, context.userId)) return Promise.resolve(true);
    if (statusUserId(sessionStatus.value) !== context.userId) return Promise.resolve(false);

    resolveRecoveryWaiter(false);
    return new Promise<boolean>((resolve) => {
      recoveryWaiter = {
        generation: context.generation,
        userId: context.userId,
        resolve,
      };
    });
  }

  async function preparePronunciation(
    context: ActionContext,
    attempt: number,
  ): Promise<PreparedPronunciation | null> {
    if (!isCurrent(context)) return null;
    state.value = { kind: 'preparing', attempt, recoveringSession: false };
    preparations.value += 1;

    const controller = new AbortController();
    requestController = controller;
    try {
      const pronunciation = await options.ttsService.preparePronunciation(
        {
          userId: context.userId,
          vocabularyId: options.input.vocabularyId,
          text: options.input.text,
        },
        { signal: controller.signal },
      );
      if (!isCurrent(context)) return null;
      preparedUserId = context.userId;
      return pronunciation;
    } catch (error) {
      if (!isCurrent(context)) return null;
      const code = ttsErrorCode(error);
      lastError.value = code;

      const isControlRace = code === 'session_changed' || code === 'session_unavailable';
      if (
        isControlRace &&
        !context.continuationConsumed &&
        !controller.signal.aborted &&
        isUsableForUser(sessionStatus.value, context.userId)
      ) {
        context.continuationConsumed = true;
        return preparePronunciation(context, attempt + 1);
      }

      if (code === 'session_recovery_pending' && !context.continuationConsumed) {
        context.continuationConsumed = true;
        state.value = { kind: 'preparing', attempt, recoveringSession: true };
        const canContinue = await waitForSameUserSession(context);
        if (canContinue && isCurrent(context)) {
          return preparePronunciation(context, attempt + 1);
        }
        return null;
      }

      state.value = { kind: 'error', error: code, pronunciation: null };
      preparedUserId = null;
      return null;
    } finally {
      if (requestController === controller) requestController = null;
    }
  }

  function invalidateForRefresh(context: ActionContext): void {
    options.ttsService.invalidatePronunciation(context.userId, options.input.vocabularyId);
    context.urlRefreshConsumed = true;
    urlRefreshes.value += 1;
    preparedUserId = null;
  }

  async function refreshAfterMediaFailure(context: ActionContext): Promise<void> {
    invalidateForRefresh(context);
    const pronunciation = await preparePronunciation(context, 1);
    if (!pronunciation || !isCurrent(context)) return;
    state.value = { kind: 'ready', pronunciation, notice: 'audio_refreshed' };
  }

  async function handlePlaybackFailure(
    error: unknown,
    pronunciation: PreparedPronunciation,
    context: ActionContext,
  ): Promise<void> {
    if (!isCurrent(context)) return;
    const code = audioErrorCode(error);
    lastError.value = code;

    if (code === 'gesture_required') {
      gestureRejections.value += 1;
      state.value = { kind: 'ready', pronunciation, notice: 'gesture_required' };
      return;
    }

    if (code === 'media_unavailable') {
      if (context.urlRefreshConsumed) {
        options.ttsService.invalidatePronunciation(context.userId, options.input.vocabularyId);
        preparedUserId = null;
        state.value = { kind: 'error', error: code, pronunciation: null };
        return;
      }
      await refreshAfterMediaFailure(context);
      return;
    }

    const retainedPronunciation = now() < pronunciation.expiresAt ? pronunciation : null;
    preparedUserId = retainedPronunciation ? context.userId : null;
    state.value = { kind: 'error', error: code, pronunciation: retainedPronunciation };
  }

  async function playPrepared(
    pronunciation: PreparedPronunciation,
    context: ActionContext,
  ): Promise<void> {
    if (!isCurrent(context)) return;
    playbackAttempts.value += 1;
    tapToPlayAttemptMs.value = Math.max(0, now() - context.tapStartedAt);

    let handle: MobileAudioPlaybackHandle;
    try {
      handle = options.audioPlayer.play(pronunciation.audioUrl);
    } catch (error) {
      await handlePlaybackFailure(error, pronunciation, context);
      return;
    }

    if (!isCurrent(context)) {
      handle.stop('dispose');
      return;
    }
    activeHandle = handle;
    preparedUserId = context.userId;
    state.value = { kind: 'playing', pronunciation };

    try {
      const outcome = await handle.finished;
      if (!isCurrent(context)) return;
      if (activeHandle === handle) activeHandle = null;

      switch (outcome.kind) {
        case 'ended':
          completedPlays.value += 1;
          state.value = { kind: 'ready', pronunciation, notice: null };
          return;
        case 'stopped':
          state.value = { kind: 'ready', pronunciation, notice: null };
          return;
        case 'interrupted':
          interruptions.value += 1;
          state.value = { kind: 'interrupted', pronunciation, reason: outcome.reason };
          return;
      }
    } catch (error) {
      if (activeHandle === handle) activeHandle = null;
      await handlePlaybackFailure(error, pronunciation, context);
    }
  }

  async function prepareAndPlay(context: ActionContext): Promise<void> {
    const pronunciation = await preparePronunciation(context, 1);
    if (!pronunciation || !isCurrent(context)) return;
    if (!lifecycle.isActive.value || !isUsableForUser(sessionStatus.value, context.userId)) {
      state.value = { kind: 'ready', pronunciation, notice: null };
      return;
    }
    await playPrepared(pronunciation, context);
  }

  async function refreshExpiredAndPlay(context: ActionContext): Promise<void> {
    invalidateForRefresh(context);
    const pronunciation = await preparePronunciation(context, 1);
    if (!pronunciation || !isCurrent(context)) return;
    if (!lifecycle.isActive.value || !isUsableForUser(sessionStatus.value, context.userId)) {
      state.value = { kind: 'ready', pronunciation, notice: null };
      return;
    }
    await playPrepared(pronunciation, context);
  }

  function playOrRetry(): Promise<void> {
    if (disposed || state.value.kind === 'preparing') return Promise.resolve();

    const status = sessionStatus.value;
    if (status.kind !== 'usable') {
      cancelOwnedOperation('dispose', true);
      return Promise.resolve();
    }

    const previousState = state.value;
    operationGeneration += 1;
    requestController?.abort();
    requestController = null;
    resolveRecoveryWaiter(false);
    const context: ActionContext = {
      generation: operationGeneration,
      userId: status.userId,
      tapStartedAt: now(),
      continuationConsumed: false,
      urlRefreshConsumed: false,
    };

    if (previousState.kind === 'playing') {
      return playPrepared(previousState.pronunciation, context);
    }

    const pronunciation = statePronunciation(previousState);
    if (pronunciation) {
      if (now() >= pronunciation.expiresAt) {
        return refreshExpiredAndPlay(context);
      }
      return playPrepared(pronunciation, context);
    }

    return prepareAndPlay(context);
  }

  function invalidatePronunciation(): void {
    if (disposed) return;
    const userId = preparedUserId ?? statusUserId(sessionStatus.value);
    if (userId) {
      options.ttsService.invalidatePronunciation(userId, options.input.vocabularyId);
    }
    cancelOwnedOperation('user', true);
  }

  function withDiagnosticUrl(pronunciation: PreparedPronunciation): PreparedPronunciation {
    return { ...pronunciation, audioUrl: INVALID_PRONUNCIATION_DIAGNOSTIC_URL };
  }

  function simulateInvalidUrl(): void {
    if (disposed) return;
    const current = state.value;
    switch (current.kind) {
      case 'ready':
        state.value = {
          ...current,
          pronunciation: withDiagnosticUrl(current.pronunciation),
        };
        return;
      case 'interrupted':
        state.value = {
          ...current,
          pronunciation: withDiagnosticUrl(current.pronunciation),
        };
        return;
      case 'error':
        if (current.pronunciation) {
          state.value = {
            ...current,
            pronunciation: withDiagnosticUrl(current.pronunciation),
          };
        }
        return;
      case 'idle':
      case 'preparing':
      case 'playing':
        return;
    }
  }

  function clearCounters(): void {
    preparations.value = 0;
    playbackAttempts.value = 0;
    completedPlays.value = 0;
    gestureRejections.value = 0;
    interruptions.value = 0;
    urlRefreshes.value = 0;
    tapToPlayAttemptMs.value = null;
    lastError.value = null;
  }

  const stopSessionWatch = watch(sessionStatus, (next, previous) => {
    const previousUserId = previous ? statusUserId(previous) : null;
    const nextUserId = statusUserId(next);
    if (previous && previousUserId !== nextUserId) {
      cancelOwnedOperation('dispose', true);
      return;
    }

    const waiter = recoveryWaiter;
    if (
      waiter &&
      waiter.generation === operationGeneration &&
      isUsableForUser(next, waiter.userId)
    ) {
      resolveRecoveryWaiter(true);
    }
  });

  const stopLifecycleWatch = watch(
    () => lifecycle.isActive.value,
    (active) => {
      if (active || disposed) return;
      options.audioPlayer.interruptActive('background');
      if (state.value.kind === 'preparing') {
        cancelOwnedOperation('dispose', true);
      }
    },
  );

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    operationGeneration += 1;
    requestController?.abort();
    requestController = null;
    resolveRecoveryWaiter(false);
    const handle = activeHandle;
    activeHandle = null;
    handle?.stop('dispose');
    options.audioPlayer.dispose();
    stopSessionWatch();
    stopLifecycleWatch();
    preparedUserId = null;
    state.value = { kind: 'idle' };
  }

  return {
    state: readonly(state),
    sessionStatus,
    counters: {
      preparations: readonly(preparations),
      playbackAttempts: readonly(playbackAttempts),
      completedPlays: readonly(completedPlays),
      gestureRejections: readonly(gestureRejections),
      interruptions: readonly(interruptions),
      urlRefreshes: readonly(urlRefreshes),
      tapToPlayAttemptMs: readonly(tapToPlayAttemptMs),
      lastError: readonly(lastError),
    },
    playOrRetry,
    invalidatePronunciation,
    simulateInvalidUrl,
    clearCounters,
    dispose,
  };
}

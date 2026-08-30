import { computed, readonly, ref, watch, type ComputedRef, type Ref } from 'vue';
import type { MobileAuthState } from '../../auth/mobile-auth-contract';
import {
  selectMobileFeatureSessionStatus,
  type MobileFeatureSessionStatus,
} from '../../auth/mobile-feature-session-status';
import {
  MobileAudioError,
  type MobileAudioPlaybackHandle,
  type MobileAudioPlayer,
} from '../../audio/mobile-audio-contract';
import { mobileLifecycleState } from '../../services/mobile-lifecycle';
import type { MobileTtsService } from '../../services/mobile-tts';
import type { MysteryScene } from './model';

export type UseMysteryAudioOptions = {
  authState: Readonly<MobileAuthState>;
  ttsService: MobileTtsService;
  audioPlayer: MobileAudioPlayer;
  lifecycleState?: { isActive: Readonly<Ref<boolean>> };
};

export type MysteryAudioState =
  | { kind: 'idle' }
  | { kind: 'preparing'; sceneId: string }
  | { kind: 'ready'; sceneId: string; audioUrl: string }
  | { kind: 'playing'; sceneId: string }
  | { kind: 'error'; sceneId: string; message: string };

export type MysteryAudioController = {
  state: Readonly<Ref<MysteryAudioState>>;
  sessionStatus: ComputedRef<MobileFeatureSessionStatus>;
  play(scene: MysteryScene): Promise<void>;
  dispose(): void;
};

function authoredTextFor(scene: MysteryScene): string {
  return scene.kind === 'choice' ? scene.prompt : scene.text;
}

function statusUserId(status: MobileFeatureSessionStatus): string | null {
  return status.kind === 'unavailable' ? null : status.userId;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown_error';
}

export function useMysteryAudio(options: UseMysteryAudioOptions): MysteryAudioController {
  const lifecycle = options.lifecycleState ?? mobileLifecycleState;
  const sessionStatus = computed(() => selectMobileFeatureSessionStatus(options.authState));
  const state = ref<MysteryAudioState>({ kind: 'idle' });

  let disposed = false;
  let operationGeneration = 0;
  let requestController: AbortController | null = null;
  let activeHandle: MobileAudioPlaybackHandle | null = null;
  let preparedUserId: string | null = null;

  function isCurrent(generation: number): boolean {
    return !disposed && generation === operationGeneration;
  }

  function handlePlaybackError(
    scene: MysteryScene,
    audioUrl: string,
    userId: string,
    generation: number,
    error: unknown,
  ): void {
    if (!isCurrent(generation)) return;

    if (error instanceof MobileAudioError && error.code === 'media_unavailable') {
      options.ttsService.invalidatePronunciation(userId, scene.ttsId);
      preparedUserId = null;
    }

    state.value =
      error instanceof MobileAudioError && error.code === 'gesture_required'
        ? { kind: 'ready', sceneId: scene.id, audioUrl }
        : { kind: 'error', sceneId: scene.id, message: errorMessage(error) };
  }

  async function playAudio(
    scene: MysteryScene,
    audioUrl: string,
    userId: string,
    generation: number,
  ): Promise<void> {
    if (!isCurrent(generation)) return;

    let handle: MobileAudioPlaybackHandle;
    try {
      handle = options.audioPlayer.play(audioUrl);
    } catch (error) {
      handlePlaybackError(scene, audioUrl, userId, generation, error);
      return;
    }

    if (!isCurrent(generation)) {
      handle.stop('dispose');
      return;
    }
    activeHandle = handle;
    state.value = { kind: 'playing', sceneId: scene.id };

    try {
      await handle.finished;
      if (!isCurrent(generation)) return;
      if (activeHandle === handle) activeHandle = null;
      state.value = { kind: 'idle' };
    } catch (error) {
      if (!isCurrent(generation)) return;
      if (activeHandle === handle) activeHandle = null;
      handlePlaybackError(scene, audioUrl, userId, generation, error);
    }
  }

  async function play(scene: MysteryScene): Promise<void> {
    if (disposed || state.value.kind === 'preparing') return;

    const status = sessionStatus.value;
    if (status.kind !== 'usable') return;

    const current = state.value;
    if (
      current.kind === 'ready' &&
      current.sceneId === scene.id &&
      preparedUserId === status.userId
    ) {
      await playAudio(scene, current.audioUrl, status.userId, operationGeneration);
      return;
    }

    operationGeneration += 1;
    requestController?.abort();
    requestController = null;
    const previousHandle = activeHandle;
    activeHandle = null;
    previousHandle?.stop('dispose');
    preparedUserId = null;
    state.value = { kind: 'preparing', sceneId: scene.id };

    const generation = operationGeneration;
    const controller = new AbortController();
    requestController = controller;
    try {
      const pronunciation = await options.ttsService.preparePronunciation(
        { userId: status.userId, vocabularyId: scene.ttsId, text: authoredTextFor(scene) },
        { signal: controller.signal },
      );
      if (!isCurrent(generation)) return;
      preparedUserId = status.userId;
      state.value = { kind: 'ready', sceneId: scene.id, audioUrl: pronunciation.audioUrl };
      await playAudio(scene, pronunciation.audioUrl, status.userId, generation);
    } catch (error) {
      if (!isCurrent(generation)) return;
      preparedUserId = null;
      state.value = { kind: 'error', sceneId: scene.id, message: errorMessage(error) };
    } finally {
      if (requestController === controller) requestController = null;
    }
  }

  const stopSessionWatch = watch(sessionStatus, (next, previous) => {
    const previousUserId = previous ? statusUserId(previous) : null;
    const nextUserId = statusUserId(next);
    if (previous && previousUserId !== nextUserId) {
      operationGeneration += 1;
      requestController?.abort();
      requestController = null;
      const handle = activeHandle;
      activeHandle = null;
      handle?.stop('dispose');
      preparedUserId = null;
      state.value = { kind: 'idle' };
    }
  });

  const stopLifecycleWatch = watch(
    () => lifecycle.isActive.value,
    (active) => {
      if (active) return;
      operationGeneration += 1;
      requestController?.abort();
      requestController = null;
      options.audioPlayer.interruptActive('background');
      activeHandle = null;
      preparedUserId = null;
      state.value = { kind: 'idle' };
    },
  );

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    operationGeneration += 1;
    requestController?.abort();
    requestController = null;
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
    play,
    dispose,
  };
}

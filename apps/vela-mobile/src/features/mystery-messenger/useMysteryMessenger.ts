import { computed, ref, shallowRef, watch, type ComputedRef, type Ref } from 'vue';
import type { MobileAuthState } from '../../auth/mobile-auth-contract';
import {
  selectMobileFeatureSessionStatus,
  type MobileFeatureSessionStatus,
} from '../../auth/mobile-feature-session-status';
import {
  chooseMysteryOption,
  continueMysteryMessage,
  createMysteryProgress,
  getMysteryScene,
  restartMysteryProgress,
  selectMysteryTranscript,
  submitMysteryResponse,
  type MysteryChapter,
  type MysteryProgress,
  type MysteryScene,
  type MysteryTranscriptItem,
} from './model';
import type { MysteryProgressStorage } from './storage';

export type UseMysteryMessengerOptions = {
  authState: Readonly<MobileAuthState>;
  storage: MysteryProgressStorage;
  chapter: MysteryChapter;
};

export type MysteryMessengerController = {
  progress: Readonly<Ref<MysteryProgress | null>>;
  currentScene: ComputedRef<MysteryScene | null>;
  transcript: ComputedRef<readonly MysteryTranscriptItem[]>;
  sessionStatus: ComputedRef<MobileFeatureSessionStatus>;
  persistenceWarning: Readonly<Ref<boolean>>;
  continueMessage(expectedSceneId: string): void;
  chooseOption(expectedSceneId: string, optionId: string): void;
  submitResponse(expectedSceneId: string, selectedTokenIds: readonly string[]): void;
  restart(): void;
};

export function useMysteryMessenger(
  options: UseMysteryMessengerOptions,
): MysteryMessengerController {
  const { storage, chapter } = options;
  const sessionStatus = computed(() => selectMobileFeatureSessionStatus(options.authState));

  // Progress is an immutable value object (transitions replace it), so a
  // shallow ref preserves reference identity for stale-transition checks.
  const progress = shallowRef<MysteryProgress | null>(null);
  const persistenceWarning = ref(false);
  const activeUserId = ref<string | null>(null);

  function loadForUser(userId: string): void {
    const restored = storage.load(userId, chapter);
    const next = restored ?? createMysteryProgress(chapter);
    activeUserId.value = userId;
    progress.value = next;
    persistenceWarning.value = false;
    if (!restored && !storage.save(userId, next)) persistenceWarning.value = true;
  }

  function clearRun(): void {
    activeUserId.value = null;
    progress.value = null;
    persistenceWarning.value = false;
  }

  watch(
    sessionStatus,
    (status) => {
      if (status.kind === 'usable') {
        if (activeUserId.value !== status.userId) loadForUser(status.userId);
      } else if (status.kind === 'recovering' && status.userId === activeUserId.value) {
        // Retain the same user's run; mutations stay gated on `usable`.
      } else {
        clearRun();
      }
    },
    { immediate: true, flush: 'sync' },
  );

  function isOwnedRun(
    status: MobileFeatureSessionStatus,
  ): status is Extract<MobileFeatureSessionStatus, { kind: 'usable' }> {
    return (
      status.kind === 'usable' && status.userId === activeUserId.value && progress.value !== null
    );
  }

  function transition(next: (current: MysteryProgress) => MysteryProgress): void {
    const status = sessionStatus.value;
    if (!isOwnedRun(status) || progress.value === null) return;
    const updated = next(progress.value);
    if (updated === progress.value) return;
    progress.value = updated;
    persistenceWarning.value = !storage.save(status.userId, updated);
  }

  const currentScene = computed(() =>
    progress.value ? getMysteryScene(chapter, progress.value.currentSceneId) : null,
  );

  const transcript = computed(() =>
    progress.value ? selectMysteryTranscript(chapter, progress.value) : [],
  );

  return {
    progress,
    currentScene,
    transcript,
    sessionStatus,
    persistenceWarning,
    continueMessage: (expectedSceneId: string) =>
      transition((current) => continueMysteryMessage(chapter, current, expectedSceneId)),
    chooseOption: (expectedSceneId: string, optionId: string) =>
      transition((current) => chooseMysteryOption(chapter, current, expectedSceneId, optionId)),
    submitResponse: (expectedSceneId: string, selectedTokenIds: readonly string[]) =>
      transition((current) =>
        submitMysteryResponse(chapter, current, expectedSceneId, selectedTokenIds),
      ),
    restart(): void {
      const status = sessionStatus.value;
      if (!isOwnedRun(status) || progress.value === null) return;
      storage.clear(status.userId, chapter.id);
      transition(() => restartMysteryProgress(chapter));
    },
  };
}

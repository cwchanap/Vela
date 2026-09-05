import { mount, type VueWrapper } from '@vue/test-utils';
import { QLayout, QPageContainer, Quasar } from 'quasar';
import { defineComponent, reactive } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MobileAuthCoordinator, MobileAuthState } from '../../auth/mobile-auth-contract';
import { MOBILE_AUTH_KEY } from '../../services/mobile-auth';
import { MOBILE_TTS_SERVICE_KEY } from '../../services/mobile-services';
import type { MobileTtsService } from '../../services/mobile-tts';
import MysteryMessengerPage from './MysteryMessengerPage.vue';
import { MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER as chapter } from './content';
import type { MysteryResponseBuildScene } from './model';
import { createBrowserMysteryProgressStorage, type MysteryProgressStorage } from './storage';
import { useMysteryMessenger, type MysteryMessengerController } from './useMysteryMessenger';

const EXPECTED_HISTORY_SCENE_IDS = [
  'scene-01',
  'scene-02',
  'scene-03',
  'scene-04',
  'scene-05',
  'scene-06',
  'scene-07',
  'scene-08',
  'scene-09',
  'scene-10',
  'scene-11',
  'scene-12',
] as const;

const SCENE_07_REVIEW_TOKEN_IDS = [
  'time',
  'ni-place',
  'train',
  'de',
  'station',
  'ni-time',
  'go',
  'period',
] as const;

const REVIEW_PHRASE_IDS = [
  'tomorrow-seven',
  'mina-possession',
  'train-station-plan',
  'wrote-yesterday',
  'when-is-tomorrow',
] as const;

function usableAuthState(userId = 'pilot-user'): MobileAuthState {
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

function createPilotController(userId = 'pilot-user'): {
  controller: MysteryMessengerController;
  storage: MysteryProgressStorage;
} {
  const storage = createBrowserMysteryProgressStorage(window.localStorage);
  return {
    controller: useMysteryMessenger({
      authState: reactive(usableAuthState(userId)),
      storage,
      chapter,
    }),
    storage,
  };
}

function responseSceneOf(sceneId: 'scene-07' | 'scene-11'): MysteryResponseBuildScene {
  const scene = chapter.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene || scene.kind !== 'response-build') {
    throw new Error(`missing_response_scene:${sceneId}`);
  }
  return scene;
}

function scene07HistoryOf(controller: MysteryMessengerController) {
  const entry = controller.progress.value?.history.find(
    (candidate) => candidate.sceneId === 'scene-07',
  );
  if (!entry || entry.kind !== 'response-build') {
    throw new Error('missing_scene_07_response_history');
  }
  return entry;
}

function driveReviewRunToScene07(controller: MysteryMessengerController): void {
  controller.continueMessage('scene-01');
  controller.continueMessage('scene-02');
  controller.chooseOption('scene-03', 'today-morning');
  controller.continueMessage('scene-04');
  controller.chooseOption('scene-05', 'minas-notebook', true);
  controller.continueMessage('scene-06');
}

function driveReviewRunToScene10(controller: MysteryMessengerController): void {
  driveReviewRunToScene07(controller);
  controller.submitResponse('scene-07', SCENE_07_REVIEW_TOKEN_IDS, true);
  controller.continueMessage('scene-08');
  controller.chooseOption('scene-09', 'ask-notebook-color');
}

function finishFromScene10(controller: MysteryMessengerController): void {
  controller.continueMessage('scene-10');
  controller.submitResponse('scene-11', responseSceneOf('scene-11').correctTokenIds);
  controller.continueMessage('scene-12');
}

function completeReviewRun(controller: MysteryMessengerController): void {
  driveReviewRunToScene10(controller);
  finishFromScene10(controller);
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Mystery Messenger pilot acceptance', () => {
  it('round-trips the review path and swapped scene-07 token identities', () => {
    const first = createPilotController();
    driveReviewRunToScene10(first.controller);

    expect(first.controller.currentScene.value?.id).toBe('scene-10');
    expect(scene07HistoryOf(first.controller).selectedTokenIds).toEqual(SCENE_07_REVIEW_TOKEN_IDS);
    expect(scene07HistoryOf(first.controller).hintUsed).toBe(true);
    expect(first.controller.missedPhraseRecap.value.map((item) => item.phraseId)).toEqual(
      REVIEW_PHRASE_IDS,
    );

    const relaunched = createPilotController();
    expect(relaunched.controller.currentScene.value?.id).toBe('scene-10');
    expect(scene07HistoryOf(relaunched.controller).selectedTokenIds).toEqual(
      SCENE_07_REVIEW_TOKEN_IDS,
    );
    expect(scene07HistoryOf(relaunched.controller).hintUsed).toBe(true);
    expect(relaunched.controller.missedPhraseRecap.value.map((item) => item.phraseId)).toEqual(
      REVIEW_PHRASE_IDS,
    );

    finishFromScene10(relaunched.controller);

    const stored = relaunched.storage.load('pilot-user', chapter);
    expect(stored).toMatchObject({
      chapterId: chapter.id,
      chapterVersion: chapter.version,
      currentSceneId: 'scene-13',
      completed: true,
    });
    expect(stored?.history.map((entry) => entry.sceneId)).toEqual(EXPECTED_HISTORY_SCENE_IDS);
    expect(relaunched.controller.missedPhraseRecap.value.map((item) => item.phraseId)).toEqual(
      REVIEW_PHRASE_IDS,
    );
  });

  it('persists restart before a fresh controller restores the run', () => {
    const first = createPilotController();
    completeReviewRun(first.controller);
    expect(first.controller.missedPhraseRecap.value).not.toEqual([]);

    first.controller.restart();

    expect(first.storage.load('pilot-user', chapter)).toMatchObject({
      chapterId: chapter.id,
      chapterVersion: chapter.version,
      currentSceneId: 'scene-01',
      completed: false,
      history: [],
    });

    const relaunched = createPilotController();
    expect(relaunched.controller.currentScene.value?.id).toBe('scene-01');
    expect(relaunched.controller.progress.value?.history).toEqual([]);
    expect(relaunched.controller.progress.value?.completed).toBe(false);
    expect(relaunched.controller.missedPhraseRecap.value).toEqual([]);
  });

  const PageHost = defineComponent({
    components: { QLayout, QPageContainer, MysteryMessengerPage },
    template:
      '<q-layout view="hHh Lpr fFf"><q-page-container><mystery-messenger-page /></q-page-container></q-layout>',
  });

  function authCoordinatorFixture(userId: string): MobileAuthCoordinator {
    return { state: reactive(usableAuthState(userId)) } as MobileAuthCoordinator;
  }

  function ttsServiceFixture(): MobileTtsService {
    return {
      preparePronunciation: vi.fn(),
      invalidatePronunciation: vi.fn(),
      clearUser: vi.fn(),
      clearAll: vi.fn(),
    };
  }

  function mountRealPage(userId: string): VueWrapper {
    return mount(PageHost, {
      global: {
        plugins: [Quasar],
        provide: {
          [MOBILE_AUTH_KEY as symbol]: authCoordinatorFixture(userId),
          [MOBILE_TTS_SERVICE_KEY as symbol]: ttsServiceFixture(),
        },
      },
    });
  }

  async function unlockTransition(): Promise<void> {
    await vi.advanceTimersByTimeAsync(500);
  }

  it('drives the real page from scene 07 through the ending recap', async () => {
    vi.useFakeTimers();
    const userId = 'page-user';
    const seed = createPilotController(userId);
    driveReviewRunToScene07(seed.controller);
    expect(seed.controller.currentScene.value?.id).toBe('scene-07');

    const wrapper = mountRealPage(userId);
    expect(wrapper.find('[data-testid="mystery-response-build-composer"]').exists()).toBe(true);

    for (const tokenId of SCENE_07_REVIEW_TOKEN_IDS) {
      await wrapper.get(`[data-testid="mystery-response-token-${tokenId}"]`).trigger('click');
    }
    expect(wrapper.findAll('[data-testid="mystery-response-selected-ni-place"]')).toHaveLength(1);
    expect(wrapper.findAll('[data-testid="mystery-response-selected-ni-time"]')).toHaveLength(1);

    await wrapper.get('[data-testid="mystery-response-hint"]').trigger('click');
    await wrapper.get('[data-testid="mystery-response-send"]').trigger('click');
    await unlockTransition();

    await wrapper.get('[data-testid="mystery-continue"]').trigger('click');
    await unlockTransition();
    await wrapper.get('[data-testid="mystery-option-ask-notebook-color"]').trigger('click');
    await unlockTransition();
    await wrapper.get('[data-testid="mystery-continue"]').trigger('click');
    await unlockTransition();

    for (const tokenId of responseSceneOf('scene-11').correctTokenIds) {
      await wrapper.get(`[data-testid="mystery-response-token-${tokenId}"]`).trigger('click');
    }
    await wrapper.get('[data-testid="mystery-response-send"]').trigger('click');
    await unlockTransition();
    await wrapper.get('[data-testid="mystery-continue"]').trigger('click');
    await unlockTransition();

    expect(wrapper.find('[data-testid="mystery-restart"]').exists()).toBe(true);
    for (const phraseId of REVIEW_PHRASE_IDS) {
      expect(wrapper.find(`[data-testid="mystery-recap-phrase-${phraseId}"]`).exists()).toBe(true);
    }

    wrapper.unmount();
  });
});

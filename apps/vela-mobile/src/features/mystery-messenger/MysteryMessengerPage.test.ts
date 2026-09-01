import { mount, type VueWrapper } from '@vue/test-utils';
import { QLayout, QPageContainer, Quasar } from 'quasar';
import { defineComponent, nextTick, reactive, ref, type Ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HtmlAudioPlayer } from 'src/audio/html-audio-player';
import type { MobileAuthCoordinator } from 'src/auth/mobile-auth-contract';
import type { MobileFeatureSessionStatus } from 'src/auth/mobile-feature-session-status';
import { MOBILE_AUTH_KEY } from 'src/services/mobile-auth';
import { MOBILE_TTS_SERVICE_KEY } from 'src/services/mobile-services';
import type { MobileTtsService } from 'src/services/mobile-tts';
import { MYSTERY_MESSENGER_VERTICAL_SLICE as chapter } from './content';
import type {
  MysteryProgress,
  MysteryResponseBuildScene,
  MysteryScene,
  MysteryTranscriptItem,
} from './model';
import type { MysteryProgressStorage } from './storage';
import type { MysteryAudioState } from './useMysteryAudio';
import MysteryMessengerPage from './MysteryMessengerPage.vue';

const composableMocks = vi.hoisted(() => ({
  useMysteryMessenger: vi.fn(),
  useMysteryAudio: vi.fn(),
}));

vi.mock('./useMysteryMessenger', () => ({
  useMysteryMessenger: composableMocks.useMysteryMessenger,
}));
vi.mock('./useMysteryAudio', () => ({
  useMysteryAudio: composableMocks.useMysteryAudio,
}));

const PageHost = defineComponent({
  components: { QLayout, QPageContainer, MysteryMessengerPage },
  template:
    '<q-layout view="hHh Lpr fFf"><q-page-container><mystery-messenger-page /></q-page-container></q-layout>',
});

// Mirrors the linear slice: each scene id leads to the next one.
const NEXT_SCENE_ID: Record<string, string | null> = {
  'scene-01': 'scene-02',
  'scene-02': 'scene-03',
  'scene-03': 'scene-04',
  'scene-04': 'scene-05',
  'scene-05': null,
  'response-04': 'scene-05',
};

// Test-only response-build scene spliced in as scene-04's successor role.
const RESPONSE_SCENE: MysteryResponseBuildScene = {
  kind: 'response-build',
  id: 'response-04',
  prompt: '返事を作ってください。',
  tokens: [
    { id: 'time', text: '7時' },
    { id: 'ni', text: 'に' },
    { id: 'train', text: '電車' },
  ],
  correctTokenIds: ['time', 'ni'],
  feedback: { correct: '正しいです。', incorrect: 'もう一度確認しましょう。' },
  hint: '「7時」のあとに「に」を置きます。',
  explanation: '時間の後ろに「に」を使います。',
  targetPhraseIds: [],
  nextSceneId: 'scene-05',
};

type MutableMessenger = {
  progress: Ref<MysteryProgress | null>;
  currentScene: Ref<MysteryScene | null>;
  transcript: Ref<readonly MysteryTranscriptItem[]>;
  sessionStatus: Ref<MobileFeatureSessionStatus>;
  persistenceWarning: Ref<boolean>;
  continueMessage: ReturnType<typeof vi.fn>;
  chooseOption: ReturnType<typeof vi.fn>;
  submitResponse: ReturnType<typeof vi.fn>;
  restart: ReturnType<typeof vi.fn>;
};

type MutableAudio = {
  state: Ref<MysteryAudioState>;
  sessionStatus: Ref<MobileFeatureSessionStatus>;
  play: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
};

function messengerFixture(
  options: {
    currentSceneId?: string | null;
    transcript?: readonly MysteryTranscriptItem[];
    sessionStatus?: MobileFeatureSessionStatus;
    persistenceWarning?: boolean;
  } = {},
): MutableMessenger {
  const scenes = [...chapter.scenes, RESPONSE_SCENE];
  const currentScene = ref<MysteryScene | null>(
    options.currentSceneId === undefined
      ? scenes[0]!
      : options.currentSceneId === null
        ? null
        : (scenes.find((scene) => scene.id === options.currentSceneId) ?? null),
  );
  const advance = () => {
    const nextId = NEXT_SCENE_ID[currentScene.value?.id ?? ''];
    currentScene.value =
      nextId === null ? null : (scenes.find((scene) => scene.id === nextId) ?? null);
  };
  return {
    progress: ref<MysteryProgress | null>(null),
    currentScene,
    transcript: ref<readonly MysteryTranscriptItem[]>(options.transcript ?? []),
    sessionStatus: ref<MobileFeatureSessionStatus>(
      options.sessionStatus ?? { kind: 'usable', userId: 'user-1' },
    ),
    persistenceWarning: ref(options.persistenceWarning ?? false),
    continueMessage: vi.fn(advance),
    chooseOption: vi.fn(advance),
    submitResponse: vi.fn(advance),
    restart: vi.fn(() => {
      currentScene.value = scenes[0]!;
    }),
  };
}

function audioFixture(
  options: { state?: MysteryAudioState; sessionStatus?: MobileFeatureSessionStatus } = {},
): MutableAudio {
  return {
    state: ref<MysteryAudioState>(options.state ?? { kind: 'idle' }),
    sessionStatus: ref<MobileFeatureSessionStatus>(
      options.sessionStatus ?? { kind: 'usable', userId: 'user-1' },
    ),
    play: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
  };
}

function authCoordinatorFixture(): MobileAuthCoordinator {
  return {
    state: reactive({
      phase: 'authenticated',
      operation: 'idle',
      sessionUsable: true,
      errorCode: null,
      retryAction: null,
      notice: null,
      user: { userId: 'user-1', email: null },
    }),
  } as MobileAuthCoordinator;
}

function ttsServiceFixture(): MobileTtsService {
  return {
    preparePronunciation: vi.fn(),
    invalidatePronunciation: vi.fn(),
    clearUser: vi.fn(),
    clearAll: vi.fn(),
  };
}

function mountPageWithController(
  messenger: MutableMessenger,
  options: {
    audio?: MutableAudio;
    coordinator?: MobileAuthCoordinator;
    ttsService?: MobileTtsService;
  } = {},
): VueWrapper {
  composableMocks.useMysteryMessenger.mockReturnValue(messenger);
  composableMocks.useMysteryAudio.mockReturnValue(options.audio ?? audioFixture());
  const coordinator = options.coordinator ?? authCoordinatorFixture();
  const ttsService = options.ttsService ?? ttsServiceFixture();

  return mount(PageHost, {
    global: {
      plugins: [Quasar],
      provide: {
        [MOBILE_AUTH_KEY as symbol]: coordinator,
        [MOBILE_TTS_SERVICE_KEY as symbol]: ttsService,
      },
    },
  });
}

beforeEach(() => {
  composableMocks.useMysteryMessenger.mockReset();
  composableMocks.useMysteryAudio.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('MysteryMessengerPage', () => {
  it('guards rapid continue taps with the 500 ms transition lock', async () => {
    vi.useFakeTimers();
    const messenger = messengerFixture();
    const wrapper = mountPageWithController(messenger);

    await wrapper.get('[data-testid="mystery-continue"]').trigger('click');
    await wrapper.get('[data-testid="mystery-continue"]').trigger('click');
    expect(messenger.continueMessage).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(500);
    await wrapper.get('[data-testid="mystery-continue"]').trigger('click');
    expect(messenger.continueMessage).toHaveBeenCalledTimes(2);
  });

  it('accepts only one choice submission within the rapid-transition guard', async () => {
    vi.useFakeTimers();
    const messenger = messengerFixture({ currentSceneId: 'scene-03' });
    messenger.chooseOption = vi.fn();
    const wrapper = mountPageWithController(messenger);

    await wrapper.get('[data-testid="mystery-option-understood"]').trigger('click');
    await wrapper.get('[data-testid="mystery-option-understood"]').trigger('click');
    expect(messenger.chooseOption).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(500);
    await wrapper.get('[data-testid="mystery-option-understood"]').trigger('click');
    expect(messenger.chooseOption).toHaveBeenCalledTimes(2);
    expect(messenger.chooseOption).toHaveBeenLastCalledWith('scene-03', 'understood');
  });

  it('captures the visible scene only after acquiring the transition lock', async () => {
    vi.useFakeTimers();
    const messenger = messengerFixture();
    const wrapper = mountPageWithController(messenger);

    await wrapper.get('[data-testid="mystery-continue"]').trigger('click');

    expect(messenger.continueMessage).toHaveBeenCalledTimes(1);
    expect(messenger.continueMessage).toHaveBeenCalledWith('scene-01');
  });

  it('disables transitions and renders session copy while the session recovers', async () => {
    const messenger = messengerFixture({
      sessionStatus: { kind: 'recovering', userId: 'user-1', sessionUsable: true },
    });
    const wrapper = mountPageWithController(messenger);

    expect(wrapper.get('[data-testid="mystery-session-status"]').text()).toContain('recovering');
    expect(wrapper.get('[data-testid="mystery-continue"]').attributes('disabled')).toBeDefined();
    await wrapper.get('[data-testid="mystery-continue"]').trigger('click');
    expect(messenger.continueMessage).not.toHaveBeenCalled();
  });

  it('disables choice options while the session is not usable', async () => {
    const messenger = messengerFixture({ currentSceneId: 'scene-03' });
    const wrapper = mountPageWithController(messenger);
    messenger.sessionStatus.value = { kind: 'unavailable' };
    await nextTick();

    expect(wrapper.get('[data-testid="mystery-session-status"]').text()).toContain('unavailable');
    expect(
      wrapper.get('[data-testid="mystery-option-understood"]').attributes('disabled'),
    ).toBeDefined();
    await wrapper.get('[data-testid="mystery-option-understood"]').trigger('click');
    expect(messenger.chooseOption).not.toHaveBeenCalled();
  });

  it('renders the persistence warning when progress cannot be saved', () => {
    const messenger = messengerFixture({ persistenceWarning: true });
    const wrapper = mountPageWithController(messenger);

    expect(wrapper.get('[data-testid="mystery-save-warning"]').text()).toContain("can't be saved");
  });

  it('renders the exact ready copy for prepared audio', () => {
    const audio = audioFixture({
      state: {
        kind: 'ready',
        sceneId: 'scene-01',
        audioUrl: 'https://audio.example.test/scene-01.mp3',
      },
    });
    const wrapper = mountPageWithController(messengerFixture(), { audio });

    expect(wrapper.get('[data-testid="mystery-audio-status"]').text()).toBe('Tap play again');
  });

  it('renders the audio error copy as an alert', async () => {
    const audio = audioFixture();
    const wrapper = mountPageWithController(messengerFixture(), { audio });

    audio.state.value = { kind: 'error', sceneId: 'scene-01', message: 'audio_sentinel_failure' };
    await nextTick();

    const error = wrapper.get('[data-testid="mystery-audio-error"]');
    expect(error.attributes('role')).toBe('alert');
    expect(error.text()).toContain('audio_sentinel_failure');
    expect(wrapper.find('[data-testid="mystery-audio-status"]').exists()).toBe(false);
  });

  it('replays the resolved scene on explicit taps and never auto-plays', async () => {
    const audio = audioFixture();
    const messenger = messengerFixture({
      currentSceneId: 'scene-02',
      transcript: [
        {
          kind: 'message',
          sceneId: 'scene-02',
          speaker: 'mina',
          text: 'あしたの朝7時、あなたはまだ知らない言葉と出会います。',
          audio: {
            ttsId: 'tts-scene-02',
            text: 'あしたの朝7時、あなたはまだ知らない言葉と出会います。',
          },
          active: true,
        },
      ],
    });
    const wrapper = mountPageWithController(messenger, { audio });

    expect(audio.play).not.toHaveBeenCalled();

    await wrapper.get('[data-testid="mystery-replay-scene-02"]').trigger('click');
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(audio.play).toHaveBeenCalledWith(chapter.scenes[1]);

    audio.state.value = {
      kind: 'ready',
      sceneId: 'scene-02',
      audioUrl: 'https://audio.example.test/scene-02.mp3',
    };
    await nextTick();
    expect(audio.play).toHaveBeenCalledTimes(1);

    await wrapper.get('[data-testid="mystery-replay-scene-02"]').trigger('click');
    expect(audio.play).toHaveBeenCalledTimes(2);
  });

  it('renders the restart action at the ending and restarts the run', async () => {
    const messenger = messengerFixture({ currentSceneId: 'scene-05' });
    const wrapper = mountPageWithController(messenger);

    expect(wrapper.find('[data-testid="mystery-continue"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="mystery-restart"]').exists()).toBe(true);

    await wrapper.get('[data-testid="mystery-restart"]').trigger('click');
    expect(messenger.restart).toHaveBeenCalledTimes(1);
  });

  it('renders the response composer for a response-build scene', () => {
    const messenger = messengerFixture({ currentSceneId: 'response-04' });
    const wrapper = mountPageWithController(messenger);

    expect(wrapper.find('[data-testid="mystery-continue"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="mystery-response-build-composer"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="mystery-response-token-time"]').text()).toBe('7時');
  });

  it('advances to the next scene after the first Send', async () => {
    const messenger = messengerFixture({ currentSceneId: 'response-04' });
    const wrapper = mountPageWithController(messenger);

    await wrapper.get('[data-testid="mystery-response-token-time"]').trigger('click');
    await wrapper.get('[data-testid="mystery-response-token-ni"]').trigger('click');
    await wrapper.get('[data-testid="mystery-response-send"]').trigger('click');

    expect(messenger.submitResponse).toHaveBeenCalledTimes(1);
    expect(messenger.submitResponse).toHaveBeenCalledWith('response-04', ['time', 'ni']);
    expect(wrapper.find('[data-testid="mystery-restart"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="mystery-response-build-composer"]').exists()).toBe(false);
  });

  it('guards rapid response submissions with the 500 ms transition lock', async () => {
    vi.useFakeTimers();
    const messenger = messengerFixture({ currentSceneId: 'response-04' });
    messenger.submitResponse = vi.fn();
    const wrapper = mountPageWithController(messenger);

    await wrapper.get('[data-testid="mystery-response-token-time"]').trigger('click');
    await wrapper.get('[data-testid="mystery-response-send"]').trigger('click');
    await wrapper.get('[data-testid="mystery-response-send"]').trigger('click');
    expect(messenger.submitResponse).toHaveBeenCalledTimes(1);
    expect(messenger.submitResponse).toHaveBeenCalledWith('response-04', ['time']);

    await vi.advanceTimersByTimeAsync(500);
    await wrapper.get('[data-testid="mystery-response-send"]').trigger('click');
    expect(messenger.submitResponse).toHaveBeenCalledTimes(2);
  });

  it('disables the response composer while the session is not usable', async () => {
    const messenger = messengerFixture({ currentSceneId: 'response-04' });
    const wrapper = mountPageWithController(messenger);
    messenger.sessionStatus.value = { kind: 'unavailable' };
    await nextTick();

    expect(
      wrapper.get('[data-testid="mystery-response-send"]').attributes('disabled'),
    ).toBeDefined();
    await wrapper.get('[data-testid="mystery-response-token-time"]').trigger('click');
    await wrapper.get('[data-testid="mystery-response-send"]').trigger('click');
    expect(messenger.submitResponse).not.toHaveBeenCalled();
  });

  it('toggles the hint without locking the transition or advancing the story', async () => {
    vi.useFakeTimers();
    const messenger = messengerFixture({ currentSceneId: 'response-04' });
    messenger.submitResponse = vi.fn();
    const wrapper = mountPageWithController(messenger);

    await wrapper.get('[data-testid="mystery-response-hint"]').trigger('click');
    expect(wrapper.get('[data-testid="mystery-response-hint-copy"]').text()).toBe(
      RESPONSE_SCENE.hint,
    );
    expect(messenger.submitResponse).not.toHaveBeenCalled();
    expect(messenger.continueMessage).not.toHaveBeenCalled();
    expect(messenger.chooseOption).not.toHaveBeenCalled();

    // The hint tap must not consume the 500 ms lock: the next Send is accepted.
    await wrapper.get('[data-testid="mystery-response-token-time"]').trigger('click');
    await wrapper.get('[data-testid="mystery-response-send"]').trigger('click');
    expect(messenger.submitResponse).toHaveBeenCalledTimes(1);
  });

  it('supplies the auth coordinator, browser storage, TTS service, and audio player', () => {
    const coordinator = authCoordinatorFixture();
    const ttsService = ttsServiceFixture();
    mountPageWithController(messengerFixture(), { coordinator, ttsService });

    const messengerOptions = composableMocks.useMysteryMessenger.mock.calls[0]![0];
    expect(messengerOptions.authState).toBe(coordinator.state);
    expect(messengerOptions.chapter).toBe(chapter);
    const storage = messengerOptions.storage as MysteryProgressStorage;
    const progress: MysteryProgress = {
      chapterId: chapter.id,
      chapterVersion: chapter.version,
      currentSceneId: 'scene-02',
      history: [{ kind: 'message', sceneId: 'scene-01' }],
      completed: false,
    };
    storage.save('user-a', progress);
    expect(storage.load('user-a', chapter)).toEqual(progress);
    storage.clear('user-a', chapter.id);
    expect(storage.load('user-a', chapter)).toBeNull();

    const audioOptions = composableMocks.useMysteryAudio.mock.calls[0]![0];
    expect(audioOptions.authState).toBe(coordinator.state);
    expect(audioOptions.ttsService).toBe(ttsService);
    expect(audioOptions.audioPlayer).toBeInstanceOf(HtmlAudioPlayer);
  });

  it('throws mystery_messenger_dependencies_unavailable when dependencies are missing', () => {
    composableMocks.useMysteryMessenger.mockReturnValue(messengerFixture());
    composableMocks.useMysteryAudio.mockReturnValue(audioFixture());

    expect(() => mount(PageHost, { global: { plugins: [Quasar] } })).toThrow(
      'mystery_messenger_dependencies_unavailable',
    );
  });

  it('disposes the audio controller when the page unmounts', () => {
    const audio = audioFixture();
    const wrapper = mountPageWithController(messengerFixture(), { audio });

    wrapper.unmount();

    expect(audio.dispose).toHaveBeenCalledTimes(1);
  });
});

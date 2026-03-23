import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, reactive, type Component } from 'vue';
import type { ListeningConfig, ListeningQuestion } from '../../types/listening';

const mockListeningGameService = {
  getListeningQuestions: vi.fn(),
};

const mockGeneratePronunciation = vi.fn();
let ListeningGame: Component;

const listeningStore = reactive({
  questions: [] as ListeningQuestion[],
  currentIndex: 0,
  score: 0,
  gameActive: false,
  currentQuestion: null as ListeningQuestion | null,
  startGame: ((_: ListeningQuestion[]) => undefined) as (_questions: ListeningQuestion[]) => void,
  submitAnswer: ((_: boolean) => undefined) as (_isCorrect: boolean) => void,
  endGame: (() => undefined) as () => void,
});

const progressStore = {
  updateProgress: vi.fn(),
  recordGameSession: vi.fn().mockResolvedValue(undefined),
};

const authStore = reactive<{
  user: { id: string } | null;
}>({
  user: { id: 'user-123' },
});

const listeningConfig: ListeningConfig = {
  mode: 'multiple-choice',
  source: 'vocabulary',
  jlptLevels: [],
};

const makeQuestion = (id: string, text: string, englishTranslation: string): ListeningQuestion => ({
  kind: 'vocabulary',
  id,
  text,
  reading: `${text}-reading`,
  romaji: `${text}-romaji`,
  englishTranslation,
  distractors: ['wrong-1', 'wrong-2', 'wrong-3'],
  raw: {
    id,
    japanese_word: text,
    hiragana: `${text}-reading`,
    romaji: `${text}-romaji`,
    english_translation: englishTranslation,
    difficulty_level: 1,
    category: 'test',
    created_at: '2024-01-01T00:00:00Z',
  },
});

const ListeningSetupStub = defineComponent({
  name: 'ListeningSetup',
  props: {
    isStarting: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['start'],
  methods: {
    emitStart() {
      this.$emit('start', listeningConfig);
    },
  },
  template: '<button class="start-button" @click="emitStart">Start</button>',
});

const AudioPlayerStub = defineComponent({
  name: 'AudioPlayer',
  props: {
    audioUrl: {
      type: String,
      default: null,
    },
    isLoading: {
      type: Boolean,
      default: false,
    },
  },
  emits: ['played'],
  watch: {
    audioUrl(url: string | null) {
      if (url) {
        this.$emit('played');
      }
    },
  },
  template: '<div class="audio-player-stub" />',
});

const MultipleChoiceQuestionStub = defineComponent({
  name: 'MultipleChoiceQuestion',
  props: {
    correctAnswer: {
      type: String,
      required: true,
    },
  },
  emits: ['answer'],
  template:
    '<button class="answer-button" @click="$emit(\'answer\', correctAnswer)">Answer question</button>',
});

const DictationQuestionStub = defineComponent({
  name: 'DictationQuestion',
  emits: ['answer'],
  template:
    '<button class="dictation-button" @click="$emit(\'answer\', \'typed\')">Dictate</button>',
});

const AnswerFeedbackStub = defineComponent({
  name: 'AnswerFeedback',
  emits: ['next'],
  template: '<div class="answer-feedback-stub" />',
});

const GameTimerStub = defineComponent({
  name: 'GameTimer',
  props: {
    onTimeout: {
      type: Function,
      required: true,
    },
  },
  template: '<div class="game-timer-stub" />',
});

const ScoreDisplayStub = defineComponent({
  name: 'ScoreDisplay',
  props: {
    score: {
      type: Number,
      required: true,
    },
  },
  template: '<div class="score-display-stub" />',
});

function resetStores() {
  listeningStore.questions = [];
  listeningStore.currentIndex = 0;
  listeningStore.score = 0;
  listeningStore.gameActive = false;
  listeningStore.currentQuestion = null;
  listeningStore.startGame = vi.fn((questions: ListeningQuestion[]) => {
    listeningStore.questions = questions;
    listeningStore.currentIndex = 0;
    listeningStore.score = 0;
    listeningStore.gameActive = true;
    listeningStore.currentQuestion = questions[0] ?? null;
  });
  listeningStore.submitAnswer = vi.fn((isCorrect: boolean) => {
    if (isCorrect) {
      listeningStore.score += 1;
    }
    listeningStore.currentIndex += 1;
    listeningStore.currentQuestion = listeningStore.questions[listeningStore.currentIndex] ?? null;
    if (listeningStore.currentIndex >= listeningStore.questions.length) {
      listeningStore.endGame();
    }
  });
  listeningStore.endGame = vi.fn(() => {
    listeningStore.gameActive = false;
  });

  authStore.user = { id: 'user-123' };
  progressStore.updateProgress.mockReset();
  progressStore.recordGameSession.mockReset();
  progressStore.recordGameSession.mockResolvedValue(undefined);
}

function mountPage() {
  return mount(ListeningGame, {
    global: {
      stubs: {
        QPage: {
          template: '<div class="q-page-stub"><slot /></div>',
        },
        QBtn: {
          props: {
            label: {
              type: String,
              default: '',
            },
          },
          emits: ['click'],
          template: '<button @click="$emit(\'click\')"><slot />{{ label }}</button>',
        },
        QIcon: {
          template: '<span class="q-icon-stub" />',
        },
        ListeningSetup: ListeningSetupStub,
        'listening-setup': ListeningSetupStub,
        AudioPlayer: AudioPlayerStub,
        'audio-player': AudioPlayerStub,
        MultipleChoiceQuestion: MultipleChoiceQuestionStub,
        'multiple-choice-question': MultipleChoiceQuestionStub,
        DictationQuestion: DictationQuestionStub,
        'dictation-question': DictationQuestionStub,
        AnswerFeedback: AnswerFeedbackStub,
        'answer-feedback': AnswerFeedbackStub,
        GameTimer: GameTimerStub,
        'game-timer': GameTimerStub,
        ScoreDisplay: ScoreDisplayStub,
        'score-display': ScoreDisplayStub,
      },
    },
  });
}

describe('ListeningGame', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    resetStores();
    vi.doMock('src/services/listeningGameService', () => ({
      listeningGameService: mockListeningGameService,
    }));
    vi.doMock('src/services/ttsService', () => ({
      generatePronunciation: mockGeneratePronunciation,
    }));
    vi.doMock('src/stores/listeningGame', () => ({
      useListeningGameStore: () => listeningStore,
    }));
    vi.doMock('src/stores/progress', () => ({
      useProgressStore: () => progressStore,
    }));
    vi.doMock('src/stores/auth', () => ({
      useAuthStore: () => authStore,
    }));
    ListeningGame = (await import('./ListeningGame.vue')).default;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reveals the question UI when audio loading is skipped because no user is signed in', async () => {
    authStore.user = null;
    mockListeningGameService.getListeningQuestions.mockResolvedValue([
      makeQuestion('q1', '猫', 'cat'),
    ]);

    const wrapper = mountPage();

    await wrapper.find('.start-button').trigger('click');
    await flushPromises();

    expect(mockGeneratePronunciation).not.toHaveBeenCalled();
    expect(wrapper.find('.answer-button').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('Listen to the audio, then answer the question');
  });

  it('catches next-audio preload failures instead of leaving an unhandled rejection', async () => {
    const preloadError = new Error('Preload failed');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    mockListeningGameService.getListeningQuestions.mockResolvedValue([
      makeQuestion('q1', '猫', 'cat'),
      makeQuestion('q2', '犬', 'dog'),
    ]);
    mockGeneratePronunciation
      .mockResolvedValueOnce({ audioUrl: 'https://example.com/q1.mp3' })
      .mockRejectedValueOnce(preloadError);

    const wrapper = mountPage();

    await wrapper.find('.start-button').trigger('click');
    await flushPromises();

    await wrapper.find('.answer-button').trigger('click');
    await flushPromises();

    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to preload next audio:', preloadError);
  });

  it('records only attempted prompts when a listening game times out', async () => {
    mockListeningGameService.getListeningQuestions.mockResolvedValue([
      makeQuestion('q1', '猫', 'cat'),
      makeQuestion('q2', '犬', 'dog'),
    ]);
    mockGeneratePronunciation
      .mockResolvedValueOnce({ audioUrl: 'https://example.com/q1.mp3' })
      .mockResolvedValueOnce({ audioUrl: 'https://example.com/q2.mp3' });

    const wrapper = mountPage();

    await wrapper.find('.start-button').trigger('click');
    await flushPromises();

    await wrapper.find('.answer-button').trigger('click');
    await flushPromises();

    const onTimeout = wrapper.findComponent(GameTimerStub).props('onTimeout') as () => void;
    onTimeout();
    await flushPromises();

    expect(progressStore.recordGameSession).toHaveBeenCalledWith(
      'listening',
      1,
      expect.any(Number),
      1,
      1,
    );
  });

  it('does not record an abandoned listening game during unmount cleanup', async () => {
    mockListeningGameService.getListeningQuestions.mockResolvedValue([
      makeQuestion('q1', '猫', 'cat'),
      makeQuestion('q2', '犬', 'dog'),
    ]);
    mockGeneratePronunciation.mockResolvedValue({ audioUrl: 'https://example.com/q1.mp3' });

    const wrapper = mountPage();

    await wrapper.find('.start-button').trigger('click');
    await flushPromises();

    wrapper.unmount();
    await flushPromises();

    expect(progressStore.recordGameSession).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, reactive, type Component } from 'vue';
import type { ListeningConfig, ListeningQuestion } from '../../types/listening';

const mockListeningGameService = {
  getListeningQuestions: vi.fn(),
};

const mockGeneratePronunciation = vi.fn();
const mockNotifyCreate = vi.fn();
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
  session: { user: { id: string } } | null;
}>({
  user: { id: 'user-123' },
  session: { user: { id: 'user-123' } },
});

const audioPlayerBehavior = reactive({
  autoEmitPlayed: true,
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

const makeSentenceQuestion = (
  id: string,
  text: string,
  englishTranslation: string,
): ListeningQuestion => ({
  kind: 'sentence',
  id,
  text,
  reading: `${text}-reading`,
  romaji: `${text}-romaji`,
  englishTranslation,
  distractors: ['wrong-1', 'wrong-2', 'wrong-3'],
  raw: {
    id,
    japanese_sentence: text,
    hiragana: `${text}-reading`,
    romaji: `${text}-romaji`,
    english_translation: englishTranslation,
    difficulty_level: 1,
    category: 'test',
    created_at: '2024-01-01T00:00:00Z',
    words_array: [text],
  },
});

function createDeferred<T>() {
  let resolve!: (_value: T) => void;
  let reject!: (_error?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

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
  emits: ['played', 'error'],
  watch: {
    audioUrl(url: string | null) {
      if (url && audioPlayerBehavior.autoEmitPlayed) {
        this.$emit('played');
      }
    },
  },
  template:
    '<div class="audio-player-stub"><button class="audio-played-button" @click="$emit(\'played\')">Played</button><button class="audio-error-button" @click="$emit(\'error\', \'playback-failed\')">Error</button><button class="audio-autoplay-blocked-button" @click="$emit(\'error\', \'autoplay-blocked\')">Autoplay blocked</button></div>',
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
  props: {
    reading: {
      type: String,
      default: undefined,
    },
    isCorrect: {
      type: Boolean,
      default: false,
    },
  },
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
  authStore.session = { user: { id: 'user-123' } };
  audioPlayerBehavior.autoEmitPlayed = true;
  listeningConfig.mode = 'multiple-choice';
  listeningConfig.source = 'vocabulary';
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
    vi.doMock('quasar', async (importOriginal) => {
      const actual = await importOriginal<typeof import('quasar')>();
      return {
        ...actual,
        Notify: {
          ...actual.Notify,
          create: mockNotifyCreate,
        },
      };
    });
    ListeningGame = (await import('./ListeningGame.vue')).default;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips the current question when audio loading fails', async () => {
    const audioError = new Error('TTS unavailable');
    mockListeningGameService.getListeningQuestions.mockResolvedValue([
      makeQuestion('q1', '猫', 'cat'),
      makeQuestion('q2', '犬', 'dog'),
    ]);
    mockGeneratePronunciation
      .mockRejectedValueOnce(audioError)
      .mockResolvedValueOnce({ audioUrl: 'https://example.com/q2.mp3' });

    const wrapper = mountPage();

    await wrapper.find('.start-button').trigger('click');
    await flushPromises();

    expect(listeningStore.currentQuestion?.id).toBe('q2');
    expect(mockNotifyCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to load audio. Skipping this question.',
        type: 'warning',
      }),
    );
    expect(wrapper.find('.answer-button').exists()).toBe(true);
    expect(wrapper.find('.answer-feedback-stub').exists()).toBe(false);
  });

  it('uses the session user ID while the profile is still loading', async () => {
    authStore.user = null;
    authStore.session = { user: { id: 'session-user-456' } };
    mockListeningGameService.getListeningQuestions.mockResolvedValue([
      makeQuestion('q1', '猫', 'cat'),
    ]);
    mockGeneratePronunciation.mockResolvedValue({ audioUrl: 'https://example.com/q1.mp3' });

    const wrapper = mountPage();

    await wrapper.find('.start-button').trigger('click');
    await flushPromises();

    expect(mockGeneratePronunciation).toHaveBeenCalledWith('q1', '猫', 'session-user-456');
    expect(mockNotifyCreate).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Audio is unavailable. Skipping this question.' }),
    );
    expect(listeningStore.currentQuestion?.id).toBe('q1');

    await wrapper.find('.answer-button').trigger('click');
    await flushPromises();

    expect(progressStore.recordGameSession).toHaveBeenCalledWith(
      'vocabulary',
      1,
      expect.any(Number),
      1,
      1,
      'session-user-456',
    );
  });

  it('ends the listening session once when authentication is missing before audio loads', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    authStore.user = null;
    authStore.session = null;
    mockListeningGameService.getListeningQuestions.mockResolvedValue([
      makeQuestion('q1', '猫', 'cat'),
      makeQuestion('q2', '犬', 'dog'),
    ]);

    const wrapper = mountPage();

    await wrapper.find('.start-button').trigger('click');
    await flushPromises();

    expect(mockGeneratePronunciation).not.toHaveBeenCalled();
    expect(listeningStore.submitAnswer).not.toHaveBeenCalled();
    expect(listeningStore.endGame).toHaveBeenCalledTimes(1);
    expect(listeningStore.gameActive).toBe(false);
    expect(wrapper.find('.start-button').exists()).toBe(true);
    expect(progressStore.recordGameSession).not.toHaveBeenCalled();
    expect(mockNotifyCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Your session has expired. Please sign in again to continue listening practice.',
        type: 'warning',
      }),
    );
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'loadAudioForCurrentQuestion: no authenticated user — ending listening session. Session may have expired.',
    );
  });

  it('passes sentence readings to answer feedback when available', async () => {
    listeningConfig.mode = 'dictation';
    listeningConfig.source = 'sentences';
    mockListeningGameService.getListeningQuestions.mockResolvedValue([
      makeSentenceQuestion('s1', '猫です。', 'It is a cat.'),
    ]);
    mockGeneratePronunciation.mockResolvedValue({ audioUrl: 'https://example.com/s1.mp3' });

    const wrapper = mountPage();

    await wrapper.find('.start-button').trigger('click');
    await flushPromises();

    await wrapper.find('.dictation-button').trigger('click');
    await flushPromises();

    expect(wrapper.findComponent(AnswerFeedbackStub).props('reading')).toBe('猫です。-reading');
    expect(wrapper.findComponent(AnswerFeedbackStub).props('isCorrect')).toBe(false);
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

  it('ignores stale audio failures after a new listening session has already started', async () => {
    const staleAudioError = new Error('Stale TTS failure');
    const deferredAudio = createDeferred<{ audioUrl: string }>();
    void deferredAudio.promise.catch(() => undefined);

    mockListeningGameService.getListeningQuestions
      .mockResolvedValueOnce([makeQuestion('q1', '猫', 'cat'), makeQuestion('q2', '犬', 'dog')])
      .mockResolvedValueOnce([makeQuestion('n1', '鳥', 'bird'), makeQuestion('n2', '魚', 'fish')]);
    mockGeneratePronunciation
      .mockReturnValueOnce(deferredAudio.promise)
      .mockResolvedValueOnce({ audioUrl: 'https://example.com/n1.mp3' });

    const wrapper = mountPage();

    await wrapper.find('.start-button').trigger('click');
    await flushPromises();

    const onTimeout = wrapper.findComponent(GameTimerStub).props('onTimeout') as () => void;
    onTimeout();
    await flushPromises();

    const playAgainButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Play Again');
    expect(playAgainButton).toBeTruthy();
    await playAgainButton!.trigger('click');
    await flushPromises();

    expect(listeningStore.currentQuestion?.id).toBe('n1');
    const notifyCallCount = mockNotifyCreate.mock.calls.length;

    deferredAudio.reject(staleAudioError);
    await flushPromises();

    expect(listeningStore.currentQuestion?.id).toBe('n1');
    expect(listeningStore.submitAnswer).not.toHaveBeenCalled();
    expect(mockNotifyCreate).toHaveBeenCalledTimes(notifyCallCount);
  });

  it('skips to the next question when audio playback fails', async () => {
    audioPlayerBehavior.autoEmitPlayed = false;
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

    expect(wrapper.find('.answer-button').exists()).toBe(false);

    await wrapper.find('.audio-error-button').trigger('click');
    await flushPromises();

    expect(listeningStore.currentQuestion?.id).toBe('q2');
    expect(mockNotifyCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Audio playback failed. Skipping this question.',
        type: 'warning',
      }),
    );

    await wrapper.find('.audio-played-button').trigger('click');
    await flushPromises();

    expect(wrapper.find('.answer-button').exists()).toBe(true);
  });

  it('keeps the current prompt available when autoplay is blocked', async () => {
    audioPlayerBehavior.autoEmitPlayed = false;
    mockListeningGameService.getListeningQuestions.mockResolvedValue([
      makeQuestion('q1', '猫', 'cat'),
      makeQuestion('q2', '犬', 'dog'),
    ]);
    mockGeneratePronunciation.mockResolvedValueOnce({ audioUrl: 'https://example.com/q1.mp3' });

    const wrapper = mountPage();

    await wrapper.find('.start-button').trigger('click');
    await flushPromises();

    expect(wrapper.find('.answer-button').exists()).toBe(false);

    await wrapper.find('.audio-autoplay-blocked-button').trigger('click');
    await flushPromises();

    expect(listeningStore.currentQuestion?.id).toBe('q1');
    expect(listeningStore.submitAnswer).not.toHaveBeenCalled();
    expect(mockNotifyCreate).not.toHaveBeenCalled();

    await wrapper.find('.audio-played-button').trigger('click');
    await flushPromises();

    expect(wrapper.find('.answer-button').exists()).toBe(true);
  });

  it('shows game-over accuracy using attempted prompts after skipped audio questions', async () => {
    mockListeningGameService.getListeningQuestions.mockResolvedValue([
      makeQuestion('q1', '猫', 'cat'),
      makeQuestion('q2', '犬', 'dog'),
    ]);
    mockGeneratePronunciation
      .mockRejectedValueOnce(new Error('TTS unavailable'))
      .mockResolvedValueOnce({ audioUrl: 'https://example.com/q2.mp3' });

    const wrapper = mountPage();

    await wrapper.find('.start-button').trigger('click');
    await flushPromises();

    expect(listeningStore.currentQuestion?.id).toBe('q2');

    await wrapper.find('.answer-button').trigger('click');
    await flushPromises();

    wrapper.findComponent(AnswerFeedbackStub).vm.$emit('next');
    await flushPromises();

    expect(wrapper.text()).toContain('1 / 1 correct');
    expect(wrapper.text()).not.toContain('1 / 2 correct');
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
      'vocabulary',
      1,
      expect.any(Number),
      1,
      1,
      'user-123',
    );
  });

  it('shows the game-over state immediately when timeout happens during answer feedback', async () => {
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

    expect(wrapper.find('.answer-feedback-stub').exists()).toBe(true);

    const onTimeout = wrapper.findComponent(GameTimerStub).props('onTimeout') as () => void;
    onTimeout();
    await flushPromises();

    expect(wrapper.find('.answer-feedback-stub').exists()).toBe(false);
    expect(wrapper.text()).toContain('Game Over!');
    expect(wrapper.text()).toContain('Play Again');
  });

  it('does not record a listening session when the timer expires before any answer is submitted', async () => {
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

    const onTimeout = wrapper.findComponent(GameTimerStub).props('onTimeout') as () => void;
    onTimeout();
    await flushPromises();

    expect(progressStore.recordGameSession).not.toHaveBeenCalled();
  });

  it('does not record a listening session when audio failures skip every prompt without an answer', async () => {
    mockListeningGameService.getListeningQuestions.mockResolvedValue([
      makeQuestion('q1', '猫', 'cat'),
    ]);
    mockGeneratePronunciation.mockRejectedValueOnce(new Error('TTS unavailable'));

    const wrapper = mountPage();

    await wrapper.find('.start-button').trigger('click');
    await flushPromises();

    expect(listeningStore.gameActive).toBe(false);
    expect(progressStore.recordGameSession).not.toHaveBeenCalled();
  });

  it('records listening sessions using the practiced sentence source', async () => {
    listeningConfig.source = 'sentences';
    mockListeningGameService.getListeningQuestions.mockResolvedValue([
      makeSentenceQuestion('s1', '猫です。', 'It is a cat.'),
    ]);
    mockGeneratePronunciation.mockResolvedValue({ audioUrl: 'https://example.com/s1.mp3' });

    const wrapper = mountPage();

    await wrapper.find('.start-button').trigger('click');
    await flushPromises();

    await wrapper.find('.answer-button').trigger('click');
    await flushPromises();

    expect(progressStore.recordGameSession).toHaveBeenCalledWith(
      'sentence',
      1,
      expect.any(Number),
      1,
      1,
      'user-123',
    );
  });

  it('notifies the user when saving the listening session fails', async () => {
    progressStore.recordGameSession.mockRejectedValue(new Error('Save failed'));
    mockListeningGameService.getListeningQuestions.mockResolvedValue([
      makeQuestion('q1', '猫', 'cat'),
    ]);
    mockGeneratePronunciation.mockResolvedValue({ audioUrl: 'https://example.com/q1.mp3' });

    const wrapper = mountPage();

    await wrapper.find('.start-button').trigger('click');
    await flushPromises();

    await wrapper.find('.answer-button').trigger('click');
    await flushPromises();

    expect(progressStore.recordGameSession).toHaveBeenCalledWith(
      'vocabulary',
      1,
      expect.any(Number),
      1,
      1,
      'user-123',
    );
    expect(mockNotifyCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Your game progress could not be saved. Please check your connection.',
        type: 'warning',
      }),
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

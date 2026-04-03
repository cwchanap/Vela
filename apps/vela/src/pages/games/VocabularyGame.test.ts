import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { Quasar, Notify } from 'quasar';
import { createRouter, createMemoryHistory } from 'vue-router';
import VocabularyGame from './VocabularyGame.vue';
import { useGameStore } from 'src/stores/games';
import { useAuthStore } from 'src/stores/auth';
import { useProgressStore } from 'src/stores/progress';

// Mock child components
vi.mock('src/components/games/VocabularyCard.vue', () => ({
  default: {
    template: '<div data-testid="vocabulary-card"><slot /></div>',
    name: 'VocabularyCard',
    props: ['question', 'showPronunciation'],
    emits: ['answer', 'pronounce'],
  },
}));

vi.mock('src/components/games/ScoreDisplay.vue', () => ({
  default: {
    template: '<div data-testid="score-display" />',
    name: 'ScoreDisplay',
    props: ['score'],
  },
}));

vi.mock('src/components/games/GameTimer.vue', () => ({
  default: {
    template: '<div data-testid="game-timer" />',
    name: 'GameTimer',
  },
}));

vi.mock('src/components/games/JlptLevelSelector.vue', () => ({
  default: {
    template: '<div data-testid="jlpt-level-selector" />',
    name: 'JlptLevelSelector',
    props: ['modelValue'],
    emits: ['update:modelValue'],
  },
}));

// Mock services
const mockGetVocabularyQuestions = vi.fn();
const mockGetVocabularyPool = vi.fn();
const mockGetStats = vi.fn();
const mockGetDueItems = vi.fn();
const mockQualityFromCorrectness = vi.fn();
const mockRecordBatchReview = vi.fn();
const mockPronounceWord = vi.fn();
const mockShuffleArray = vi.fn().mockImplementation((arr: any[]) => arr);
const mockBuildDistractors = vi.fn().mockReturnValue([
  { id: 'opt1', japanese_word: '猫', english_translation: 'cat' },
  { id: 'opt2', japanese_word: '犬', english_translation: 'dog' },
  { id: 'opt3', japanese_word: '鳥', english_translation: 'bird' },
]);
const mockNormalizeVocabulary = vi.fn().mockImplementation((v: any) => v);
const mockToVocabularyOption = vi.fn().mockImplementation((v: any) => ({
  id: v.id,
  japanese_word: v.japanese_word,
  english_translation: v.english_translation,
}));

vi.mock('../../services/gameService', () => ({
  gameService: {
    getVocabularyQuestions: (...args: any[]) => mockGetVocabularyQuestions(...args),
    getVocabularyPool: (...args: any[]) => mockGetVocabularyPool(...args),
  },
  InsufficientVocabularyError: class InsufficientVocabularyError extends Error {
    constructor() {
      super('Insufficient vocabulary');
      this.name = 'InsufficientVocabularyError';
    }
  },
}));

vi.mock('../../services/srsService', () => ({
  srsService: {
    getStats: (...args: any[]) => mockGetStats(...args),
    getDueItems: (...args: any[]) => mockGetDueItems(...args),
    qualityFromCorrectness: (...args: any[]) => mockQualityFromCorrectness(...args),
    recordBatchReview: (...args: any[]) => mockRecordBatchReview(...args),
  },
}));

vi.mock('../../services/ttsService', () => ({
  pronounceWord: (...args: any[]) => mockPronounceWord(...args),
}));

vi.mock('src/utils/vocabulary', () => ({
  buildDistractors: (...args: any[]) => mockBuildDistractors(...args),
  normalizeVocabulary: (...args: any[]) => mockNormalizeVocabulary(...args),
  toVocabularyOption: (...args: any[]) => mockToVocabularyOption(...args),
}));

vi.mock('src/utils/array', () => ({
  shuffleArray: (...args: any[]) => mockShuffleArray(...args),
}));

const mockVocabQuestion = {
  word: {
    id: 'vocab-1',
    japanese_word: '本',
    english_translation: 'book',
    hiragana: 'ほん',
    jlpt_level: 'N5',
  },
  options: [
    { id: 'vocab-1', japanese_word: '本', english_translation: 'book' },
    { id: 'opt1', japanese_word: '猫', english_translation: 'cat' },
    { id: 'opt2', japanese_word: '犬', english_translation: 'dog' },
    { id: 'opt3', japanese_word: '鳥', english_translation: 'bird' },
  ],
  correctAnswer: 'vocab-1',
};

const mockUser = {
  id: 'user-1',
  email: 'test@test.com',
  username: 'testuser',
  current_level: 1,
  total_experience: 0,
  learning_streak: 0,
  native_language: 'en',
  avatar_url: null,
  preferences: { dailyGoal: 30 },
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
} as any;

const createTestRouter = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/games/vocabulary', component: { template: '<div />' } },
    ],
  });

describe('VocabularyGame', () => {
  let router: ReturnType<typeof createTestRouter>;

  beforeEach(() => {
    setActivePinia(createPinia());
    router = createTestRouter();
    vi.clearAllMocks();
    Notify.create = vi.fn() as any;

    mockGetVocabularyQuestions.mockReset();
    mockGetVocabularyPool.mockReset();
    mockGetStats.mockReset();
    mockGetDueItems.mockReset();
    mockQualityFromCorrectness.mockReset();
    mockRecordBatchReview.mockReset();
    mockPronounceWord.mockReset();
    mockShuffleArray.mockReset();
    mockBuildDistractors.mockReset();
    mockNormalizeVocabulary.mockReset();
    mockToVocabularyOption.mockReset();

    // Default mocks
    mockGetStats.mockResolvedValue({ due_today: 0 });
    mockGetVocabularyQuestions.mockResolvedValue([mockVocabQuestion]);
    mockGetVocabularyPool.mockResolvedValue([]);
    mockQualityFromCorrectness.mockReturnValue(3);
    mockRecordBatchReview.mockResolvedValue(undefined);
    mockPronounceWord.mockResolvedValue(undefined);
    mockShuffleArray.mockImplementation((arr: any[]) => arr);
    mockBuildDistractors.mockReturnValue([
      { id: 'opt1', japanese_word: '猫', english_translation: 'cat' },
      { id: 'opt2', japanese_word: '犬', english_translation: 'dog' },
      { id: 'opt3', japanese_word: '鳥', english_translation: 'bird' },
    ]);
    mockNormalizeVocabulary.mockImplementation((v: any) => v);
    mockToVocabularyOption.mockImplementation((v: any) => ({
      id: v.id,
      japanese_word: v.japanese_word,
      english_translation: v.english_translation,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mountComponent = async () => {
    const wrapper = mount(VocabularyGame, {
      global: {
        plugins: [[Quasar, { plugins: { Notify } }], router],
        stubs: {
          'q-page': { template: '<div><slot /></div>' },
          'q-toggle': {
            template:
              '<input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
            props: ['modelValue', 'label', 'color'],
            emits: ['update:modelValue'],
          },
          'q-btn': {
            template:
              '<button @click="$emit(\'click\')" :data-label="label">{{ label }}<slot /></button>',
            props: [
              'label',
              'color',
              'loading',
              'disable',
              'flat',
              'round',
              'dense',
              'icon',
              'size',
              'ariaLabel',
            ],
            emits: ['click'],
          },
          'q-card': { template: '<div><slot /></div>' },
          'q-card-section': { template: '<div><slot /></div>' },
          'q-card-actions': { template: '<div><slot /></div>' },
          'q-icon': true,
          'q-tooltip': true,
        },
      },
    });
    await router.isReady();
    // Re-assign after Quasar plugin installation overrides Notify.create
    Notify.create = vi.fn() as any;
    return wrapper;
  };

  describe('Initial render - setup screen', () => {
    it('renders setup screen by default', async () => {
      const wrapper = await mountComponent();
      expect(wrapper.text()).toContain('Vocabulary Quiz');
      wrapper.unmount();
    });

    it('shows the Start Quiz button by default', async () => {
      const wrapper = await mountComponent();
      expect(wrapper.text()).toContain('Start Quiz');
      wrapper.unmount();
    });

    it('renders JlptLevelSelector component', async () => {
      const wrapper = await mountComponent();
      expect(wrapper.find('[data-testid="jlpt-level-selector"]').exists()).toBe(true);
      wrapper.unmount();
    });

    it('shows SRS toggle', async () => {
      const wrapper = await mountComponent();
      expect(wrapper.find('input[type="checkbox"]').exists()).toBe(true);
      wrapper.unmount();
    });
  });

  describe('startGame - regular quiz', () => {
    it('starts a regular game and hides setup screen', async () => {
      const wrapper = await mountComponent();
      const gameStore = useGameStore();

      const startBtn = wrapper.find('[data-label="Start Quiz"]');
      await startBtn.trigger('click');
      await vi.waitFor(() => expect(gameStore.gameActive).toBe(true));

      expect(mockGetVocabularyQuestions).toHaveBeenCalledWith(10, undefined);
      // Setup screen should be hidden after starting
      await wrapper.vm.$nextTick();
      expect(wrapper.find('[data-label="Start Quiz"]').exists()).toBe(false);
      wrapper.unmount();
    });

    it('shows warning when no vocabulary available', async () => {
      mockGetVocabularyQuestions.mockResolvedValue([]);
      const wrapper = await mountComponent();

      const startBtn = wrapper.find('[data-label="Start Quiz"]');
      await startBtn.trigger('click');
      await vi.waitFor(() =>
        expect(Notify.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' })),
      );
      wrapper.unmount();
    });

    it('shows error notification when game fails to start', async () => {
      mockGetVocabularyQuestions.mockRejectedValue(new Error('Network error'));
      const wrapper = await mountComponent();

      const startBtn = wrapper.find('[data-label="Start Quiz"]');
      await startBtn.trigger('click');
      await vi.waitFor(() =>
        expect(Notify.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'negative' })),
      );
      wrapper.unmount();
    });
  });

  describe('startGame - with JLPT filter', () => {
    it('passes jlpt filter to getVocabularyQuestions when levels selected', async () => {
      mockGetVocabularyQuestions.mockResolvedValue([mockVocabQuestion]);
      const wrapper = await mountComponent();

      // Set JLPT levels directly on the component
      (wrapper.vm as any).selectedJlptLevels = ['N5', 'N4'];
      const startBtn = wrapper.find('[data-label="Start Quiz"]');
      await startBtn.trigger('click');
      await vi.waitFor(() =>
        expect(mockGetVocabularyQuestions).toHaveBeenCalledWith(10, ['N5', 'N4']),
      );
      wrapper.unmount();
    });

    it('shows the JLPT-specific empty state message when filtered questions are unavailable', async () => {
      mockGetVocabularyQuestions.mockResolvedValue([]);
      const wrapper = await mountComponent();

      (wrapper.vm as any).selectedJlptLevels = ['N5'];
      await wrapper.vm.$nextTick();

      const startBtn = wrapper.find('[data-label="Start Quiz"]');
      await startBtn.trigger('click');

      await vi.waitFor(() =>
        expect(Notify.create).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'warning',
            message: expect.stringContaining('selected JLPT levels'),
          }),
        ),
      );
      wrapper.unmount();
    });
  });

  describe('handleAnswer', () => {
    it('updates correctAnswers count for correct answer', async () => {
      const wrapper = await mountComponent();
      const gameStore = useGameStore();

      const startBtn = wrapper.find('[data-label="Start Quiz"]');
      await startBtn.trigger('click');
      await vi.waitFor(() => expect(gameStore.gameActive).toBe(true));

      await (wrapper.vm as any).handleAnswer('vocab-1'); // correct answer
      expect((wrapper.vm as any).correctAnswers).toBe(1);
      wrapper.unmount();
    });

    it('does not increment correctAnswers for wrong answer', async () => {
      const wrapper = await mountComponent();
      const gameStore = useGameStore();

      const startBtn = wrapper.find('[data-label="Start Quiz"]');
      await startBtn.trigger('click');
      await vi.waitFor(() => expect(gameStore.gameActive).toBe(true));

      await (wrapper.vm as any).handleAnswer('wrong-id'); // wrong answer
      expect((wrapper.vm as any).correctAnswers).toBe(0);
      wrapper.unmount();
    });

    it('sets showAnswerFeedback to true after answering', async () => {
      const wrapper = await mountComponent();
      const gameStore = useGameStore();

      const startBtn = wrapper.find('[data-label="Start Quiz"]');
      await startBtn.trigger('click');
      await vi.waitFor(() => expect(gameStore.gameActive).toBe(true));

      await (wrapper.vm as any).handleAnswer('vocab-1');
      expect((wrapper.vm as any).showAnswerFeedback).toBe(true);
      wrapper.unmount();
    });

    it('sets lastAnswerResult with correct data', async () => {
      const wrapper = await mountComponent();
      const gameStore = useGameStore();

      const startBtn = wrapper.find('[data-label="Start Quiz"]');
      await startBtn.trigger('click');
      await vi.waitFor(() => expect(gameStore.gameActive).toBe(true));

      await (wrapper.vm as any).handleAnswer('vocab-1');
      const result = (wrapper.vm as any).lastAnswerResult;
      expect(result).not.toBeNull();
      expect(result.isCorrect).toBe(true);
      expect(result.selectedId).toBe('vocab-1');
      wrapper.unmount();
    });

    it('queues SRS review when user is authenticated', async () => {
      const wrapper = await mountComponent();
      const gameStore = useGameStore();
      const authStore = useAuthStore();
      authStore.setUser(mockUser);
      authStore.setSession({ user: { id: 'user-1', email: 'test@test.com' } });

      const startBtn = wrapper.find('[data-label="Start Quiz"]');
      await startBtn.trigger('click');
      await vi.waitFor(() => expect(gameStore.gameActive).toBe(true));

      await (wrapper.vm as any).handleAnswer('vocab-1');
      expect((wrapper.vm as any).srsReviewQueue.length).toBe(1);
      wrapper.unmount();
    });

    it('does not queue SRS review when user is not authenticated', async () => {
      const wrapper = await mountComponent();
      const gameStore = useGameStore();

      const startBtn = wrapper.find('[data-label="Start Quiz"]');
      await startBtn.trigger('click');
      await vi.waitFor(() => expect(gameStore.gameActive).toBe(true));

      await (wrapper.vm as any).handleAnswer('vocab-1');
      expect((wrapper.vm as any).srsReviewQueue.length).toBe(0);
      wrapper.unmount();
    });
  });

  describe('proceedToNextQuestion', () => {
    it('clears showAnswerFeedback and lastAnswerResult', async () => {
      const wrapper = await mountComponent();
      const gameStore = useGameStore();

      const startBtn = wrapper.find('[data-label="Start Quiz"]');
      await startBtn.trigger('click');
      await vi.waitFor(() => expect(gameStore.gameActive).toBe(true));

      await (wrapper.vm as any).handleAnswer('vocab-1');
      expect((wrapper.vm as any).showAnswerFeedback).toBe(true);

      (wrapper.vm as any).proceedToNextQuestion();
      expect((wrapper.vm as any).showAnswerFeedback).toBe(false);
      expect((wrapper.vm as any).lastAnswerResult).toBeNull();
      wrapper.unmount();
    });
  });

  describe('handlePronounce', () => {
    it('shows warning when user is not authenticated', async () => {
      const wrapper = await mountComponent();

      const word = { id: 'vocab-1', japanese_word: '本', english_translation: 'book' } as any;
      await (wrapper.vm as any).handlePronounce(word);

      expect(Notify.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'warning', message: expect.stringContaining('sign in') }),
      );
      wrapper.unmount();
    });

    it('calls pronounceWord when user is authenticated', async () => {
      const wrapper = await mountComponent();
      const authStore = useAuthStore();
      authStore.setUser(mockUser);
      authStore.setSession({ user: { id: 'user-1', email: 'test@test.com' } });

      const word = { id: 'vocab-1', japanese_word: '本', english_translation: 'book' } as any;
      await (wrapper.vm as any).handlePronounce(word);

      expect(mockPronounceWord).toHaveBeenCalledWith(word, 'user-1');
      wrapper.unmount();
    });

    it('shows error notification when pronounceWord fails', async () => {
      mockPronounceWord.mockRejectedValue(new Error('TTS error'));
      const wrapper = await mountComponent();
      const authStore = useAuthStore();
      authStore.setUser(mockUser);
      authStore.setSession({ user: { id: 'user-1', email: 'test@test.com' } });

      const word = { id: 'vocab-1', japanese_word: '本', english_translation: 'book' } as any;
      await (wrapper.vm as any).handlePronounce(word);

      expect(Notify.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'negative' }));
      wrapper.unmount();
    });

    it('shows the fallback pronunciation error when a non-Error value is thrown', async () => {
      mockPronounceWord.mockRejectedValue('TTS failed');
      const wrapper = await mountComponent();
      const authStore = useAuthStore();
      authStore.setUser(mockUser);
      authStore.setSession({ user: { id: 'user-1', email: 'test@test.com' } } as any);

      const word = { id: 'vocab-1', japanese_word: '本', english_translation: 'book' } as any;
      await (wrapper.vm as any).handlePronounce(word);

      expect(Notify.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'negative',
          message: 'Failed to play pronunciation. Please check your TTS settings.',
        }),
      );
      wrapper.unmount();
    });
  });

  describe('fetchDueCount', () => {
    it('sets dueCount to 0 when user is not authenticated', async () => {
      const wrapper = await mountComponent();
      await (wrapper.vm as any).fetchDueCount([]);
      expect((wrapper.vm as any).dueCount).toBe(0);
      wrapper.unmount();
    });

    it('fetches due count when user is authenticated', async () => {
      mockGetStats.mockResolvedValue({ due_today: 5 });
      const wrapper = await mountComponent();
      const authStore = useAuthStore();
      authStore.setUser(mockUser);
      authStore.setSession({ user: { id: 'user-1', email: 'test@test.com' } });

      await (wrapper.vm as any).fetchDueCount([]);
      expect((wrapper.vm as any).dueCount).toBe(5);
      wrapper.unmount();
    });

    it('sets dueCount to null when fetchStats fails', async () => {
      mockGetStats.mockRejectedValue(new Error('network error'));
      const wrapper = await mountComponent();
      const authStore = useAuthStore();
      authStore.setUser(mockUser);
      authStore.setSession({ user: { id: 'user-1', email: 'test@test.com' } });

      await (wrapper.vm as any).fetchDueCount([]);
      expect((wrapper.vm as any).dueCount).toBeNull();
      wrapper.unmount();
    });
  });

  describe('SRS mode', () => {
    it('enables SRS mode from the route query and shows the due-count error state', async () => {
      mockGetStats.mockRejectedValue(new Error('SRS stats unavailable'));
      const authStore = useAuthStore();
      authStore.setUser(mockUser);
      authStore.setSession({ user: { id: 'user-1', email: 'test@test.com' } } as any);
      await router.push('/games/vocabulary?srsMode=true');
      await router.isReady();

      const wrapper = await mountComponent();

      await vi.waitFor(() => expect((wrapper.vm as any).srsMode).toBe(true));
      await vi.waitFor(() => expect(wrapper.text()).toContain('Could not load review count'));
      wrapper.unmount();
    });

    it('starts SRS game when srsMode is enabled with due items', async () => {
      mockGetStats.mockResolvedValue({ due_today: 3 });
      mockGetDueItems.mockResolvedValue({
        items: [
          {
            vocabulary: {
              id: 'srs-1',
              japanese_word: '山',
              english_translation: 'mountain',
              hiragana: 'やま',
              jlpt_level: 'N5',
            },
          },
        ],
      });
      mockGetVocabularyPool.mockResolvedValue([
        { id: 'p1', japanese_word: '川', english_translation: 'river' },
        { id: 'p2', japanese_word: '海', english_translation: 'sea' },
        { id: 'p3', japanese_word: '空', english_translation: 'sky' },
      ]);

      const authStore = useAuthStore();
      authStore.setUser(mockUser);
      authStore.setSession({ user: { id: 'user-1', email: 'test@test.com' } } as any);
      const wrapper = await mountComponent();
      (wrapper.vm as any).dueCount = 3;
      (wrapper.vm as any).srsMode = true;
      await wrapper.vm.$nextTick();

      await (wrapper.vm as any).startGame();

      const gameStore = useGameStore();
      await vi.waitFor(() => expect(mockGetDueItems).toHaveBeenCalledWith(10, undefined));
      await vi.waitFor(() => expect(gameStore.gameActive).toBe(true));
      await vi.waitFor(() => expect(mockShuffleArray).toHaveBeenCalled());

      expect(gameStore.questions).toHaveLength(1);
      expect(gameStore.questions[0]).toEqual(
        expect.objectContaining({
          correctAnswer: 'srs-1',
          word: expect.objectContaining({ id: 'srs-1' }),
        }),
      );
      expect(gameStore.questions[0].options).toHaveLength(4);
      expect(mockGetVocabularyQuestions).not.toHaveBeenCalled();
      wrapper.unmount();
    });

    it('falls back to random quiz when SRS due items fetch fails', async () => {
      mockGetDueItems.mockRejectedValue(new Error('SRS error'));

      const wrapper = await mountComponent();
      const authStore = useAuthStore();
      authStore.setUser(mockUser);
      authStore.setSession({ user: { id: 'user-1', email: 'test@test.com' } });
      (wrapper.vm as any).dueCount = 3;
      (wrapper.vm as any).srsMode = true;

      const startBtn = wrapper.find('[data-label="Start Quiz"]');
      await startBtn.trigger('click');
      await vi.waitFor(() =>
        expect(Notify.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' })),
      );
      expect(mockGetVocabularyQuestions).toHaveBeenCalled();
      wrapper.unmount();
    });

    it('falls back to a random quiz when SRS review words lack enough distractors', async () => {
      mockGetStats.mockResolvedValue({ due_today: 1 });
      mockGetDueItems.mockResolvedValue({
        items: [
          {
            vocabulary: {
              id: 'srs-1',
              japanese_word: '山',
              english_translation: 'mountain',
              hiragana: 'やま',
              jlpt_level: 'N5',
            },
          },
        ],
      });
      mockGetVocabularyPool.mockResolvedValue([
        { id: 'p1', japanese_word: '川', english_translation: 'river' },
      ]);
      mockBuildDistractors.mockReturnValueOnce([
        { id: 'p1', japanese_word: '川', english_translation: 'river' },
      ]);

      const authStore = useAuthStore();
      authStore.setUser(mockUser);
      authStore.setSession({ user: { id: 'user-1', email: 'test@test.com' } } as any);
      const wrapper = await mountComponent();
      const gameStore = useGameStore();
      (wrapper.vm as any).dueCount = 1;
      (wrapper.vm as any).srsMode = true;
      await wrapper.vm.$nextTick();

      await (wrapper.vm as any).startGame();
      await vi.waitFor(() => expect(mockBuildDistractors).toHaveBeenCalled());
      await vi.waitFor(() => expect(mockGetVocabularyQuestions).toHaveBeenCalled());
      expect(Notify.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'warning',
          message: expect.stringContaining('Not enough unique distractors'),
        }),
      );

      expect(gameStore.questions[0]).toEqual(
        expect.objectContaining({
          correctAnswer: 'vocab-1',
          word: expect.objectContaining({ id: 'vocab-1' }),
        }),
      );
      expect(gameStore.gameActive).toBe(true);
      wrapper.unmount();
    });
  });

  describe('session recording', () => {
    it('warns when queued SRS reviews cannot be saved after the game ends', async () => {
      mockRecordBatchReview.mockRejectedValue(new Error('SRS save failed'));
      const wrapper = await mountComponent();
      const authStore = useAuthStore();
      authStore.setUser(mockUser);
      authStore.setSession({ user: { id: 'user-1', email: 'test@test.com' } } as any);
      const gameStore = useGameStore();
      const progressStore = useProgressStore();
      const recordGameSessionSpy = vi
        .spyOn(progressStore, 'recordGameSession')
        .mockResolvedValue(undefined);

      const startBtn = wrapper.find('[data-label="Start Quiz"]');
      await startBtn.trigger('click');
      await vi.waitFor(() => expect(gameStore.gameActive).toBe(true));

      await (wrapper.vm as any).handleAnswer('vocab-1');

      await vi.waitFor(() => expect(mockRecordBatchReview).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(recordGameSessionSpy).toHaveBeenCalledTimes(1));
      expect(Notify.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'warning',
          message: expect.stringContaining('review progress could not be saved'),
        }),
      );
      wrapper.unmount();
    });
  });

  describe('game over screen', () => {
    it('shows game over screen when game ends', async () => {
      const wrapper = await mountComponent();
      const gameStore = useGameStore();

      const startBtn = wrapper.find('[data-label="Start Quiz"]');
      await startBtn.trigger('click');
      await vi.waitFor(() => expect(gameStore.gameActive).toBe(true));

      gameStore.gameActive = false;
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain('Game Over!');
      wrapper.unmount();
    });

    it('shows Play Again button on game over screen', async () => {
      const wrapper = await mountComponent();
      const gameStore = useGameStore();

      const startBtn = wrapper.find('[data-label="Start Quiz"]');
      await startBtn.trigger('click');
      await vi.waitFor(() => expect(gameStore.gameActive).toBe(true));

      gameStore.gameActive = false;
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain('Play Again');
      wrapper.unmount();
    });

    it('shows Change Settings button on game over screen', async () => {
      const wrapper = await mountComponent();
      const gameStore = useGameStore();

      const startBtn = wrapper.find('[data-label="Start Quiz"]');
      await startBtn.trigger('click');
      await vi.waitFor(() => expect(gameStore.gameActive).toBe(true));

      gameStore.gameActive = false;
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain('Change Settings');
      wrapper.unmount();
    });
  });

  describe('currentQuestion computed', () => {
    it('returns undefined when no questions loaded', async () => {
      const wrapper = await mountComponent();
      expect((wrapper.vm as any).currentQuestion).toBeUndefined();
      wrapper.unmount();
    });

    it('returns the current question from game store', async () => {
      const wrapper = await mountComponent();
      const gameStore = useGameStore();

      const startBtn = wrapper.find('[data-label="Start Quiz"]');
      await startBtn.trigger('click');
      await vi.waitFor(() => expect(gameStore.gameActive).toBe(true));

      expect((wrapper.vm as any).currentQuestion).toEqual(mockVocabQuestion);
      wrapper.unmount();
    });
  });
});

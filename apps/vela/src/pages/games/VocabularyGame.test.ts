import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { Quasar, Notify } from 'quasar';
import { createRouter, createMemoryHistory } from 'vue-router';
import VocabularyGame from './VocabularyGame.vue';
import { useGameStore } from 'src/stores/games';
import { useAuthStore } from 'src/stores/auth';

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
  buildDistractors: vi.fn().mockReturnValue([
    { id: 'opt1', japanese_word: '猫', english_translation: 'cat' },
    { id: 'opt2', japanese_word: '犬', english_translation: 'dog' },
    { id: 'opt3', japanese_word: '鳥', english_translation: 'bird' },
  ]),
  normalizeVocabulary: vi.fn().mockImplementation((v: any) => v),
  toVocabularyOption: vi.fn().mockImplementation((v: any) => ({
    id: v.id,
    japanese_word: v.japanese_word,
    english_translation: v.english_translation,
  })),
}));

vi.mock('src/utils/array', () => ({
  shuffleArray: vi.fn().mockImplementation((arr: any[]) => arr),
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

    // Default mocks
    mockGetStats.mockResolvedValue({ due_today: 0 });
    mockGetVocabularyQuestions.mockResolvedValue([mockVocabQuestion]);
    mockGetVocabularyPool.mockResolvedValue([]);
    mockQualityFromCorrectness.mockReturnValue(3);
    mockRecordBatchReview.mockResolvedValue(undefined);
    mockPronounceWord.mockResolvedValue(undefined);
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

      const wrapper = await mountComponent();
      const authStore = useAuthStore();
      authStore.setUser(mockUser);
      authStore.setSession({ user: { id: 'user-1', email: 'test@test.com' } });
      (wrapper.vm as any).dueCount = 3;
      (wrapper.vm as any).srsMode = true;

      const startBtn = wrapper.find('[data-label="Start Quiz"]');
      await startBtn.trigger('click');
      await vi.waitFor(() => expect(mockGetDueItems).toHaveBeenCalled());
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

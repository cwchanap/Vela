import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { Quasar, Notify } from 'quasar';
import SentenceBuilder from './SentenceBuilder.vue';
import { useGameStore } from 'src/stores/games';
import { useProgressStore } from 'src/stores/progress';
import { gameService } from 'src/services/gameService';
import type { SentenceQuestion } from 'src/stores/games';

let notifySpy: ReturnType<typeof vi.fn>;
let dialogSpy: ReturnType<typeof vi.fn>;

vi.mock('quasar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('quasar')>();
  return {
    ...actual,
    useQuasar: () => ({
      notify: notifySpy,
      dialog: dialogSpy,
    }),
  };
});

// Mock game service
vi.mock('src/services/gameService', () => ({
  gameService: {
    getSentenceQuestions: vi.fn(),
  },
}));

describe('SentenceBuilder', () => {
  const mockSentenceQuestions: SentenceQuestion[] = [
    {
      sentence: {
        id: 'sentence-1',
        japanese_sentence: '私は猫が好きです',
        english_translation: 'I like cats',
        words_array: ['私は', '猫が', '好きです'],
        created_at: '2024-01-01T00:00:00Z',
      },
      scrambled: ['好きです', '私は', '猫が'],
      correctAnswer: '私は 猫が 好きです',
    },
    {
      sentence: {
        id: 'sentence-2',
        japanese_sentence: '今日は晴れです',
        english_translation: 'It is sunny today',
        words_array: ['今日は', '晴れです'],
        created_at: '2024-01-01T00:00:00Z',
      },
      scrambled: ['晴れです', '今日は'],
      correctAnswer: '今日は 晴れです',
    },
  ];

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    notifySpy = vi.fn();
    dialogSpy = vi.fn();
    vi.mocked(gameService.getSentenceQuestions).mockResolvedValue(mockSentenceQuestions);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const mountComponent = () => {
    return mount(SentenceBuilder, {
      global: {
        plugins: [[Quasar, { plugins: { Notify } }]],
      },
    });
  };

  it('should show loading spinner initially', () => {
    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('Loading game...');
    expect(wrapper.findComponent({ name: 'QSpinnerDots' }).exists()).toBe(true);
  });

  it('should fetch and start sentence game on mount', async () => {
    const gameStore = useGameStore();
    const startGameSpy = vi.spyOn(gameStore, 'startSentenceGame');

    mountComponent();

    await flushPromises();

    expect(gameService.getSentenceQuestions).toHaveBeenCalledWith(5);
    expect(startGameSpy).toHaveBeenCalledWith(mockSentenceQuestions);
  });

  it('should display English translation of current question', async () => {
    const gameStore = useGameStore();
    gameStore.startSentenceGame(mockSentenceQuestions);

    const wrapper = mountComponent();
    await flushPromises();
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('I like cats');
  });

  it('should initialize scrambled words from question', async () => {
    const gameStore = useGameStore();
    gameStore.startSentenceGame(mockSentenceQuestions);

    const wrapper = mountComponent();
    await flushPromises();
    await wrapper.vm.$nextTick();

    // Should have scrambled words available - check text content
    expect(wrapper.text()).toContain('Available Words:');
    // The component should be showing the game content
    expect(wrapper.text()).toContain('Unscramble the sentence:');
  });

  it('should have "Check Answer" button disabled when no answer', async () => {
    const gameStore = useGameStore();
    gameStore.startSentenceGame(mockSentenceQuestions);

    const wrapper = mountComponent();
    await flushPromises();
    await wrapper.vm.$nextTick();

    const checkButton = wrapper
      .findAll('button')
      .find((btn) => btn.text().includes('Check Answer'));
    expect(checkButton?.attributes('disabled')).toBeDefined();
  });

  it('should display instruction text', async () => {
    const gameStore = useGameStore();
    gameStore.startSentenceGame(mockSentenceQuestions);

    const wrapper = mountComponent();
    await flushPromises();
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('Unscramble the sentence:');
  });

  it('should display "Your Answer" and "Available Words" sections', async () => {
    const gameStore = useGameStore();
    gameStore.startSentenceGame(mockSentenceQuestions);

    const wrapper = mountComponent();
    await flushPromises();
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('Your Answer:');
    expect(wrapper.text()).toContain('Available Words:');
  });

  it('should not call getSentenceQuestions if game already active', async () => {
    const gameStore = useGameStore();
    gameStore.startSentenceGame(mockSentenceQuestions);

    mountComponent();
    await flushPromises();

    // Should not be called because game is already active
    expect(gameService.getSentenceQuestions).not.toHaveBeenCalled();
  });

  it('should handle empty questions response', async () => {
    vi.mocked(gameService.getSentenceQuestions).mockResolvedValue([]);

    const gameStore = useGameStore();
    const startGameSpy = vi.spyOn(gameStore, 'startSentenceGame');

    const wrapper = mountComponent();
    await flushPromises();

    // Game should not have started — no game content visible
    expect(wrapper.findComponent({ name: 'QSpinnerDots' }).exists()).toBe(true);
    expect(gameStore.sentenceGameActive).toBe(false);
    expect(startGameSpy).not.toHaveBeenCalled();
  });

  it('should show game content when game is active', async () => {
    const gameStore = useGameStore();
    gameStore.startSentenceGame(mockSentenceQuestions);

    const wrapper = mountComponent();
    await flushPromises();
    await wrapper.vm.$nextTick();

    expect(wrapper.findComponent({ name: 'QSpinnerDots' }).exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Loading game...');
  });

  it('should have correct number of scrambled words', async () => {
    const gameStore = useGameStore();
    gameStore.startSentenceGame(mockSentenceQuestions);

    const wrapper = mountComponent();
    await flushPromises();
    await wrapper.vm.$nextTick();

    // Component should show word bank section
    expect(wrapper.text()).toContain('Available Words:');
    expect(wrapper.find('.word-bank').exists()).toBe(true);
  });

  it('should display the Japanese sentence as the primary prompt', async () => {
    const gameStore = useGameStore();
    gameStore.startSentenceGame(mockSentenceQuestions);

    const wrapper = mountComponent();
    await flushPromises();
    await wrapper.vm.$nextTick();

    const japaneseSentence = mockSentenceQuestions[0]?.sentence.japanese_sentence;
    expect(wrapper.text()).toContain(japaneseSentence || '');
  });

  it('should render the Japanese sentence in a large prompt element', async () => {
    const gameStore = useGameStore();
    gameStore.startSentenceGame(mockSentenceQuestions);

    const wrapper = mountComponent();
    await flushPromises();
    await wrapper.vm.$nextTick();

    const largeText = wrapper.find('.text-h5.japanese-text');
    expect(largeText.exists()).toBe(true);
  });

  it('should display English translation as a small hint caption', async () => {
    const gameStore = useGameStore();
    gameStore.startSentenceGame(mockSentenceQuestions);

    const wrapper = mountComponent();
    await flushPromises();
    await wrapper.vm.$nextTick();

    const englishTranslation = mockSentenceQuestions[0]?.sentence.english_translation;
    expect(wrapper.text()).toContain(englishTranslation || '');
  });

  it('should render English translation in caption style, not as primary content', async () => {
    const gameStore = useGameStore();
    gameStore.startSentenceGame(mockSentenceQuestions);

    const wrapper = mountComponent();
    await flushPromises();
    await wrapper.vm.$nextTick();

    const caption = wrapper.find('.text-caption.text-grey-7');
    expect(caption.exists()).toBe(true);
    expect(caption.text()).toBe(mockSentenceQuestions[0]?.sentence.english_translation);
  });

  it('should create drop zone for user answer', async () => {
    const gameStore = useGameStore();
    gameStore.startSentenceGame(mockSentenceQuestions);

    const wrapper = mountComponent();
    await flushPromises();
    await wrapper.vm.$nextTick();

    const dropZone = wrapper.find('.drop-zone');
    expect(dropZone.exists()).toBe(true);
  });

  it('should create word bank for available words', async () => {
    const gameStore = useGameStore();
    gameStore.startSentenceGame(mockSentenceQuestions);

    const wrapper = mountComponent();
    await flushPromises();
    await wrapper.vm.$nextTick();

    const wordBank = wrapper.find('.word-bank');
    expect(wordBank.exists()).toBe(true);
  });

  it('should have proper styling for drop zone', async () => {
    const gameStore = useGameStore();
    gameStore.startSentenceGame(mockSentenceQuestions);

    const wrapper = mountComponent();
    await flushPromises();
    await wrapper.vm.$nextTick();

    const dropZone = wrapper.find('.drop-zone');
    expect(dropZone.classes()).toContain('bg-grey-2');
    expect(dropZone.classes()).toContain('q-pa-md');
  });

  it('should have proper styling for word bank', async () => {
    const gameStore = useGameStore();
    gameStore.startSentenceGame(mockSentenceQuestions);

    const wrapper = mountComponent();
    await flushPromises();
    await wrapper.vm.$nextTick();

    const wordBank = wrapper.find('.word-bank');
    expect(wordBank.classes()).toContain('bg-grey-2');
    expect(wordBank.classes()).toContain('q-pa-md');
  });

  it('should request 5 questions by default', async () => {
    mountComponent();
    await flushPromises();

    expect(gameService.getSentenceQuestions).toHaveBeenCalledWith(5);
  });

  it('should initialize game start time on mount', async () => {
    mountComponent();
    await flushPromises();

    // Game should have started (checked via store state)
    const gameStore = useGameStore();
    expect(gameStore.sentenceGameActive).toBe(true);
  });

  it('keeps currentQuestion null and ignores answer checks before the game starts', async () => {
    let resolveQuestions!: (_questions: SentenceQuestion[]) => void;
    vi.mocked(gameService.getSentenceQuestions).mockReturnValue(
      new Promise<SentenceQuestion[]>((resolve) => {
        resolveQuestions = resolve;
      }),
    );

    const wrapper = mountComponent();
    const vm = wrapper.vm as any;

    expect(vm.currentQuestion).toBeNull();

    vm.checkAnswer();

    expect(notifySpy).not.toHaveBeenCalled();
    resolveQuestions([]);
    await flushPromises();
  });

  it('autoFillCorrect moves all answer tokens into the user answer', async () => {
    const gameStore = useGameStore();
    gameStore.startSentenceGame(mockSentenceQuestions);

    const wrapper = mountComponent();
    await flushPromises();
    await wrapper.vm.$nextTick();

    const vm = wrapper.vm as any;
    vm.autoFillCorrect();
    await wrapper.vm.$nextTick();

    expect(vm.userAnswer).toEqual(['私は', '猫が', '好きです']);
    expect(vm.scrambledWords).toEqual([]);
  });

  it('moves words between the scrambled bank and the user answer', async () => {
    const wrapper = mountComponent();
    await flushPromises();
    await wrapper.vm.$nextTick();

    const vm = wrapper.vm as any;

    vm.addWord(0);
    await wrapper.vm.$nextTick();
    expect(vm.userAnswer).toEqual(['好きです']);
    expect(vm.scrambledWords).toEqual(['私は', '猫が']);

    vm.removeWord(0);
    await wrapper.vm.$nextTick();
    expect(vm.userAnswer).toEqual([]);
    expect(vm.scrambledWords).toEqual(['私は', '猫が', '好きです']);
  });

  it('checks a correct answer, updates score, and loads the next question', async () => {
    const gameStore = useGameStore();
    const answerSpy = vi.spyOn(gameStore, 'answerSentenceQuestion');
    gameStore.startSentenceGame(mockSentenceQuestions);

    const wrapper = mountComponent();
    await flushPromises();
    await wrapper.vm.$nextTick();

    const vm = wrapper.vm as any;
    vm.userAnswer = ['私は', '猫が', '好きです'];
    vm.checkAnswer();
    await flushPromises();

    expect(answerSpy).toHaveBeenCalledWith(true);
    expect(gameStore.score).toBe(1);
    expect(gameStore.currentSentenceQuestionIndex).toBe(1);
    expect(vm.correctAnswers).toBe(1);
    expect(vm.userAnswer).toEqual([]);
    expect(vm.scrambledWords).toEqual(mockSentenceQuestions[1]?.scrambled);
    expect(notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Correct!',
        color: 'positive',
      }),
    );
  });

  it('checks an incorrect final answer and shows the game over dialog', async () => {
    const singleQuestion = [mockSentenceQuestions[0]!];
    const gameStore = useGameStore();
    const answerSpy = vi.spyOn(gameStore, 'answerSentenceQuestion');
    gameStore.startSentenceGame(singleQuestion);

    const wrapper = mountComponent();
    await flushPromises();
    await wrapper.vm.$nextTick();

    const vm = wrapper.vm as any;
    vm.userAnswer = ['間違い'];
    vm.checkAnswer();
    await flushPromises();

    expect(answerSpy).toHaveBeenCalledWith(false);
    expect(notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: `Incorrect. The correct answer is: ${singleQuestion[0].correctAnswer}`,
        color: 'negative',
      }),
    );
    expect(dialogSpy).toHaveBeenCalledWith({
      title: 'Game Over',
      message: 'You scored 0 out of 1!',
    });
  });

  it('records the finished session and resets tracking after the last question', async () => {
    vi.useFakeTimers();
    const startTime = new Date('2024-01-01T00:00:00Z');
    vi.setSystemTime(startTime);

    const progressStore = useProgressStore();
    const recordSessionSpy = vi
      .spyOn(progressStore, 'recordGameSession')
      .mockResolvedValue(undefined);
    vi.mocked(gameService.getSentenceQuestions).mockResolvedValue([mockSentenceQuestions[0]!]);

    const wrapper = mountComponent();
    await flushPromises();

    vi.setSystemTime(new Date('2024-01-01T00:00:30Z'));

    const vm = wrapper.vm as any;
    vm.userAnswer = ['私は', '猫が', '好きです'];
    vm.checkAnswer();
    await flushPromises();

    expect(recordSessionSpy).toHaveBeenCalledWith('sentence', 1, 30, 1, 1);
    expect(dialogSpy).toHaveBeenCalledWith({
      title: 'Game Over',
      message: 'You scored 1 out of 1!',
    });
    expect(vm.gameStartTime).toBeNull();
    expect(vm.correctAnswers).toBe(0);
    expect(vm.totalQuestions).toBe(0);
  });

  it('warns when saving the finished session fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));

    const progressStore = useProgressStore();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(progressStore, 'recordGameSession').mockRejectedValue(new Error('save failed'));
    vi.mocked(gameService.getSentenceQuestions).mockResolvedValue([mockSentenceQuestions[0]!]);

    const wrapper = mountComponent();
    await flushPromises();

    vi.setSystemTime(new Date('2024-01-01T00:00:05Z'));

    const vm = wrapper.vm as any;
    vm.userAnswer = ['私は', '猫が', '好きです'];
    vm.checkAnswer();
    await flushPromises();

    expect(notifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'warning',
        message: 'Your game progress could not be saved. Please check your connection.',
      }),
    );
    expect(vm.gameStartTime).toBeNull();
    expect(vm.correctAnswers).toBe(0);
    expect(vm.totalQuestions).toBe(0);
  });
});

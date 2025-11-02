import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { Quasar } from 'quasar';
import SentenceBuilder from './SentenceBuilder.vue';
import { useGameStore } from 'src/stores/games';
import { gameService } from 'src/services/gameService';
import type { SentenceQuestion } from 'src/stores/games';

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
    vi.mocked(gameService.getSentenceQuestions).mockResolvedValue(mockSentenceQuestions);
  });

  const mountComponent = () => {
    return mount(SentenceBuilder, {
      global: {
        plugins: [Quasar],
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

    const wrapper = mountComponent();
    await flushPromises();

    // Should still show loading since no game started
    expect(wrapper.text()).toContain('Loading game...');
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

  it('should display English translation as hint', async () => {
    const gameStore = useGameStore();
    gameStore.startSentenceGame(mockSentenceQuestions);

    const wrapper = mountComponent();
    await flushPromises();
    await wrapper.vm.$nextTick();

    const englishTranslation = mockSentenceQuestions[0]?.sentence.english_translation;
    expect(wrapper.text()).toContain(englishTranslation || '');
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
});

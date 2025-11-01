import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { Quasar } from 'quasar';
import VocabularyCard from './VocabularyCard.vue';
import type { Question } from 'src/stores/games';

describe('VocabularyCard', () => {
  const mockQuestion: Question = {
    word: {
      id: 'vocab-1',
      japanese_word: '猫',
      romaji: 'neko',
      english_translation: 'cat',
      hiragana: 'ねこ',
      created_at: '2024-01-01T00:00:00Z',
    },
    options: ['cat', 'dog', 'bird', 'fish'],
    correctAnswer: 'cat',
  };

  const mountComponent = (question: Question = mockQuestion) => {
    return mount(VocabularyCard, {
      props: {
        question,
      },
      global: {
        plugins: [Quasar],
      },
    });
  };

  it('should render Japanese word', () => {
    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('猫');
  });

  it('should render romaji when available', () => {
    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('neko');
  });

  it('should not render romaji when not available', () => {
    const questionWithoutRomaji: Question = {
      word: {
        id: 'vocab-3',
        japanese_word: '魚',
        english_translation: 'fish',
        created_at: '2024-01-01T00:00:00Z',
      },
      options: ['fish', 'cat', 'dog', 'bird'],
      correctAnswer: 'fish',
    };

    const wrapper = mountComponent(questionWithoutRomaji);

    expect(wrapper.find('.text-subtitle1').exists()).toBe(false);
  });

  it('should render all answer options', () => {
    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('cat');
    expect(wrapper.text()).toContain('dog');
    expect(wrapper.text()).toContain('bird');
    expect(wrapper.text()).toContain('fish');
  });

  it('should render correct number of option buttons', () => {
    const wrapper = mountComponent();

    // Find all buttons with labels matching options
    const buttons = wrapper.findAllComponents({ name: 'QBtn' });
    // Filter out the pronounce button (which has icon, not label for options)
    const optionButtons = buttons.filter((btn) => {
      const label = btn.props('label');
      return label && mockQuestion.options.includes(label);
    });

    expect(optionButtons.length).toBe(4);
  });

  it('should emit answer event when option button is clicked', async () => {
    const wrapper = mountComponent();

    const buttons = wrapper.findAllComponents({ name: 'QBtn' });
    const catButton = buttons.find((btn) => btn.props('label') === 'cat');

    await catButton?.trigger('click');

    expect(wrapper.emitted('answer')).toBeTruthy();
    expect(wrapper.emitted('answer')?.[0]).toEqual(['cat']);
  });

  it('should emit pronounce event when pronounce button is clicked', async () => {
    const wrapper = mountComponent();

    const pronounceButton = wrapper.find('[data-testid="btn-pronounce"]');
    await pronounceButton.trigger('click');

    expect(wrapper.emitted('pronounce')).toBeTruthy();
    expect(wrapper.emitted('pronounce')?.[0]).toEqual([mockQuestion.word]);
  });

  it('should display Japanese word in large text', () => {
    const wrapper = mountComponent();

    const japaneseWord = wrapper.find('.text-h2');
    expect(japaneseWord.exists()).toBe(true);
    expect(japaneseWord.text()).toBe('猫');
  });

  it('should have pronounce button with volume icon', () => {
    const wrapper = mountComponent();

    const pronounceButton = wrapper.findComponent({ name: 'QBtn' });
    expect(pronounceButton.exists()).toBe(true);
    // Check the component props
    expect(pronounceButton.props('icon')).toBe('volume_up');
  });

  it('should render card with proper structure', () => {
    const wrapper = mountComponent();

    expect(wrapper.find('.my-card').exists()).toBe(true);
    expect(wrapper.findComponent({ name: 'QCardSection' }).exists()).toBe(true);
    expect(wrapper.findComponent({ name: 'QCardActions' }).exists()).toBe(true);
  });

  it('should emit correct answer when correct option is clicked', async () => {
    const wrapper = mountComponent();

    const buttons = wrapper.findAllComponents({ name: 'QBtn' });
    const correctButton = buttons.find(
      (btn) => btn.props('label') === mockQuestion.word.english_translation,
    );

    await correctButton?.trigger('click');

    expect(wrapper.emitted('answer')?.[0]).toEqual(['cat']);
  });

  it('should emit wrong answer when incorrect option is clicked', async () => {
    const wrapper = mountComponent();

    const buttons = wrapper.findAllComponents({ name: 'QBtn' });
    const wrongButton = buttons.find((btn) => btn.props('label') === 'dog');

    await wrongButton?.trigger('click');

    expect(wrapper.emitted('answer')?.[0]).toEqual(['dog']);
  });

  it('should handle multiple clicks on different options', async () => {
    const wrapper = mountComponent();

    const buttons = wrapper.findAllComponents({ name: 'QBtn' });
    const optionButtons = buttons.filter((btn) => {
      const label = btn.props('label');
      return label && mockQuestion.options.includes(label);
    });

    for (const btn of optionButtons) {
      await btn.trigger('click');
    }

    expect(wrapper.emitted('answer')?.length).toBe(4);
    expect(wrapper.emitted('answer')?.[0]).toEqual(['cat']);
    expect(wrapper.emitted('answer')?.[1]).toEqual(['dog']);
    expect(wrapper.emitted('answer')?.[2]).toEqual(['bird']);
    expect(wrapper.emitted('answer')?.[3]).toEqual(['fish']);
  });

  it('should display romaji in grey color', () => {
    const wrapper = mountComponent();

    const romajiElement = wrapper.find('.text-grey');
    expect(romajiElement.exists()).toBe(true);
    expect(romajiElement.text()).toBe('neko');
  });

  it('should center Japanese word display', () => {
    const wrapper = mountComponent();

    const japaneseWord = wrapper.find('.text-h2');
    expect(japaneseWord.classes()).toContain('text-center');
  });

  it('should render with different vocabulary', () => {
    const customQuestion: Question = {
      word: {
        id: 'vocab-2',
        japanese_word: '犬',
        romaji: 'inu',
        english_translation: 'dog',
        created_at: '2024-01-01T00:00:00Z',
      },
      options: ['dog', 'cat', 'bird', 'fish'],
      correctAnswer: 'dog',
    };

    const wrapper = mountComponent(customQuestion);

    expect(wrapper.text()).toContain('犬');
    expect(wrapper.text()).toContain('inu');
    expect(wrapper.text()).toContain('dog');
  });

  it('should have tooltip on pronounce button', () => {
    const wrapper = mountComponent();

    const tooltip = wrapper.findComponent({ name: 'QTooltip' });
    expect(tooltip.exists()).toBe(true);
    // Tooltip content might not render in test environment, just verify it exists
  });

  it('should have flat style option buttons', () => {
    const wrapper = mountComponent();

    const buttons = wrapper.findAllComponents({ name: 'QBtn' }).filter((btn) => {
      const label = btn.props('label');
      return label && mockQuestion.options.includes(label);
    });

    buttons.forEach((button) => {
      expect(button.props('flat')).toBe(true);
    });
  });

  it('should arrange options vertically', () => {
    const wrapper = mountComponent();

    const cardActions = wrapper.findComponent({ name: 'QCardActions' });
    expect(cardActions.exists()).toBe(true);
    expect(cardActions.props('vertical')).toBe(true);
  });

  it('should handle vocabulary without hiragana field', () => {
    const questionWithoutHiragana: Question = {
      word: {
        id: 'vocab-4',
        japanese_word: '猫',
        romaji: 'neko',
        english_translation: 'cat',
        created_at: '2024-01-01T00:00:00Z',
      },
      options: ['cat', 'dog', 'bird', 'fish'],
      correctAnswer: 'cat',
    };

    const wrapper = mountComponent(questionWithoutHiragana);

    expect(wrapper.text()).toContain('猫');
    expect(wrapper.text()).toContain('neko');
  });
});

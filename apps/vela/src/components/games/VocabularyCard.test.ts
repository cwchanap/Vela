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
    options: [
      { text: '猫', reading: 'ねこ' },
      { text: '犬', reading: 'いぬ' },
      { text: '鳥', reading: 'とり' },
      { text: '魚', reading: 'さかな' },
    ],
    correctAnswer: '猫',
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

  it('should render English word as the question prompt', () => {
    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('cat');
  });

  it('should render Japanese options', () => {
    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('猫');
    expect(wrapper.text()).toContain('犬');
    expect(wrapper.text()).toContain('鳥');
    expect(wrapper.text()).toContain('魚');
  });

  it('should render correct number of option buttons', () => {
    const wrapper = mountComponent();

    const buttons = wrapper.findAllComponents({ name: 'QBtn' });
    // 4 option buttons + 1 pronounce button
    const optionButtons = buttons.filter((btn) => !btn.props('icon'));
    expect(optionButtons.length).toBe(4);
  });

  it('should emit answer event with japanese_word when option button is clicked', async () => {
    const wrapper = mountComponent();

    const buttons = wrapper.findAllComponents({ name: 'QBtn' });
    const optionButtons = buttons.filter((btn) => !btn.props('icon'));
    await optionButtons[0]?.trigger('click');

    expect(wrapper.emitted('answer')).toBeTruthy();
    expect(wrapper.emitted('answer')?.[0]).toEqual([mockQuestion.options[0]?.text]);
  });

  it('should emit pronounce event when pronounce button is clicked', async () => {
    const wrapper = mountComponent();

    const pronounceButton = wrapper.find('[data-testid="btn-pronounce"]');
    await pronounceButton.trigger('click');

    expect(wrapper.emitted('pronounce')).toBeTruthy();
    expect(wrapper.emitted('pronounce')?.[0]).toEqual([mockQuestion.word]);
  });

  it('should display English word in large text', () => {
    const wrapper = mountComponent();

    const heading = wrapper.find('.text-h4');
    expect(heading.exists()).toBe(true);
    expect(heading.text()).toBe('cat');
  });

  it('should have pronounce button with volume icon', () => {
    const wrapper = mountComponent();

    const pronounceButton = wrapper
      .find('[data-testid="btn-pronounce"]')
      .findComponent({ name: 'QBtn' });
    expect(pronounceButton.exists()).toBe(true);
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
    const optionButtons = buttons.filter((btn) => !btn.props('icon'));
    // First option is 猫 which is the correct answer
    await optionButtons[0]?.trigger('click');

    expect(wrapper.emitted('answer')?.[0]).toEqual(['猫']);
  });

  it('should emit wrong answer when incorrect option is clicked', async () => {
    const wrapper = mountComponent();

    const buttons = wrapper.findAllComponents({ name: 'QBtn' });
    const optionButtons = buttons.filter((btn) => !btn.props('icon'));
    // Second option is 犬 which is wrong
    await optionButtons[1]?.trigger('click');

    expect(wrapper.emitted('answer')?.[0]).toEqual(['犬']);
  });

  it('should handle multiple clicks on different options', async () => {
    const wrapper = mountComponent();

    const buttons = wrapper.findAllComponents({ name: 'QBtn' });
    const optionButtons = buttons.filter((btn) => !btn.props('icon'));

    for (const btn of optionButtons) {
      await btn.trigger('click');
    }

    expect(wrapper.emitted('answer')?.length).toBe(4);
  });

  it('should have tooltip on pronounce button', () => {
    const wrapper = mountComponent();

    const tooltip = wrapper.findComponent({ name: 'QTooltip' });
    expect(tooltip.exists()).toBe(true);
  });

  it('should have flat style option buttons', () => {
    const wrapper = mountComponent();

    const buttons = wrapper.findAllComponents({ name: 'QBtn' }).filter((btn) => !btn.props('icon'));

    buttons.forEach((button) => {
      expect(button.props('flat')).toBe(true);
    });
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
      options: [
        { text: '犬', reading: 'いぬ' },
        { text: '猫', reading: 'ねこ' },
        { text: '鳥', reading: 'とり' },
        { text: '魚', reading: 'さかな' },
      ],
      correctAnswer: '犬',
    };

    const wrapper = mountComponent(customQuestion);

    expect(wrapper.text()).toContain('dog');
    expect(wrapper.text()).toContain('犬');
  });

  it('should render a FuriKana component for each option', () => {
    const wrapper = mountComponent();

    const furiKanaComponents = wrapper.findAllComponents({ name: 'FuriKana' });
    expect(furiKanaComponents).toHaveLength(4);
  });

  it('should pass option text to each FuriKana component', () => {
    const wrapper = mountComponent();

    const furiKanaComponents = wrapper.findAllComponents({ name: 'FuriKana' });
    const optionTexts = furiKanaComponents.map((c) => c.props('text'));
    expect(optionTexts).toContain('猫');
    expect(optionTexts).toContain('犬');
    expect(optionTexts).toContain('鳥');
    expect(optionTexts).toContain('魚');
  });

  it('should pass hiragana reading to each FuriKana component', () => {
    const wrapper = mountComponent();

    const furiKanaComponents = wrapper.findAllComponents({ name: 'FuriKana' });
    const readings = furiKanaComponents.map((c) => c.props('reading'));
    expect(readings).toContain('ねこ');
    expect(readings).toContain('いぬ');
    expect(readings).toContain('とり');
    expect(readings).toContain('さかな');
  });

  it('should render ruby elements for kanji options with readings', () => {
    const wrapper = mountComponent();

    // All 4 options have kanji and readings, so all should render ruby
    const rubyElements = wrapper.findAll('ruby');
    expect(rubyElements.length).toBe(4);
  });

  it('should render span elements for kana options without kanji', () => {
    const kanaQuestion: Question = {
      word: {
        id: 'vocab-5',
        japanese_word: 'ねこ',
        english_translation: 'cat',
        created_at: '2024-01-01T00:00:00Z',
      },
      options: [
        { text: 'ねこ', reading: 'ねこ' },
        { text: 'いぬ', reading: 'いぬ' },
        { text: 'とり', reading: 'とり' },
        { text: 'さかな', reading: 'さかな' },
      ],
      correctAnswer: 'ねこ',
    };

    const wrapper = mountComponent(kanaQuestion);

    // Pure kana options should not render ruby (no kanji to annotate)
    expect(wrapper.findAll('ruby').length).toBe(0);

    // Each FuriKana should render a span instead of ruby
    const furiKanaComponents = wrapper.findAllComponents({ name: 'FuriKana' });
    expect(furiKanaComponents.every((c) => c.find('span').exists())).toBe(true);
    expect(furiKanaComponents.every((c) => !c.find('ruby').exists())).toBe(true);
  });

  it('should handle options without hiragana reading', () => {
    const questionWithoutReadings: Question = {
      word: {
        id: 'vocab-4',
        japanese_word: '猫',
        romaji: 'neko',
        english_translation: 'cat',
        created_at: '2024-01-01T00:00:00Z',
      },
      options: [{ text: '猫' }, { text: '犬' }, { text: '鳥' }, { text: '魚' }],
      correctAnswer: '猫',
    };

    const wrapper = mountComponent(questionWithoutReadings);

    expect(wrapper.text()).toContain('cat');
    expect(wrapper.text()).toContain('猫');
  });
});

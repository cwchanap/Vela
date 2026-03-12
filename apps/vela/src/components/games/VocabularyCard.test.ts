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
      { id: 'vocab-1', text: '猫', reading: 'ねこ' },
      { id: 'vocab-2', text: '犬', reading: 'いぬ' },
      { id: 'vocab-3', text: '鳥', reading: 'とり' },
      { id: 'vocab-4', text: '魚', reading: 'さかな' },
    ],
    correctAnswer: 'vocab-1',
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

  const findAnswerButtons = (wrapper: ReturnType<typeof mountComponent>) =>
    wrapper.findAll('[data-testid="answer-button"]');

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

    const optionButtons = findAnswerButtons(wrapper);
    expect(optionButtons.length).toBe(4);
  });

  it('should emit answer event with vocabulary id when option button is clicked', async () => {
    const wrapper = mountComponent();

    const optionButtons = findAnswerButtons(wrapper);
    await optionButtons[0]?.trigger('click');

    expect(wrapper.emitted('answer')).toBeTruthy();
    expect(wrapper.emitted('answer')?.[0]).toEqual([mockQuestion.options[0]?.id]);
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

  it('should have aria-label on pronounce button', () => {
    const wrapper = mountComponent();

    const pronounceButton = wrapper.find('[data-testid="btn-pronounce"]');
    expect(pronounceButton.attributes('aria-label')).toBe('Play pronunciation for 猫');
  });

  it('should have dynamic aria-label with Japanese word', () => {
    const customQuestion: Question = {
      word: {
        id: 'vocab-2',
        japanese_word: '犬',
        romaji: 'inu',
        english_translation: 'dog',
        created_at: '2024-01-01T00:00:00Z',
      },
      options: [
        { id: 'vocab-2', text: '犬', reading: 'いぬ' },
        { id: 'vocab-1', text: '猫', reading: 'ねこ' },
        { id: 'vocab-3', text: '鳥', reading: 'とり' },
        { id: 'vocab-4', text: '魚', reading: 'さかな' },
      ],
      correctAnswer: 'vocab-2',
    };

    const wrapper = mountComponent(customQuestion);

    const pronounceButton = wrapper.find('[data-testid="btn-pronounce"]');
    expect(pronounceButton.attributes('aria-label')).toBe('Play pronunciation for 犬');
  });

  it('should render card with proper structure', () => {
    const wrapper = mountComponent();

    expect(wrapper.find('.my-card').exists()).toBe(true);
    expect(wrapper.findComponent({ name: 'QCardSection' }).exists()).toBe(true);
    expect(wrapper.findComponent({ name: 'QCardActions' }).exists()).toBe(true);
  });

  it('should emit correct answer when correct option is clicked', async () => {
    const wrapper = mountComponent();

    const optionButtons = findAnswerButtons(wrapper);
    // First option is 猫 which is the correct answer
    await optionButtons[0]?.trigger('click');

    expect(wrapper.emitted('answer')?.[0]).toEqual(['vocab-1']);
  });

  it('should emit wrong answer when incorrect option is clicked', async () => {
    const wrapper = mountComponent();

    const optionButtons = findAnswerButtons(wrapper);
    // Second option is 犬 which is wrong
    await optionButtons[1]?.trigger('click');

    expect(wrapper.emitted('answer')?.[0]).toEqual(['vocab-2']);
  });

  it('should handle multiple clicks on different options', async () => {
    const wrapper = mountComponent();

    const optionButtons = findAnswerButtons(wrapper);

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

    const optionButtons = findAnswerButtons(wrapper);

    optionButtons.forEach((button) => {
      expect(button.classes()).toContain('q-btn--flat');
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
        { id: 'vocab-2', text: '犬', reading: 'いぬ' },
        { id: 'vocab-1', text: '猫', reading: 'ねこ' },
        { id: 'vocab-3', text: '鳥', reading: 'とり' },
        { id: 'vocab-4', text: '魚', reading: 'さかな' },
      ],
      correctAnswer: 'vocab-2',
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
        { id: 'vocab-5', text: 'ねこ', reading: 'ねこ' },
        { id: 'vocab-6', text: 'いぬ', reading: 'いぬ' },
        { id: 'vocab-7', text: 'とり', reading: 'とり' },
        { id: 'vocab-8', text: 'さかな', reading: 'さかな' },
      ],
      correctAnswer: 'vocab-5',
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
      options: [
        { id: 'vocab-1', text: '猫' },
        { id: 'vocab-2', text: '犬' },
        { id: 'vocab-3', text: '鳥' },
        { id: 'vocab-4', text: '魚' },
      ],
      correctAnswer: 'vocab-1',
    };

    const wrapper = mountComponent(questionWithoutReadings);

    expect(wrapper.text()).toContain('cat');
    expect(wrapper.text()).toContain('猫');
  });
});

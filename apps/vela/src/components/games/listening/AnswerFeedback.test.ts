import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import AnswerFeedback from './AnswerFeedback.vue';

const defaultProps = {
  isCorrect: false,
  japaneseText: '猫',
  reading: 'ねこ',
  englishTranslation: 'cat',
  audioUrl: 'https://example.com/cat.mp3',
  userInput: 'dog',
  showUserInput: true,
  isLast: false,
};

const mountComponent = (props = {}) =>
  mount(AnswerFeedback, {
    props: {
      ...defaultProps,
      ...props,
    },
    global: {
      stubs: {
        AudioPlayer: {
          template: '<div class="audio-player-stub" />',
        },
        QCard: {
          template: '<div class="q-card-stub"><slot /></div>',
        },
        QCardSection: {
          template: '<div class="q-card-section-stub"><slot /></div>',
        },
        QCardActions: {
          template: '<div class="q-card-actions-stub"><slot /></div>',
        },
        QBtn: {
          props: {
            label: {
              type: String,
              default: '',
            },
          },
          emits: ['click'],
          template: '<button @click="$emit(\'click\')">{{ label }}</button>',
        },
      },
    },
  });

describe('AnswerFeedback', () => {
  it('shows the typed input message for incorrect dictation answers', () => {
    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('You typed: "dog"');
  });

  it('does not show the typed input message for multiple-choice selections', () => {
    const wrapper = mountComponent({ showUserInput: false });

    expect(wrapper.text()).not.toContain('You typed:');
    expect(wrapper.text()).toContain('Incorrect');
  });

  describe('correct vs incorrect state', () => {
    it('shows ✓ icon for a correct answer', () => {
      const wrapper = mountComponent({ isCorrect: true });
      expect(wrapper.text()).toContain('✓');
    });

    it('shows ✗ icon for an incorrect answer', () => {
      const wrapper = mountComponent({ isCorrect: false });
      expect(wrapper.text()).toContain('✗');
    });

    it('shows "Correct!" text for a correct answer', () => {
      const wrapper = mountComponent({ isCorrect: true });
      expect(wrapper.text()).toContain('Correct!');
    });

    it('shows "Incorrect" text for an incorrect answer', () => {
      const wrapper = mountComponent({ isCorrect: false });
      expect(wrapper.text()).toContain('Incorrect');
    });
  });

  describe('reading field', () => {
    it('shows reading when provided', () => {
      const wrapper = mountComponent({ reading: 'いぬ' });
      expect(wrapper.text()).toContain('いぬ');
    });

    it('hides reading when not provided', () => {
      const wrapper = mountComponent({ reading: undefined });
      expect(wrapper.text()).not.toContain('いぬ');
    });
  });

  describe('user input display', () => {
    it('hides the typed input message when userInput is empty', () => {
      const wrapper = mountComponent({ showUserInput: true, userInput: '' });
      expect(wrapper.text()).not.toContain('You typed:');
    });

    it('hides the typed input message when the answer is correct', () => {
      const wrapper = mountComponent({
        showUserInput: true,
        userInput: 'cat',
        isCorrect: true,
      });
      expect(wrapper.text()).not.toContain('You typed:');
    });
  });

  describe('button label', () => {
    it('shows "Finish" when isLast is true', () => {
      const wrapper = mountComponent({ isLast: true });
      expect(wrapper.text()).toContain('Finish');
    });

    it('shows "Next Question" when isLast is false', () => {
      const wrapper = mountComponent({ isLast: false });
      expect(wrapper.text()).toContain('Next Question');
    });
  });

  describe('next event', () => {
    it('emits next when the action button is clicked', async () => {
      const wrapper = mountComponent();
      await wrapper.find('button').trigger('click');
      expect(wrapper.emitted('next')).toHaveLength(1);
    });
  });

  describe('japanese text and translation', () => {
    it('renders the Japanese text', () => {
      const wrapper = mountComponent({ japaneseText: '犬' });
      expect(wrapper.text()).toContain('犬');
    });

    it('renders the English translation', () => {
      const wrapper = mountComponent({ englishTranslation: 'dog' });
      expect(wrapper.text()).toContain('dog');
    });
  });
});

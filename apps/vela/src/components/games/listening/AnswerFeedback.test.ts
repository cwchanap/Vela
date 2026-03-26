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
});

import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { Quasar } from 'quasar';
import MultipleChoiceQuestion from './MultipleChoiceQuestion.vue';

const defaultProps = {
  correctAnswer: 'cat',
  distractors: ['dog', 'bird', 'fish'],
};

const mountComponent = (props = defaultProps) =>
  mount(MultipleChoiceQuestion, {
    props,
    global: { plugins: [Quasar] },
  });

describe('MultipleChoiceQuestion', () => {
  it('renders 4 answer options', () => {
    const wrapper = mountComponent();
    const buttons = wrapper.findAll('button');
    expect(buttons).toHaveLength(4);
  });

  it('includes the correct answer among the options', () => {
    const wrapper = mountComponent();
    expect(wrapper.text()).toContain('cat');
  });

  it('includes all distractors among the options', () => {
    const wrapper = mountComponent();
    expect(wrapper.text()).toContain('dog');
    expect(wrapper.text()).toContain('bird');
    expect(wrapper.text()).toContain('fish');
  });

  it('emits answer event with selected option on click', async () => {
    const wrapper = mountComponent();
    const buttons = wrapper.findAll('button');
    await buttons[0]!.trigger('click');

    expect(wrapper.emitted('answer')).toHaveLength(1);
    expect(typeof wrapper.emitted('answer')![0]![0]).toBe('string');
  });

  it('emits the correct answer text when correct button clicked', async () => {
    const wrapper = mountComponent();
    // Find the button containing 'cat'
    const buttons = wrapper.findAll('button');
    const catButton = buttons.find((b) => b.text().trim() === 'cat');
    expect(catButton).toBeDefined();

    await catButton!.trigger('click');
    expect(wrapper.emitted('answer')![0]![0]).toBe('cat');
  });

  it('disables all buttons after a selection', async () => {
    const wrapper = mountComponent();
    const buttons = wrapper.findAll('button');
    await buttons[0]!.trigger('click');

    // All buttons should now be disabled
    const disabledButtons = wrapper.findAll('button[disabled]');
    expect(disabledButtons).toHaveLength(4);
  });

  it('does not emit a second answer if clicked again', async () => {
    const wrapper = mountComponent();
    const buttons = wrapper.findAll('button');
    await buttons[0]!.trigger('click');
    await buttons[1]!.trigger('click');

    expect(wrapper.emitted('answer')).toHaveLength(1);
  });

  it('uses only up to 3 distractors even if more provided', () => {
    const wrapper = mount(MultipleChoiceQuestion, {
      props: { correctAnswer: 'cat', distractors: ['dog', 'bird', 'fish', 'horse', 'cow'] },
      global: { plugins: [Quasar] },
    });
    // 1 correct + 3 distractors max = 4 buttons
    expect(wrapper.findAll('button')).toHaveLength(4);
  });

  it('shows prompt text', () => {
    const wrapper = mountComponent();
    expect(wrapper.text()).toContain('Select the meaning');
  });

  it('shuffles options (options array contains correct answer)', () => {
    const renderedSequences = new Set<string>();

    for (let i = 0; i < 12; i++) {
      const wrapper = mountComponent();
      renderedSequences.add(
        wrapper
          .findAll('button')
          .map((button) => button.text().trim())
          .join('|'),
      );
      expect(wrapper.text()).toContain('cat');
    }

    expect(renderedSequences.size).toBeGreaterThan(1);
  });

  describe('with fewer than 3 distractors', () => {
    it('renders correct answer + available distractors only', () => {
      const wrapper = mount(MultipleChoiceQuestion, {
        props: { correctAnswer: 'cat', distractors: ['dog'] },
        global: { plugins: [Quasar] },
      });
      expect(wrapper.findAll('button')).toHaveLength(2);
    });
  });
});

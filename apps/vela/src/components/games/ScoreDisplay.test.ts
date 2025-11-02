import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ScoreDisplay from './ScoreDisplay.vue';

describe('ScoreDisplay', () => {
  it.each([
    [5, 'positive score'],
    [0, 'zero score'],
    [99, 'large score'],
    [-5, 'negative score'],
    [7.5, 'decimal score'],
  ])('should render %s (%s)', (score, _description) => {
    const wrapper = mount(ScoreDisplay, {
      props: {
        score,
      },
    });

    expect(wrapper.text()).toContain(`Score: ${score}`);
  });

  it('should have correct CSS classes', () => {
    const wrapper = mount(ScoreDisplay, {
      props: {
        score: 10,
      },
    });

    const scoreDisplay = wrapper.find('div');
    expect(scoreDisplay.classes()).toContain('text-h6');
    expect(scoreDisplay.classes()).toContain('q-mt-md');
  });

  it('should render as a single div element', () => {
    const wrapper = mount(ScoreDisplay, {
      props: {
        score: 5,
      },
    });

    expect(wrapper.element.tagName).toBe('DIV');
  });

  it('should update score immediately when prop changes', async () => {
    const wrapper = mount(ScoreDisplay, {
      props: {
        score: 0,
      },
    });

    expect(wrapper.text()).toContain('Score: 0');

    for (let i = 1; i <= 5; i++) {
      await wrapper.setProps({ score: i });
      expect(wrapper.text()).toContain(`Score: ${i}`);
    }
  });
});

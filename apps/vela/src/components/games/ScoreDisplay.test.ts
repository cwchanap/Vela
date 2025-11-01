import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ScoreDisplay from './ScoreDisplay.vue';

describe('ScoreDisplay', () => {
  it('should render score prop', () => {
    const wrapper = mount(ScoreDisplay, {
      props: {
        score: 5,
      },
    });

    expect(wrapper.text()).toContain('Score: 5');
  });

  it('should render zero score', () => {
    const wrapper = mount(ScoreDisplay, {
      props: {
        score: 0,
      },
    });

    expect(wrapper.text()).toContain('Score: 0');
  });

  it('should update when score prop changes', async () => {
    const wrapper = mount(ScoreDisplay, {
      props: {
        score: 3,
      },
    });

    expect(wrapper.text()).toContain('Score: 3');

    await wrapper.setProps({ score: 8 });

    expect(wrapper.text()).toContain('Score: 8');
  });

  it('should display large scores correctly', () => {
    const wrapper = mount(ScoreDisplay, {
      props: {
        score: 99,
      },
    });

    expect(wrapper.text()).toContain('Score: 99');
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

  it('should handle negative scores', () => {
    const wrapper = mount(ScoreDisplay, {
      props: {
        score: -5,
      },
    });

    expect(wrapper.text()).toContain('Score: -5');
  });

  it('should handle decimal scores', () => {
    const wrapper = mount(ScoreDisplay, {
      props: {
        score: 7.5,
      },
    });

    expect(wrapper.text()).toContain('Score: 7.5');
  });

  it('should display score label', () => {
    const wrapper = mount(ScoreDisplay, {
      props: {
        score: 10,
      },
    });

    expect(wrapper.text()).toMatch(/Score:/);
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

import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { Quasar } from 'quasar';
import FlashcardRating from './FlashcardRating.vue';
import { QUALITY_RATINGS } from 'src/stores/flashcards';

describe('FlashcardRating', () => {
  const mountComponent = () => {
    return mount(FlashcardRating, {
      global: {
        plugins: [Quasar],
      },
    });
  };

  it('should render all four rating buttons', () => {
    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('Again');
    expect(wrapper.text()).toContain('Hard');
    expect(wrapper.text()).toContain('Good');
    expect(wrapper.text()).toContain('Easy');
  });

  it('should render instruction label', () => {
    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('How well did you know this?');
  });

  it('should emit rate event with AGAIN value when Again clicked', async () => {
    const wrapper = mountComponent();

    const againButton = wrapper.find('[data-testid="btn-again"]');
    await againButton.trigger('click');

    expect(wrapper.emitted('rate')).toBeTruthy();
    expect(wrapper.emitted('rate')?.[0]).toEqual([QUALITY_RATINGS.AGAIN]);
  });

  it('should emit rate event with HARD value when Hard clicked', async () => {
    const wrapper = mountComponent();

    const hardButton = wrapper.find('[data-testid="btn-hard"]');
    await hardButton.trigger('click');

    expect(wrapper.emitted('rate')?.[0]).toEqual([QUALITY_RATINGS.HARD]);
  });

  it('should emit rate event with GOOD value when Good clicked', async () => {
    const wrapper = mountComponent();

    const goodButton = wrapper.find('[data-testid="btn-good"]');
    await goodButton.trigger('click');

    expect(wrapper.emitted('rate')?.[0]).toEqual([QUALITY_RATINGS.GOOD]);
  });

  it('should emit rate event with EASY value when Easy clicked', async () => {
    const wrapper = mountComponent();

    const easyButton = wrapper.find('[data-testid="btn-easy"]');
    await easyButton.trigger('click');

    expect(wrapper.emitted('rate')?.[0]).toEqual([QUALITY_RATINGS.EASY]);
  });

  it('should render buttons with correct colors', () => {
    const wrapper = mountComponent();

    const buttons = wrapper.findAllComponents({ name: 'QBtn' });

    // Find buttons by their label and check color
    const againBtn = buttons.find((b) => b.props('label') === 'Again');
    const hardBtn = buttons.find((b) => b.props('label') === 'Hard');
    const goodBtn = buttons.find((b) => b.props('label') === 'Good');
    const easyBtn = buttons.find((b) => b.props('label') === 'Easy');

    expect(againBtn?.props('color')).toBe('negative');
    expect(hardBtn?.props('color')).toBe('warning');
    expect(goodBtn?.props('color')).toBe('primary');
    expect(easyBtn?.props('color')).toBe('positive');
  });

  it('should render outline style buttons', () => {
    const wrapper = mountComponent();

    const buttons = wrapper.findAllComponents({ name: 'QBtn' });

    buttons.forEach((button) => {
      expect(button.props('outline')).toBe(true);
    });
  });

  it('should have tooltips on buttons', () => {
    const wrapper = mountComponent();

    const tooltips = wrapper.findAllComponents({ name: 'QTooltip' });
    expect(tooltips.length).toBe(4);
  });
});

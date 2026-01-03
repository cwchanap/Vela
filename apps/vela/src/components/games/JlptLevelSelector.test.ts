import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { Quasar } from 'quasar';
import JlptLevelSelector from './JlptLevelSelector.vue';

describe('JlptLevelSelector', () => {
  const mountComponent = (modelValue: number[] = []) => {
    return mount(JlptLevelSelector, {
      props: {
        modelValue,
      },
      global: {
        plugins: [Quasar],
      },
    });
  };

  beforeEach(() => {
    // Reset before each test
  });

  it('renders all JLPT level options', () => {
    const wrapper = mountComponent();

    const buttons = wrapper.findAll('[data-testid^="jlpt-level-"]');
    // 5 levels + "all" button = 6 buttons
    expect(buttons.length).toBe(6);
  });

  it('displays "All Levels" option', () => {
    const wrapper = mountComponent();

    const allButton = wrapper.find('[data-testid="jlpt-level-all"]');
    expect(allButton.exists()).toBe(true);
    expect(allButton.text()).toContain('All');
  });

  it('shows N5-N1 level buttons', () => {
    const wrapper = mountComponent();

    expect(wrapper.find('[data-testid="jlpt-level-5"]').text()).toContain('N5');
    expect(wrapper.find('[data-testid="jlpt-level-4"]').text()).toContain('N4');
    expect(wrapper.find('[data-testid="jlpt-level-3"]').text()).toContain('N3');
    expect(wrapper.find('[data-testid="jlpt-level-2"]').text()).toContain('N2');
    expect(wrapper.find('[data-testid="jlpt-level-1"]').text()).toContain('N1');
  });

  it('emits update:modelValue when a level is selected', async () => {
    const wrapper = mountComponent([]);

    await wrapper.find('[data-testid="jlpt-level-5"]').trigger('click');

    expect(wrapper.emitted('update:modelValue')).toBeTruthy();
    expect(wrapper.emitted('update:modelValue')![0]).toEqual([[5]]);
  });

  it('emits update:modelValue with empty array when All is selected', async () => {
    const wrapper = mountComponent([5]);

    await wrapper.find('[data-testid="jlpt-level-all"]').trigger('click');

    expect(wrapper.emitted('update:modelValue')).toBeTruthy();
    expect(wrapper.emitted('update:modelValue')![0]).toEqual([[]]);
  });

  it('highlights selected levels', () => {
    const wrapper = mountComponent([5, 4]);

    const n5Button = wrapper.find('[data-testid="jlpt-level-5"]');
    const n4Button = wrapper.find('[data-testid="jlpt-level-4"]');
    const n3Button = wrapper.find('[data-testid="jlpt-level-3"]');

    expect(n5Button.classes()).toContain('bg-primary');
    expect(n4Button.classes()).toContain('bg-primary');
    expect(n3Button.classes()).not.toContain('bg-primary');
  });

  it('highlights All button when no levels selected', () => {
    const wrapper = mountComponent([]);

    const allButton = wrapper.find('[data-testid="jlpt-level-all"]');
    expect(allButton.classes()).toContain('bg-primary');
  });

  it('allows multiple level selection', async () => {
    const wrapper = mountComponent([5]);

    await wrapper.find('[data-testid="jlpt-level-4"]').trigger('click');

    expect(wrapper.emitted('update:modelValue')).toBeTruthy();
    expect(wrapper.emitted('update:modelValue')![0]).toEqual([[5, 4]]);
  });

  it('deselects level when clicking already selected level', async () => {
    const wrapper = mountComponent([5, 4]);

    await wrapper.find('[data-testid="jlpt-level-5"]').trigger('click');

    expect(wrapper.emitted('update:modelValue')).toBeTruthy();
    expect(wrapper.emitted('update:modelValue')![0]).toEqual([[4]]);
  });

  it('shows difficulty indicators for each level', () => {
    const wrapper = mountComponent([]);

    // Check for difficulty labels or hints
    expect(wrapper.text()).toContain('N5');
    expect(wrapper.text()).toContain('N1');
  });
});

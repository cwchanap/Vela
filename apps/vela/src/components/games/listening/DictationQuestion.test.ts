import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { Quasar } from 'quasar';
import DictationQuestion from './DictationQuestion.vue';

const mountComponent = () =>
  mount(DictationQuestion, {
    global: { plugins: [Quasar] },
  });

describe('DictationQuestion', () => {
  it('renders the prompt text', () => {
    const wrapper = mountComponent();
    expect(wrapper.text()).toContain('Type what you heard');
  });

  it('renders a submit button', () => {
    const wrapper = mountComponent();
    expect(wrapper.find('button').exists()).toBe(true);
    expect(wrapper.text()).toContain('Submit');
  });

  it('submit button is disabled when input is empty', () => {
    const wrapper = mountComponent();
    const submitBtn = wrapper.find('button');
    expect(submitBtn.attributes('disabled')).toBeDefined();
  });

  it('emits answer event when submit button clicked with input', async () => {
    const wrapper = mountComponent();
    const input = wrapper.find('input');
    await input.setValue('ねこ');
    await wrapper.find('button').trigger('click');

    expect(wrapper.emitted('answer')).toHaveLength(1);
    expect(wrapper.emitted('answer')![0]![0]).toBe('ねこ');
  });

  it('emits answer event when Enter key pressed', async () => {
    const wrapper = mountComponent();
    const input = wrapper.find('input');
    await input.setValue('猫');
    await input.trigger('keyup', { key: 'Enter', isComposing: false });

    expect(wrapper.emitted('answer')).toHaveLength(1);
    expect(wrapper.emitted('answer')![0]![0]).toBe('猫');
  });

  it('does not emit answer when Enter pressed during IME composition', async () => {
    const wrapper = mountComponent();
    const input = wrapper.find('input');
    await input.setValue('neko');
    await input.trigger('keyup', { key: 'Enter', isComposing: true });

    expect(wrapper.emitted('answer')).toBeUndefined();
  });

  it('does not emit answer for empty input on Enter', async () => {
    const wrapper = mountComponent();
    const input = wrapper.find('input');
    await input.trigger('keyup', { key: 'Enter', isComposing: false });

    expect(wrapper.emitted('answer')).toBeUndefined();
  });

  it('does not emit answer for whitespace-only input', async () => {
    const wrapper = mountComponent();
    const input = wrapper.find('input');
    await input.setValue('   ');
    await wrapper.find('button').trigger('click');

    expect(wrapper.emitted('answer')).toBeUndefined();
  });

  it('does not emit a second answer after submit (prevents double-submit)', async () => {
    const wrapper = mountComponent();
    const input = wrapper.find('input');
    await input.setValue('ねこ');
    await wrapper.find('button').trigger('click');
    await wrapper.find('button').trigger('click');

    expect(wrapper.emitted('answer')).toHaveLength(1);
  });

  it('ignores non-Enter key presses', async () => {
    const wrapper = mountComponent();
    const input = wrapper.find('input');
    await input.setValue('ね');
    await input.trigger('keyup', { key: 'Space', isComposing: false });

    expect(wrapper.emitted('answer')).toBeUndefined();
  });
});

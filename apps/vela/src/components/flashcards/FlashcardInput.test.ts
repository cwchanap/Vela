import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { Quasar } from 'quasar';
import FlashcardInput from './FlashcardInput.vue';

describe('FlashcardInput', () => {
  const mountComponent = (props = {}) => {
    return mount(FlashcardInput, {
      props: {
        correctAnswer: '猫',
        alternateAnswers: ['ねこ', 'neko'],
        ...props,
      },
      global: {
        plugins: [Quasar],
      },
    });
  };

  it('should render input field', () => {
    const wrapper = mountComponent();

    const input = wrapper.find('[data-testid="input-answer"]');
    expect(input.exists()).toBe(true);
  });

  it('should render submit button', () => {
    const wrapper = mountComponent();

    const submitBtn = wrapper.find('[data-testid="btn-submit-answer"]');
    expect(submitBtn.exists()).toBe(true);
  });

  it('should disable submit button when input is empty', () => {
    const wrapper = mountComponent();

    const submitBtn = wrapper.findComponent('[data-testid="btn-submit-answer"]');
    expect(submitBtn.props('disable')).toBe(true);
  });

  it('should emit submit event with correct answer', async () => {
    const wrapper = mountComponent();

    const input = wrapper.findComponent({ name: 'QInput' });
    await input.setValue('猫');

    const submitBtn = wrapper.find('[data-testid="btn-submit-answer"]');
    await submitBtn.trigger('click');

    expect(wrapper.emitted('submit')).toBeTruthy();
    expect(wrapper.emitted('submit')?.[0]).toEqual(['猫', true]);
  });

  it('should accept alternate answers', async () => {
    const wrapper = mountComponent();

    const input = wrapper.findComponent({ name: 'QInput' });
    await input.setValue('ねこ');

    const submitBtn = wrapper.find('[data-testid="btn-submit-answer"]');
    await submitBtn.trigger('click');

    expect(wrapper.emitted('submit')?.[0]).toEqual(['ねこ', true]);
  });

  it('should accept romaji answer', async () => {
    const wrapper = mountComponent();

    const input = wrapper.findComponent({ name: 'QInput' });
    await input.setValue('neko');

    const submitBtn = wrapper.find('[data-testid="btn-submit-answer"]');
    await submitBtn.trigger('click');

    expect(wrapper.emitted('submit')?.[0]).toEqual(['neko', true]);
  });

  it('should emit submit with false for incorrect answer', async () => {
    const wrapper = mountComponent();

    const input = wrapper.findComponent({ name: 'QInput' });
    await input.setValue('wrong');

    const submitBtn = wrapper.find('[data-testid="btn-submit-answer"]');
    await submitBtn.trigger('click');

    expect(wrapper.emitted('submit')?.[0]).toEqual(['wrong', false]);
  });

  it('should be case insensitive', async () => {
    const wrapper = mountComponent();

    const input = wrapper.findComponent({ name: 'QInput' });
    await input.setValue('NEKO');

    const submitBtn = wrapper.find('[data-testid="btn-submit-answer"]');
    await submitBtn.trigger('click');

    expect(wrapper.emitted('submit')?.[0]).toEqual(['NEKO', true]);
  });

  it('should show correct feedback after correct answer', async () => {
    const wrapper = mountComponent();

    const input = wrapper.findComponent({ name: 'QInput' });
    await input.setValue('猫');

    const submitBtn = wrapper.find('[data-testid="btn-submit-answer"]');
    await submitBtn.trigger('click');

    expect(wrapper.text()).toContain('Correct');
  });

  it('should show incorrect feedback with correct answer after wrong answer', async () => {
    const wrapper = mountComponent();

    const input = wrapper.findComponent({ name: 'QInput' });
    await input.setValue('wrong');

    const submitBtn = wrapper.find('[data-testid="btn-submit-answer"]');
    await submitBtn.trigger('click');

    expect(wrapper.text()).toContain('Incorrect');
    expect(wrapper.text()).toContain('猫');
  });

  it('should make input readonly after submission', async () => {
    const wrapper = mountComponent();

    const input = wrapper.findComponent({ name: 'QInput' });
    await input.setValue('猫');

    const submitBtn = wrapper.find('[data-testid="btn-submit-answer"]');
    await submitBtn.trigger('click');

    expect(input.props('readonly')).toBe(true);
  });

  it('should reset state when reset is called', async () => {
    const wrapper = mountComponent();

    const input = wrapper.findComponent({ name: 'QInput' });
    await input.setValue('猫');

    const submitBtn = wrapper.find('[data-testid="btn-submit-answer"]');
    await submitBtn.trigger('click');

    // Call exposed reset function
    (wrapper.vm as any).reset();
    await wrapper.vm.$nextTick();

    expect(input.props('modelValue')).toBe('');
    expect(input.props('readonly')).toBe(false);
  });

  it('should use custom label when provided', () => {
    const wrapper = mountComponent({ label: 'Custom Label' });

    const input = wrapper.findComponent({ name: 'QInput' });
    expect(input.props('label')).toBe('Custom Label');
  });

  it('should use custom hint when provided', () => {
    const wrapper = mountComponent({ hint: 'Custom Hint' });

    const input = wrapper.findComponent({ name: 'QInput' });
    expect(input.props('hint')).toBe('Custom Hint');
  });

  it('should not allow multiple submissions', async () => {
    const wrapper = mountComponent();

    const input = wrapper.findComponent({ name: 'QInput' });
    await input.setValue('猫');

    const submitBtn = wrapper.find('[data-testid="btn-submit-answer"]');
    await submitBtn.trigger('click');
    await submitBtn.trigger('click');
    await submitBtn.trigger('click');

    // Should only emit once
    expect(wrapper.emitted('submit')?.length).toBe(1);
  });

  it('should handle vocabulary without alternate answers', async () => {
    const wrapper = mountComponent({
      correctAnswer: '犬',
      alternateAnswers: undefined,
    });

    const input = wrapper.findComponent({ name: 'QInput' });
    await input.setValue('犬');

    const submitBtn = wrapper.find('[data-testid="btn-submit-answer"]');
    await submitBtn.trigger('click');

    expect(wrapper.emitted('submit')?.[0]).toEqual(['犬', true]);
  });
});

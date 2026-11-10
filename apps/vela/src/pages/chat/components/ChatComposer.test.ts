import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { Quasar } from 'quasar';
import ChatComposer from './ChatComposer.vue';

describe('ChatComposer', () => {
  const mountComponent = (props = {}) => {
    return mount(ChatComposer, {
      props: {
        modelValue: '',
        loading: false,
        ...props,
      },
      global: {
        plugins: [Quasar],
      },
    });
  };

  const typeDraft = async (
    wrapper: ReturnType<typeof mountComponent>,
    value: string,
  ): Promise<void> => {
    const input = wrapper.find('[data-testid="llm-chat-input"]');
    await input.setValue(value);
    await wrapper.setProps({ modelValue: value });
  };

  it('should render the chat input and send button', () => {
    const wrapper = mountComponent();

    expect(wrapper.find('[data-testid="llm-chat-input"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="llm-chat-send"]').exists()).toBe(true);
  });

  it('should emit update:modelValue as the draft changes', async () => {
    const wrapper = mountComponent();
    const input = wrapper.find('[data-testid="llm-chat-input"]');

    await input.setValue('draft text');

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['draft text']);
  });

  it('should emit send with the trimmed draft when the button is clicked', async () => {
    const wrapper = mountComponent();
    await typeDraft(wrapper, '   hello world   ');

    await wrapper.find('[data-testid="llm-chat-send"]').trigger('click');

    expect(wrapper.emitted('send')).toEqual([['hello world']]);
  });

  it('should emit send once for a single Enter press', async () => {
    const wrapper = mountComponent();
    await typeDraft(wrapper, '\t padded message \n');
    const input = wrapper.find('[data-testid="llm-chat-input"]');

    await input.trigger('keydown', { key: 'Enter' });
    await input.trigger('keyup', { key: 'Enter' });

    expect(wrapper.emitted('send')).toEqual([['padded message']]);
  });

  it('should emit the same trimmed payload from Enter and the send button', async () => {
    const wrapper = mountComponent();
    await typeDraft(wrapper, '   same message   ');
    const input = wrapper.find('[data-testid="llm-chat-input"]');

    await input.trigger('keydown', { key: 'Enter' });
    await wrapper.find('[data-testid="llm-chat-send"]').trigger('click');

    expect(wrapper.emitted('send')).toEqual([['same message'], ['same message']]);
  });

  it('should not emit send for a whitespace-only draft', async () => {
    const wrapper = mountComponent();
    await typeDraft(wrapper, '   ');
    const input = wrapper.find('[data-testid="llm-chat-input"]');

    await input.trigger('keydown', { key: 'Enter' });
    await wrapper.find('[data-testid="llm-chat-send"]').trigger('click');

    expect(wrapper.emitted('send')).toBeUndefined();
  });

  it('should not emit send while loading', async () => {
    const wrapper = mountComponent({ loading: true });
    await wrapper.setProps({ modelValue: 'ready' });

    await wrapper.find('[data-testid="llm-chat-send"]').trigger('click');

    expect(wrapper.emitted('send')).toBeUndefined();
  });

  it('should not emit send when Enter confirms an IME candidate', async () => {
    const wrapper = mountComponent();
    await typeDraft(wrapper, 'にほんご');
    const input = wrapper.find('[data-testid="llm-chat-input"]');

    // The Enter that commits an IME candidate arrives as a composing keydown
    // followed by a non-composing keyup after the candidate is committed.
    await input.trigger('keydown', { key: 'Enter', isComposing: true });
    await input.trigger('keyup', { key: 'Enter', isComposing: false });

    expect(wrapper.emitted('send')).toBeUndefined();
  });

  it('should not emit send when Enter has keyCode 229 for IME', async () => {
    const wrapper = mountComponent();
    await typeDraft(wrapper, 'にほんご');
    const input = wrapper.find('[data-testid="llm-chat-input"]');

    await input.trigger('keydown', { key: 'Enter', keyCode: 229 });

    expect(wrapper.emitted('send')).toBeUndefined();
  });
});

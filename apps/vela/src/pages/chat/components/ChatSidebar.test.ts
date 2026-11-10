import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { Quasar } from 'quasar';
import ChatSidebar from './ChatSidebar.vue';
import type { ChatThreadSummaryDTO } from '../../../services/chatHistoryService';

const thread = (overrides: Partial<ChatThreadSummaryDTO> = {}): ChatThreadSummaryDTO => ({
  ThreadId: 't-1',
  title: 'Original title',
  createdAt: Date.now() - 120_000,
  updatedAt: Date.now() - 60_000,
  ...overrides,
});

describe('ChatSidebar', () => {
  const mountComponent = (props = {}) =>
    mount(ChatSidebar, {
      props: {
        threads: [thread()],
        activeThreadId: null,
        loading: false,
        error: false,
        disabled: false,
        ...props,
      },
      global: {
        plugins: [Quasar],
        stubs: { Teleport: true },
      },
    });

  const openRenameEditor = async (wrapper: ReturnType<typeof mountComponent>) => {
    await wrapper.find('[data-testid="chat-thread-menu"]').trigger('click');
    await flushPromises();
    await wrapper.find('[data-testid="chat-thread-rename"]').trigger('click');
    await flushPromises();
  };

  it('emits the trimmed rename and closes the editor when not busy', async () => {
    const wrapper = mountComponent();
    await openRenameEditor(wrapper);

    await wrapper.find('[data-testid="chat-thread-rename-input"]').setValue('  New title  ');
    await wrapper
      .find('[data-testid="chat-thread-rename-input"]')
      .trigger('keydown', { key: 'Enter' });
    await flushPromises();

    expect(wrapper.emitted('rename')).toEqual([[{ threadId: 't-1', title: 'New title' }]]);
    expect(wrapper.find('[data-testid="chat-thread-rename-input"]').exists()).toBe(false);
  });

  it('keeps the open rename editor and its draft without emitting while busy', async () => {
    const wrapper = mountComponent();
    await openRenameEditor(wrapper);

    await wrapper.find('[data-testid="chat-thread-rename-input"]').setValue('Draft in progress');
    await wrapper.setProps({ disabled: true });

    await wrapper
      .find('[data-testid="chat-thread-rename-input"]')
      .trigger('keydown', { key: 'Enter' });
    await wrapper.find('[data-testid="chat-thread-rename-save"]').trigger('click');
    await flushPromises();

    expect(wrapper.emitted('rename')).toBeUndefined();
    const input = wrapper.find('[data-testid="chat-thread-rename-input"]');
    expect(input.exists()).toBe(true);
    expect((input.element as HTMLInputElement).value).toBe('Draft in progress');
  });

  it('commits the preserved draft once no longer busy', async () => {
    const wrapper = mountComponent();
    await openRenameEditor(wrapper);

    await wrapper.find('[data-testid="chat-thread-rename-input"]').setValue('Held title');
    await wrapper.setProps({ disabled: true });
    await wrapper.setProps({ disabled: false });

    await wrapper
      .find('[data-testid="chat-thread-rename-input"]')
      .trigger('keydown', { key: 'Enter' });
    await flushPromises();

    expect(wrapper.emitted('rename')).toEqual([[{ threadId: 't-1', title: 'Held title' }]]);
  });

  it('keeps the editor open with an inline error when the trimmed title exceeds 60 characters', async () => {
    const wrapper = mountComponent();
    await openRenameEditor(wrapper);

    await wrapper.find('[data-testid="chat-thread-rename-input"]').setValue(` ${'a'.repeat(61)} `);
    await wrapper
      .find('[data-testid="chat-thread-rename-input"]')
      .trigger('keydown', { key: 'Enter' });
    await flushPromises();

    expect(wrapper.emitted('rename')).toBeUndefined();
    expect(wrapper.find('[data-testid="chat-thread-rename-input"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('60 characters or fewer');
  });

  it('ignores Enter pressed to confirm an IME composition', async () => {
    const wrapper = mountComponent();
    await openRenameEditor(wrapper);

    const input = wrapper.find('[data-testid="chat-thread-rename-input"]');
    await input.trigger('keydown', { key: 'Enter', isComposing: true });
    await flushPromises();

    expect(wrapper.emitted('rename')).toBeUndefined();
    expect(input.exists()).toBe(true);

    await input.trigger('keydown', { key: 'Enter', keyCode: 229 });
    await flushPromises();

    expect(wrapper.emitted('rename')).toBeUndefined();
    expect(input.exists()).toBe(true);
  });

  it('disables the rename input and save button while busy', async () => {
    const wrapper = mountComponent();
    await openRenameEditor(wrapper);

    await wrapper.setProps({ disabled: true });

    expect(wrapper.findComponent({ name: 'QInput' }).props('disable')).toBe(true);
    const saveButton = wrapper
      .findAllComponents({ name: 'QBtn' })
      .find((b) => b.attributes('data-testid') === 'chat-thread-rename-save');
    expect(saveButton?.props('disable')).toBe(true);
  });

  it('disables already-open menu actions while busy', async () => {
    const wrapper = mountComponent();

    await wrapper.find('[data-testid="chat-thread-menu"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-testid="chat-thread-rename"]').exists()).toBe(true);

    await wrapper.setProps({ disabled: true });

    const renameItem = wrapper.find('[data-testid="chat-thread-rename"]');
    const deleteItem = wrapper.find('[data-testid="llm-chat-delete-thread"]');
    expect(renameItem.findComponent({ name: 'QItem' }).props('disable')).toBe(true);
    expect(deleteItem.findComponent({ name: 'QItem' }).props('disable')).toBe(true);

    await renameItem.trigger('click');
    await deleteItem.trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="chat-thread-rename-input"]').exists()).toBe(false);
    expect(wrapper.emitted('delete')).toBeUndefined();
  });

  it('closes rename without emitting when saving with unchanged title', async () => {
    const wrapper = mountComponent();
    await openRenameEditor(wrapper);

    // Draft is already 'Original title'; press Enter without changes
    await wrapper
      .find('[data-testid="chat-thread-rename-input"]')
      .trigger('keydown', { key: 'Enter' });
    await flushPromises();

    expect(wrapper.emitted('rename')).toBeUndefined();
    expect(wrapper.find('[data-testid="chat-thread-rename-input"]').exists()).toBe(false);
  });

  it('stops event propagation on Escape so mobile dialog is not closed', async () => {
    const wrapper = mountComponent();
    await openRenameEditor(wrapper);

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    const stopPropagationSpy = vi.spyOn(event, 'stopPropagation');
    wrapper.find('[data-testid="chat-thread-rename-input"]').element.dispatchEvent(event);
    await flushPromises();

    expect(stopPropagationSpy).toHaveBeenCalled();
    expect(wrapper.find('[data-testid="chat-thread-rename-input"]').exists()).toBe(false);
  });

  it('renders existing threads alongside a retry banner when a background refetch fails', () => {
    const wrapper = mountComponent({
      threads: [thread({ ThreadId: 't-1', title: 'Cached thread' })],
      error: true,
    });

    expect(wrapper.find('[data-testid="llm-chat-thread-item"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Cached thread');
    expect(wrapper.find('[data-testid="chat-sidebar-retry"]').exists()).toBe(true);
  });
});

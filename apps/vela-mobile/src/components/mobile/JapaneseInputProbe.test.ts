import { mount } from '@vue/test-utils';
import { Quasar } from 'quasar';
import { nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import JapaneseInputProbe from './JapaneseInputProbe.vue';

function mountProbe() {
  return mount(JapaneseInputProbe, {
    attachTo: document.body,
    global: { plugins: [Quasar] },
  });
}

const ownedNativeEvents = ['compositionstart', 'input', 'compositionend', 'keydown'] as const;

describe('JapaneseInputProbe', () => {
  it('tracks draft during composition without submitting', async () => {
    const wrapper = mountProbe();
    const input = wrapper.get('input');
    await input.trigger('compositionstart');
    input.element.value = 'にほんご';
    await input.trigger('input');
    await input.trigger('keydown', { key: 'Enter', isComposing: true });
    expect(wrapper.get('[data-testid="ime-draft"]').text()).toContain('にほんご');
    expect(wrapper.get('[data-testid="ime-composing"]').text()).toContain('yes');
    expect(wrapper.get('[data-testid="ime-submitted"]').text()).not.toContain('にほんご');
  });

  it('records exact commit then submits on a later Enter keydown', async () => {
    const wrapper = mountProbe();
    const input = wrapper.get('input');
    await input.trigger('compositionstart');
    input.element.value = '日本語';
    await input.trigger('input');
    await input.trigger('compositionend', { data: '日本語' });
    await nextTick();
    expect(wrapper.getComponent({ name: 'QInput' }).props('modelValue')).toBe('日本語');
    expect(wrapper.get('[data-testid="ime-model"]').text()).toContain('日本語');
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('日本語');
    await input.trigger('keydown', { key: 'Enter', isComposing: false });
    expect(wrapper.get('[data-testid="ime-committed"]').text()).toContain('日本語');
    expect(wrapper.get('[data-testid="ime-submitted"]').text()).toContain('日本語');
  });

  it('does not write an in-progress draft through QInput model updates', async () => {
    const wrapper = mountProbe();
    const qInput = wrapper.getComponent({ name: 'QInput' });
    const input = wrapper.get('input');
    await input.trigger('compositionstart');
    input.element.value = 'にほ';
    await input.trigger('input');
    expect(qInput.props('modelValue')).toBe('');
  });

  it('does not submit from the button while composition is active', async () => {
    const wrapper = mountProbe();
    const input = wrapper.get('input');
    await input.trigger('compositionstart');
    input.element.value = '  にほ  ';
    await input.trigger('input');
    await wrapper.get('[data-testid="ime-submit"]').trigger('click');
    expect(wrapper.get('[data-testid="ime-draft"]').element.textContent).toBe('Draft:   にほ  ');
    expect(wrapper.get('[data-testid="ime-submitted"]').element.textContent).toBe('Submitted: ');
  });

  it('blocks Enter when the key event remains composing after native commit', async () => {
    const wrapper = mountProbe();
    const input = wrapper.get('input');
    await input.trigger('compositionstart');
    input.element.value = '日本語';
    await input.trigger('input');
    await input.trigger('compositionend', { data: '日本語' });
    await input.trigger('keydown', { key: 'Enter', isComposing: true });
    expect(wrapper.get('[data-testid="ime-composing"]').text()).toContain('no');
    expect(wrapper.get('[data-testid="ime-submitted"]').text()).not.toContain('日本語');
    await input.trigger('keydown', { key: 'Enter', isComposing: false });
    expect(wrapper.get('[data-testid="ime-submitted"]').text()).toContain('日本語');
  });

  it('submits on keydown rather than keyup', async () => {
    const wrapper = mountProbe();
    const input = wrapper.get('input');
    input.element.value = '確定';
    await input.trigger('input');
    await input.trigger('keyup', { key: 'Enter', isComposing: false });
    expect(wrapper.get('[data-testid="ime-submitted"]').text()).not.toContain('確定');
    await input.trigger('keydown', { key: 'Enter', isComposing: false });
    expect(wrapper.get('[data-testid="ime-submitted"]').text()).toContain('確定');
  });

  it('Done blurs the native control', async () => {
    const wrapper = mountProbe();
    const input = wrapper.get('input');
    input.element.focus();
    await wrapper.get('[data-testid="ime-done"]').trigger('click');
    expect(document.activeElement).not.toBe(input.element);
  });

  it('submits an ordinary input without changing whitespace', async () => {
    const wrapper = mountProbe();
    const input = wrapper.get('input');
    input.element.value = '  日本語  ';
    await input.trigger('input');
    await wrapper.get('[data-testid="ime-submit"]').trigger('click');
    expect(wrapper.get('[data-testid="ime-model"]').element.textContent).toBe('Model:   日本語  ');
    expect(wrapper.get('[data-testid="ime-draft"]').element.textContent).toBe('Draft:   日本語  ');
    expect(wrapper.get('[data-testid="ime-submitted"]').element.textContent).toBe(
      'Submitted:   日本語  ',
    );
  });

  it('marks Done and Submit as mobile touch targets', () => {
    const wrapper = mountProbe();
    expect(wrapper.get('[data-testid="ime-done"]').classes()).toContain('mobile-touch-target');
    expect(wrapper.get('[data-testid="ime-submit"]').classes()).toContain('mobile-touch-target');
  });

  it('blurs the native control when tapping the non-interactive background', async () => {
    const wrapper = mountProbe();
    const input = wrapper.get('input');
    input.element.focus();
    await wrapper.get('[data-testid="ime-probe"]').trigger('pointerdown');
    expect(document.activeElement).not.toBe(input.element);
  });

  it('keeps the native control focused while Submit activates', async () => {
    const wrapper = mountProbe();
    const input = wrapper.get('input');
    input.element.focus();
    input.element.value = '送信';
    await input.trigger('input');
    await wrapper.get('[data-testid="ime-submit"]').trigger('click');
    expect(document.activeElement).toBe(input.element);
    expect(wrapper.get('[data-testid="ime-submitted"]').text()).toContain('送信');
  });

  it('removes its native listeners on unmount', async () => {
    const addListener = vi.spyOn(HTMLInputElement.prototype, 'addEventListener');
    const wrapper = mountProbe();
    const input = wrapper.get('input');
    const nativeInput = input.element as HTMLInputElement;
    const draftReadout = wrapper.get('[data-testid="ime-draft"]');
    type NativeListener = Parameters<HTMLInputElement['removeEventListener']>[1];
    const ownedListeners = new Map<string, NativeListener>();

    for (const type of ownedNativeEvents) {
      const ownedCallIndex = addListener.mock.calls.findLastIndex(
        ([registeredType], index) =>
          registeredType === type && (addListener.mock.instances[index] as unknown) === nativeInput,
      );
      expect(ownedCallIndex).toBeGreaterThanOrEqual(0);
      ownedListeners.set(type, addListener.mock.calls[ownedCallIndex]![1]);
    }

    nativeInput.value = 'before unmount';
    await input.trigger('input');
    const readoutBeforeUnmount = draftReadout.element.textContent;
    const removeListener = vi.spyOn(nativeInput, 'removeEventListener');
    wrapper.unmount();

    for (const type of ownedNativeEvents) {
      expect(removeListener).toHaveBeenCalledWith(type, ownedListeners.get(type));
    }

    nativeInput.value = 'after unmount';
    nativeInput.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    expect(draftReadout.element.textContent).toBe(readoutBeforeUnmount);
    removeListener.mockRestore();
    addListener.mockRestore();
  });
});

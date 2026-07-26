import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import {
  type KeyboardListener,
  type KeyboardListenerEvent,
  useKeyboardViewport,
} from './useKeyboardViewport';

function mountHarness(options: Parameters<typeof useKeyboardViewport>[0]) {
  let state: ReturnType<typeof useKeyboardViewport>;
  const Harness = defineComponent({
    setup() {
      state = useKeyboardViewport(options);
      return () => null;
    },
  });
  const wrapper = mount(Harness);
  return { wrapper, state: state! };
}

describe('useKeyboardViewport', () => {
  it('skips native registration in browser mode', () => {
    const addListener = vi.fn();
    mountHarness({ isNative: () => false, addListener });
    expect(addListener).not.toHaveBeenCalled();
  });

  it('hides on will-show, scrolls after did-show, and restores on did-hide', async () => {
    const listeners = new Map<KeyboardListenerEvent, KeyboardListener>();
    const remove = vi.fn(async () => undefined);
    const scrollIntoView = vi.fn();
    const addListener = vi.fn(async (name: KeyboardListenerEvent, listener: KeyboardListener) => {
      listeners.set(name, listener);
      return { remove };
    });
    const { state } = mountHarness({
      isNative: () => true,
      addListener,
      getFocusedBlock: () => ({ scrollIntoView }) as unknown as HTMLElement,
      requestFrame: (callback) => {
        callback(0);
        return 1;
      },
      cancelFrame: vi.fn(),
    });
    await flushPromises();
    listeners.get('keyboardWillShow')?.();
    expect(state.isKeyboardVisible.value).toBe(true);
    listeners.get('keyboardDidShow')?.();
    await nextTick();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
    listeners.get('keyboardDidHide')?.();
    expect(state.isKeyboardVisible.value).toBe(false);
  });

  it('replays a keyboardWillShow event that arrives while later listeners are still registering', async () => {
    const listeners = new Map<KeyboardListenerEvent, KeyboardListener>();
    const remove = vi.fn(async () => undefined);
    const scrollIntoView = vi.fn();
    let resolveDidShow!: () => void;
    let resolveDidHide!: () => void;
    const addListener = vi.fn(async (name: KeyboardListenerEvent, listener: KeyboardListener) => {
      listeners.set(name, listener);
      if (name === 'keyboardDidShow') {
        await new Promise<void>((resolve) => {
          resolveDidShow = resolve;
        });
      }
      if (name === 'keyboardDidHide') {
        await new Promise<void>((resolve) => {
          resolveDidHide = resolve;
        });
      }
      return { remove };
    });

    const { state } = mountHarness({
      isNative: () => true,
      addListener,
      getFocusedBlock: () => ({ scrollIntoView }) as unknown as HTMLElement,
      requestFrame: (callback) => {
        callback(0);
        return 1;
      },
      cancelFrame: vi.fn(),
    });

    // Wait for the first listener (keyboardWillShow) to install, but the
    // later two addListener calls are still pending their bridge round-trips.
    await vi.waitFor(() => expect(listeners.has('keyboardWillShow')).toBe(true));
    expect(state.nativeStatus.value).toBe('unavailable');

    // The keyboard opens before registration completes.
    listeners.get('keyboardWillShow')?.();
    expect(state.isKeyboardVisible.value).toBe(false);

    // Complete registration; the queued will-show event must be replayed.
    resolveDidShow();
    await vi.waitFor(() => expect(listeners.has('keyboardDidHide')).toBe(true));
    resolveDidHide();
    await flushPromises();

    expect(state.nativeStatus.value).toBe('native');
    expect(state.isKeyboardVisible.value).toBe(true);
  });

  it('schedules the settled scroll when keyboardDidShow is lost during registration', async () => {
    // Simulates the race where the native keyboard fires keyboardDidShow
    // before its listener is installed (the addListener round-trip for
    // keyboardDidShow is still in flight). The keyboardWillShow listener IS
    // installed, so that event is queued — but keyboardDidShow has no
    // listener yet and is lost. The compensation after replay must schedule
    // the scroll so the first focused form is not left obscured.
    const listeners = new Map<KeyboardListenerEvent, KeyboardListener>();
    const remove = vi.fn(async () => undefined);
    const scrollIntoView = vi.fn();
    let resolveDidShow!: () => void;
    let resolveDidHide!: () => void;
    const addListener = vi.fn(async (name: KeyboardListenerEvent, listener: KeyboardListener) => {
      listeners.set(name, listener);
      if (name === 'keyboardDidShow') {
        await new Promise<void>((resolve) => {
          resolveDidShow = resolve;
        });
      }
      if (name === 'keyboardDidHide') {
        await new Promise<void>((resolve) => {
          resolveDidHide = resolve;
        });
      }
      return { remove };
    });

    const { state } = mountHarness({
      isNative: () => true,
      addListener,
      getFocusedBlock: () => ({ scrollIntoView }) as unknown as HTMLElement,
      requestFrame: (callback) => {
        callback(0);
        return 1;
      },
      cancelFrame: vi.fn(),
    });

    // Wait for keyboardWillShow to install; keyboardDidShow/keyboardDidHide
    // are still pending their bridge round-trips.
    await vi.waitFor(() => expect(listeners.has('keyboardWillShow')).toBe(true));

    // The keyboard opens: keyboardWillShow is captured (queued), but the
    // subsequent keyboardDidShow has no listener yet — it is lost. We do NOT
    // call listeners.get('keyboardDidShow') here, simulating the lost event.
    listeners.get('keyboardWillShow')?.();
    expect(state.isKeyboardVisible.value).toBe(false);

    // Complete registration. The replayed keyboardWillShow sets
    // isKeyboardVisible to true, but keyboardDidShow was never queued so
    // scrollFocusedBlockAfterLayout would not run without compensation.
    resolveDidShow();
    await vi.waitFor(() => expect(listeners.has('keyboardDidHide')).toBe(true));
    resolveDidHide();
    await flushPromises();
    await nextTick();

    expect(state.nativeStatus.value).toBe('native');
    expect(state.isKeyboardVisible.value).toBe(true);
    // The compensation must have scheduled the scroll even though
    // keyboardDidShow was never delivered.
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('removes every resolved listener handle on unmount', async () => {
    const remove = vi.fn(async () => undefined);
    const { wrapper } = mountHarness({
      isNative: () => true,
      addListener: vi.fn(async () => ({ remove })),
    });
    await flushPromises();
    wrapper.unmount();
    await flushPromises();
    expect(remove).toHaveBeenCalledTimes(3);
  });

  it('removes a listener resolved after unmount and stops registering', async () => {
    const remove = vi.fn(async () => undefined);
    let resolveHandle!: (handle: { remove: typeof remove }) => void;
    const addListener = vi.fn(
      () =>
        new Promise<{ remove: typeof remove }>((resolve) => {
          resolveHandle = resolve;
        }),
    );
    const { wrapper } = mountHarness({
      isNative: () => true,
      addListener,
    });
    expect(addListener).toHaveBeenCalledOnce();

    wrapper.unmount();
    resolveHandle({ remove });
    await flushPromises();

    expect(remove).toHaveBeenCalledOnce();
    expect(addListener).toHaveBeenCalledOnce();
  });

  it('rolls back partial registration before native callbacks can mutate layout', async () => {
    const listeners = new Map<KeyboardListenerEvent, KeyboardListener>();
    const remove = vi.fn(async () => undefined);
    const addListener = vi.fn(async (name: KeyboardListenerEvent, listener: KeyboardListener) => {
      listeners.set(name, listener);
      if (name === 'keyboardDidShow') {
        throw new Error('native listener unavailable');
      }
      return { remove };
    });
    const { state, wrapper } = mountHarness({
      isNative: () => true,
      addListener,
    });
    await flushPromises();
    expect(state.nativeStatus.value).toBe('unavailable');
    expect(state.lastError.value).toBe('native listener unavailable');
    expect(remove).toHaveBeenCalledTimes(1);
    listeners.get('keyboardWillShow')?.();
    expect(state.isKeyboardVisible.value).toBe(false);
    wrapper.unmount();
    await flushPromises();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('reports registration failure before a non-settling rollback finishes', async () => {
    const remove = vi.fn(() => new Promise<void>(() => undefined));
    const { state } = mountHarness({
      isNative: () => true,
      addListener: vi.fn(async (name) => {
        if (name === 'keyboardDidShow') {
          throw new Error('registration rejected');
        }
        return { remove };
      }),
    });

    await vi.waitFor(() => {
      expect(remove).toHaveBeenCalledOnce();
    });
    expect(state.nativeStatus.value).toBe('unavailable');
    expect(state.lastError.value).toBe('registration rejected');
  });

  it('repeats settled scrolling when the native viewport resizes', async () => {
    const listeners = new Map<KeyboardListenerEvent, KeyboardListener>();
    const scrollIntoView = vi.fn();
    mountHarness({
      isNative: () => true,
      addListener: vi.fn(async (name, listener) => {
        listeners.set(name, listener);
        return { remove: vi.fn(async () => undefined) };
      }),
      getFocusedBlock: () => ({ scrollIntoView }) as unknown as HTMLElement,
      requestFrame: (callback) => {
        callback(0);
        return 1;
      },
      cancelFrame: vi.fn(),
    });
    await flushPromises();
    listeners.get('keyboardWillShow')?.();
    listeners.get('keyboardDidShow')?.();
    await nextTick();
    window.dispatchEvent(new Event('resize'));
    await nextTick();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('removes the resize listener and cancels a pending frame on unmount', async () => {
    const removeNative = vi.fn(async () => undefined);
    const removeWindow = vi.spyOn(window, 'removeEventListener');
    const requestFrame = vi.fn(() => 17);
    const cancelFrame = vi.fn();
    const listeners = new Map<KeyboardListenerEvent, KeyboardListener>();
    const { wrapper } = mountHarness({
      isNative: () => true,
      addListener: vi.fn(async (name, listener) => {
        listeners.set(name, listener);
        return { remove: removeNative };
      }),
      getFocusedBlock: () => document.createElement('section'),
      requestFrame,
      cancelFrame,
    });
    await flushPromises();
    listeners.get('keyboardWillShow')?.();
    listeners.get('keyboardDidShow')?.();
    await nextTick();
    expect(requestFrame).toHaveBeenCalledOnce();

    wrapper.unmount();

    expect(removeNative).toHaveBeenCalledTimes(3);
    expect(removeWindow).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(cancelFrame).toHaveBeenCalledWith(17);
    removeWindow.mockRestore();
  });
});

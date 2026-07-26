import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { Keyboard, type KeyboardInfo } from '@capacitor/keyboard';
import { nextTick, onMounted, onUnmounted, ref } from 'vue';

export type KeyboardListenerEvent = 'keyboardWillShow' | 'keyboardDidShow' | 'keyboardDidHide';

export type KeyboardListener = (info?: KeyboardInfo) => void;

export type AddKeyboardListener = (
  eventName: KeyboardListenerEvent,
  listener: KeyboardListener,
) => Promise<PluginListenerHandle>;

export type KeyboardViewportOptions = {
  isNative?: () => boolean;
  addListener?: AddKeyboardListener;
  getFocusedBlock?: () => HTMLElement | null;
  requestFrame?: typeof requestAnimationFrame;
  cancelFrame?: typeof cancelAnimationFrame;
};

export type KeyboardNativeStatus = 'browser' | 'native' | 'unavailable';

function addNativeKeyboardListener(
  eventName: KeyboardListenerEvent,
  listener: KeyboardListener,
): Promise<PluginListenerHandle> {
  switch (eventName) {
    case 'keyboardWillShow':
      return Keyboard.addListener(eventName, (info) => listener(info));
    case 'keyboardDidShow':
      return Keyboard.addListener(eventName, (info) => listener(info));
    case 'keyboardDidHide':
      return Keyboard.addListener(eventName, () => listener());
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useKeyboardViewport(options: KeyboardViewportOptions = {}) {
  const isNative = options.isNative ?? Capacitor.isNativePlatform;
  const addListener = options.addListener ?? addNativeKeyboardListener;
  const getFocusedBlock =
    options.getFocusedBlock ??
    (() => document.querySelector<HTMLElement>('[data-keyboard-scroll-block]'));
  const requestFrame =
    options.requestFrame ??
    ((callback: Parameters<typeof requestAnimationFrame>[0]) => requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame ?? ((handle: number) => cancelAnimationFrame(handle));

  const isKeyboardVisible = ref(false);
  const nativeStatus = ref<KeyboardNativeStatus>('browser');
  const lastError = ref<string | null>(null);
  const handles: PluginListenerHandle[] = [];
  let mounted = false;
  let nativeReady = false;
  let pendingFrame: number | null = null;

  async function scrollFocusedBlockAfterLayout(): Promise<void> {
    await nextTick();
    if (!mounted || !nativeReady || !isKeyboardVisible.value) return;

    if (pendingFrame !== null) {
      cancelFrame(pendingFrame);
    }
    pendingFrame = requestFrame(() => {
      pendingFrame = null;
      if (!mounted || !nativeReady || !isKeyboardVisible.value) return;
      getFocusedBlock()?.scrollIntoView({ block: 'nearest' });
    });
  }

  const listeners: Record<KeyboardListenerEvent, KeyboardListener> = {
    keyboardWillShow: () => {
      if (!mounted || !nativeReady) return;
      isKeyboardVisible.value = true;
    },
    // iOS fires keyboardWillShow before keyboardDidShow; scrollFocusedBlockAfterLayout
    // guards on isKeyboardVisible, so this ordering is required for the scroll to run.
    keyboardDidShow: () => {
      if (!mounted || !nativeReady) return;
      void scrollFocusedBlockAfterLayout();
    },
    keyboardDidHide: () => {
      if (!mounted || !nativeReady) return;
      isKeyboardVisible.value = false;
    },
  };

  function onWindowResize(): void {
    if (!mounted || !nativeReady || !isKeyboardVisible.value) return;
    void scrollFocusedBlockAfterLayout();
  }

  async function removeHandles(): Promise<void> {
    const resolvedHandles = handles.splice(0);
    await Promise.allSettled(resolvedHandles.map((handle) => handle.remove()));
  }

  async function registerNativeListeners(): Promise<void> {
    const eventNames: KeyboardListenerEvent[] = [
      'keyboardWillShow',
      'keyboardDidShow',
      'keyboardDidHide',
    ];

    try {
      for (const eventName of eventNames) {
        if (!mounted) return;
        const handle = await addListener(eventName, listeners[eventName]);
        if (!mounted) {
          await handle.remove();
          return;
        }
        handles.push(handle);
      }
      nativeReady = true;
      nativeStatus.value = 'native';
    } catch (error) {
      nativeReady = false;
      nativeStatus.value = 'unavailable';
      lastError.value = errorMessage(error);
      await removeHandles();
    }
  }

  onMounted(() => {
    mounted = true;
    window.addEventListener('resize', onWindowResize);
    if (isNative()) {
      nativeStatus.value = 'unavailable';
      void registerNativeListeners();
    } else {
      nativeStatus.value = 'browser';
    }
  });

  onUnmounted(() => {
    mounted = false;
    nativeReady = false;
    window.removeEventListener('resize', onWindowResize);
    void removeHandles();
    if (pendingFrame !== null) {
      cancelFrame(pendingFrame);
      pendingFrame = null;
    }
  });

  return {
    isKeyboardVisible,
    nativeStatus,
    lastError,
  };
}

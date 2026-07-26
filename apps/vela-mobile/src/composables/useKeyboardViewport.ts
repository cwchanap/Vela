import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { Keyboard, type KeyboardInfo } from '@capacitor/keyboard';
import { type InjectionKey, nextTick, onMounted, onUnmounted, ref } from 'vue';

export type KeyboardViewportState = {
  isKeyboardVisible: ReturnType<typeof ref<boolean>>;
  nativeStatus: ReturnType<typeof ref<KeyboardNativeStatus>>;
  lastError: ReturnType<typeof ref<string | null>>;
};

export const KEYBOARD_VIEWPORT_INJECTION_KEY: InjectionKey<KeyboardViewportState> =
  Symbol('keyboardViewport');

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
  // Events that arrive after a listener is installed but before nativeReady
  // flips true (i.e. while later addListener round-trips are still pending)
  // are queued and replayed once registration completes, so the first focus
  // can't leave the footer visible or skip the focused-block scroll. Replay is
  // idempotent: multiple keyboardWillShow events in the queue each set
  // isKeyboardVisible to true, and multiple keyboardDidShow events each
  // schedule a scroll that no-ops if the block is already in view, so a burst
  // of repeated events is harmless.
  const pendingEvents: KeyboardListenerEvent[] = [];
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
      if (!mounted) return;
      if (!nativeReady) {
        pendingEvents.push('keyboardWillShow');
        return;
      }
      isKeyboardVisible.value = true;
    },
    // iOS fires keyboardWillShow before keyboardDidShow; scrollFocusedBlockAfterLayout
    // guards on isKeyboardVisible, so this ordering is required for the scroll to run.
    keyboardDidShow: () => {
      if (!mounted) return;
      if (!nativeReady) {
        pendingEvents.push('keyboardDidShow');
        return;
      }
      void scrollFocusedBlockAfterLayout();
    },
    keyboardDidHide: () => {
      if (!mounted) return;
      if (!nativeReady) {
        pendingEvents.push('keyboardDidHide');
        return;
      }
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

    // Each addListener call awaits a Capacitor bridge round-trip, so the whole
    // loop is asynchronous. The mounted check before each await and the
    // nativeReady gate on every callback defend against two races:
    //   1. The component unmounts mid-registration — late callbacks would
    //      mutate reactive state after onUnmounted tore it down, so every
    //      listener bails out when mounted is false and a handle obtained
    //      after unmount is removed immediately.
    //   2. Registration partially succeeds — nativeReady only flips true once
    //      all three handles are pushed, so callbacks that arrive while
    //      registration is incomplete are queued (pendingEvents) and replayed
    //      after the loop instead of acting on a half-registered listener set.
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
      // Replay any events that arrived between individual listener installation
      // and nativeReady. Listeners re-check nativeReady (now true) and run their
      // normal path; ordering is preserved because events are pushed in arrival
      // order.
      const queued = pendingEvents.splice(0);
      for (const event of queued) {
        if (!mounted) break;
        listeners[event]();
      }
    } catch (error) {
      nativeReady = false;
      nativeStatus.value = 'unavailable';
      lastError.value = errorMessage(error);
      pendingEvents.length = 0;
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
    pendingEvents.length = 0;
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

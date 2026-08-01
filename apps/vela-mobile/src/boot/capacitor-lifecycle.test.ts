import type { PluginListenerHandle } from '@capacitor/core';
import { focusManager } from '@tanstack/vue-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mobileLifecycleState, resetMobileLifecycleForTests } from 'src/services/mobile-lifecycle';
import { registerCapacitorLifecycle, resetCapacitorLifecycleForTests } from './capacitor-lifecycle';

describe('Capacitor lifecycle', () => {
  let setFocused: ReturnType<typeof vi.spyOn> | undefined;

  afterEach(() => {
    setFocused?.mockRestore();
    setFocused = undefined;
  });

  it('registers resume diagnostics and native focus listeners once', async () => {
    resetCapacitorLifecycleForTests();
    resetMobileLifecycleForTests();
    setFocused = vi.spyOn(focusManager, 'setFocused');
    const addListener = vi.fn(async (name: 'resume' | 'appStateChange', listener: () => void) => {
      if (name === 'appStateChange') {
        (listener as (event: { isActive: boolean }) => void)({ isActive: false });
        (listener as (event: { isActive: boolean }) => void)({ isActive: true });
      }
      return { remove: vi.fn(async () => undefined) };
    });
    await registerCapacitorLifecycle({ addListener });
    await registerCapacitorLifecycle({ addListener });
    expect(addListener).toHaveBeenCalledTimes(2);
    expect(addListener).toHaveBeenCalledWith('resume', expect.any(Function));
    expect(addListener).toHaveBeenCalledWith('appStateChange', expect.any(Function));
    expect(setFocused).toHaveBeenNthCalledWith(1, false);
    expect(setFocused).toHaveBeenNthCalledWith(2, true);
    expect(mobileLifecycleState.isActive.value).toBe(true);
    expect(mobileLifecycleState.lastBecameInactiveAt.value).not.toBeNull();
    expect(mobileLifecycleState.lastBecameActiveAt.value).not.toBeNull();
    expect(mobileLifecycleState.resumeCount.value).toBe(0);
  });

  it('shares one native listener registration across concurrent callers', async () => {
    resetCapacitorLifecycleForTests();
    let resolveRegistration: (handle: PluginListenerHandle) => void;
    const pendingRegistration = new Promise<PluginListenerHandle>((resolve) => {
      resolveRegistration = resolve;
    });
    const addListener = vi.fn(
      (_name: 'resume' | 'appStateChange', _listener: () => void) => pendingRegistration,
    );

    const registrations = Promise.all([
      registerCapacitorLifecycle({ addListener }),
      registerCapacitorLifecycle({ addListener }),
    ]);

    expect(addListener).toHaveBeenCalledTimes(1);
    resolveRegistration!({ remove: vi.fn(async () => undefined) });
    await Promise.resolve();
    expect(addListener).toHaveBeenCalledTimes(2);
    await expect(registrations).resolves.toEqual([undefined, undefined]);
  });

  it('allows registration to retry after a failed subscription', async () => {
    resetCapacitorLifecycleForTests();
    let attempts = 0;
    const addListener = vi.fn(async (_name: 'resume' | 'appStateChange', _listener: () => void) => {
      attempts += 1;
      if (attempts === 1) throw new Error('registration failed');
      return { remove: vi.fn(async () => undefined) };
    });

    await expect(registerCapacitorLifecycle({ addListener })).rejects.toThrow(
      'registration failed',
    );
    await expect(registerCapacitorLifecycle({ addListener })).resolves.toBeUndefined();
    expect(addListener).toHaveBeenCalledTimes(3);
  });

  it('removes a partial registration before allowing a retry', async () => {
    resetCapacitorLifecycleForTests();
    const remove = vi.fn(async () => undefined);
    let attempts = 0;
    const addListener = vi.fn(async (_name: 'resume' | 'appStateChange', _listener: () => void) => {
      attempts += 1;
      if (attempts === 2) throw new Error('app state registration failed');
      return { remove };
    });

    await expect(registerCapacitorLifecycle({ addListener })).rejects.toThrow(
      'app state registration failed',
    );
    expect(remove).toHaveBeenCalledOnce();

    await expect(registerCapacitorLifecycle({ addListener })).resolves.toBeUndefined();
    expect(addListener).toHaveBeenCalledTimes(4);
  });
});

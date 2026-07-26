import type { PluginListenerHandle } from '@capacitor/core';
import { describe, expect, it, vi } from 'vitest';
import { registerCapacitorLifecycle, resetCapacitorLifecycleForTests } from './capacitor-lifecycle';

describe('Capacitor lifecycle', () => {
  it('registers one native resume listener', async () => {
    resetCapacitorLifecycleForTests();
    const addListener = vi.fn(async (_name: 'resume', listener: () => void) => {
      listener();
      return { remove: vi.fn(async () => undefined) };
    });
    await registerCapacitorLifecycle({ addListener });
    await registerCapacitorLifecycle({ addListener });
    expect(addListener).toHaveBeenCalledTimes(1);
  });

  it('shares one native listener registration across concurrent callers', async () => {
    resetCapacitorLifecycleForTests();
    let resolveRegistration: (handle: PluginListenerHandle) => void;
    const pendingRegistration = new Promise<PluginListenerHandle>((resolve) => {
      resolveRegistration = resolve;
    });
    const addListener = vi.fn((_name: 'resume', _listener: () => void) => pendingRegistration);

    const registrations = Promise.all([
      registerCapacitorLifecycle({ addListener }),
      registerCapacitorLifecycle({ addListener }),
    ]);

    expect(addListener).toHaveBeenCalledTimes(1);
    resolveRegistration!({ remove: vi.fn(async () => undefined) });
    await expect(registrations).resolves.toEqual([undefined, undefined]);
  });

  it('allows registration to retry after a failed subscription', async () => {
    resetCapacitorLifecycleForTests();
    let attempts = 0;
    const addListener = vi.fn(async (_name: 'resume', _listener: () => void) => {
      attempts += 1;
      if (attempts === 1) throw new Error('registration failed');
      return { remove: vi.fn(async () => undefined) };
    });

    await expect(registerCapacitorLifecycle({ addListener })).rejects.toThrow(
      'registration failed',
    );
    await expect(registerCapacitorLifecycle({ addListener })).resolves.toBeUndefined();
    expect(addListener).toHaveBeenCalledTimes(2);
  });
});

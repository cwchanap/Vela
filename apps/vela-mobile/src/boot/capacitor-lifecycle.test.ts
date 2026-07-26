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
});

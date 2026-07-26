import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import boot from './diagnostic-cold-entry';
import { DIAGNOSTIC_COLD_ENTRY_KEY, stageDiagnosticColdEntry } from 'src/diagnostics/cold-entry';

describe('diagnostic-cold-entry boot hook', () => {
  afterEach(() => {
    window.localStorage.removeItem(DIAGNOSTIC_COLD_ENTRY_KEY);
    vi.restoreAllMocks();
  });

  it('swallows a guard-thrown navigation failure so startup is not interrupted', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: {} },
        { path: '/diagnostics/ios-interactions/detail', component: {} },
      ],
    });
    stageDiagnosticColdEntry(window.localStorage, '/diagnostics/ios-interactions/detail');
    router.beforeEach(() => {
      throw new Error('navigation failed');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(boot({ router } as Parameters<typeof boot>[0])).resolves.toBeUndefined();

    // The staged entry is cleaned up before navigation, so no replay.
    expect(window.localStorage.getItem(DIAGNOSTIC_COLD_ENTRY_KEY)).toBeNull();
    // Vue Router also warns about the uncaught guard error; assert our boot
    // boundary logged the suppressed failure rather than asserting call count.
    expect(warn).toHaveBeenCalledWith(
      '[diagnostic-cold-entry] cold-entry navigation failed',
      expect.any(Error),
    );
  });

  it('swallows a guard-cancelled navigation failure silently', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: {} },
        { path: '/diagnostics/ios-interactions/detail', component: {} },
      ],
    });
    stageDiagnosticColdEntry(window.localStorage, '/diagnostics/ios-interactions/detail');
    // A guard returning false cancels the navigation; router.replace resolves
    // with a NavigationFailure, which replaceColdMobileRoute re-throws.
    router.beforeEach(() => false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(boot({ router } as Parameters<typeof boot>[0])).resolves.toBeUndefined();

    expect(window.localStorage.getItem(DIAGNOSTIC_COLD_ENTRY_KEY)).toBeNull();
    // NavigationFailure is expected, so it is swallowed without logging.
    expect(warn).not.toHaveBeenCalled();
  });

  it('completes normally when no cold entry is staged', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: {} }],
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(boot({ router } as Parameters<typeof boot>[0])).resolves.toBeUndefined();

    expect(warn).not.toHaveBeenCalled();
  });
});

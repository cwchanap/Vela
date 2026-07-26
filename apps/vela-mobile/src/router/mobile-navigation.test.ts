import { describe, expect, it, vi } from 'vitest';
import {
  createMemoryHistory,
  createRouter,
  isNavigationFailure,
  NavigationFailureType,
  type RouteRecordRaw,
} from 'vue-router';
import {
  backOrFallback,
  enterMobileRoute,
  pushMobileRoute,
  readMobileDepth,
  replaceColdMobileRoute,
} from './mobile-navigation';
import { mobileScrollBehavior } from './index';

const records: RouteRecordRaw[] = [
  { path: '/', component: { template: '<div>home</div>' } },
  { path: '/more', component: { template: '<div>more</div>' } },
  { path: '/detail', component: { template: '<div>detail</div>' } },
];

function makeRouter() {
  return createRouter({ history: createMemoryHistory(), routes: records });
}

describe('mobile navigation', () => {
  it('pushes unique routes and increments mobileDepth', async () => {
    const router = makeRouter();
    await router.replace({ path: '/', state: { mobileDepth: 0 } });
    await pushMobileRoute(router, '/more');
    expect(router.currentRoute.value.fullPath).toBe('/more');
    expect(readMobileDepth(router)).toBe(1);
  });

  it('does not change depth for the current fullPath', async () => {
    const router = makeRouter();
    await router.replace({ path: '/detail', state: { mobileDepth: 2 } });
    const result = await pushMobileRoute(router, '/detail');
    expect(result.kind).toBe('noop');
    expect(readMobileDepth(router)).toBe(2);
  });

  it('rejects route entry outside the allowlist', async () => {
    const router = makeRouter();
    await router.replace('/');
    const result = await enterMobileRoute(router, '/more', new Set(['/detail']));
    expect(result.kind).toBe('rejected');
    expect(router.currentRoute.value.fullPath).toBe('/');
  });

  it('pushes an allowed in-session entry with chronological depth', async () => {
    const router = makeRouter();
    await router.replace({ path: '/', state: { mobileDepth: 0 } });
    await enterMobileRoute(router, '/detail', new Set(['/detail']));
    expect(router.currentRoute.value.fullPath).toBe('/detail');
    expect(readMobileDepth(router)).toBe(1);
  });

  it('treats repeated route entry as a depth-preserving no-op', async () => {
    const router = makeRouter();
    await router.replace({ path: '/', state: { mobileDepth: 0 } });
    await enterMobileRoute(router, '/detail', new Set(['/detail']));
    const result = await enterMobileRoute(router, '/detail', new Set(['/detail']));
    expect(result.kind).toBe('noop');
    expect(readMobileDepth(router)).toBe(1);
  });

  it('replaces an allowed cold entry at depth zero', async () => {
    const router = makeRouter();
    await router.replace({ path: '/', state: { mobileDepth: 3 } });
    await replaceColdMobileRoute(router, '/detail', new Set(['/detail']));
    expect(router.currentRoute.value.fullPath).toBe('/detail');
    expect(readMobileDepth(router)).toBe(0);
  });

  it('keeps in-session entry coherent across back and forward', async () => {
    const router = makeRouter();
    await router.replace({ path: '/', state: { mobileDepth: 0 } });
    await enterMobileRoute(router, '/detail', new Set(['/detail']));

    router.back();
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/');
      expect(readMobileDepth(router)).toBe(0);
    });

    router.forward();
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/detail');
      expect(readMobileDepth(router)).toBe(1);
    });
  });

  it('rejects when a guard aborts navigation instead of reporting success', async () => {
    const router = makeRouter();
    await router.replace('/');
    router.beforeEach(() => false);
    let failure: unknown;
    try {
      await pushMobileRoute(router, '/detail');
    } catch (error) {
      failure = error;
    }
    expect(isNavigationFailure(failure, NavigationFailureType.aborted)).toBe(true);
    expect(router.currentRoute.value.fullPath).toBe('/');
  });

  it('surfaces cancellation when a newer navigation supersedes an in-flight push', async () => {
    const router = makeRouter();
    await router.replace('/');
    let releaseMore: (() => void) | undefined;
    router.beforeEach(async (to) => {
      if (to.path === '/more') {
        await new Promise<void>((resolve) => {
          releaseMore = resolve;
        });
      }
    });

    const first = pushMobileRoute(router, '/more');
    await vi.waitFor(() => expect(releaseMore).toBeTypeOf('function'));
    const second = pushMobileRoute(router, '/detail');
    releaseMore?.();

    let cancellation: unknown;
    try {
      await first;
    } catch (error) {
      cancellation = error;
    }
    expect(isNavigationFailure(cancellation, NavigationFailureType.cancelled)).toBe(true);
    await expect(second).resolves.toMatchObject({
      kind: 'pushed',
      fullPath: '/detail',
      depth: 1,
    });
  });

  it('uses browser history when app-owned depth is positive', async () => {
    const router = makeRouter();
    await router.replace({ path: '/', state: { mobileDepth: 0 } });
    await pushMobileRoute(router, '/detail');
    const result = await backOrFallback(router, '/more');
    expect(result.kind).toBe('back');
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/');
      expect(readMobileDepth(router)).toBe(0);
    });
  });

  it('surfaces an aborted back navigation instead of reporting success', async () => {
    const router = makeRouter();
    await router.replace({ path: '/', state: { mobileDepth: 0 } });
    await pushMobileRoute(router, '/detail');
    expect(readMobileDepth(router)).toBe(1);

    router.beforeEach(() => false);
    let failure: unknown;
    try {
      await backOrFallback(router, '/more');
    } catch (error) {
      failure = error;
    }
    expect(isNavigationFailure(failure, NavigationFailureType.aborted)).toBe(true);
    expect(router.currentRoute.value.fullPath).toBe('/detail');
    expect(readMobileDepth(router)).toBe(1);
  });

  it('uses fallback when app-owned depth is zero', async () => {
    const router = makeRouter();
    await router.replace({ path: '/detail', state: { mobileDepth: 0 } });
    await backOrFallback(router, '/more');
    expect(router.currentRoute.value.fullPath).toBe('/more');
    expect(readMobileDepth(router)).toBe(0);
  });

  it('rejects when router.back() is a no-op on inconsistent history state', async () => {
    vi.useFakeTimers();
    try {
      const router = makeRouter();
      // Set mobileDepth > 0 without any real prior push, so router.back() has
      // nothing to pop and afterEach never fires.
      await router.replace({ path: '/detail', state: { mobileDepth: 3 } });
      const pending = backOrFallback(router, '/more');
      // Advance past the settle timeout so the fallback rejection fires.
      vi.advanceTimersByTime(2000);
      await expect(pending).rejects.toThrow('did not produce a navigation within timeout');
      expect(router.currentRoute.value.fullPath).toBe('/detail');
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores the original route depth across back and forward', async () => {
    const router = makeRouter();
    await router.replace({ path: '/detail', state: { mobileDepth: 2 } });
    await pushMobileRoute(router, '/');
    expect(readMobileDepth(router)).toBe(3);

    router.back();
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/detail');
      expect(readMobileDepth(router)).toBe(2);
    });

    router.forward();
    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/');
      expect(readMobileDepth(router)).toBe(3);
    });
  });
});

describe('mobileScrollBehavior', () => {
  it('restores saved positions for popstate navigation', () => {
    const saved = { left: 12, top: 480 };
    expect(mobileScrollBehavior({} as never, {} as never, saved)).toEqual(saved);
  });

  it('scrolls new navigation to the top', () => {
    expect(mobileScrollBehavior({} as never, {} as never, null)).toEqual({
      left: 0,
      top: 0,
    });
  });
});

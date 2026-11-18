import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

// Spy on the history factory while keeping createRouter real so the
// router factory under test still produces a working router instance.
vi.mock('vue-router', async () => {
  const actual = await vi.importActual<typeof import('vue-router')>('vue-router');
  return {
    ...actual,
    createWebHistory: vi.fn(actual.createWebHistory),
  };
});

// Import after mock is registered so the module under test picks up the spy.
const { createWebHistory } = await import('vue-router');
const routerModule = await import('./index');
const createRouter = routerModule.default;
const { mobileScrollBehavior } = routerModule;

describe('router/index', () => {
  beforeEach(() => {
    vi.mocked(createWebHistory).mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('exports a router factory function', () => {
    expect(typeof createRouter).toBe('function');
  });

  it('returns a router instance with the scaffold routes', () => {
    const router = (createRouter as () => any)();
    expect(router).toBeDefined();
    expect(router.options.routes.length).toBeGreaterThan(0);
  });

  it('installs the exported mobile scroll behavior', () => {
    const router = (createRouter as () => any)();
    expect(router.options.scrollBehavior).toBe(mobileScrollBehavior);
  });

  it('uses a single web history factory with the Quasar router base', () => {
    vi.stubEnv('QUASAR_VUE_ROUTER_BASE', '/app/');
    const router = (createRouter as () => any)();
    expect(router).toBeDefined();
    expect(createWebHistory).toHaveBeenCalledTimes(1);
    expect(createWebHistory).toHaveBeenCalledWith('/app/');
  });
});

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

// Spy on the history factory while keeping createRouter real so the
// router factory under test still produces a working router instance.
vi.mock('vue-router', async () => {
  const actual = await vi.importActual<typeof import('vue-router')>('vue-router');
  return {
    ...actual,
    createMemoryHistory: vi.fn(actual.createMemoryHistory),
    createWebHashHistory: vi.fn(actual.createWebHashHistory),
    createWebHistory: vi.fn(actual.createWebHistory),
  };
});

// Import after mock is registered so the module under test picks up the spy.
const { createMemoryHistory, createWebHashHistory, createWebHistory } = await import('vue-router');
const routerModule = await import('./index');
const createRouter = routerModule.default;
const { mobileScrollBehavior } = routerModule;

describe('router/index', () => {
  beforeEach(() => {
    vi.mocked(createMemoryHistory).mockClear();
    vi.mocked(createWebHashHistory).mockClear();
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

  it('uses web history with the Quasar router base in history mode', () => {
    vi.stubEnv('QUASAR_VUE_ROUTER_BASE', '/app/');
    vi.stubEnv('QUASAR_VUE_ROUTER_MODE', 'history');
    const router = (createRouter as () => any)();
    expect(router).toBeDefined();
    expect(createWebHistory).toHaveBeenCalledTimes(1);
    expect(createWebHistory).toHaveBeenCalledWith('/app/');
    expect(createWebHashHistory).not.toHaveBeenCalled();
    expect(createMemoryHistory).not.toHaveBeenCalled();
  });

  it('uses hash history when the router mode is hash (Capacitor builds)', () => {
    vi.stubEnv('QUASAR_VUE_ROUTER_MODE', 'hash');
    const router = (createRouter as () => any)();
    expect(router).toBeDefined();
    expect(createWebHashHistory).toHaveBeenCalledTimes(1);
    expect(createWebHistory).not.toHaveBeenCalled();
    expect(createMemoryHistory).not.toHaveBeenCalled();
  });

  it('uses memory history on the server', () => {
    vi.stubEnv('QUASAR_SERVER', 'true');
    vi.stubEnv('QUASAR_VUE_ROUTER_MODE', 'history');
    const router = (createRouter as () => any)();
    expect(router).toBeDefined();
    expect(createMemoryHistory).toHaveBeenCalledTimes(1);
    expect(createWebHistory).not.toHaveBeenCalled();
    expect(createWebHashHistory).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

// Spy on the history factories while keeping createRouter real so the
// router factory under test still produces a working router instance.
vi.mock('vue-router', async () => {
  const actual = await vi.importActual<typeof import('vue-router')>('vue-router');
  return {
    ...actual,
    createMemoryHistory: vi.fn(actual.createMemoryHistory),
    createWebHistory: vi.fn(actual.createWebHistory),
    createWebHashHistory: vi.fn(actual.createWebHashHistory),
  };
});

// Import after mock is registered so the module under test picks up spies.
const { createMemoryHistory, createWebHistory, createWebHashHistory } = await import('vue-router');
const createRouter = (await import('./index')).default;

describe('router/index', () => {
  beforeEach(() => {
    vi.mocked(createMemoryHistory).mockClear();
    vi.mocked(createWebHistory).mockClear();
    vi.mocked(createWebHashHistory).mockClear();
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

  it('uses createMemoryHistory when SERVER is set', () => {
    vi.stubEnv('SERVER', 'true');
    const router = (createRouter as () => any)();
    expect(router).toBeDefined();
    expect(createMemoryHistory).toHaveBeenCalledTimes(1);
    expect(createWebHistory).not.toHaveBeenCalled();
    expect(createWebHashHistory).not.toHaveBeenCalled();
  });

  it('uses createWebHistory when VUE_ROUTER_MODE is "history" (no SERVER)', () => {
    vi.stubEnv('VUE_ROUTER_MODE', 'history');
    const router = (createRouter as () => any)();
    expect(router).toBeDefined();
    expect(createWebHistory).toHaveBeenCalledTimes(1);
    expect(createMemoryHistory).not.toHaveBeenCalled();
    expect(createWebHashHistory).not.toHaveBeenCalled();
  });

  it('uses createWebHashHistory by default (no SERVER, no history mode)', () => {
    const router = (createRouter as () => any)();
    expect(router).toBeDefined();
    expect(createWebHashHistory).toHaveBeenCalledTimes(1);
    expect(createMemoryHistory).not.toHaveBeenCalled();
    expect(createWebHistory).not.toHaveBeenCalled();
  });

  it('prefers SERVER over VUE_ROUTER_MODE', () => {
    vi.stubEnv('SERVER', 'true');
    vi.stubEnv('VUE_ROUTER_MODE', 'history');
    (createRouter as () => any)();
    expect(createMemoryHistory).toHaveBeenCalledTimes(1);
    expect(createWebHistory).not.toHaveBeenCalled();
  });

  it('forwards VUE_ROUTER_BASE to the chosen history factory', () => {
    vi.stubEnv('VUE_ROUTER_MODE', 'history');
    vi.stubEnv('VUE_ROUTER_BASE', '/app/');
    (createRouter as () => any)();
    expect(createWebHistory).toHaveBeenCalledWith('/app/');
  });
});

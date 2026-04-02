import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import type { RouteLocationNormalized } from 'vue-router';

// ===========================================================================
// Hoisted mocks — must run before vi.mock() factory functions are evaluated.
// ===========================================================================
const {
  mockBeforeEachCbs,
  mockCreateWebHistory,
  mockCreateWebHashHistory,
  mockCreateMemoryHistory,
  mockCreateRouter,
  mockAuthStore,
} = vi.hoisted(() => {
  const mockBeforeEachCbs: ((..._args: unknown[]) => unknown)[] = [];

  const mockRouterInstance = {
    beforeEach: (fn: (..._args: unknown[]) => unknown) => {
      mockBeforeEachCbs.push(fn);
    },
    options: {} as { history?: unknown },
  };

  const mockCreateRouter = vi.fn((options: { history?: unknown }) => {
    mockRouterInstance.options = options;
    return mockRouterInstance;
  });

  const mockCreateWebHistory = vi.fn(() => ({ _type: 'web' }));
  const mockCreateWebHashHistory = vi.fn(() => ({ _type: 'hash' }));
  const mockCreateMemoryHistory = vi.fn(() => ({ _type: 'memory' }));

  const mockAuthStore = {
    isInitialized: false,
    isAuthenticated: false,
    session: null as unknown,
    initialize: vi.fn(),
  };

  return {
    mockBeforeEachCbs,
    mockCreateWebHistory,
    mockCreateWebHashHistory,
    mockCreateMemoryHistory,
    mockCreateRouter,
    mockAuthStore,
  };
});

// ===========================================================================
// Module mocks
// ===========================================================================
vi.mock('vue-router', () => ({
  createRouter: mockCreateRouter,
  createWebHistory: mockCreateWebHistory,
  createWebHashHistory: mockCreateWebHashHistory,
  createMemoryHistory: mockCreateMemoryHistory,
}));

vi.mock('../stores/auth', () => ({
  useAuthStore: vi.fn(() => mockAuthStore),
}));

vi.mock('./routes', () => ({ default: [] }));

// ===========================================================================
// Helper
// ===========================================================================
function makeRoute(overrides: {
  path?: string;
  fullPath?: string;
  matched?: Array<{ meta: Record<string, unknown> }>;
}): RouteLocationNormalized {
  return {
    path: '/',
    fullPath: '/',
    name: undefined,
    matched: [],
    meta: {},
    query: {},
    params: {},
    hash: '',
    redirectedFrom: undefined,
    ...overrides,
  } as unknown as RouteLocationNormalized;
}

// ===========================================================================
// Tests
// ===========================================================================
describe('router/index', () => {
  let routerFactory: (..._args: unknown[]) => unknown;

  beforeEach(async () => {
    setActivePinia(createPinia());

    // Reset captured callbacks and mock call counters
    mockBeforeEachCbs.length = 0;
    mockCreateWebHistory.mockClear();
    mockCreateWebHashHistory.mockClear();
    mockCreateMemoryHistory.mockClear();
    mockCreateRouter.mockClear();
    mockAuthStore.initialize.mockReset();

    // Reset auth state
    mockAuthStore.isInitialized = false;
    mockAuthStore.isAuthenticated = false;
    mockAuthStore.session = null;

    // Reset env flags changed between tests
    delete (process.env as Record<string, string | undefined>).SERVER;
    delete (process.env as Record<string, string | undefined>).VUE_ROUTER_MODE;

    // Import the module (cached after first load; calling default({}) re-evaluates the factory)
    routerFactory = (await import('./index')).default as (..._args: unknown[]) => unknown;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // =========================================================================
  // History factory selection
  // =========================================================================
  describe('history factory selection', () => {
    it('uses createMemoryHistory when SERVER env is set', () => {
      process.env.SERVER = 'true';
      routerFactory({});
      expect(mockCreateMemoryHistory).toHaveBeenCalledTimes(1);
      expect(mockCreateWebHistory).not.toHaveBeenCalled();
      expect(mockCreateWebHashHistory).not.toHaveBeenCalled();
    });

    it('uses createWebHistory when VUE_ROUTER_MODE is "history"', () => {
      delete (process.env as Record<string, string | undefined>).SERVER;
      process.env.VUE_ROUTER_MODE = 'history';
      routerFactory({});
      expect(mockCreateWebHistory).toHaveBeenCalledTimes(1);
      expect(mockCreateMemoryHistory).not.toHaveBeenCalled();
      expect(mockCreateWebHashHistory).not.toHaveBeenCalled();
    });

    it('uses createWebHashHistory as default (no SERVER, VUE_ROUTER_MODE not "history")', () => {
      delete (process.env as Record<string, string | undefined>).SERVER;
      delete (process.env as Record<string, string | undefined>).VUE_ROUTER_MODE;
      routerFactory({});
      expect(mockCreateWebHashHistory).toHaveBeenCalledTimes(1);
      expect(mockCreateMemoryHistory).not.toHaveBeenCalled();
      expect(mockCreateWebHistory).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Navigation guard body
  // =========================================================================
  describe('navigation guard', () => {
    let guard: (..._args: unknown[]) => Promise<void>;

    beforeEach(() => {
      // Instantiate the router — this registers the beforeEach guard via our mock
      routerFactory({});
      expect(mockBeforeEachCbs).toHaveLength(1);
      guard = mockBeforeEachCbs[0] as (..._args: unknown[]) => Promise<void>;
    });

    // --- legacy /dashboard redirect ---
    it('redirects /dashboard to { name: "home" }', async () => {
      const next = vi.fn();
      await guard(makeRoute({ path: '/dashboard', fullPath: '/dashboard' }), makeRoute({}), next);
      expect(next).toHaveBeenCalledWith({ name: 'home' });
    });

    // --- auth store initialization ---
    it('initializes auth store when isInitialized is false', async () => {
      mockAuthStore.isInitialized = false;
      mockAuthStore.initialize.mockResolvedValueOnce(undefined);
      const next = vi.fn();
      await guard(makeRoute({ path: '/home', fullPath: '/home' }), makeRoute({}), next);
      expect(mockAuthStore.initialize).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalled();
    });

    it('skips authStore.initialize() when already initialized', async () => {
      mockAuthStore.isInitialized = true;
      const next = vi.fn();
      await guard(makeRoute({ path: '/home', fullPath: '/home' }), makeRoute({}), next);
      expect(mockAuthStore.initialize).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    });

    // --- requiresAuth: authenticated ---
    it('allows authenticated user through requiresAuth route', async () => {
      mockAuthStore.isInitialized = true;
      mockAuthStore.isAuthenticated = true;
      const next = vi.fn();
      await guard(
        makeRoute({
          path: '/protected',
          fullPath: '/protected',
          matched: [{ meta: { requiresAuth: true } }],
        }),
        makeRoute({}),
        next,
      );
      expect(next).toHaveBeenCalledWith();
    });

    // --- requiresAuth: unauthenticated in production (non-dev) ---
    it('redirects unauthenticated user to login when not in dev mode', async () => {
      mockAuthStore.isInitialized = true;
      mockAuthStore.isAuthenticated = false;

      // Temporarily disable dev mode so the login-redirect branch is exercised.
      // import.meta.env is a mutable plain object in Vitest.
      const origDEV = import.meta.env.DEV;
      const origVITE_DEV_MODE = import.meta.env.VITE_DEV_MODE;
      try {
        (import.meta.env as Record<string, unknown>).DEV = false;
        (import.meta.env as Record<string, unknown>).VITE_DEV_MODE = '';

        const next = vi.fn();
        await guard(
          makeRoute({
            path: '/protected',
            fullPath: '/protected',
            matched: [{ meta: { requiresAuth: true } }],
          }),
          makeRoute({}),
          next,
        );
        expect(next).toHaveBeenCalledWith({ name: 'login', query: { redirect: '/protected' } });
      } finally {
        (import.meta.env as Record<string, unknown>).DEV = origDEV;
        (import.meta.env as Record<string, unknown>).VITE_DEV_MODE = origVITE_DEV_MODE;
      }
    });

    // --- requiresAuth: dev-mode bypass ---
    it('allows unauthenticated user through requiresAuth in dev mode (dev bypass)', async () => {
      mockAuthStore.isInitialized = true;
      mockAuthStore.isAuthenticated = false;
      // import.meta.env.DEV is true by default in Vitest — the dev bypass fires
      const next = vi.fn();
      await guard(
        makeRoute({
          path: '/protected',
          fullPath: '/protected',
          matched: [{ meta: { requiresAuth: true } }],
        }),
        makeRoute({}),
        next,
      );
      // Dev bypass calls next() without arguments and returns
      expect(next).toHaveBeenCalledWith();
      expect(next).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'login' }));
    });

    // --- requiresGuest ---
    it('redirects user with a session away from guest-only route', async () => {
      mockAuthStore.isInitialized = true;
      mockAuthStore.session = { tokens: 'mock' };
      const next = vi.fn();
      await guard(
        makeRoute({
          path: '/login',
          fullPath: '/login',
          matched: [{ meta: { requiresGuest: true } }],
        }),
        makeRoute({}),
        next,
      );
      expect(next).toHaveBeenCalledWith({ name: 'home' });
    });

    it('allows user without session to access guest-only route', async () => {
      mockAuthStore.isInitialized = true;
      mockAuthStore.session = null;
      const next = vi.fn();
      await guard(
        makeRoute({
          path: '/login',
          fullPath: '/login',
          matched: [{ meta: { requiresGuest: true } }],
        }),
        makeRoute({}),
        next,
      );
      expect(next).toHaveBeenCalledWith();
    });

    // --- error handling ---
    it('falls back to next() and logs an error when the guard throws', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockAuthStore.isInitialized = false;
      mockAuthStore.initialize.mockRejectedValueOnce(new Error('boom'));
      const next = vi.fn();
      await guard(makeRoute({ path: '/home', fullPath: '/home' }), makeRoute({}), next);
      expect(consoleSpy).toHaveBeenCalledWith('Router guard error:', expect.any(Error));
      expect(next).toHaveBeenCalledWith();
      consoleSpy.mockRestore();
    });
  });
});

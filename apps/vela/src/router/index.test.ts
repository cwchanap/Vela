import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import type { RouteLocationNormalized } from 'vue-router';

// ===========================================================================
// Hoisted mocks — must run before vi.mock() factory functions are evaluated.
// ===========================================================================
const { mockBeforeEachCbs, mockCreateWebHistory, mockCreateRouter, mockAuthStore } = vi.hoisted(
  () => {
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

    const mockAuthStore = {
      isInitialized: false,
      isAuthenticated: false,
      session: null as unknown,
      initialize: vi.fn(),
    };

    return {
      mockBeforeEachCbs,
      mockCreateWebHistory,
      mockCreateRouter,
      mockAuthStore,
    };
  },
);

// ===========================================================================
// Module mocks
// ===========================================================================
vi.mock('vue-router', () => ({
  createRouter: mockCreateRouter,
  createWebHistory: mockCreateWebHistory,
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
    mockCreateRouter.mockClear();
    mockAuthStore.initialize.mockReset();

    // Reset auth state
    mockAuthStore.isInitialized = false;
    mockAuthStore.isAuthenticated = false;
    mockAuthStore.session = null;

    // Import the module (cached after first load; calling default({}) re-evaluates the factory)
    routerFactory = (await import('./index')).default as (..._args: unknown[]) => unknown;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // =========================================================================
  // History setup
  // =========================================================================
  describe('history', () => {
    it('uses a single web history factory with the Quasar router base', () => {
      vi.stubEnv('QUASAR_VUE_ROUTER_BASE', '/app/');
      routerFactory({});
      expect(mockCreateWebHistory).toHaveBeenCalledTimes(1);
      expect(mockCreateWebHistory).toHaveBeenCalledWith('/app/');
      expect(mockCreateRouter).toHaveBeenCalledTimes(1);
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
      // Runtime invariant: router must register exactly one guard
      if (mockBeforeEachCbs.length !== 1) {
        throw new Error(`Expected exactly 1 guard, got ${mockBeforeEachCbs.length}`);
      }
      guard = mockBeforeEachCbs[0] as (..._args: unknown[]) => Promise<void>;
    });

    it('keeps a valid session on a protected route when profile loading failed', async () => {
      mockAuthStore.isInitialized = true;
      mockAuthStore.session = { user: { id: 'user-1' } };
      const next = vi.fn();
      await guard(
        makeRoute({ path: '/settings', matched: [{ meta: { requiresAuth: true } }] }),
        makeRoute({}),
        next,
      );
      expect(next).toHaveBeenCalledWith();
    });

    // --- legacy /dashboard redirect ---
    it('redirects /dashboard to { name: "home" }', async () => {
      const next = vi.fn();
      await guard(makeRoute({ path: '/dashboard', fullPath: '/dashboard' }), makeRoute({}), next);
      expect(next).toHaveBeenCalledWith({ name: 'home' });
      expect(next).toHaveBeenCalledTimes(1);
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

    // --- requiresAuth: unauthenticated ---
    it('redirects unauthenticated user from a requiresAuth route to login', async () => {
      mockAuthStore.isInitialized = true;
      mockAuthStore.isAuthenticated = false;

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
      expect(next).toHaveBeenCalledTimes(1);
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
      expect(next).toHaveBeenCalledTimes(1);
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

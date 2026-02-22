import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const mockAuthService = {
  getCurrentSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  getUserProfile: vi.fn(),
  signUp: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  confirmSignUp: vi.fn(),
  resendSignUpCode: vi.fn(),
  resetPassword: vi.fn(),
  updatePassword: vi.fn(),
  updateUserProfile: vi.fn(),
};

vi.mock('../services/authService', () => ({
  authService: mockAuthService,
}));

const mockQueryClient = {
  getQueryState: vi.fn(() => null),
  getQueryData: vi.fn(() => null),
  setQueryData: vi.fn(),
  invalidateQueries: vi.fn(),
  clear: vi.fn(),
};

vi.mock('../boot/query', () => ({
  queryClient: mockQueryClient,
  QUERY_STALE_TIME: 300000,
}));

vi.mock('@vela/common', () => ({
  authKeys: {
    session: () => ['auth', 'session'],
    user: () => ['auth', 'user'],
    profile: (id: string) => ['auth', 'profile', id],
  },
}));

const mockSession = {
  user: { id: 'user-123', email: 'test@example.com' },
  accessToken: 'access-token',
  idToken: 'id-token',
};

const mockProfile = {
  id: 'user-123',
  email: 'test@example.com',
  username: 'testuser',
  avatar_url: null,
  current_level: 1,
  total_experience: 0,
  learning_streak: 0,
  native_language: 'en',
  preferences: {},
  last_activity: null,
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

const makeUser = (overrides = {}) => ({
  id: 'user-123',
  email: 'test@example.com',
  current_level: 1,
  total_experience: 0,
  learning_streak: 0,
  native_language: 'en',
  preferences: {},
  created_at: '',
  updated_at: '',
  ...overrides,
});

describe('useAuthStore', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('has correct initial state', async () => {
    const { useAuthStore } = await import('./auth');
    const store = useAuthStore();
    expect(store.user).toBeNull();
    expect(store.session).toBeNull();
    expect(store.isLoading).toBe(false);
    expect(store.error).toBeNull();
    expect(store.isInitialized).toBe(false);
    expect(store.isAuthenticated).toBe(false);
  });

  describe('computed getters', () => {
    it('isAuthenticated is true when user and session are both set', async () => {
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      store.setUser(makeUser());
      store.setSession(mockSession);
      expect(store.isAuthenticated).toBe(true);
    });

    it('isAuthenticated is false when only user is set', async () => {
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      store.setUser(makeUser());
      expect(store.isAuthenticated).toBe(false);
    });

    it('userName falls back to email prefix when no username', async () => {
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      store.setUser(makeUser({ email: 'hello@example.com', username: undefined }));
      expect(store.userName).toBe('hello');
    });

    it('userName uses username when set', async () => {
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      store.setUser(makeUser({ username: 'myname' }));
      expect(store.userName).toBe('myname');
    });

    it('userLevel defaults to 1 when no user', async () => {
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      expect(store.userLevel).toBe(1);
    });
  });

  describe('clearAuth', () => {
    it('resets all auth state', async () => {
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      store.setUser(makeUser());
      store.setSession(mockSession);
      store.setError('some error');
      store.setLoading(true);
      store.clearAuth();
      expect(store.user).toBeNull();
      expect(store.session).toBeNull();
      expect(store.error).toBeNull();
      expect(store.isLoading).toBe(false);
    });
  });

  describe('signIn', () => {
    it('returns true and invalidates 3 queries on success', async () => {
      mockAuthService.signIn.mockResolvedValueOnce({
        success: true,
        user: { id: 'user-123', email: 'test@example.com' },
      });
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      const result = await store.signIn({ email: 'test@example.com', password: 'password' });
      expect(result).toBe(true);
      expect(mockQueryClient.invalidateQueries).toHaveBeenCalledTimes(3);
    });

    it('returns false and sets error on failure', async () => {
      mockAuthService.signIn.mockResolvedValueOnce({
        success: false,
        error: 'Invalid credentials',
      });
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      const result = await store.signIn({ email: 'bad@example.com', password: 'wrong' });
      expect(result).toBe(false);
      expect(store.error).toBe('Invalid credentials');
    });

    it('sets pendingVerificationEmail when user is not confirmed', async () => {
      mockAuthService.signIn.mockResolvedValueOnce({
        success: false,
        error: 'User is not confirmed',
        user: { email: 'unconfirmed@example.com' },
      });
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      await store.signIn({ email: 'unconfirmed@example.com', password: 'password' });
      expect(store.pendingVerificationEmail).toBe('unconfirmed@example.com');
    });

    it('sets isLoading to false after completion', async () => {
      mockAuthService.signIn.mockResolvedValueOnce({
        success: true,
        user: { id: 'u1', email: 'a@b.com' },
      });
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      await store.signIn({ email: 'a@b.com', password: 'pass' });
      expect(store.isLoading).toBe(false);
    });
  });

  describe('signOut', () => {
    it('clears auth state and query cache on success', async () => {
      mockAuthService.signOut.mockResolvedValueOnce({ success: true });
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      store.setUser(makeUser());
      store.setSession(mockSession);
      const result = await store.signOut();
      expect(result).toBe(true);
      expect(store.user).toBeNull();
      expect(store.session).toBeNull();
      expect(mockQueryClient.clear).toHaveBeenCalledTimes(1);
    });

    it('returns false and sets error on failure', async () => {
      mockAuthService.signOut.mockResolvedValueOnce({ success: false, error: 'Sign out failed' });
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      const result = await store.signOut();
      expect(result).toBe(false);
      expect(store.error).toBe('Sign out failed');
    });
  });

  describe('signUp', () => {
    it('returns true on success', async () => {
      mockAuthService.signUp.mockResolvedValueOnce({ success: true });
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      const result = await store.signUp({
        email: 'new@example.com',
        password: 'password',
        username: 'newuser',
      });
      expect(result).toBe(true);
    });

    it('returns false and sets error on failure', async () => {
      mockAuthService.signUp.mockResolvedValueOnce({ success: false, error: 'Email in use' });
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      const result = await store.signUp({
        email: 'existing@example.com',
        password: 'password',
        username: 'u',
      });
      expect(result).toBe(false);
      expect(store.error).toBe('Email in use');
    });
  });

  describe('resetPassword', () => {
    it('returns true on success', async () => {
      mockAuthService.resetPassword.mockResolvedValueOnce({ success: true });
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      const result = await store.resetPassword('test@example.com');
      expect(result).toBe(true);
    });

    it('returns false and sets error on failure', async () => {
      mockAuthService.resetPassword.mockResolvedValueOnce({
        success: false,
        error: 'User not found',
      });
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      const result = await store.resetPassword('noone@example.com');
      expect(result).toBe(false);
      expect(store.error).toBe('User not found');
    });
  });

  describe('initialize', () => {
    it('does not reinitialize if already initialized', async () => {
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      store.setInitialized(true);
      await store.initialize();
      expect(mockAuthService.getCurrentSession).not.toHaveBeenCalled();
    });

    it('sets isInitialized to true when session does not exist', async () => {
      mockAuthService.getCurrentSession.mockResolvedValueOnce(null);
      mockAuthService.onAuthStateChange.mockImplementation(() => {});
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      await store.initialize();
      expect(store.isInitialized).toBe(true);
      expect(store.user).toBeNull();
    });

    it('loads user profile when session exists', async () => {
      mockAuthService.getCurrentSession.mockResolvedValueOnce(mockSession);
      mockAuthService.onAuthStateChange.mockImplementation(() => {});
      mockAuthService.getUserProfile.mockResolvedValueOnce(mockProfile);
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      await store.initialize();
      expect(store.isInitialized).toBe(true);
      expect(store.user?.id).toBe('user-123');
    });
  });

  describe('updateProfile', () => {
    it('returns false and sets error when no user is logged in', async () => {
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      const result = await store.updateProfile({ username: 'new' });
      expect(result).toBe(false);
      expect(store.error).toBe('No user logged in');
    });

    it('returns true and invalidates profile query on success', async () => {
      mockAuthService.updateUserProfile.mockResolvedValueOnce({ success: true });
      mockAuthService.getUserProfile.mockResolvedValueOnce({ ...mockProfile, username: 'updated' });
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      store.setUser(makeUser());
      const result = await store.updateProfile({ username: 'updated' });
      expect(result).toBe(true);
      expect(mockQueryClient.invalidateQueries).toHaveBeenCalledTimes(1);
    });
  });

  describe('confirmSignUp', () => {
    it('returns true on success', async () => {
      mockAuthService.confirmSignUp.mockResolvedValueOnce({ success: true });
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      const result = await store.confirmSignUp('test@example.com', '123456');
      expect(result).toBe(true);
    });

    it('returns false and sets error on failure', async () => {
      mockAuthService.confirmSignUp.mockResolvedValueOnce({
        success: false,
        error: 'Invalid code',
      });
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      const result = await store.confirmSignUp('test@example.com', 'wrong');
      expect(result).toBe(false);
      expect(store.error).toBe('Invalid code');
    });
  });
});

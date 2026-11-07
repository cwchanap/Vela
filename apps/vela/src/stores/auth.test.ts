import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const mockAuthService = {
  getCurrentSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  getUserProfile: vi.fn(),
  signInWithGoogle: vi.fn(),
  signOut: vi.fn(),
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

const AUTH_REDIRECT_STORAGE_KEY = 'vela.auth.redirectTo';

describe('useAuthStore', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.resetModules();
    window.sessionStorage.clear();
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

  describe('signInWithGoogle', () => {
    it('returns true after starting Google Hosted UI sign in', async () => {
      mockAuthService.signInWithGoogle.mockResolvedValueOnce(undefined);
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      const result = await store.signInWithGoogle();
      expect(result).toBe(true);
      expect(mockAuthService.signInWithGoogle).toHaveBeenCalledTimes(1);
    });

    it('sets isLoading to false after completion', async () => {
      mockAuthService.signInWithGoogle.mockResolvedValueOnce(undefined);
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      await store.signInWithGoogle();
      expect(store.isLoading).toBe(false);
    });

    it('stores the internal redirect before starting Hosted UI sign in', async () => {
      mockAuthService.signInWithGoogle.mockResolvedValueOnce(undefined);
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();

      await store.signInWithGoogle('/progress?tab=weekly');

      expect(window.sessionStorage.getItem(AUTH_REDIRECT_STORAGE_KEY)).toBe('/progress?tab=weekly');
    });

    it('sanitizes external redirects before storing Hosted UI state', async () => {
      mockAuthService.signInWithGoogle.mockResolvedValueOnce(undefined);
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();

      await store.signInWithGoogle('https://example.com/phishing');

      expect(window.sessionStorage.getItem(AUTH_REDIRECT_STORAGE_KEY)).toBe('/');
    });

    it('clears the pending redirect when Hosted UI start fails', async () => {
      mockAuthService.signInWithGoogle.mockRejectedValueOnce(new Error('network'));
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();

      await store.signInWithGoogle('/progress');

      expect(window.sessionStorage.getItem(AUTH_REDIRECT_STORAGE_KEY)).toBeNull();
    });

    it('consumes and clears the pending Hosted UI redirect', async () => {
      window.sessionStorage.setItem(AUTH_REDIRECT_STORAGE_KEY, '/progress');
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();

      expect(store.consumePendingAuthRedirect('/settings')).toBe('/progress');
      expect(window.sessionStorage.getItem(AUTH_REDIRECT_STORAGE_KEY)).toBeNull();
    });

    it('returns false and sets generic error on exception', async () => {
      mockAuthService.signInWithGoogle.mockRejectedValueOnce(new Error('network'));
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      const result = await store.signInWithGoogle();
      expect(result).toBe(false);
      expect(store.error).toBe('network');
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

    it('returns false and sets generic error on exception', async () => {
      mockAuthService.signOut.mockRejectedValueOnce(new Error('network'));
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      const result = await store.signOut();
      expect(result).toBe(false);
      expect(store.error).toContain('unexpected error');
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

    it('sets error and does not set isInitialized when getCurrentSession rejects', async () => {
      mockAuthService.getCurrentSession.mockRejectedValueOnce(new Error('network error'));
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      await store.initialize();
      expect(store.error).toBe('Failed to initialize authentication');
      expect(store.isInitialized).toBe(false);
      expect(store.isLoading).toBe(false);
    });

    it('onAuthStateChange callback with session sets session and loads profile', async () => {
      let capturedCallback: ((_event: string, _session: unknown) => void) | null = null;
      mockAuthService.getCurrentSession.mockResolvedValueOnce(null);
      mockAuthService.onAuthStateChange.mockImplementation(
        (cb: (_event: string, _session: unknown) => void) => {
          capturedCallback = cb;
        },
      );
      mockAuthService.getUserProfile.mockResolvedValueOnce(mockProfile);
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      await store.initialize();

      expect(capturedCallback).not.toBeNull();
      capturedCallback!('SIGNED_IN', mockSession);

      await vi.waitFor(() => {
        expect(store.user?.id).toBe('user-123');
      });
      expect(store.session).toEqual(mockSession);
    });

    it('onAuthStateChange callback with null session clears auth', async () => {
      let capturedCallback: ((_event: string, _session: unknown) => void) | null = null;
      mockAuthService.getCurrentSession.mockResolvedValueOnce(null);
      mockAuthService.onAuthStateChange.mockImplementation(
        (cb: (_event: string, _session: unknown) => void) => {
          capturedCallback = cb;
        },
      );
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      await store.initialize();
      store.setUser(makeUser());
      store.setSession(mockSession);

      capturedCallback!('SIGNED_OUT', null);

      await vi.waitFor(() => {
        expect(store.user).toBeNull();
      });
      expect(store.session).toBeNull();
    });

    it('onAuthStateChange callback with OAUTH_FAILURE sets error', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      let capturedCallback: ((_event: string, _session: unknown) => void) | null = null;
      mockAuthService.getCurrentSession.mockResolvedValueOnce(null);
      mockAuthService.onAuthStateChange.mockImplementation(
        (cb: (_event: string, _session: unknown) => void) => {
          capturedCallback = cb;
        },
      );
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      await store.initialize();

      capturedCallback!('OAUTH_FAILURE', null);

      await vi.waitFor(() => {
        expect(store.error).toBe('Sign-in failed. Please try again.');
      });
      expect(consoleSpy).toHaveBeenCalledWith('OAuth sign-in failed');
      expect(store.user).toBeNull();
      expect(store.session).toBeNull();
    });

    it('onAuthStateChange callback with TOKEN_REFRESH_FAILURE logs error without changing state', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      let capturedCallback: ((_event: string, _session: unknown) => void) | null = null;
      mockAuthService.getCurrentSession.mockResolvedValueOnce(null);
      mockAuthService.onAuthStateChange.mockImplementation(
        (cb: (_event: string, _session: unknown) => void) => {
          capturedCallback = cb;
        },
      );
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      await store.initialize();
      store.setUser(makeUser());
      store.setSession(mockSession);

      capturedCallback!('TOKEN_REFRESH_FAILURE', null);

      await vi.waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith('Token refresh failed');
      });
      // State should remain unchanged
      expect(store.user).not.toBeNull();
      expect(store.session).not.toBeNull();
      expect(store.error).toBeNull();
    });
  });

  describe('loadUserProfile', () => {
    it('sets error when getUserProfile rejects', async () => {
      mockAuthService.getUserProfile.mockRejectedValueOnce(new Error('network'));
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      await store.loadUserProfile('user-123');
      expect(store.error).toBe('Failed to load user profile');
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

    it('returns false and sets error when service returns failure response', async () => {
      mockAuthService.updateUserProfile.mockResolvedValueOnce({
        success: false,
        error: 'Update rejected',
      });
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      store.setUser(makeUser());
      const result = await store.updateProfile({ username: 'new' });
      expect(result).toBe(false);
      expect(store.error).toBe('Update rejected');
    });

    it('returns false and sets generic error when service throws', async () => {
      mockAuthService.updateUserProfile.mockRejectedValueOnce(new Error('Network failure'));
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      store.setUser(makeUser());
      const result = await store.updateProfile({ username: 'new' });
      expect(result).toBe(false);
      expect(store.error).toBe('An unexpected error occurred during profile update');
    });
  });

  describe('updateExperience', () => {
    it('returns false when no user is logged in', async () => {
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      const result = await store.updateExperience(100);
      expect(result).toBe(false);
    });

    it('updates experience and level on success', async () => {
      mockAuthService.updateUserProfile.mockResolvedValueOnce({ success: true });
      mockAuthService.getUserProfile.mockResolvedValueOnce({
        ...mockProfile,
        total_experience: 1100,
        current_level: 2,
      });
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      store.setUser(makeUser({ total_experience: 900, current_level: 1 }));
      const result = await store.updateExperience(200);
      expect(result).toBe(true);
      expect(store.user?.total_experience).toBe(1100);
      // Math.floor(1100 / 1000) + 1 = 2
      expect(store.user?.current_level).toBe(2);
    });

    it('returns false on exception', async () => {
      mockAuthService.updateUserProfile.mockRejectedValueOnce(new Error('network'));
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      store.setUser(makeUser());
      const result = await store.updateExperience(100);
      expect(result).toBe(false);
    });
  });

  describe('updateStreak', () => {
    it('returns false when no user is logged in', async () => {
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      const result = await store.updateStreak();
      expect(result).toBe(false);
    });

    it('increments learning streak on success with default increment=true', async () => {
      mockAuthService.updateUserProfile.mockResolvedValueOnce({ success: true });
      mockAuthService.getUserProfile.mockResolvedValueOnce({ ...mockProfile, learning_streak: 4 });
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      store.setUser(makeUser({ learning_streak: 3 }));
      const result = await store.updateStreak();
      expect(result).toBe(true);
      expect(store.user?.learning_streak).toBe(4);
    });

    it('resets learning streak when increment=false', async () => {
      mockAuthService.updateUserProfile.mockResolvedValueOnce({ success: true });
      mockAuthService.getUserProfile.mockResolvedValueOnce({ ...mockProfile, learning_streak: 0 });
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      store.setUser(makeUser({ learning_streak: 5 }));
      const result = await store.updateStreak(false);
      expect(result).toBe(true);
      expect(store.user?.learning_streak).toBe(0);
    });

    it('returns false on exception', async () => {
      mockAuthService.updateUserProfile.mockRejectedValueOnce(new Error('network'));
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      store.setUser(makeUser());
      const result = await store.updateStreak();
      expect(result).toBe(false);
    });
  });

  describe('updatePreferences', () => {
    it('returns false when no user is logged in', async () => {
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      const result = await store.updatePreferences({ dailyGoal: 30 });
      expect(result).toBe(false);
    });

    it('updates user preferences on success', async () => {
      const updatedPrefs = { dailyGoal: 60, dailyLessonGoal: 10 };
      mockAuthService.updateUserProfile.mockResolvedValueOnce({ success: true });
      mockAuthService.getUserProfile.mockResolvedValueOnce({
        ...mockProfile,
        preferences: updatedPrefs,
      });
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      store.setUser(makeUser({ preferences: { dailyGoal: 30 } }));
      const result = await store.updatePreferences({ dailyGoal: 60 });
      expect(result).toBe(true);
      expect(store.user?.preferences).toMatchObject({ dailyGoal: 60 });
    });

    it('returns false on exception', async () => {
      mockAuthService.updateUserProfile.mockRejectedValueOnce(new Error('network'));
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      store.setUser(makeUser({ preferences: {} }));
      const result = await store.updatePreferences({ dailyGoal: 30 });
      expect(result).toBe(false);
    });
  });

  describe('account transition guards', () => {
    it('does not merge an in-flight updatePreferences into a different account', async () => {
      let resolveUpdate!: (_v: { success: boolean }) => void;
      mockAuthService.updateUserProfile.mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolveUpdate = res;
          }),
      );
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      store.setSession({ user: { id: 'user-a', email: 'a@example.com' }, provider: 'cognito' });
      store.setUser(makeUser({ id: 'user-a', preferences: { dailyGoal: 30 } }));

      const pending = store.updatePreferences({ dailyGoal: 60 });
      store.setSession({ user: { id: 'user-b', email: 'b@example.com' }, provider: 'cognito' });
      store.setUser(makeUser({ id: 'user-b', preferences: { dailyGoal: 10 } }));
      resolveUpdate({ success: true });

      const result = await pending;
      expect(result).toBe(false);
      expect(store.user?.id).toBe('user-b');
      expect(store.user?.preferences).toMatchObject({ dailyGoal: 10 });
    });

    it('returns false and keeps error clear when the user signs out mid-request', async () => {
      let resolveUpdate!: (_v: { success: boolean }) => void;
      mockAuthService.updateUserProfile.mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolveUpdate = res;
          }),
      );
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      store.setSession({ user: { id: 'user-a', email: 'a@example.com' }, provider: 'cognito' });
      store.setUser(makeUser({ id: 'user-a', preferences: { dailyGoal: 30 } }));

      const pending = store.updatePreferences({ dailyGoal: 60 });
      store.setSession(null);
      store.setUser(null);
      resolveUpdate({ success: true });

      const result = await pending;
      expect(result).toBe(false);
      expect(store.user).toBeNull();
      expect(store.error).toBeNull();
    });

    it('does not commit an in-flight updateExperience to a different account', async () => {
      let resolveUpdate!: (_v: { success: boolean }) => void;
      mockAuthService.updateUserProfile.mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolveUpdate = res;
          }),
      );
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      store.setSession({ user: { id: 'user-a', email: 'a@example.com' }, provider: 'cognito' });
      store.setUser(makeUser({ id: 'user-a', total_experience: 900 }));

      const pending = store.updateExperience(200);
      store.setSession({ user: { id: 'user-b', email: 'b@example.com' }, provider: 'cognito' });
      store.setUser(makeUser({ id: 'user-b', total_experience: 0 }));
      resolveUpdate({ success: true });

      const result = await pending;
      expect(result).toBe(false);
      expect(store.user?.id).toBe('user-b');
      expect(store.user?.total_experience).toBe(0);
    });

    it('does not commit a loadUserProfile response for a different session user', async () => {
      let resolveGet!: (_v: unknown) => void;
      mockAuthService.getUserProfile.mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolveGet = res;
          }),
      );
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      store.setSession({ user: { id: 'user-a', email: 'a@example.com' }, provider: 'cognito' });

      const pending = store.loadUserProfile('user-a');
      store.setSession({ user: { id: 'user-b', email: 'b@example.com' }, provider: 'cognito' });
      store.setUser(makeUser({ id: 'user-b' }));
      resolveGet({ ...mockProfile, id: 'user-a' });

      await pending;
      expect(store.user?.id).toBe('user-b');
    });

    it('commits a loadUserProfile response when the session still matches', async () => {
      mockAuthService.getUserProfile.mockResolvedValueOnce({
        ...mockProfile,
        id: 'user-a',
      });
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      store.setSession({ user: { id: 'user-a', email: 'a@example.com' }, provider: 'cognito' });

      await store.loadUserProfile('user-a');
      expect(store.user?.id).toBe('user-a');
      expect(store.user?.username).toBe('testuser');
    });

    it('does not commit a loadUserProfile response after sign-out', async () => {
      let resolveGet!: (_v: unknown) => void;
      mockAuthService.getUserProfile.mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolveGet = res;
          }),
      );
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      store.setSession({ user: { id: 'user-a', email: 'a@example.com' }, provider: 'cognito' });
      store.setUser(makeUser({ id: 'user-a' }));

      const pending = store.loadUserProfile('user-a');
      store.setSession(null);
      store.setUser(null);
      resolveGet({ ...mockProfile, id: 'user-a' });

      await pending;
      expect(store.user).toBeNull();
    });

    it('exposes a session generation that changes across session boundaries only', async () => {
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      const g0 = store.sessionGeneration;

      store.setSession({ user: { id: 'user-a', email: 'a@example.com' }, provider: 'cognito' });
      const g1 = store.sessionGeneration;
      expect(g1).not.toBe(g0);

      store.setSession({ user: { id: 'user-a', email: 'a@example.com' }, provider: 'cognito' });
      expect(store.sessionGeneration).toBe(g1);

      store.setSession(null);
      const g2 = store.sessionGeneration;
      expect(g2).not.toBe(g1);

      store.setSession({ user: { id: 'user-a', email: 'a@example.com' }, provider: 'cognito' });
      const g3 = store.sessionGeneration;
      expect(g3).not.toBe(g2);
      expect(g3).not.toBe(g1);
    });

    it('does not merge an in-flight updatePreferences after same-account re-authentication', async () => {
      let resolveUpdate!: (_v: { success: boolean }) => void;
      mockAuthService.updateUserProfile.mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolveUpdate = res;
          }),
      );
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      store.setSession({ user: { id: 'user-a', email: 'a@example.com' }, provider: 'cognito' });
      store.setUser(makeUser({ id: 'user-a', preferences: { dailyGoal: 30 } }));

      const pending = store.updatePreferences({ dailyGoal: 60 });
      store.setSession(null);
      store.setUser(null);
      store.setSession({ user: { id: 'user-a', email: 'a@example.com' }, provider: 'cognito' });
      store.setUser(makeUser({ id: 'user-a', preferences: { dailyGoal: 5 } }));
      resolveUpdate({ success: true });

      const result = await pending;
      expect(result).toBe(false);
      expect(store.user?.id).toBe('user-a');
      expect(store.user?.preferences).toMatchObject({ dailyGoal: 5 });
    });

    it('does not commit an in-flight updateExperience after same-account re-authentication', async () => {
      let resolveUpdate!: (_v: { success: boolean }) => void;
      mockAuthService.updateUserProfile.mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolveUpdate = res;
          }),
      );
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      store.setSession({ user: { id: 'user-a', email: 'a@example.com' }, provider: 'cognito' });
      store.setUser(makeUser({ id: 'user-a', total_experience: 900 }));

      const pending = store.updateExperience(200);
      store.setSession(null);
      store.setUser(null);
      store.setSession({ user: { id: 'user-a', email: 'a@example.com' }, provider: 'cognito' });
      store.setUser(makeUser({ id: 'user-a', total_experience: 42 }));
      resolveUpdate({ success: true });

      const result = await pending;
      expect(result).toBe(false);
      expect(store.user?.id).toBe('user-a');
      expect(store.user?.total_experience).toBe(42);
    });

    it('does not commit a loadUserProfile response after same-account re-authentication', async () => {
      let resolveGet!: (_v: unknown) => void;
      mockAuthService.getUserProfile.mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolveGet = res;
          }),
      );
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      store.setSession({ user: { id: 'user-a', email: 'a@example.com' }, provider: 'cognito' });
      store.setUser(makeUser({ id: 'user-a', preferences: { dailyGoal: 11 } }));

      const pending = store.loadUserProfile('user-a');
      store.setSession(null);
      store.setUser(null);
      store.setSession({ user: { id: 'user-a', email: 'a@example.com' }, provider: 'cognito' });
      store.setUser(makeUser({ id: 'user-a', preferences: { dailyGoal: 7 } }));
      resolveGet({ ...mockProfile, id: 'user-a' });

      await pending;
      expect(store.user?.preferences).toMatchObject({ dailyGoal: 7 });
    });

    it('returns false when updateProfile completes after same-account re-authentication', async () => {
      let resolveUpdate!: (_v: { success: boolean }) => void;
      mockAuthService.updateUserProfile.mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolveUpdate = res;
          }),
      );
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      store.setSession({ user: { id: 'user-a', email: 'a@example.com' }, provider: 'cognito' });
      store.setUser(makeUser({ id: 'user-a', preferences: { dailyGoal: 30 } }));

      const pending = store.updateProfile({ preferences: { dailyGoal: 60 } });
      store.setSession(null);
      store.setUser(null);
      store.setSession({ user: { id: 'user-a', email: 'a@example.com' }, provider: 'cognito' });
      store.setUser(makeUser({ id: 'user-a', preferences: { dailyGoal: 5 } }));
      resolveUpdate({ success: true });

      const result = await pending;
      expect(result).toBe(false);
      expect(store.user?.id).toBe('user-a');
      expect(store.user?.preferences).toMatchObject({ dailyGoal: 5 });
    });

    it('returns false when the session changes during the updateProfile reload', async () => {
      let resolveUpdate!: (_v: { success: boolean }) => void;
      mockAuthService.updateUserProfile.mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolveUpdate = res;
          }),
      );
      let resolveGet!: (_v: unknown) => void;
      const pendingProfile = new Promise((res) => {
        resolveGet = res;
      });
      mockAuthService.getUserProfile.mockImplementationOnce(() => pendingProfile);
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      store.setSession({ user: { id: 'user-a', email: 'a@example.com' }, provider: 'cognito' });
      store.setUser(makeUser({ id: 'user-a', preferences: { dailyGoal: 30 } }));

      const pending = store.updateProfile({ preferences: { dailyGoal: 60 } });
      resolveUpdate({ success: true });
      await Promise.resolve();

      void pendingProfile.then(() => {
        store.setSession(null);
        store.setUser(null);
      });
      resolveGet({ ...mockProfile, id: 'user-a' });

      const result = await pending;
      expect(result).toBe(false);
      expect(store.user).toBeNull();
    });

    it('does not set error or overwrite loading when update fails after session transition', async () => {
      let rejectUpdate!: (_v: unknown) => void;
      mockAuthService.updateUserProfile.mockImplementationOnce(
        () =>
          new Promise((_, rej) => {
            rejectUpdate = rej;
          }),
      );
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      store.setSession({ user: { id: 'user-a', email: 'a@example.com' }, provider: 'cognito' });
      store.setUser(makeUser({ id: 'user-a', preferences: { dailyGoal: 30 } }));

      const pending = store.updateProfile({ preferences: { dailyGoal: 60 } });

      // Session transitions before the request fails
      store.clearAuth();
      store.setLoading(true); // e.g. a new sign-in starts

      rejectUpdate(new Error('Network error'));
      const result = await pending;

      expect(result).toBe(false);
      expect(store.error).toBeNull();
      expect(store.isLoading).toBe(true);
    });

    it('clears previous user and maintains loading until new profile loads when switching accounts during pending updateProfile', async () => {
      let resolveUpdate!: (_v: { success: boolean }) => void;
      mockAuthService.updateUserProfile.mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolveUpdate = res;
          }),
      );
      mockAuthService.getUserProfile.mockResolvedValueOnce({
        ...mockProfile,
        id: 'user-b',
        email: 'b@example.com',
      });
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      store.setSession({ user: { id: 'user-a', email: 'a@example.com' }, provider: 'cognito' });
      store.setUser(makeUser({ id: 'user-a', preferences: { dailyGoal: 30 } }));

      const pending = store.updateProfile({ preferences: { dailyGoal: 60 } });
      expect(store.isLoading).toBe(true);

      // Account switches directly to user-b while update is in flight
      store.setSession({ user: { id: 'user-b', email: 'b@example.com' }, provider: 'cognito' });
      expect(store.user).toBeNull();
      expect(store.isLoading).toBe(true);

      // New user profile loads
      await store.loadUserProfile('user-b');
      expect(store.user?.id).toBe('user-b');
      expect(store.isLoading).toBe(false);

      resolveUpdate({ success: true });
      const result = await pending;

      expect(result).toBe(false);
      expect(store.isLoading).toBe(false);
    });

    it('clears user.value on account switch so user A profile is not retained if user B profile fails to load', async () => {
      mockAuthService.getUserProfile.mockRejectedValueOnce(new Error('Profile fetch failed'));
      const { useAuthStore } = await import('./auth');
      const store = useAuthStore();
      store.setSession({ user: { id: 'user-a', email: 'a@example.com' }, provider: 'cognito' });
      store.setUser(
        makeUser({
          id: 'user-a',
          preferences: { llm: { keys: { google: 'user-a-secret-key' } } },
        }),
      );

      // Switch to user-b: user A profile must be cleared immediately
      store.setSession({ user: { id: 'user-b', email: 'b@example.com' }, provider: 'cognito' });
      expect(store.user).toBeNull();

      // Profile load for user-b fails
      await store.loadUserProfile('user-b');
      expect(store.user).toBeNull();
      expect(store.error).toBe('Failed to load user profile');
      expect(store.isLoading).toBe(false);
    });
  });
});

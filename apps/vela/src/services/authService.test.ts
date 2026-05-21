import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { authService, _resetProfileGuard } from './authService';

// Mock the OAuth redirect listener side-effect import
vi.mock('aws-amplify/auth/enable-oauth-listener', () => ({}));

// Mock Amplify modules
vi.mock('aws-amplify/auth', () => ({
  signInWithRedirect: vi.fn(),
  signOut: vi.fn(),
  getCurrentUser: vi.fn(),
  fetchAuthSession: vi.fn(),
}));

vi.mock('aws-amplify/utils', () => ({
  Hub: {
    listen: vi.fn(),
  },
}));

vi.mock('aws-amplify', () => ({
  Amplify: {
    configure: vi.fn(),
  },
}));

// Mock config
vi.mock('../config', () => ({
  config: {
    cognito: {
      userPoolId: 'test-pool-id',
      userPoolClientId: 'test-client-id',
      region: 'us-east-1',
      oauth: {
        domain: 'test-domain.auth.us-east-1.amazoncognito.com',
        redirectSignIn: ['http://localhost:9000/auth/callback'],
        redirectSignOut: ['http://localhost:9000/auth/login'],
        responseType: 'code',
        providers: ['Google'],
      },
    },
    api: {
      url: '/api/',
    },
  },
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock default fetch responses
mockFetch.mockResolvedValue({
  ok: true,
  json: vi.fn().mockResolvedValue({ profile: null }),
});

// Mock AWS Cognito client
vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: vi.fn(),
  AdminConfirmSignUpCommand: vi.fn(),
  ListUsersCommand: vi.fn(),
}));

import { signInWithRedirect, signOut, getCurrentUser, fetchAuthSession } from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';
import { Amplify } from 'aws-amplify';

describe('AuthService', () => {
  // Capture the top-level Hub listener registered during authService module initialization.
  // Must be done synchronously here (before any beforeEach can clear mock call records).
  const initialHubListenCalls = [...vi.mocked(Hub.listen).mock.calls];
  const topLevelHubListener = initialHubListenCalls[0]?.[1] as ((_data: any) => void) | undefined;
  const initialAmplifyConfigureCalls = [...vi.mocked(Amplify.configure).mock.calls];

  beforeEach(() => {
    vi.clearAllMocks();
    _resetProfileGuard();
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ profile: null }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('configureAmplify', () => {
    it('includes Hosted UI Google OAuth configuration', () => {
      expect(initialAmplifyConfigureCalls[0]?.[0]).toEqual({
        Auth: {
          Cognito: {
            userPoolId: 'test-pool-id',
            userPoolClientId: 'test-client-id',
            loginWith: {
              oauth: {
                domain: 'test-domain.auth.us-east-1.amazoncognito.com',
                scopes: ['email', 'openid', 'profile'],
                redirectSignIn: ['http://localhost:9000/auth/callback'],
                redirectSignOut: ['http://localhost:9000/auth/login'],
                responseType: 'code',
                providers: ['Google'],
              },
            },
          },
        },
      });
    });
  });

  describe('signInWithGoogle', () => {
    it('starts the Google Hosted UI redirect', async () => {
      vi.mocked(signInWithRedirect).mockResolvedValue(undefined);

      await authService.signInWithGoogle();

      expect(signInWithRedirect).toHaveBeenCalledWith({ provider: 'Google' });
    });

    it('propagates redirect errors', async () => {
      const redirectError = new Error('redirect failed');
      vi.mocked(signInWithRedirect).mockRejectedValue(redirectError);

      await expect(authService.signInWithGoogle()).rejects.toThrow('redirect failed');
    });
  });

  describe('signOut', () => {
    it('should sign out successfully', async () => {
      vi.mocked(signOut).mockResolvedValue(undefined);

      const result = await authService.signOut();

      expect(result.success).toBe(true);
      expect(signOut).toHaveBeenCalled();
    });

    it('should return error when signOut fails', async () => {
      vi.mocked(signOut).mockRejectedValue(new Error('Sign out failed'));

      const result = await authService.signOut();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Sign out failed');
    });
  });

  describe('getCurrentSession', () => {
    it('should return session when valid access token exists', async () => {
      const mockUser = {
        userId: 'user-123',
        signInDetails: { loginId: 'test@example.com' },
      } as any;
      const mockSession = { tokens: { accessToken: 'valid-token' as any } } as any;

      vi.mocked(fetchAuthSession).mockResolvedValue(mockSession);
      vi.mocked(getCurrentUser).mockResolvedValue(mockUser);

      const ensureProfileSpy = vi
        .spyOn(authService as any, 'ensureProfileForCurrentUser')
        .mockResolvedValue(undefined);

      const result = await authService.getCurrentSession();

      expect(result).not.toBeNull();
      expect(result?.user?.id).toBe('user-123');
      expect(result?.user?.email).toBe('test@example.com');
      expect(result?.provider).toBe('cognito');
      expect(ensureProfileSpy).toHaveBeenCalledWith('user-123', 'test@example.com', null);
    });

    it('should use ID token claims when OAuth user has no signInDetails', async () => {
      const mockUser = {
        userId: 'oauth-user-123',
      } as any;
      const mockSession = {
        tokens: {
          accessToken: 'valid-token' as any,
          idToken: {
            payload: { email: 'test@example.com', preferred_username: 'oauthuser' },
            toString: () => 'id-token',
          },
        } as any,
      } as any;

      vi.mocked(fetchAuthSession).mockResolvedValue(mockSession);
      vi.mocked(getCurrentUser).mockResolvedValue(mockUser);

      const ensureProfileSpy = vi
        .spyOn(authService as any, 'ensureProfileForCurrentUser')
        .mockResolvedValue(undefined);

      const result = await authService.getCurrentSession();

      expect(result).not.toBeNull();
      expect(result?.user?.id).toBe('oauth-user-123');
      expect(result?.user?.email).toBe('test@example.com');
      expect(result?.provider).toBe('cognito');
      expect(ensureProfileSpy).toHaveBeenCalledWith(
        'oauth-user-123',
        'test@example.com',
        'oauthuser',
      );
    });

    it('should return null when no access token', async () => {
      vi.mocked(fetchAuthSession).mockResolvedValue({ tokens: undefined } as any);

      const result = await authService.getCurrentSession();

      expect(result).toBeNull();
    });

    it('should return null and log error when session fetch fails', async () => {
      vi.mocked(fetchAuthSession).mockRejectedValue(new Error('No session'));

      const result = await authService.getCurrentSession();

      expect(result).toBeNull();
    });
  });

  describe('getCurrentUser', () => {
    it('should return user info when authenticated', async () => {
      const mockUser = {
        userId: 'user-123',
        signInDetails: { loginId: 'test@example.com' },
      } as any;

      vi.mocked(getCurrentUser).mockResolvedValue(mockUser);
      vi.mocked(fetchAuthSession).mockResolvedValue({
        tokens: { idToken: { payload: {}, toString: () => 'id' } as any },
      } as any);

      const result = await authService.getCurrentUser();

      expect(result).not.toBeNull();
      expect(result?.id).toBe('user-123');
      expect(result?.email).toBe('test@example.com');
    });

    it('should use ID token claims when OAuth user has no signInDetails', async () => {
      const mockUser = {
        userId: 'oauth-user-123',
      } as any;

      vi.mocked(getCurrentUser).mockResolvedValue(mockUser);
      vi.mocked(fetchAuthSession).mockResolvedValue({
        tokens: {
          idToken: {
            payload: { email: 'test@example.com', preferred_username: 'oauthuser' },
            toString: () => 'id-token',
          },
        } as any,
      } as any);

      const result = await authService.getCurrentUser();

      expect(result).not.toBeNull();
      expect(result?.id).toBe('oauth-user-123');
      expect(result?.email).toBe('test@example.com');
    });

    it('should return null when not authenticated', async () => {
      vi.mocked(getCurrentUser).mockRejectedValue(new Error('Not authenticated'));

      const result = await authService.getCurrentUser();

      expect(result).toBeNull();
    });

    it('should return email as null when loginId is not set and no ID token email', async () => {
      const mockUser = {
        userId: 'user-456',
        signInDetails: {},
      } as any;

      vi.mocked(getCurrentUser).mockResolvedValue(mockUser);
      vi.mocked(fetchAuthSession).mockResolvedValue({
        tokens: { idToken: { payload: {}, toString: () => 'id' } as any },
      } as any);

      const result = await authService.getCurrentUser();

      expect(result?.email).toBeNull();
    });
  });

  describe('getUserProfile', () => {
    it('should return user profile when found', async () => {
      const mockProfile = {
        user_id: 'user-123',
        email: 'test@example.com',
        username: 'testuser',
      };

      vi.mocked(fetchAuthSession).mockResolvedValue({
        tokens: {
          idToken: { toString: () => 'id-token' } as any,
          accessToken: { toString: () => 'token' } as any,
        },
      } as any);
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ profile: mockProfile }),
      });

      const result = await authService.getUserProfile('user-123');

      expect(result).toEqual(mockProfile);
    });

    it('should return null when profile fetch fails', async () => {
      vi.mocked(fetchAuthSession).mockResolvedValue({
        tokens: {
          idToken: { toString: () => 'id-token' } as any,
          accessToken: { toString: () => 'token' } as any,
        },
      } as any);
      mockFetch.mockRejectedValue(new Error('Not found'));

      const result = await authService.getUserProfile('user-123');

      expect(result).toBeNull();
    });
  });

  describe('updateUserProfile', () => {
    it('should update user profile successfully', async () => {
      vi.mocked(fetchAuthSession).mockResolvedValue({
        tokens: {
          idToken: { toString: () => 'id-token' } as any,
          accessToken: { toString: () => 'token' } as any,
        },
      } as any);
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true }),
      });

      const result = await authService.updateUserProfile('user-123', {
        username: 'newusername',
      });

      expect(result.success).toBe(true);
    });

    it('should return error when update fails', async () => {
      vi.mocked(fetchAuthSession).mockResolvedValue({
        tokens: {
          idToken: { toString: () => 'id-token' } as any,
          accessToken: { toString: () => 'token' } as any,
        },
      } as any);
      mockFetch.mockRejectedValue(new Error('Update failed'));

      const result = await authService.updateUserProfile('user-123', {
        username: 'newusername',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Update failed');
    });
  });

  describe('onAuthStateChange', () => {
    it('should register Hub listener and return unsubscribe', () => {
      const mockUnsubscribe = vi.fn();
      vi.mocked(Hub.listen).mockReturnValue(mockUnsubscribe as any);

      const callback = vi.fn();
      const subscription = authService.onAuthStateChange(callback);

      expect(Hub.listen).toHaveBeenCalledWith('auth', expect.any(Function));
      expect(subscription).toHaveProperty('unsubscribe');
    });

    it('should call callback with SIGNED_OUT event on signedOut', async () => {
      const callback = vi.fn();
      let capturedListener: ((_data: any) => void) | null = null;

      vi.mocked(Hub.listen).mockImplementation((_channel: any, listener: any) => {
        capturedListener = listener;
        return vi.fn() as any;
      });

      authService.onAuthStateChange(callback);

      expect(capturedListener).not.toBeNull();

      // Simulate signedOut event
      capturedListener!({ payload: { event: 'signedOut' } });

      expect(callback).toHaveBeenCalledWith('SIGNED_OUT', null);
    });

    it('should call callback with SIGNED_IN event on successful signedIn', async () => {
      const mockUser = {
        userId: 'user-123',
        signInDetails: { loginId: 'test@example.com' },
      } as any;
      const mockSession = {
        tokens: {
          accessToken: 'token' as any,
          idToken: { payload: {}, toString: () => 'id' } as any,
        },
      } as any;

      vi.mocked(getCurrentUser).mockResolvedValue(mockUser);
      vi.mocked(fetchAuthSession).mockResolvedValue(mockSession);

      const callback = vi.fn();
      let capturedListener: ((_data: any) => void) | null = null;

      vi.mocked(Hub.listen).mockImplementation((_channel: any, listener: any) => {
        capturedListener = listener;
        return vi.fn() as any;
      });

      // Also mock the profile creation fetch
      mockFetch.mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ success: true }) });

      authService.onAuthStateChange(callback);

      // Simulate signedIn event
      capturedListener!({ payload: { event: 'signedIn' } });

      // Wait for async operations
      await vi.waitFor(() => expect(callback).toHaveBeenCalled());

      expect(callback).toHaveBeenCalledWith(
        'SIGNED_IN',
        expect.objectContaining({
          user: expect.objectContaining({ id: 'user-123' }),
          provider: 'cognito',
        }),
      );
    });

    it('should read preferred_username from ID token claims in signedIn event', async () => {
      const mockUser = {
        userId: 'user-123',
        signInDetails: { loginId: 'test@example.com' },
      } as any;
      const mockSession = {
        tokens: {
          accessToken: 'token' as any,
          idToken: {
            payload: { preferred_username: 'myuser' },
            toString: () => 'id-token',
          },
        },
      } as any;

      vi.mocked(getCurrentUser).mockResolvedValue(mockUser);
      vi.mocked(fetchAuthSession).mockResolvedValue(mockSession);

      const callback = vi.fn();
      let capturedListener: ((_data: any) => void) | null = null;

      vi.mocked(Hub.listen).mockImplementation((_channel: any, listener: any) => {
        capturedListener = listener;
        return vi.fn() as any;
      });

      mockFetch.mockResolvedValue({ ok: true, json: vi.fn().mockResolvedValue({ success: true }) });

      authService.onAuthStateChange(callback);
      capturedListener!({ payload: { event: 'signedIn' } });

      await vi.waitFor(() => expect(callback).toHaveBeenCalled());

      expect(callback).toHaveBeenCalledWith(
        'SIGNED_IN',
        expect.objectContaining({ user: expect.objectContaining({ id: 'user-123' }) }),
      );
    });

    it('should preserve ID token email and username for OAuth signedIn events without signInDetails', async () => {
      const mockUser = {
        userId: 'oauth-user-123',
      } as any;
      const mockSession = {
        tokens: {
          accessToken: 'token' as any,
          idToken: {
            payload: { email: 'test@example.com', preferred_username: 'oauthuser' },
            toString: () => 'id-token',
          },
        },
      } as any;

      vi.mocked(getCurrentUser).mockResolvedValue(mockUser);
      vi.mocked(fetchAuthSession).mockResolvedValue(mockSession);

      const createProfileSpy = vi
        .spyOn(authService as any, 'createUserProfile')
        .mockResolvedValue(undefined);
      const callback = vi.fn();
      let capturedListener: ((_data: any) => void) | null = null;

      vi.mocked(Hub.listen).mockImplementation((_channel: any, listener: any) => {
        capturedListener = listener;
        return vi.fn() as any;
      });

      authService.onAuthStateChange(callback);
      capturedListener!({ payload: { event: 'signedIn' } });

      await vi.waitFor(() => expect(callback).toHaveBeenCalled());

      expect(createProfileSpy).toHaveBeenCalledWith('oauth-user-123', {
        email: 'test@example.com',
        username: 'oauthuser',
      });
      expect(callback).toHaveBeenCalledWith('SIGNED_IN', {
        user: { id: 'oauth-user-123', email: 'test@example.com' },
        provider: 'cognito',
      });
    });

    it('should fall back to name claim when preferred_username is missing for Google users', async () => {
      const mockUser = {
        userId: 'google-user-456',
      } as any;
      const mockSession = {
        tokens: {
          accessToken: 'token' as any,
          idToken: {
            // Google maps display name to "name", not "preferred_username"
            payload: { email: 'google@example.com', name: 'Google Display Name' },
            toString: () => 'id-token',
          },
        },
      } as any;

      vi.mocked(getCurrentUser).mockResolvedValue(mockUser);
      vi.mocked(fetchAuthSession).mockResolvedValue(mockSession);

      const createProfileSpy = vi
        .spyOn(authService as any, 'createUserProfile')
        .mockResolvedValue(undefined);
      const callback = vi.fn();
      let capturedListener: ((_data: any) => void) | null = null;

      vi.mocked(Hub.listen).mockImplementation((_channel: any, listener: any) => {
        capturedListener = listener;
        return vi.fn() as any;
      });

      authService.onAuthStateChange(callback);
      capturedListener!({ payload: { event: 'signedIn' } });

      await vi.waitFor(() => expect(callback).toHaveBeenCalled());

      expect(createProfileSpy).toHaveBeenCalledWith('google-user-456', {
        email: 'google@example.com',
        username: 'Google Display Name',
      });
    });

    it('should log error when getCurrentUser throws during signedIn Hub event', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const err = new Error('get user failed');
      vi.mocked(getCurrentUser).mockRejectedValue(err);

      const callback = vi.fn();
      let capturedListener: ((_data: any) => void) | null = null;

      vi.mocked(Hub.listen).mockImplementation((_channel: any, listener: any) => {
        capturedListener = listener;
        return vi.fn() as any;
      });

      authService.onAuthStateChange(callback);
      capturedListener!({ payload: { event: 'signedIn' } });

      await vi.waitFor(() => expect(consoleSpy).toHaveBeenCalled());

      expect(consoleSpy).toHaveBeenCalledWith('Error handling sign in:', err);
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('top-level Hub event logging', () => {
    it('should log on signedIn event', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      topLevelHubListener?.({ payload: { event: 'signedIn' } });
      expect(consoleSpy).toHaveBeenCalledWith('✅ User signed in to Cognito');
    });

    it('should log on signedOut event', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      topLevelHubListener?.({ payload: { event: 'signedOut' } });
      expect(consoleSpy).toHaveBeenCalledWith('✅ User signed out from Cognito');
    });

    it('should log on tokenRefresh event', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      topLevelHubListener?.({ payload: { event: 'tokenRefresh' } });
      expect(consoleSpy).toHaveBeenCalledWith('✅ Cognito token refreshed successfully');
    });
  });

  describe('with Cognito authentication disabled (cognitoEnabled = false)', () => {
    // Uses vi.resetModules() + vi.doMock() to get a fresh authService instance
    // where configureAmplify() returns false (empty cognito config).
    let disabledAuthService: typeof authService;

    beforeAll(async () => {
      vi.resetModules();
      vi.doMock('../config', () => ({
        config: {
          cognito: { userPoolId: '', userPoolClientId: '', region: '' },
          api: { url: '/api/' },
          app: { isDev: false },
        },
      }));
      // vi.mock registrations for aws-amplify/* still apply after resetModules
      const mod = await import('./authService');
      disabledAuthService = mod.authService;
    });

    afterAll(() => {
      vi.resetModules();
    });

    it('signOut returns success when auth is disabled', async () => {
      const result = await disabledAuthService.signOut();
      expect(result.success).toBe(true);
    });

    it('getCurrentUser returns null when auth is disabled', async () => {
      const result = await disabledAuthService.getCurrentUser();
      expect(result).toBeNull();
    });

    it('onAuthStateChange returns noop unsubscribe when auth is disabled', () => {
      const callback = vi.fn();
      const sub = disabledAuthService.onAuthStateChange(callback);
      expect(sub).toHaveProperty('unsubscribe');
      expect(typeof sub.unsubscribe).toBe('function');
      expect(() => sub.unsubscribe()).not.toThrow();
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('private profile creation helpers', () => {
    it('logs and swallows create-profile races in ensureProfileForCurrentUser', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const raceError = new Error('Profile already exists');
      const createProfileSpy = vi
        .spyOn(authService as any, 'createUserProfile')
        .mockRejectedValueOnce(raceError);

      await (authService as any).ensureProfileForCurrentUser(
        'user-123',
        'test@example.com',
        'tester',
      );

      expect(createProfileSpy).toHaveBeenCalledWith('user-123', {
        email: 'test@example.com',
        username: 'tester',
      });
      expect(consoleLogSpy).toHaveBeenCalledWith(
        'Profile creation completed (may already exist):',
        raceError,
      );
    });

    it('skips createUserProfile when profileEnsuredForUserId matches the user', async () => {
      const createProfileSpy = vi
        .spyOn(authService as any, 'createUserProfile')
        .mockResolvedValue(undefined);

      // First call — should hit createUserProfile
      await (authService as any).ensureProfileForCurrentUser('user-abc', 'a@b.com', null);
      expect(createProfileSpy).toHaveBeenCalledTimes(1);

      // Second call for same user — should be skipped by the memo guard
      await (authService as any).ensureProfileForCurrentUser('user-abc', 'a@b.com', null);
      expect(createProfileSpy).toHaveBeenCalledTimes(1); // still 1
    });

    it('re-runs createUserProfile for a different user after reset', async () => {
      const createProfileSpy = vi
        .spyOn(authService as any, 'createUserProfile')
        .mockResolvedValue(undefined);

      await (authService as any).ensureProfileForCurrentUser('user-first', 'first@test.com', null);
      expect(createProfileSpy).toHaveBeenCalledTimes(1);

      // Different user — should trigger another POST
      await (authService as any).ensureProfileForCurrentUser(
        'user-second',
        'second@test.com',
        null,
      );
      expect(createProfileSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('isAuthenticated', () => {
    it('returns true when a valid session exists', async () => {
      vi.mocked(fetchAuthSession).mockResolvedValue({
        tokens: { accessToken: 'valid-token' as any },
      } as any);

      const result = await authService.isAuthenticated();
      expect(result).toBe(true);
    });

    it('returns false when no session exists', async () => {
      vi.mocked(fetchAuthSession).mockResolvedValue({ tokens: undefined } as any);

      const result = await authService.isAuthenticated();
      expect(result).toBe(false);
    });

    it('returns false when fetchAuthSession throws', async () => {
      vi.mocked(fetchAuthSession).mockRejectedValue(new Error('no session'));

      const result = await authService.isAuthenticated();
      expect(result).toBe(false);
    });

    it('does not trigger profile creation', async () => {
      vi.mocked(fetchAuthSession).mockResolvedValue({
        tokens: { accessToken: 'valid-token' as any },
      } as any);

      const ensureProfileSpy = vi.spyOn(authService as any, 'ensureProfileForCurrentUser');

      await authService.isAuthenticated();

      expect(ensureProfileSpy).not.toHaveBeenCalled();
    });

    it('does not make any network calls beyond fetchAuthSession', async () => {
      vi.mocked(fetchAuthSession).mockResolvedValue({
        tokens: { accessToken: 'valid-token' as any },
      } as any);

      await authService.isAuthenticated();

      expect(fetchAuthSession).toHaveBeenCalledTimes(1);
    });
  });

  describe('module initialization logging', () => {
    it('logs detailed Cognito configuration in development mode', async () => {
      const consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

      vi.resetModules();
      vi.doMock('../config', () => ({
        config: {
          cognito: {
            userPoolId: 'dev-pool-id',
            userPoolClientId: 'dev-client-id',
            region: 'us-east-1',
            oauth: {
              domain: 'test-domain.auth.us-east-1.amazoncognito.com',
              redirectSignIn: ['http://localhost:9000/auth/callback'],
              redirectSignOut: ['http://localhost:9000/auth/login'],
              responseType: 'code',
              providers: ['Google'],
            },
          },
          api: {
            url: '/api/',
          },
          app: {
            isDev: true,
          },
        },
      }));

      await import('./authService');

      expect(consoleDebugSpy).toHaveBeenCalledWith('✅ Amplify configured with Cognito', {
        userPoolId: 'dev-pool-id',
        userPoolClientId: 'dev-client-id',
      });
    });
  });
});

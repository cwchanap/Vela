import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { authService } from './authService';

// Mock Amplify modules
vi.mock('aws-amplify/auth', () => ({
  signUp: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  getCurrentUser: vi.fn(),
  confirmSignUp: vi.fn(),
  resendSignUpCode: vi.fn(),
  fetchAuthSession: vi.fn(),
  resetPassword: vi.fn(),
  fetchUserAttributes: vi.fn(),
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

import {
  signIn,
  signUp,
  signOut,
  getCurrentUser,
  fetchAuthSession,
  confirmSignUp,
  resendSignUpCode,
  resetPassword,
  fetchUserAttributes,
} from 'aws-amplify/auth';
import { Hub } from 'aws-amplify/utils';

describe('AuthService', () => {
  // Capture the top-level Hub listener registered during authService module initialization.
  // Must be done synchronously here (before any beforeEach can clear mock call records).
  const initialHubListenCalls = [...vi.mocked(Hub.listen).mock.calls];
  const topLevelHubListener = initialHubListenCalls[0]?.[1] as ((_data: any) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ profile: null }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('signIn', () => {
    it('should sign in successfully when user is already confirmed', async () => {
      const mockSignInResult = {
        isSignedIn: true,
        nextStep: { signInStep: 'DONE' },
      } as any;
      const mockUser = {
        userId: 'user-123',
        username: 'test@example.com',
        signInDetails: { loginId: 'test@example.com' },
      } as any;
      const mockSession = {
        tokens: { accessToken: 'token' as any },
      } as any;

      vi.mocked(signIn).mockResolvedValue(mockSignInResult);
      vi.mocked(getCurrentUser).mockResolvedValue(mockUser);
      vi.mocked(fetchAuthSession).mockResolvedValue(mockSession);

      const result = await authService.signIn({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result.success).toBe(true);
      expect(result.user?.id).toBe('user-123');
      expect(result.user?.email).toBe('test@example.com');
      expect(signIn).toHaveBeenCalledWith({
        username: 'test@example.com',
        password: 'password123',
      });
    });

    it('should auto-confirm user when signIn returns CONFIRM_SIGN_UP nextStep', async () => {
      const mockSignInResult = {
        isSignedIn: false,
        nextStep: { signInStep: 'CONFIRM_SIGN_UP' },
      } as any;
      const mockRetrySignInResult = {
        isSignedIn: true,
        nextStep: { signInStep: 'DONE' },
      } as any;
      const mockUser = {
        userId: 'user-123',
        username: 'test@example.com',
        signInDetails: { loginId: 'test@example.com' },
      } as any;
      const mockSession = {
        tokens: { accessToken: 'token' as any },
      } as any;

      vi.mocked(signIn)
        .mockResolvedValueOnce(mockSignInResult)
        .mockResolvedValueOnce(mockRetrySignInResult);
      vi.mocked(getCurrentUser).mockResolvedValue(mockUser);
      vi.mocked(fetchAuthSession).mockResolvedValue(mockSession);
      mockFetch.mockResolvedValue({ ok: true });

      const result = await authService.signIn({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result.success).toBe(true);
      expect(result.user?.id).toBe('user-123');
      expect(signIn).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenCalledWith('/api/auth/auto-confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'test@example.com' }),
      });
    });

    it('should auto-confirm user when signIn throws UserNotConfirmedException', async () => {
      const mockRetrySignInResult = {
        isSignedIn: true,
        nextStep: { signInStep: 'DONE' },
      } as any;
      const mockUser = {
        userId: 'user-123',
        username: 'test@example.com',
        signInDetails: { loginId: 'test@example.com' },
      } as any;
      const mockSession = {
        tokens: { accessToken: 'token' as any },
      } as any;

      const userNotConfirmedError = new Error('User is not confirmed');
      userNotConfirmedError.name = 'UserNotConfirmedException';

      vi.mocked(signIn)
        .mockRejectedValueOnce(userNotConfirmedError)
        .mockResolvedValueOnce(mockRetrySignInResult);
      vi.mocked(getCurrentUser).mockResolvedValue(mockUser);
      vi.mocked(fetchAuthSession).mockResolvedValue(mockSession);
      mockFetch.mockResolvedValue({ ok: true });

      const result = await authService.signIn({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result.success).toBe(true);
      expect(result.user?.id).toBe('user-123');
      expect(signIn).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenCalledWith('/api/auth/auto-confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'test@example.com' }),
      });
    });

    it('should return error when auto-confirmation fails', async () => {
      const mockSignInResult = {
        isSignedIn: false,
        nextStep: { signInStep: 'CONFIRM_SIGN_UP' },
      } as any;

      vi.mocked(signIn).mockResolvedValue(mockSignInResult);
      mockFetch.mockRejectedValue(new Error('Auto-confirm failed'));

      const result = await authService.signIn({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Auto-confirm failed');
      expect(mockFetch).toHaveBeenCalledWith('/api/auth/auto-confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'test@example.com' }),
      });
    });

    it('should return error when sign in fails after auto-confirmation', async () => {
      const mockSignInResult = {
        isSignedIn: false,
        nextStep: { signInStep: 'CONFIRM_SIGN_UP' },
      } as any;

      vi.mocked(signIn)
        .mockResolvedValueOnce(mockSignInResult)
        .mockResolvedValueOnce({ isSignedIn: false, nextStep: { signInStep: 'DONE' } } as any);
      mockFetch.mockResolvedValue({ ok: true });

      const result = await authService.signIn({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Sign in failed');
    });

    it('should return generic error when signIn throws a non-Error value', async () => {
      vi.mocked(signIn).mockRejectedValue('unexpected non-error string');

      const result = await authService.signIn({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('An unexpected error occurred');
    });

    it('should return "Sign in failed after auto-confirmation" when retry fails after UserNotConfirmedException', async () => {
      const err = new Error('User is not confirmed');
      err.name = 'UserNotConfirmedException';

      vi.mocked(signIn)
        .mockRejectedValueOnce(err) // first call → UserNotConfirmedException
        .mockRejectedValueOnce(new Error('retry also failed')); // retry → fails too
      mockFetch.mockResolvedValue({ ok: true }); // autoConfirmUser succeeds

      const result = await authService.signIn({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Sign in failed after auto-confirmation');
    });
  });

  describe('signUp', () => {
    it('should sign up successfully', async () => {
      vi.mocked(signUp).mockResolvedValue({
        userId: 'new-user-123',
        isSignUpComplete: false,
      } as any);
      mockFetch.mockResolvedValue({ ok: true });

      const result = await authService.signUp({
        email: 'new@example.com',
        password: 'password123',
      });

      expect(result.success).toBe(true);
      expect(result.user?.id).toBe('new-user-123');
      expect(result.user?.email).toBe('new@example.com');
      expect(signUp).toHaveBeenCalledWith(
        expect.objectContaining({ username: 'new@example.com', password: 'password123' }),
      );
    });

    it('should include username as preferred_username when provided', async () => {
      vi.mocked(signUp).mockResolvedValue({
        userId: 'new-user-456',
        isSignUpComplete: false,
      } as any);
      mockFetch.mockResolvedValue({ ok: true });

      await authService.signUp({
        email: 'user@example.com',
        password: 'password123',
        username: 'myusername',
      });

      expect(signUp).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            userAttributes: expect.objectContaining({ preferred_username: 'myusername' }),
          }),
        }),
      );
    });

    it('should return error when signUp fails', async () => {
      vi.mocked(signUp).mockRejectedValue(new Error('UsernameExistsException'));

      const result = await authService.signUp({
        email: 'existing@example.com',
        password: 'password123',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('UsernameExistsException');
    });

    it('should handle signUp without userId', async () => {
      vi.mocked(signUp).mockResolvedValue({ userId: undefined, isSignUpComplete: false } as any);

      const result = await authService.signUp({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result.success).toBe(true);
      expect(result.user?.id).toBe('');
    });

    it('should continue signup even when auto-confirmation fails', async () => {
      vi.mocked(signUp).mockResolvedValue({ userId: 'user-789', isSignUpComplete: false } as any);
      mockFetch.mockResolvedValue({ ok: false });

      const result = await authService.signUp({
        email: 'test@example.com',
        password: 'password123',
      });

      // Should still succeed even if auto-confirm fails
      expect(result.success).toBe(true);
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

      const result = await authService.getCurrentSession();

      expect(result).not.toBeNull();
      expect(result?.user?.id).toBe('user-123');
      expect(result?.user?.email).toBe('test@example.com');
      expect(result?.provider).toBe('cognito');
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

      const result = await authService.getCurrentUser();

      expect(result).not.toBeNull();
      expect(result?.id).toBe('user-123');
      expect(result?.email).toBe('test@example.com');
    });

    it('should return null when not authenticated', async () => {
      vi.mocked(getCurrentUser).mockRejectedValue(new Error('Not authenticated'));

      const result = await authService.getCurrentUser();

      expect(result).toBeNull();
    });

    it('should return email as null when loginId is not set', async () => {
      const mockUser = {
        userId: 'user-456',
        signInDetails: {},
      } as any;

      vi.mocked(getCurrentUser).mockResolvedValue(mockUser);

      const result = await authService.getCurrentUser();

      expect(result?.email).toBeNull();
    });
  });

  describe('confirmSignUp', () => {
    it('should confirm signup successfully', async () => {
      vi.mocked(confirmSignUp).mockResolvedValue({ isSignUpComplete: true } as any);

      const result = await authService.confirmSignUp('test@example.com', '123456');

      expect(result.success).toBe(true);
      expect(confirmSignUp).toHaveBeenCalledWith({
        username: 'test@example.com',
        confirmationCode: '123456',
      });
    });

    it('should return error when confirmation fails', async () => {
      vi.mocked(confirmSignUp).mockRejectedValue(new Error('CodeMismatchException'));

      const result = await authService.confirmSignUp('test@example.com', 'wrong-code');

      expect(result.success).toBe(false);
      expect(result.error).toBe('CodeMismatchException');
    });
  });

  describe('resendSignUpCode', () => {
    it('should resend signup code successfully', async () => {
      vi.mocked(resendSignUpCode).mockResolvedValue({
        destination: 'email',
        deliveryMedium: 'EMAIL',
        attributeName: 'email',
      } as any);

      const result = await authService.resendSignUpCode('test@example.com');

      expect(result.success).toBe(true);
      expect(resendSignUpCode).toHaveBeenCalledWith({ username: 'test@example.com' });
    });

    it('should return error when resend fails', async () => {
      vi.mocked(resendSignUpCode).mockRejectedValue(new Error('TooManyRequestsException'));

      const result = await authService.resendSignUpCode('test@example.com');

      expect(result.success).toBe(false);
      expect(result.error).toBe('TooManyRequestsException');
    });
  });

  describe('resetPassword', () => {
    it('should initiate password reset successfully', async () => {
      vi.mocked(resetPassword).mockResolvedValue({
        isPasswordReset: false,
        nextStep: {
          resetPasswordStep: 'CONFIRM_RESET_PASSWORD_WITH_CODE',
          codeDeliveryDetails: {},
        },
      } as any);

      const result = await authService.resetPassword('test@example.com');

      expect(result.success).toBe(true);
      expect(resetPassword).toHaveBeenCalledWith({ username: 'test@example.com' });
    });

    it('should return error when reset password fails', async () => {
      vi.mocked(resetPassword).mockRejectedValue(new Error('UserNotFoundException'));

      const result = await authService.resetPassword('nonexistent@example.com');

      expect(result.success).toBe(false);
      expect(result.error).toBe('UserNotFoundException');
    });
  });

  describe('updatePassword', () => {
    it('should always return error directing to reset flow', async () => {
      const result = await authService.updatePassword('newPassword123');

      expect(result.success).toBe(false);
      expect(result.error).toContain('reset password');
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
      const mockSession = { tokens: { accessToken: 'token' as any } } as any;

      vi.mocked(getCurrentUser).mockResolvedValue(mockUser);
      vi.mocked(fetchAuthSession).mockResolvedValue(mockSession);
      vi.mocked(fetchUserAttributes).mockRejectedValue(new Error('no attrs'));

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

    it('should fetch preferred_username when fetchUserAttributes succeeds in signedIn event', async () => {
      const mockUser = {
        userId: 'user-123',
        signInDetails: { loginId: 'test@example.com' },
      } as any;
      const mockSession = { tokens: { accessToken: 'token' as any } } as any;

      vi.mocked(getCurrentUser).mockResolvedValue(mockUser);
      vi.mocked(fetchAuthSession).mockResolvedValue(mockSession);
      vi.mocked(fetchUserAttributes).mockResolvedValue({ preferred_username: 'myuser' } as any);

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
      expect(fetchUserAttributes).toHaveBeenCalled();
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

    it('signUp returns disabled error', async () => {
      const result = await disabledAuthService.signUp({ email: 'a@b.com', password: 'pw' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/disabled/i);
    });

    it('signIn returns disabled error', async () => {
      const result = await disabledAuthService.signIn({ email: 'a@b.com', password: 'pw' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/disabled/i);
    });

    it('signOut returns success when auth is disabled', async () => {
      const result = await disabledAuthService.signOut();
      expect(result.success).toBe(true);
    });

    it('getCurrentUser returns null when auth is disabled', async () => {
      const result = await disabledAuthService.getCurrentUser();
      expect(result).toBeNull();
    });

    it('confirmSignUp returns disabled error', async () => {
      const result = await disabledAuthService.confirmSignUp('a@b.com', '123456');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/disabled/i);
    });

    it('resendSignUpCode returns disabled error', async () => {
      const result = await disabledAuthService.resendSignUpCode('a@b.com');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/disabled/i);
    });

    it('resetPassword returns disabled error', async () => {
      const result = await disabledAuthService.resetPassword('a@b.com');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/disabled/i);
    });

    it('updatePassword returns disabled error', async () => {
      const result = await disabledAuthService.updatePassword('newpw');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/disabled/i);
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
});

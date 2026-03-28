import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
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
  });
});

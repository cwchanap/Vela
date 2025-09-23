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

import { signIn, getCurrentUser, fetchAuthSession } from 'aws-amplify/auth';

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
});

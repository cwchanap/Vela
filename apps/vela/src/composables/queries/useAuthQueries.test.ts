import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { withQueryClient } from 'src/test-utils/withQueryClient';

const mockAuthService = {
  getCurrentSession: vi.fn(),
  getCurrentUser: vi.fn(),
  getUserProfile: vi.fn(),
  signUp: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  confirmSignUp: vi.fn(),
  resendSignUpCode: vi.fn(),
  resetPassword: vi.fn(),
  updateUserProfile: vi.fn(),
};

vi.mock('src/services/authService', () => ({ authService: mockAuthService }));

describe('useAuthQueries', () => {
  let authKeys: typeof import('./useAuthQueries').authKeys;

  beforeAll(async () => {
    ({ authKeys } = await import('./useAuthQueries'));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('authKeys', () => {
    it('generates correct session key', async () => {
      expect(authKeys.session()).toEqual(['auth', 'session']);
    });

    it('generates correct user key', async () => {
      expect(authKeys.user()).toEqual(['auth', 'user']);
    });

    it('generates correct profile key', async () => {
      expect(authKeys.profile('user-123')).toEqual(['auth', 'profile', 'user-123']);
    });
  });

  describe('useSessionQuery', () => {
    it('resolves with null when no session exists', async () => {
      mockAuthService.getCurrentSession.mockResolvedValue(null);
      const { useSessionQuery } = await import('./useAuthQueries');
      const { result } = withQueryClient(() => useSessionQuery());
      await flushPromises();
      expect(result.data.value).toBeNull();
      expect(result.isPending.value).toBe(false);
    });
  });

  describe('useCurrentUserQuery', () => {
    it('resolves with null when no user exists', async () => {
      mockAuthService.getCurrentUser.mockResolvedValue(null);
      const { useCurrentUserQuery } = await import('./useAuthQueries');
      const { result } = withQueryClient(() => useCurrentUserQuery());
      await flushPromises();
      expect(result.data.value).toBeNull();
      expect(result.isPending.value).toBe(false);
    });
  });

  describe('useUserProfileQuery', () => {
    it('is disabled when userId is null', async () => {
      const { useUserProfileQuery } = await import('./useAuthQueries');
      const { result } = withQueryClient(() => useUserProfileQuery(null));
      expect(result).toBeDefined();
      expect(mockAuthService.getUserProfile).not.toHaveBeenCalled();
    });

    it('is disabled when userId is undefined', async () => {
      const { useUserProfileQuery } = await import('./useAuthQueries');
      const { result } = withQueryClient(() => useUserProfileQuery(undefined));
      expect(result).toBeDefined();
      expect(mockAuthService.getUserProfile).not.toHaveBeenCalled();
    });
  });

  describe('useSignInMutation', () => {
    it('calls authService.signIn with provided data', async () => {
      mockAuthService.signIn.mockResolvedValueOnce({
        success: true,
        user: { id: 'u1', email: 'a@b.com' },
      });
      const { useSignInMutation } = await import('./useAuthQueries');
      const { result } = withQueryClient(() => useSignInMutation());
      await result.mutateAsync({ email: 'a@b.com', password: 'pass' });
      expect(mockAuthService.signIn).toHaveBeenCalledWith({ email: 'a@b.com', password: 'pass' });
    });

    it('invalidates session and user queries on successful sign in', async () => {
      mockAuthService.signIn.mockResolvedValueOnce({
        success: true,
        user: { id: 'u1', email: 'a@b.com' },
      });
      const { useSignInMutation } = await import('./useAuthQueries');
      const { result, queryClient } = withQueryClient(() => useSignInMutation());
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      await result.mutateAsync({ email: 'a@b.com', password: 'pass' });
      expect(invalidateSpy).toHaveBeenCalled();
      // Verify session key is invalidated
      const sessionCall = invalidateSpy.mock.calls.find((call) => {
        const options = call[0] as { queryKey?: readonly unknown[] };
        return options?.queryKey?.includes('session');
      });
      expect(sessionCall).toBeDefined();
      // Verify user key is invalidated
      const userCall = invalidateSpy.mock.calls.find((call) => {
        const options = call[0] as { queryKey?: readonly unknown[] };
        return options?.queryKey?.includes('user');
      });
      expect(userCall).toBeDefined();
    });

    it('does not invalidate queries when sign in returns success: false', async () => {
      mockAuthService.signIn.mockResolvedValueOnce({
        success: false,
        error: 'Invalid credentials',
      });
      const { useSignInMutation } = await import('./useAuthQueries');
      const { result, queryClient } = withQueryClient(() => useSignInMutation());
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      await result.mutateAsync({ email: 'bad@example.com', password: 'wrong' });
      expect(invalidateSpy).not.toHaveBeenCalled();
    });
  });

  describe('useSignOutMutation', () => {
    it('calls authService.signOut', async () => {
      mockAuthService.signOut.mockResolvedValueOnce({ success: true });
      const { useSignOutMutation } = await import('./useAuthQueries');
      const { result, queryClient } = withQueryClient(() => useSignOutMutation());
      const clearSpy = vi.spyOn(queryClient, 'clear');
      await result.mutateAsync();
      expect(mockAuthService.signOut).toHaveBeenCalled();
      expect(clearSpy).toHaveBeenCalled();
    });
  });

  describe('useSignUpMutation', () => {
    it('calls authService.signUp with provided data', async () => {
      mockAuthService.signUp.mockResolvedValueOnce({ success: true });
      const { useSignUpMutation } = await import('./useAuthQueries');
      const { result } = withQueryClient(() => useSignUpMutation());
      await result.mutateAsync({ email: 'new@example.com', password: 'pass', username: 'user' });
      expect(mockAuthService.signUp).toHaveBeenCalledWith({
        email: 'new@example.com',
        password: 'pass',
        username: 'user',
      });
    });

    it('invalidates session and user queries on success', async () => {
      mockAuthService.signUp.mockResolvedValueOnce({ success: true });
      const { useSignUpMutation } = await import('./useAuthQueries');
      const { result, queryClient } = withQueryClient(() => useSignUpMutation());
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      await result.mutateAsync({ email: 'new@example.com', password: 'pass', username: 'user' });
      expect(invalidateSpy).toHaveBeenCalled();
      // Verify session key is invalidated
      const sessionCall = invalidateSpy.mock.calls.find((call) => {
        const options = call[0] as { queryKey?: readonly unknown[] };
        return options?.queryKey?.includes('session');
      });
      expect(sessionCall).toBeDefined();
      // Verify user key is invalidated
      const userCall = invalidateSpy.mock.calls.find((call) => {
        const options = call[0] as { queryKey?: readonly unknown[] };
        return options?.queryKey?.includes('user');
      });
      expect(userCall).toBeDefined();
    });

    it('does not invalidate queries when sign up returns success: false', async () => {
      mockAuthService.signUp.mockResolvedValueOnce({
        success: false,
        error: 'Email already exists',
      });
      const { useSignUpMutation } = await import('./useAuthQueries');
      const { result, queryClient } = withQueryClient(() => useSignUpMutation());
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      await result.mutateAsync({ email: 'exists@example.com', password: 'pass', username: 'user' });
      expect(invalidateSpy).not.toHaveBeenCalled();
    });
  });

  describe('useConfirmSignUpMutation', () => {
    it('calls authService.confirmSignUp', async () => {
      mockAuthService.confirmSignUp.mockResolvedValueOnce({ success: true });
      const { useConfirmSignUpMutation } = await import('./useAuthQueries');
      const { result } = withQueryClient(() => useConfirmSignUpMutation());
      await result.mutateAsync({ email: 'a@b.com', code: '123456' });
      expect(mockAuthService.confirmSignUp).toHaveBeenCalledWith('a@b.com', '123456');
    });
  });

  describe('useResendSignUpCodeMutation', () => {
    it('calls authService.resendSignUpCode', async () => {
      mockAuthService.resendSignUpCode.mockResolvedValueOnce({ success: true });
      const { useResendSignUpCodeMutation } = await import('./useAuthQueries');
      const { result } = withQueryClient(() => useResendSignUpCodeMutation());
      await result.mutateAsync('a@b.com');
      expect(mockAuthService.resendSignUpCode).toHaveBeenCalledWith('a@b.com');
    });
  });

  describe('useResetPasswordMutation', () => {
    it('calls authService.resetPassword', async () => {
      mockAuthService.resetPassword.mockResolvedValueOnce({ success: true });
      const { useResetPasswordMutation } = await import('./useAuthQueries');
      const { result } = withQueryClient(() => useResetPasswordMutation());
      await result.mutateAsync('a@b.com');
      expect(mockAuthService.resetPassword).toHaveBeenCalledWith('a@b.com');
    });
  });

  describe('useUpdateProfileMutation', () => {
    it('calls authService.updateUserProfile and invalidates profile query on success', async () => {
      mockAuthService.updateUserProfile.mockResolvedValueOnce({ success: true });
      const { useUpdateProfileMutation } = await import('./useAuthQueries');
      const { result, queryClient } = withQueryClient(() => useUpdateProfileMutation());
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      await result.mutateAsync({ userId: 'u1', profileData: { username: 'newname' } });
      expect(mockAuthService.updateUserProfile).toHaveBeenCalledWith('u1', { username: 'newname' });
      expect(invalidateSpy).toHaveBeenCalled();
      // Verify profile key is invalidated
      const profileCall = invalidateSpy.mock.calls.find((call) => {
        const options = call[0] as { queryKey?: readonly unknown[] };
        return options?.queryKey?.includes('profile');
      });
      expect(profileCall).toBeDefined();
    });
  });
});

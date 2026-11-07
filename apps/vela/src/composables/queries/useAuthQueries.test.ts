import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { withQueryClient } from 'src/test-utils/withQueryClient';
import { authKeys as sharedAuthKeys } from '@vela/common';

const mockAuthService = {
  getCurrentSession: vi.fn(),
  getCurrentUser: vi.fn(),
  getUserProfile: vi.fn(),
  signInWithGoogle: vi.fn(),
  signOut: vi.fn(),
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
    it('re-exports the shared auth query keys', async () => {
      expect(authKeys).toBe(sharedAuthKeys);
    });

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

  describe('useSignInWithGoogleMutation', () => {
    it('calls authService.signInWithGoogle', async () => {
      mockAuthService.signInWithGoogle.mockResolvedValueOnce(undefined);
      const { useSignInWithGoogleMutation } = await import('./useAuthQueries');
      const { result } = withQueryClient(() => useSignInWithGoogleMutation());
      await result.mutateAsync();
      expect(mockAuthService.signInWithGoogle).toHaveBeenCalledTimes(1);
    });

    it('invalidates session and user queries after starting Google sign in', async () => {
      mockAuthService.signInWithGoogle.mockResolvedValueOnce(undefined);
      const { useSignInWithGoogleMutation } = await import('./useAuthQueries');
      const { result, queryClient } = withQueryClient(() => useSignInWithGoogleMutation());
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      await result.mutateAsync();
      expect(invalidateSpy).toHaveBeenCalled();
      const sessionCall = invalidateSpy.mock.calls.find((call) => {
        const options = call[0] as { queryKey?: readonly unknown[] };
        return options?.queryKey?.includes('session');
      });
      expect(sessionCall).toBeDefined();
      const userCall = invalidateSpy.mock.calls.find((call) => {
        const options = call[0] as { queryKey?: readonly unknown[] };
        return options?.queryKey?.includes('user');
      });
      expect(userCall).toBeDefined();
    });

    it('does not invalidate queries when Google sign in throws', async () => {
      mockAuthService.signInWithGoogle.mockRejectedValueOnce(new Error('redirect failed'));
      const { useSignInWithGoogleMutation } = await import('./useAuthQueries');
      const { result, queryClient } = withQueryClient(() => useSignInWithGoogleMutation());
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      await expect(result.mutateAsync()).rejects.toThrow('redirect failed');
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
});

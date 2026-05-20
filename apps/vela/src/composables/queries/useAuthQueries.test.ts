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

    it('applies optimistic update to cache when previous profile exists', async () => {
      mockAuthService.updateUserProfile.mockResolvedValueOnce({ success: true });
      const { useUpdateProfileMutation, authKeys } = await import('./useAuthQueries');
      const { result, queryClient } = withQueryClient(() => useUpdateProfileMutation());

      const previousProfile = {
        id: 'u1',
        username: 'oldname',
        email: 'a@b.com',
        avatar_url: 'https://old.avatar/img.png',
        native_language: 'en',
        current_level: 1,
        total_experience: 0,
        learning_streak: 0,
        last_activity: null,
        preferences: { dailyGoal: 10, difficulty: 'Beginner' as const, notifications: false },
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };

      // Pre-populate the cache so onMutate can snapshot it
      queryClient.setQueryData(authKeys.profile('u1'), previousProfile);

      const mutatePromise = result.mutateAsync({
        userId: 'u1',
        profileData: {
          username: 'newname',
          avatar_url: 'https://new.avatar/img.png',
          native_language: 'ja',
          preferences: { dailyGoal: 20, difficulty: 'Intermediate', notifications: true },
        },
      });

      // Flush the onMutate microtasks so the optimistic write is applied
      await flushPromises();

      const optimistic = queryClient.getQueryData(authKeys.profile('u1')) as typeof previousProfile;
      expect(optimistic.username).toBe('newname');
      expect(optimistic.avatar_url).toBe('https://new.avatar/img.png');
      expect(optimistic.native_language).toBe('ja');
      expect(optimistic.preferences).toEqual({
        dailyGoal: 20,
        difficulty: 'Intermediate',
        notifications: true,
      });
      // Unchanged fields must be preserved
      expect(optimistic.current_level).toBe(1);

      await mutatePromise;
    });

    it('rolls back cache to previous profile when mutation rejects', async () => {
      mockAuthService.updateUserProfile.mockRejectedValueOnce(new Error('Network error'));
      const { useUpdateProfileMutation, authKeys } = await import('./useAuthQueries');
      const { result, queryClient } = withQueryClient(() => useUpdateProfileMutation());

      const previousProfile = {
        id: 'u1',
        username: 'oldname',
        email: 'a@b.com',
        avatar_url: null,
        native_language: 'en',
        current_level: 1,
        total_experience: 0,
        learning_streak: 0,
        last_activity: null,
        preferences: { dailyGoal: 10, difficulty: 'Beginner' as const, notifications: false },
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };

      queryClient.setQueryData(authKeys.profile('u1'), previousProfile);

      await expect(
        result.mutateAsync({ userId: 'u1', profileData: { username: 'newname' } }),
      ).rejects.toThrow('Network error');

      await flushPromises();

      const restored = queryClient.getQueryData(authKeys.profile('u1'));
      expect(restored).toEqual(previousProfile);
    });

    it('does not write to cache when no previous profile is in cache', async () => {
      mockAuthService.updateUserProfile.mockResolvedValueOnce({ success: true });
      const { useUpdateProfileMutation, authKeys } = await import('./useAuthQueries');
      const { result, queryClient } = withQueryClient(() => useUpdateProfileMutation());

      // Ensure no cached profile exists for this user
      expect(queryClient.getQueryData(authKeys.profile('u2'))).toBeUndefined();

      const mutatePromise = result.mutateAsync({
        userId: 'u2',
        profileData: { username: 'newname' },
      });

      expect(queryClient.getQueryData(authKeys.profile('u2'))).toBeUndefined();

      await mutatePromise;
      await flushPromises();

      // The cache should remain empty — no optimistic write was applied
      expect(queryClient.getQueryData(authKeys.profile('u2'))).toBeUndefined();
    });

    it('normalizes empty-string username and avatar_url to null in optimistic update', async () => {
      mockAuthService.updateUserProfile.mockResolvedValueOnce({ success: true });
      const { useUpdateProfileMutation, authKeys } = await import('./useAuthQueries');
      const { result, queryClient } = withQueryClient(() => useUpdateProfileMutation());

      const previousProfile = {
        id: 'u3',
        username: 'existing',
        email: 'c@d.com',
        avatar_url: 'https://old.avatar/img.png',
        native_language: 'en',
        current_level: 1,
        total_experience: 0,
        learning_streak: 0,
        last_activity: null,
        preferences: { dailyGoal: 10, difficulty: 'Beginner' as const, notifications: false },
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };

      queryClient.setQueryData(authKeys.profile('u3'), previousProfile);

      const mutatePromise = result.mutateAsync({
        userId: 'u3',
        profileData: { username: '', avatar_url: '' },
      });

      await flushPromises();

      const optimistic = queryClient.getQueryData(authKeys.profile('u3')) as typeof previousProfile;
      // Empty strings should be coerced to null via the `|| null` branch
      expect(optimistic.username).toBeNull();
      expect(optimistic.avatar_url).toBeNull();

      await mutatePromise;
    });
  });
});

import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  authService,
  type SignUpData,
  type SignInData,
  type ProfileData,
} from 'src/services/authService';
import type { Profile, UserPreferences } from 'src/types/shared';

/**
 * Query key factory for auth-related queries
 */
export const authKeys = {
  all: ['auth'] as const,
  session: () => [...authKeys.all, 'session'] as const,
  user: () => [...authKeys.all, 'user'] as const,
  profile: (userId: string) => [...authKeys.all, 'profile', userId] as const,
};

/**
 * Hook to get the current user session
 */
export function useSessionQuery() {
  return useQuery({
    queryKey: authKeys.session(),
    queryFn: () => authService.getCurrentSession(),
    staleTime: 30 * 60 * 1000, // 30 minutes - sessions are long-lived
    gcTime: 60 * 60 * 1000, // 1 hour
  });
}

/**
 * Hook to get the current user
 */
export function useCurrentUserQuery() {
  return useQuery({
    queryKey: authKeys.user(),
    queryFn: () => authService.getCurrentUser(),
    staleTime: 30 * 60 * 1000, // 30 minutes
    gcTime: 60 * 60 * 1000, // 1 hour
  });
}

/**
 * Hook to get user profile
 */
export function useUserProfileQuery(userId: string | null | undefined) {
  return useQuery({
    queryKey: authKeys.profile(userId || ''),
    queryFn: () => authService.getUserProfile(userId || ''),
    enabled: !!userId, // Only run query if userId is provided
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
}

/**
 * Hook to sign up a new user
 */
export function useSignUpMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: SignUpData) => authService.signUp(data),
    onSuccess: (result) => {
      if (result.success) {
        // Invalidate session and user queries
        queryClient.invalidateQueries({ queryKey: authKeys.session() });
        queryClient.invalidateQueries({ queryKey: authKeys.user() });
      }
    },
  });
}

/**
 * Hook to sign in
 */
export function useSignInMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: SignInData) => authService.signIn(data),
    onSuccess: (result) => {
      if (result.success && result.user) {
        // Invalidate and refetch session, user, and profile queries
        queryClient.invalidateQueries({ queryKey: authKeys.session() });
        queryClient.invalidateQueries({ queryKey: authKeys.user() });
        queryClient.invalidateQueries({ queryKey: authKeys.profile(result.user.id) });
      }
    },
  });
}

/**
 * Hook to sign out
 */
export function useSignOutMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => authService.signOut(),
    onSuccess: () => {
      // Clear all queries on sign out
      queryClient.clear();
    },
  });
}

/**
 * Hook to confirm sign up
 */
export function useConfirmSignUpMutation() {
  return useMutation({
    mutationFn: ({ email, code }: { email: string; code: string }) =>
      authService.confirmSignUp(email, code),
  });
}

/**
 * Hook to resend sign up code
 */
export function useResendSignUpCodeMutation() {
  return useMutation({
    mutationFn: (email: string) => authService.resendSignUpCode(email),
  });
}

/**
 * Hook to reset password
 */
export function useResetPasswordMutation() {
  return useMutation({
    mutationFn: (email: string) => authService.resetPassword(email),
  });
}

/**
 * Hook to update user profile
 */
export function useUpdateProfileMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, profileData }: { userId: string; profileData: ProfileData }) =>
      authService.updateUserProfile(userId, profileData),
    onSuccess: (_result, variables) => {
      // Invalidate the specific user's profile query
      queryClient.invalidateQueries({ queryKey: authKeys.profile(variables.userId) });
    },
    // Optimistic update
    onMutate: async ({ userId, profileData }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: authKeys.profile(userId) });

      // Snapshot the previous value
      const previousProfile = queryClient.getQueryData<Profile>(authKeys.profile(userId));

      // Optimistically update to the new value
      if (previousProfile) {
        // Convert undefined to null for Profile compatibility
        const normalizedData: Partial<Profile> = {};
        if (profileData.username !== undefined)
          normalizedData.username = profileData.username || null;
        if (profileData.avatar_url !== undefined)
          normalizedData.avatar_url = profileData.avatar_url || null;
        if (profileData.native_language !== undefined)
          normalizedData.native_language = profileData.native_language;
        if (profileData.preferences !== undefined) {
          normalizedData.preferences = profileData.preferences as unknown as UserPreferences;
        }

        queryClient.setQueryData<Profile>(authKeys.profile(userId), {
          ...previousProfile,
          ...normalizedData,
        });
      }

      // Return a context object with the snapshotted value
      return { previousProfile };
    },
    // If the mutation fails, use the context to roll back
    onError: (_err, variables, context) => {
      if (context?.previousProfile) {
        queryClient.setQueryData(authKeys.profile(variables.userId), context.previousProfile);
      }
    },
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { authService } from 'src/services/authService';
import { authKeys } from '@vela/common';

export { authKeys };

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
 * Hook to start Google sign-in through Cognito Hosted UI.
 */
export function useSignInWithGoogleMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => authService.signInWithGoogle(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: authKeys.session() });
      queryClient.invalidateQueries({ queryKey: authKeys.user() });
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

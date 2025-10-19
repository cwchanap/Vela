import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { progressService } from 'src/services/progressService';

/**
 * Query key factory for progress-related queries
 */
export const progressKeys = {
  all: ['progress'] as const,
  analytics: (userId: string | null) => [...progressKeys.all, 'analytics', userId] as const,
};

/**
 * Hook to fetch progress analytics for the current user
 */
export function useProgressAnalyticsQuery(userId: string | null | undefined) {
  return useQuery({
    queryKey: progressKeys.analytics(userId || null),
    queryFn: () => progressService.getProgressAnalytics(),
    enabled: !!userId, // Only run query if user is logged in
    staleTime: 2 * 60 * 1000, // 2 minutes - progress data changes frequently
    gcTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to record a game session
 */
export function useRecordGameSessionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      gameType,
      score,
      durationSeconds,
      questionsAnswered,
      correctAnswers,
      experienceGained,
    }: {
      gameType: string;
      score: number;
      durationSeconds: number;
      questionsAnswered: number;
      correctAnswers: number;
      experienceGained: number;
    }) =>
      progressService.recordGameSession(
        gameType,
        score,
        durationSeconds,
        questionsAnswered,
        correctAnswers,
        experienceGained,
      ),
    onSuccess: () => {
      // Invalidate progress analytics to refetch updated data
      queryClient.invalidateQueries({ queryKey: progressKeys.all });
    },
  });
}

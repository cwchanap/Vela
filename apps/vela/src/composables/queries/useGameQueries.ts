import { useQuery } from '@tanstack/vue-query';
import { gameService } from 'src/services/gameService';

/**
 * Query key factory for game-related queries
 */
export const gameKeys = {
  all: ['games'] as const,
  vocabulary: (count: number) => [...gameKeys.all, 'vocabulary', count] as const,
  sentences: (count: number) => [...gameKeys.all, 'sentences', count] as const,
};

/**
 * Hook to fetch vocabulary questions for games
 */
export function useVocabularyQuestionsQuery(count = 10) {
  return useQuery({
    queryKey: gameKeys.vocabulary(count),
    queryFn: () => gameService.getVocabularyQuestions(count),
    staleTime: 2 * 60 * 1000, // 2 minutes - game questions should be relatively fresh
    gcTime: 5 * 60 * 1000, // 5 minutes
    // Don't refetch game questions automatically
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}

/**
 * Hook to fetch sentence questions for games
 */
export function useSentenceQuestionsQuery(count = 5) {
  return useQuery({
    queryKey: gameKeys.sentences(count),
    queryFn: () => gameService.getSentenceQuestions(count),
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000, // 5 minutes
    // Don't refetch game questions automatically
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  getSavedSentences,
  deleteSavedSentence,
  type SavedSentence,
} from 'src/services/savedSentencesService';

/**
 * Query key factory for saved sentences queries
 */
export const savedSentencesKeys = {
  all: ['saved-sentences'] as const,
  list: (limit: number) => [...savedSentencesKeys.all, 'list', limit] as const,
};

/**
 * Hook to fetch saved sentences
 */
export function useSavedSentencesQuery(limit = 50) {
  return useQuery({
    queryKey: savedSentencesKeys.list(limit),
    queryFn: () => getSavedSentences(limit),
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to delete a saved sentence
 */
export function useDeleteSavedSentenceMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sentenceId: string) => deleteSavedSentence(sentenceId),
    onSuccess: () => {
      // Invalidate all saved sentences queries to refetch
      queryClient.invalidateQueries({ queryKey: savedSentencesKeys.all });
    },
    // Optimistic update
    onMutate: async (sentenceId) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: savedSentencesKeys.all });

      // Snapshot the previous value
      const previousData = queryClient.getQueryData<SavedSentence[]>(savedSentencesKeys.list(50));

      // Optimistically update by filtering out the deleted sentence
      if (previousData) {
        const filtered = previousData.filter((s) => s.sentence_id !== sentenceId);
        queryClient.setQueryData<SavedSentence[]>(savedSentencesKeys.list(50), filtered);
      }

      // Return a context object with the snapshotted value
      return { previousData };
    },
    // If the mutation fails, use the context to roll back
    onError: (_err, _variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(savedSentencesKeys.list(50), context.previousData);
      }
    },
  });
}

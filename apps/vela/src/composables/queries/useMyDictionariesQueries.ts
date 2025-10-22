import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  getMyDictionaries,
  deleteDictionaryEntry,
  type MyDictionaryEntry,
} from 'src/services/myDictionariesService';

/**
 * Query key factory for my dictionaries queries
 */
export const myDictionariesKeys = {
  all: ['my-dictionaries'] as const,
  list: (limit: number) => [...myDictionariesKeys.all, 'list', limit] as const,
};

/**
 * Hook to fetch dictionary entries
 */
export function useMyDictionariesQuery(limit = 50) {
  return useQuery({
    queryKey: myDictionariesKeys.list(limit),
    queryFn: () => getMyDictionaries(limit),
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook to delete a dictionary entry
 */
export function useDeleteDictionaryEntryMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (entryId: string) => deleteDictionaryEntry(entryId),
    onSuccess: () => {
      // Invalidate all my dictionaries queries to refetch
      queryClient.invalidateQueries({ queryKey: myDictionariesKeys.all });
    },
    // Optimistic update
    onMutate: async (entryId) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: myDictionariesKeys.all });

      // Snapshot the previous value
      const previousData = queryClient.getQueryData<MyDictionaryEntry[]>(
        myDictionariesKeys.list(50),
      );

      // Optimistically update by filtering out the deleted sentence
      if (previousData) {
        const filtered = previousData.filter((entry) => entry.sentence_id !== entryId);
        queryClient.setQueryData<MyDictionaryEntry[]>(myDictionariesKeys.list(50), filtered);
      }

      // Return a context object with the snapshotted value
      return { previousData };
    },
    // If the mutation fails, use the context to roll back
    onError: (_err, _variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(myDictionariesKeys.list(50), context.previousData);
      }
    },
  });
}

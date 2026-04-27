import { useMutation, useQuery } from '@tanstack/vue-query';
import { dictionaryKeys } from '@vela/common';
import {
  addFlashcard,
  lookupWord,
  type AddFlashcardPayload,
} from 'src/services/vocabularyService';

export function dictionaryLookupQueryOptions(dictionaryForm: string) {
  return {
    queryKey: dictionaryKeys.lookup(dictionaryForm),
    queryFn: () => lookupWord(dictionaryForm),
  };
}

export function useDictionaryLookupQuery(dictionaryForm: string) {
  return useQuery(dictionaryLookupQueryOptions(dictionaryForm));
}

export function useAddFlashcardMutation() {
  return useMutation({
    mutationFn: (payload: AddFlashcardPayload) => addFlashcard(payload),
  });
}

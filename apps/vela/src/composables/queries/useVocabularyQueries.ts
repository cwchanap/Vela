import { useMutation, useQuery } from '@tanstack/vue-query';
import { dictionaryKeys } from '@vela/common';
import { addFlashcard, lookupWord, type AddFlashcardPayload } from 'src/services/vocabularyService';

export function dictionaryLookupQueryOptions(dictionaryForm: string, reading?: string) {
  const baseKey: string[] = [...dictionaryKeys.lookup(dictionaryForm)];
  const queryKey = reading ? [...baseKey, reading] : baseKey;
  return {
    queryKey,
    queryFn: () => lookupWord(dictionaryForm, reading),
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

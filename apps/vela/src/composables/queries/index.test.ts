import { describe, expect, it } from 'vitest';
import {
  authKeys,
  dictionaryLookupQueryOptions,
  gameKeys,
  myDictionariesKeys,
  progressKeys,
  useAddFlashcardMutation,
  useMyDictionariesQuery,
  useProgressAnalyticsQuery,
  useSessionQuery,
  useTTSSettingsQuery,
  useVocabularyQuestionsQuery,
} from './index';

describe('composables/queries/index', () => {
  it('re-exports the auth query helpers', () => {
    expect(authKeys).toBeDefined();
    expect(typeof useSessionQuery).toBe('function');
  });

  it('re-exports the game query helpers', () => {
    expect(gameKeys).toBeDefined();
    expect(typeof useVocabularyQuestionsQuery).toBe('function');
  });

  it('re-exports the progress query helpers', () => {
    expect(progressKeys).toBeDefined();
    expect(typeof useProgressAnalyticsQuery).toBe('function');
  });

  it('re-exports the dictionary query helpers', () => {
    expect(myDictionariesKeys).toBeDefined();
    expect(typeof useMyDictionariesQuery).toBe('function');
    expect(typeof dictionaryLookupQueryOptions).toBe('function');
    expect(typeof useAddFlashcardMutation).toBe('function');
  });

  it('re-exports the TTS query helpers', () => {
    expect(typeof useTTSSettingsQuery).toBe('function');
  });
});

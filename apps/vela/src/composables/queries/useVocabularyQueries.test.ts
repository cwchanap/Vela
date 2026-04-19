import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withQueryClient } from 'src/test-utils/withQueryClient';

const mockLookupWord = vi.fn();
const mockAddFlashcard = vi.fn();

vi.mock('src/services/vocabularyService', () => ({
  lookupWord: mockLookupWord,
  addFlashcard: mockAddFlashcard,
}));

describe('useVocabularyQueries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds dictionary lookup query options with a stable key', async () => {
    mockLookupWord.mockResolvedValue(null);
    const { dictionaryLookupQueryOptions } = await import('./useVocabularyQueries');

    const options = dictionaryLookupQueryOptions('猫');
    expect(options.queryKey).toEqual(['dictionary', 'lookup', '猫']);

    await options.queryFn();
    expect(mockLookupWord).toHaveBeenCalledWith('猫');
  });

  it('calls addFlashcard through the mutation wrapper', async () => {
    mockAddFlashcard.mockResolvedValue({
      vocabulary_id: 'vocab-123',
      created: true,
      alreadyInSRS: false,
    });
    const { useAddFlashcardMutation } = await import('./useVocabularyQueries');
    const { result } = withQueryClient(() => useAddFlashcardMutation());

    await result.mutateAsync({
      japanese_word: '猫',
      reading: 'ねこ',
      english_translation: 'cat',
    });

    expect(mockAddFlashcard).toHaveBeenCalledWith({
      japanese_word: '猫',
      reading: 'ねこ',
      english_translation: 'cat',
    });
  });
});

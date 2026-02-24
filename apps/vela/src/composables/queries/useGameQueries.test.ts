import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { withQueryClient } from 'src/test-utils/withQueryClient';

const mockGameService = {
  getVocabularyQuestions: vi.fn(),
  getSentenceQuestions: vi.fn(),
};

vi.mock('src/services/gameService', () => ({ gameService: mockGameService }));

describe('useGameQueries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('gameKeys', () => {
    it('generates correct vocabulary key', async () => {
      const { gameKeys } = await import('./useGameQueries');
      expect(gameKeys.vocabulary(10)).toEqual(['games', 'vocabulary', 10]);
    });

    it('generates correct sentences key', async () => {
      const { gameKeys } = await import('./useGameQueries');
      expect(gameKeys.sentences(5)).toEqual(['games', 'sentences', 5]);
    });

    it('generates correct all key', async () => {
      const { gameKeys } = await import('./useGameQueries');
      expect(gameKeys.all).toEqual(['games']);
    });
  });

  describe('useVocabularyQuestionsQuery', () => {
    it('resolves with empty array when no questions exist', async () => {
      mockGameService.getVocabularyQuestions.mockResolvedValue([]);
      const { useVocabularyQuestionsQuery } = await import('./useGameQueries');
      const { result } = withQueryClient(() => useVocabularyQuestionsQuery(10));
      await flushPromises();
      expect(result.data.value).toEqual([]);
      expect(result.isPending.value).toBe(false);
    });

    it('calls gameService.getVocabularyQuestions with custom count', async () => {
      mockGameService.getVocabularyQuestions.mockResolvedValue([]);
      const { useVocabularyQuestionsQuery } = await import('./useGameQueries');
      withQueryClient(() => useVocabularyQuestionsQuery(20));
      await flushPromises();
      expect(mockGameService.getVocabularyQuestions).toHaveBeenCalledWith(20);
    });

    it('calls gameService.getVocabularyQuestions with default count of 10', async () => {
      mockGameService.getVocabularyQuestions.mockResolvedValue([]);
      const { useVocabularyQuestionsQuery } = await import('./useGameQueries');
      withQueryClient(() => useVocabularyQuestionsQuery());
      await flushPromises();
      expect(mockGameService.getVocabularyQuestions).toHaveBeenCalledWith(10);
    });
  });

  describe('useSentenceQuestionsQuery', () => {
    it('resolves with empty array when no questions exist', async () => {
      mockGameService.getSentenceQuestions.mockResolvedValue([]);
      const { useSentenceQuestionsQuery } = await import('./useGameQueries');
      const { result } = withQueryClient(() => useSentenceQuestionsQuery(5));
      await flushPromises();
      expect(result.data.value).toEqual([]);
      expect(result.isPending.value).toBe(false);
    });

    it('calls gameService.getSentenceQuestions with default count of 5', async () => {
      mockGameService.getSentenceQuestions.mockResolvedValue([]);
      const { useSentenceQuestionsQuery } = await import('./useGameQueries');
      withQueryClient(() => useSentenceQuestionsQuery());
      await flushPromises();
      expect(mockGameService.getSentenceQuestions).toHaveBeenCalledWith(5);
    });

    it('calls gameService.getSentenceQuestions with custom count', async () => {
      mockGameService.getSentenceQuestions.mockResolvedValue([]);
      const { useSentenceQuestionsQuery } = await import('./useGameQueries');
      withQueryClient(() => useSentenceQuestionsQuery(15));
      await flushPromises();
      expect(mockGameService.getSentenceQuestions).toHaveBeenCalledWith(15);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VueQueryPlugin, QueryClient } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { flushPromises } from '@vue/test-utils';

const mockGameService = {
  getVocabularyQuestions: vi.fn(),
  getSentenceQuestions: vi.fn(),
};

vi.mock('src/services/gameService', () => ({ gameService: mockGameService }));

function withQueryClient<T>(composableFn: () => T): { result: T; queryClient: QueryClient } {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  let result!: T;
  const Wrapper = defineComponent({
    setup() {
      result = composableFn();
      return {};
    },
    template: '<div />',
  });
  mount(Wrapper, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } });
  return { result, queryClient };
}

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
    it('returns a query object', async () => {
      mockGameService.getVocabularyQuestions.mockResolvedValue([]);
      const { useVocabularyQuestionsQuery } = await import('./useGameQueries');
      const { result } = withQueryClient(() => useVocabularyQuestionsQuery(10));
      expect(result).toBeDefined();
      expect(typeof result.isPending).toBe('object');
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
    it('returns a query object', async () => {
      mockGameService.getSentenceQuestions.mockResolvedValue([]);
      const { useSentenceQuestionsQuery } = await import('./useGameQueries');
      const { result } = withQueryClient(() => useSentenceQuestionsQuery(5));
      expect(result).toBeDefined();
      expect(typeof result.isPending).toBe('object');
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

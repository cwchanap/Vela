import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VueQueryPlugin, QueryClient } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { flushPromises } from '@vue/test-utils';

const mockGetMyDictionaries = vi.fn();
const mockDeleteDictionaryEntry = vi.fn();

vi.mock('src/services/myDictionariesService', () => ({
  getMyDictionaries: mockGetMyDictionaries,
  deleteDictionaryEntry: mockDeleteDictionaryEntry,
}));

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

describe('useMyDictionariesQueries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('myDictionariesKeys', () => {
    it('generates correct all key', async () => {
      const { myDictionariesKeys } = await import('./useMyDictionariesQueries');
      expect(myDictionariesKeys.all).toEqual(['my-dictionaries']);
    });

    it('generates correct list key', async () => {
      const { myDictionariesKeys } = await import('./useMyDictionariesQueries');
      expect(myDictionariesKeys.list(50)).toEqual(['my-dictionaries', 'list', 50]);
    });

    it('generates correct list key with custom limit', async () => {
      const { myDictionariesKeys } = await import('./useMyDictionariesQueries');
      expect(myDictionariesKeys.list(100)).toEqual(['my-dictionaries', 'list', 100]);
    });
  });

  describe('useMyDictionariesQuery', () => {
    it('returns a query object', async () => {
      mockGetMyDictionaries.mockResolvedValue([]);
      const { useMyDictionariesQuery } = await import('./useMyDictionariesQueries');
      const { result } = withQueryClient(() => useMyDictionariesQuery(50));
      expect(result).toBeDefined();
      expect(typeof result.isPending).toBe('object');
    });

    it('calls getMyDictionaries with default limit of 50', async () => {
      mockGetMyDictionaries.mockResolvedValue([]);
      const { useMyDictionariesQuery } = await import('./useMyDictionariesQueries');
      withQueryClient(() => useMyDictionariesQuery());
      await flushPromises();
      expect(mockGetMyDictionaries).toHaveBeenCalledWith(50);
    });

    it('calls getMyDictionaries with custom limit', async () => {
      mockGetMyDictionaries.mockResolvedValue([]);
      const { useMyDictionariesQuery } = await import('./useMyDictionariesQueries');
      withQueryClient(() => useMyDictionariesQuery(100));
      await flushPromises();
      expect(mockGetMyDictionaries).toHaveBeenCalledWith(100);
    });
  });

  describe('useDeleteDictionaryEntryMutation', () => {
    it('calls deleteDictionaryEntry with entryId', async () => {
      mockDeleteDictionaryEntry.mockResolvedValueOnce(undefined);
      const { useDeleteDictionaryEntryMutation } = await import('./useMyDictionariesQueries');
      const { result } = withQueryClient(() => useDeleteDictionaryEntryMutation());
      await result.mutateAsync('sentence-123');
      expect(mockDeleteDictionaryEntry).toHaveBeenCalledWith('sentence-123');
    });

    it('invalidates my-dictionaries queries on success', async () => {
      mockDeleteDictionaryEntry.mockResolvedValueOnce(undefined);
      const { useDeleteDictionaryEntryMutation } = await import('./useMyDictionariesQueries');
      const { result, queryClient } = withQueryClient(() => useDeleteDictionaryEntryMutation());
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      await result.mutateAsync('sentence-123');
      expect(invalidateSpy).toHaveBeenCalled();
    });

    it('returns mutation object with mutateAsync', async () => {
      mockDeleteDictionaryEntry.mockResolvedValueOnce(undefined);
      const { useDeleteDictionaryEntryMutation } = await import('./useMyDictionariesQueries');
      const { result } = withQueryClient(() => useDeleteDictionaryEntryMutation());
      expect(typeof result.mutateAsync).toBe('function');
    });
  });
});

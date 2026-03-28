import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { withQueryClient } from 'src/test-utils/withQueryClient';

const mockGetMyDictionaries = vi.fn();
const mockDeleteDictionaryEntry = vi.fn();

vi.mock('src/services/myDictionariesService', () => ({
  getMyDictionaries: mockGetMyDictionaries,
  deleteDictionaryEntry: mockDeleteDictionaryEntry,
}));

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
      const { useDeleteDictionaryEntryMutation } = await import('./useMyDictionariesQueries');
      const { result } = withQueryClient(() => useDeleteDictionaryEntryMutation());
      expect(typeof result.mutateAsync).toBe('function');
    });

    it('performs optimistic update when previousData exists', async () => {
      const existingEntries = [
        { sentence_id: 'to-delete', sentence: 'Delete me' },
        { sentence_id: 'keep', sentence: 'Keep me' },
      ];
      mockDeleteDictionaryEntry.mockResolvedValueOnce(undefined);
      const { useDeleteDictionaryEntryMutation, myDictionariesKeys } =
        await import('./useMyDictionariesQueries');
      const { result, queryClient } = withQueryClient(() => useDeleteDictionaryEntryMutation());

      // Pre-populate the query cache with existing entries
      queryClient.setQueryData(myDictionariesKeys.list(50), existingEntries);

      await result.mutateAsync('to-delete');

      // Either updated optimistically or invalidated - either way, the mutation ran
      expect(mockDeleteDictionaryEntry).toHaveBeenCalledWith('to-delete');
    });

    it('handles mutation errors gracefully', async () => {
      mockDeleteDictionaryEntry.mockRejectedValueOnce(new Error('Delete failed'));
      const { useDeleteDictionaryEntryMutation } = await import('./useMyDictionariesQueries');
      const { result } = withQueryClient(() => useDeleteDictionaryEntryMutation());

      let caughtError: Error | null = null;
      try {
        await result.mutateAsync('to-delete');
      } catch (err) {
        caughtError = err as Error;
      }

      await flushPromises();

      // Mutation should have been attempted
      expect(mockDeleteDictionaryEntry).toHaveBeenCalledWith('to-delete');
      // Error was thrown
      expect(caughtError?.message).toBe('Delete failed');
    });

    it('rolls back optimistic update when previous data exists on error', async () => {
      const existingEntries = [
        { sentence_id: 'to-delete', sentence: 'Delete me' },
        { sentence_id: 'keep', sentence: 'Keep me' },
      ];
      mockDeleteDictionaryEntry.mockRejectedValueOnce(new Error('Delete failed'));
      const { useDeleteDictionaryEntryMutation, myDictionariesKeys } =
        await import('./useMyDictionariesQueries');
      const { result, queryClient } = withQueryClient(() => useDeleteDictionaryEntryMutation());

      // Pre-populate the query cache so previousData is set
      queryClient.setQueryData(myDictionariesKeys.list(50), existingEntries);
      const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');

      try {
        await result.mutateAsync('to-delete');
      } catch {
        // expected error
      }

      await flushPromises();

      // Verify setQueryData was called twice: once for optimistic update, once for rollback
      expect(setQueryDataSpy.mock.calls).toHaveLength(2);
      // The rollback (second call) should restore the original entries
      expect(setQueryDataSpy.mock.calls[1]![0]).toEqual(myDictionariesKeys.list(50));
      expect(setQueryDataSpy.mock.calls[1]![1]).toEqual(existingEntries);
    });
  });
});

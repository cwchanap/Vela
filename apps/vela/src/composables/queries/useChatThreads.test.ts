import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import { QueryClient } from '@tanstack/vue-query';
import { chatKeys } from '@vela/common';
import { withQueryClient } from 'src/test-utils/withQueryClient';
import type { ChatThreadSummaryDTO } from 'src/services/chatHistoryService';

const mockListChatThreads = vi.fn();
const mockGetChatMessages = vi.fn();
const mockSaveChatMessage = vi.fn();
const mockUpdateChatThread = vi.fn();
const mockDeleteChatThread = vi.fn();

vi.mock('src/services/chatHistoryService', () => ({
  listChatThreads: mockListChatThreads,
  getChatMessages: mockGetChatMessages,
  saveChatMessage: mockSaveChatMessage,
  updateChatThread: mockUpdateChatThread,
  deleteChatThread: mockDeleteChatThread,
}));

const mockUser = ref<{ id: string } | null>(null);
const mockSession = ref<{ user: { id: string } | null } | null>(null);

vi.mock('src/stores/auth', () => ({
  useAuthStore: () => ({
    user: mockUser,
    session: mockSession,
  }),
}));

vi.mock('pinia', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pinia')>();
  return {
    ...actual,
    storeToRefs: (store: { user: unknown; session: unknown }) => ({
      user: store.user,
      session: store.session,
    }),
  };
});

const userA = { id: 'user-a' };
const userB = { id: 'user-b' };

const signIn = (account: { id: string }) => {
  mockUser.value = account;
  mockSession.value = { user: account };
};

const thread = (id: string, title: string, updatedAt = 1_000): ChatThreadSummaryDTO => ({
  ThreadId: id,
  title,
  createdAt: 500,
  updatedAt,
});

const threadsKey = (account: { id: string }) => chatKeys.threads(account.id);

// The default test client uses gcTime 0, which garbage-collects unobserved
// cache entries between a mutation settling and the assertion. Tests that
// read cached thread data after a mutation keep entries alive instead.
const cacheClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });

describe('useChatThreads', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.value = null;
    mockSession.value = null;
  });

  afterEach(() => {
    if (cleanup) {
      cleanup();
      cleanup = undefined;
    }
  });

  describe('useChatThreads query', () => {
    it('does not fetch threads when no user is authenticated', async () => {
      const { useChatThreads } = await import('./useChatThreads');
      const { cleanup: qcCleanup } = withQueryClient(() => useChatThreads());
      cleanup = qcCleanup;
      await flushPromises();
      expect(mockListChatThreads).not.toHaveBeenCalled();
    });

    it('fetches threads for the authenticated user', async () => {
      signIn(userA);
      const threads = [thread('t-1', 'First'), thread('t-2', 'Second')];
      mockListChatThreads.mockResolvedValue(threads);
      const { useChatThreads } = await import('./useChatThreads');
      const { result, cleanup: qcCleanup } = withQueryClient(() => useChatThreads());
      cleanup = qcCleanup;
      await flushPromises();
      expect(mockListChatThreads).toHaveBeenCalledTimes(1);
      expect(mockListChatThreads).toHaveBeenCalledWith('user-a');
      expect(result.data.value).toEqual(threads);
    });

    it('fetches threads using the session identity before the profile loads', async () => {
      mockSession.value = { user: userA };
      mockListChatThreads.mockResolvedValue([]);
      const { useChatThreads } = await import('./useChatThreads');
      const { cleanup: qcCleanup } = withQueryClient(() => useChatThreads());
      cleanup = qcCleanup;
      await flushPromises();
      expect(mockListChatThreads).toHaveBeenCalledWith('user-a');
    });

    it('exposes the error when the thread list fails to load', async () => {
      signIn(userA);
      mockListChatThreads.mockRejectedValue(new Error('List failed'));
      const { useChatThreads } = await import('./useChatThreads');
      const { result, cleanup: qcCleanup } = withQueryClient(() => useChatThreads());
      cleanup = qcCleanup;
      await flushPromises();
      expect(result.isError.value).toBe(true);
      expect(result.error.value).toBeInstanceOf(Error);
    });

    it('keeps thread caches isolated per user and refetches after an account switch', async () => {
      signIn(userA);
      const threadsA = [thread('t-a', 'A thread')];
      const threadsB = [thread('t-b', 'B thread')];
      mockListChatThreads.mockResolvedValueOnce(threadsA).mockResolvedValueOnce(threadsB);
      const { useChatThreads } = await import('./useChatThreads');
      const { result, queryClient, cleanup: qcCleanup } = withQueryClient(() => useChatThreads());
      cleanup = qcCleanup;
      await flushPromises();

      expect(result.data.value).toEqual(threadsA);
      expect(queryClient.getQueryData(threadsKey(userA))).toEqual(threadsA);

      signIn(userB);
      await flushPromises();

      expect(mockListChatThreads).toHaveBeenCalledTimes(2);
      expect(result.data.value).toEqual(threadsB);
      expect(queryClient.getQueryData(threadsKey(userB))).toEqual(threadsB);
      expect(queryClient.getQueryData(threadsKey(userA))).toEqual(threadsA);
    });
  });

  describe('useUpdateThread', () => {
    it('applies an optimistic title update then invalidates the list on success', async () => {
      signIn(userA);
      const existing = [thread('t-1', 'Old title'), thread('t-2', 'Other')];
      let resolvePatch!: (_value: ChatThreadSummaryDTO) => void;
      mockUpdateChatThread.mockImplementation(
        () =>
          new Promise<ChatThreadSummaryDTO>((resolve) => {
            resolvePatch = resolve;
          }),
      );
      const { useUpdateThread } = await import('./useChatThreads');
      const { result, queryClient, cleanup: qcCleanup } = withQueryClient(() => useUpdateThread());
      cleanup = qcCleanup;
      queryClient.setQueryData(threadsKey(userA), existing);
      const cancelSpy = vi.spyOn(queryClient, 'cancelQueries');
      const setDataSpy = vi.spyOn(queryClient, 'setQueryData');
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const pending = result.mutateAsync({
        threadId: 't-1',
        patch: { title: 'New title' },
        userId: 'user-a',
      });

      await vi.waitFor(() => {
        expect(cancelSpy).toHaveBeenCalledWith({ queryKey: threadsKey(userA) });
        expect(setDataSpy).toHaveBeenCalledWith(
          threadsKey(userA),
          expect.arrayContaining([
            expect.objectContaining({ ThreadId: 't-1', title: 'New title' }),
            expect.objectContaining({ ThreadId: 't-2', title: 'Other' }),
          ]),
        );
      });

      resolvePatch({ ...existing[0]!, title: 'New title', updatedAt: 9_999 });
      await pending;

      expect(mockUpdateChatThread).toHaveBeenCalledWith('t-1', { title: 'New title' }, 'user-a');
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: threadsKey(userA) });
    });

    it('restores the previous list when the rename fails', async () => {
      signIn(userA);
      const existing = [thread('t-1', 'Old title'), thread('t-2', 'Other')];
      mockUpdateChatThread.mockRejectedValue(new Error('Rename failed'));
      const { useUpdateThread } = await import('./useChatThreads');
      const { result, queryClient, cleanup: qcCleanup } = withQueryClient(() => useUpdateThread());
      cleanup = qcCleanup;
      queryClient.setQueryData(threadsKey(userA), existing);
      const setDataSpy = vi.spyOn(queryClient, 'setQueryData');
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      await expect(
        result.mutateAsync({ threadId: 't-1', patch: { title: 'New title' }, userId: 'user-a' }),
      ).rejects.toThrow('Rename failed');

      const optimisticCall = setDataSpy.mock.calls[0];
      const rollbackCall = setDataSpy.mock.calls[1];
      expect(optimisticCall?.[0]).toEqual(threadsKey(userA));
      expect(optimisticCall?.[1]).toEqual(
        expect.arrayContaining([expect.objectContaining({ ThreadId: 't-1', title: 'New title' })]),
      );
      expect(rollbackCall?.[0]).toEqual(threadsKey(userA));
      expect(rollbackCall?.[1]).toEqual(existing);
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: threadsKey(userA) });
    });

    it('scopes optimistic rename and rollback to the initiating user after an auth switch', async () => {
      signIn(userA);
      const existingA = [thread('t-1', 'A title')];
      const existingB = [thread('t-9', 'B title')];
      let rejectPatch!: (_reason?: unknown) => void;
      mockUpdateChatThread.mockImplementation(
        () =>
          new Promise<ChatThreadSummaryDTO>((_resolve, reject) => {
            rejectPatch = reject;
          }),
      );
      const { useUpdateThread } = await import('./useChatThreads');
      const { result, queryClient, cleanup: qcCleanup } = withQueryClient(() => useUpdateThread());
      cleanup = qcCleanup;
      queryClient.setQueryData(threadsKey(userA), existingA);
      queryClient.setQueryData(threadsKey(userB), existingB);
      const setDataSpy = vi.spyOn(queryClient, 'setQueryData');
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const pending = result.mutateAsync({
        threadId: 't-1',
        patch: { title: 'Renamed' },
        userId: 'user-a',
      });

      await vi.waitFor(() => {
        expect(setDataSpy).toHaveBeenCalledWith(
          threadsKey(userA),
          expect.arrayContaining([expect.objectContaining({ ThreadId: 't-1', title: 'Renamed' })]),
        );
      });
      expect(setDataSpy).not.toHaveBeenCalledWith(threadsKey(userB), expect.anything());

      signIn(userB);
      rejectPatch(new Error('Rename failed'));
      await expect(pending).rejects.toThrow('Rename failed');

      const keysWritten = setDataSpy.mock.calls.map((call) => call[0]);
      expect(keysWritten).toEqual([threadsKey(userA), threadsKey(userA)]);
      expect(setDataSpy.mock.calls[1]?.[1]).toEqual(existingA);
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: threadsKey(userA) });
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: threadsKey(userB) });
    });

    it('clears cached lastLlmAt on an optimistic model patch', async () => {
      signIn(userA);
      const existing = thread('t-1', 'T');
      existing.model = { provider: 'google', model: 'gemini-3.8-flash' };
      existing.lastLlmAt = 1700000000000;
      mockUpdateChatThread.mockResolvedValue({ ...existing, updatedAt: 2_000 });
      const { useUpdateThread } = await import('./useChatThreads');
      const {
        result,
        queryClient,
        cleanup: qcCleanup,
      } = withQueryClient(() => useUpdateThread(), cacheClient());
      cleanup = qcCleanup;
      queryClient.setQueryData(threadsKey(userA), [existing]);

      await result.mutateAsync({
        threadId: 't-1',
        patch: { model: { provider: 'anthropic', model: 'claude-opus-4' } },
        userId: 'user-a',
      });
      await flushPromises();

      const cached = queryClient.getQueryData<ChatThreadSummaryDTO[]>(threadsKey(userA))![0]!;
      expect(cached.model).toEqual({ provider: 'anthropic', model: 'claude-opus-4' });
      expect(cached.lastLlmAt).toBeUndefined();
    });

    it('preserves cached lastLlmAt on a title-only patch', async () => {
      signIn(userA);
      const existing = thread('t-1', 'T');
      existing.lastLlmAt = 1700000000000;
      mockUpdateChatThread.mockResolvedValue({ ...existing, title: 'Renamed' });
      const { useUpdateThread } = await import('./useChatThreads');
      const {
        result,
        queryClient,
        cleanup: qcCleanup,
      } = withQueryClient(() => useUpdateThread(), cacheClient());
      cleanup = qcCleanup;
      queryClient.setQueryData(threadsKey(userA), [existing]);

      await result.mutateAsync({ threadId: 't-1', patch: { title: 'Renamed' }, userId: 'user-a' });
      await flushPromises();

      expect(
        queryClient.getQueryData<ChatThreadSummaryDTO[]>(threadsKey(userA))![0]!.lastLlmAt,
      ).toBe(1700000000000);
    });

    it('rolls back the old model and timestamp when a model patch fails', async () => {
      signIn(userA);
      const existing = thread('t-1', 'T', 1_000);
      existing.model = { provider: 'google', model: 'gemini-3.8-flash' };
      existing.lastLlmAt = 1700000000000;
      mockUpdateChatThread.mockRejectedValue(new Error('Patch failed'));
      const { useUpdateThread } = await import('./useChatThreads');
      const { result, queryClient, cleanup: qcCleanup } = withQueryClient(() => useUpdateThread());
      cleanup = qcCleanup;
      queryClient.setQueryData(threadsKey(userA), [existing]);
      const setDataSpy = vi.spyOn(queryClient, 'setQueryData');

      await expect(
        result.mutateAsync({
          threadId: 't-1',
          patch: { model: { provider: 'anthropic', model: 'claude-opus-4' } },
          userId: 'user-a',
        }),
      ).rejects.toThrow('Patch failed');
      await flushPromises();

      // The rollback restores the whole previous row — old model, cache
      // evidence and updatedAt — exactly as stored before the patch.
      const rollbackCall = setDataSpy.mock.calls[1];
      expect(rollbackCall?.[0]).toEqual(threadsKey(userA));
      expect(rollbackCall?.[1]).toEqual([existing]);
    });
  });

  describe('useSaveChatMessage', () => {
    it('updates the cached thread lastLlmAt in place after an assistant save without refetching', async () => {
      signIn(userA);
      mockSaveChatMessage.mockResolvedValue(undefined);
      const t1 = thread('t-1', 'First', 500);
      const t2 = thread('t-2', 'Second', 500);
      t2.lastLlmAt = 111;
      const { useSaveChatMessage } = await import('./useChatThreads');
      const {
        result,
        queryClient,
        cleanup: qcCleanup,
      } = withQueryClient(() => useSaveChatMessage(), cacheClient());
      cleanup = qcCleanup;
      queryClient.setQueryData(threadsKey(userA), [t1, t2]);
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      await result.mutateAsync({
        threadId: 't-2',
        userId: 'user-a',
        message: 'ai reply',
        isUser: false,
        lastLlmAt: 222,
      });

      const cached = queryClient.getQueryData<ChatThreadSummaryDTO[]>(threadsKey(userA))!;
      expect(cached[1]!.lastLlmAt).toBe(222);
      expect(cached[1]!.updatedAt).toBe(500);
      expect(cached[0]!.lastLlmAt).toBeUndefined();
      expect(invalidateSpy).not.toHaveBeenCalled();
      expect(mockListChatThreads).not.toHaveBeenCalled();
    });

    it('clears the cached thread lastLlmAt after an assistant save without cache evidence', async () => {
      signIn(userA);
      mockSaveChatMessage.mockResolvedValue(undefined);
      const t1 = thread('t-1', 'First', 500);
      t1.lastLlmAt = 111;
      const { useSaveChatMessage } = await import('./useChatThreads');
      const {
        result,
        queryClient,
        cleanup: qcCleanup,
      } = withQueryClient(() => useSaveChatMessage(), cacheClient());
      cleanup = qcCleanup;
      queryClient.setQueryData(threadsKey(userA), [t1]);

      await result.mutateAsync({
        threadId: 't-1',
        userId: 'user-a',
        message: 'ai reply',
        isUser: false,
      });

      const cached = queryClient.getQueryData<ChatThreadSummaryDTO[]>(threadsKey(userA))![0]!;
      expect(cached.lastLlmAt).toBeUndefined();
      expect(cached.updatedAt).toBe(500);
    });

    it('does not touch the thread cache after a user save', async () => {
      signIn(userA);
      mockSaveChatMessage.mockResolvedValue(undefined);
      const existing = [thread('t-1', 'First', 500)];
      const { useSaveChatMessage } = await import('./useChatThreads');
      const {
        result,
        queryClient,
        cleanup: qcCleanup,
      } = withQueryClient(() => useSaveChatMessage(), cacheClient());
      cleanup = qcCleanup;
      queryClient.setQueryData(threadsKey(userA), existing);

      await result.mutateAsync({
        threadId: 't-1',
        userId: 'user-a',
        message: 'hello',
        isUser: true,
        lastLlmAt: 222,
      });

      expect(queryClient.getQueryData(threadsKey(userA))).toEqual(existing);
    });

    it('scopes the assistant-save cache update to the initiating user', async () => {
      signIn(userA);
      mockSaveChatMessage.mockResolvedValue(undefined);
      const threadsA = [thread('t-1', 'A', 500)];
      const threadsB = [thread('t-1', 'B', 500)];
      const { useSaveChatMessage } = await import('./useChatThreads');
      const {
        result,
        queryClient,
        cleanup: qcCleanup,
      } = withQueryClient(() => useSaveChatMessage(), cacheClient());
      cleanup = qcCleanup;
      queryClient.setQueryData(threadsKey(userA), threadsA);
      queryClient.setQueryData(threadsKey(userB), threadsB);

      await result.mutateAsync({
        threadId: 't-1',
        userId: 'user-a',
        message: 'ai reply',
        isUser: false,
        lastLlmAt: 222,
      });

      expect(
        queryClient.getQueryData<ChatThreadSummaryDTO[]>(threadsKey(userA))![0]!.lastLlmAt,
      ).toBe(222);
      expect(queryClient.getQueryData(threadsKey(userB))).toEqual(threadsB);
    });
  });

  describe('useDeleteThread', () => {
    it('removes the deleted thread from cache and invalidates the initiating user list after a successful delete', async () => {
      signIn(userA);
      mockDeleteChatThread.mockResolvedValue(undefined);
      const { useDeleteThread } = await import('./useChatThreads');
      const { result, queryClient, cleanup: qcCleanup } = withQueryClient(() => useDeleteThread());
      cleanup = qcCleanup;
      queryClient.setQueryData(threadsKey(userA), [
        { ThreadId: 't-1', title: 'T1', createdAt: 1, updatedAt: 1 },
        { ThreadId: 't-2', title: 'T2', createdAt: 2, updatedAt: 2 },
      ]);
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      await result.mutateAsync({ threadId: 't-1', userId: 'user-a' });

      expect(mockDeleteChatThread).toHaveBeenCalledWith('t-1', 'user-a');
      const remaining = queryClient.getQueryData(threadsKey(userA)) as any[];
      expect(remaining).toEqual([{ ThreadId: 't-2', title: 'T2', createdAt: 2, updatedAt: 2 }]);
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: threadsKey(userA) });
    });

    it('does not invalidate the list when delete fails', async () => {
      signIn(userA);
      mockDeleteChatThread.mockRejectedValue(new Error('Delete failed'));
      const { useDeleteThread } = await import('./useChatThreads');
      const { result, queryClient, cleanup: qcCleanup } = withQueryClient(() => useDeleteThread());
      cleanup = qcCleanup;
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      await expect(result.mutateAsync({ threadId: 't-1', userId: 'user-a' })).rejects.toThrow(
        'Delete failed',
      );

      expect(invalidateSpy).not.toHaveBeenCalled();
    });

    it('scopes delete invalidation to the initiating user after an auth switch', async () => {
      signIn(userA);
      let resolveDelete!: () => void;
      mockDeleteChatThread.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveDelete = resolve;
          }),
      );
      const { useDeleteThread } = await import('./useChatThreads');
      const { result, queryClient, cleanup: qcCleanup } = withQueryClient(() => useDeleteThread());
      cleanup = qcCleanup;
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      const pending = result.mutateAsync({ threadId: 't-1', userId: 'user-a' });
      await flushPromises();

      signIn(userB);
      resolveDelete();
      await pending;

      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: threadsKey(userA) });
      expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: threadsKey(userB) });
    });
  });
});

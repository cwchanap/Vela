import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import { QueryClient } from '@tanstack/vue-query';
import { chatKeys } from '@vela/common';
import { withQueryClient } from 'src/test-utils/withQueryClient';
import type { ChatThreadModelDTO, ChatThreadSummaryDTO } from 'src/services/chatHistoryService';

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
let mockSessionGeneration = 0;

vi.mock('src/stores/auth', () => ({
  useAuthStore: () => ({
    user: mockUser,
    session: mockSession,
    // Read dynamically, like the real Pinia store's unwrapped state.
    get sessionGeneration() {
      return mockSessionGeneration;
    },
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
    mockSessionGeneration = 0;
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

    it('restores the failed rename without discarding unrelated rows', async () => {
      signIn(userA);
      const existing = [thread('t-1', 'Old title'), thread('t-2', 'Other')];
      mockUpdateChatThread.mockRejectedValue(new Error('Rename failed'));
      const { useUpdateThread } = await import('./useChatThreads');
      const { result, queryClient, cleanup: qcCleanup } = withQueryClient(() => useUpdateThread());
      cleanup = qcCleanup;
      queryClient.setQueryData(threadsKey(userA), existing);
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

      await expect(
        result.mutateAsync({ threadId: 't-1', patch: { title: 'New title' }, userId: 'user-a' }),
      ).rejects.toThrow('Rename failed');
      await flushPromises();

      // The rollback restores the failed mutation's own change; the
      // untouched sibling row must survive byte-for-byte.
      expect(queryClient.getQueryData(threadsKey(userA))).toEqual(existing);
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
      await flushPromises();

      // The rename belongs to a session that already ended: its callbacks
      // must not write any cache (userA's rollback included) and must not
      // trigger or cancel fetches for either user.
      const keysWritten = setDataSpy.mock.calls.map((call) => call[0]);
      expect(keysWritten).toEqual([threadsKey(userA)]);
      expect(invalidateSpy).not.toHaveBeenCalled();
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
      const {
        result,
        queryClient,
        cleanup: qcCleanup,
      } = withQueryClient(() => useUpdateThread(), cacheClient());
      cleanup = qcCleanup;
      queryClient.setQueryData(threadsKey(userA), [existing]);

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
      expect(queryClient.getQueryData(threadsKey(userA))).toEqual([existing]);
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

  // Cache-consistency contracts for the assistant-save / model-PATCH write
  // path. The fake server mirrors the design spec's Minimal HTTP contract:
  // every GET answers with an immutable snapshot taken when the request
  // ARRIVES (never live rows at response time), assistant saves SET/REMOVE
  // lastLlmAt transactionally, and a model PATCH commits model+REMOVE
  // together. Assistant saves and PATCHes expose independent commit/response
  // gates so a slow HTTP response can be separated from the server-side
  // commit, exactly like the real server transaction contract.
  describe('cache consistency: cancel-and-replace write path', () => {
    const T0 = 1_700_000_000_000;
    const anthropicRow: ChatThreadModelDTO = { provider: 'anthropic', model: 'claude-opus-5-5' };
    const openaiPair: ChatThreadModelDTO = { provider: 'openai', model: 'gpt-6.1-sol' };

    const cloneRow = (row: ChatThreadSummaryDTO): ChatThreadSummaryDTO => ({
      ...row,
      model: row.model ? { ...row.model } : undefined,
    });

    const makeServer = () => {
      const rows = new Map<string, ChatThreadSummaryDTO>();
      return {
        rows,
        seed(row: ChatThreadSummaryDTO) {
          rows.set(row.ThreadId, cloneRow(row));
        },
        list(): ChatThreadSummaryDTO[] {
          return [...rows.values()].map(cloneRow);
        },
        // User-save transaction: creates the row with a server-derived title.
        commitUser(threadId: string, message: string, at: number) {
          const existing = rows.get(threadId);
          if (existing) {
            existing.updatedAt = at;
            return;
          }
          rows.set(threadId, {
            ThreadId: threadId,
            title: message.trim().slice(0, 60) || 'New conversation',
            createdAt: at,
            updatedAt: at,
          });
        },
        // Assistant-save transaction: SET lastLlmAt when present, REMOVE it
        // otherwise; missing thread is a server 404.
        commitAssistant(threadId: string, lastLlmAt: number | undefined) {
          const row = rows.get(threadId);
          if (!row) throw new Error(`fake server: assistant save 404 for ${threadId}`);
          if (lastLlmAt === undefined) delete row.lastLlmAt;
          else row.lastLlmAt = lastLlmAt;
        },
        // Model PATCH: SET model and REMOVE lastLlmAt in the same update.
        commitModelPatch(threadId: string, model: ChatThreadModelDTO) {
          const row = rows.get(threadId);
          if (!row) throw new Error(`fake server: PATCH 404 for ${threadId}`);
          row.model = { ...model };
          delete row.lastLlmAt;
        },
        // Title PATCH: SET the confirmed title and bump updatedAt.
        commitTitlePatch(threadId: string, title: string, at: number) {
          const row = rows.get(threadId);
          if (!row) throw new Error(`fake server: title PATCH 404 for ${threadId}`);
          row.title = title;
          row.updatedAt = at;
        },
      };
    };

    type Server = ReturnType<typeof makeServer>;
    let server: Server;
    let listGates: Array<Promise<void>>;
    let patchGates: Array<{
      commit?: Promise<void>;
      fail?: Error;
      respond?: Promise<void>;
    }>;
    let assistantGates: Array<{ commit?: Promise<void>; respond?: Promise<void> }>;
    const cleanups: Array<() => void> = [];

    const installMocks = () => {
      mockListChatThreads.mockImplementation(() => {
        const snapshot = server.list(); // immutable request-time snapshot
        const gate = listGates.length > 0 ? listGates.shift()! : Promise.resolve();
        return gate.then(() => snapshot.map(cloneRow));
      });
      mockSaveChatMessage.mockImplementation(
        async (
          threadId: string,
          _userId: string,
          message: string,
          isUser: boolean,
          metadata?: { lastLlmAt?: number | undefined },
        ) => {
          if (isUser) {
            server.commitUser(threadId, message, 2_000);
            return;
          }
          const gates = assistantGates.shift();
          if (gates?.commit) await gates.commit;
          server.commitAssistant(threadId, metadata?.lastLlmAt);
          if (gates?.respond) await gates.respond;
        },
      );
      mockUpdateChatThread.mockImplementation(async (threadId: string, patch) => {
        const gates = patchGates.shift();
        if (gates?.commit) await gates.commit;
        if (gates?.fail) {
          if (gates.respond) await gates.respond;
          throw gates.fail;
        }
        if (patch.model !== undefined) server.commitModelPatch(threadId, patch.model);
        if (patch.title !== undefined) server.commitTitlePatch(threadId, patch.title, 5_000);
        if (gates?.respond) await gates.respond;
        return cloneRow(server.rows.get(threadId)!);
      });
    };

    const mountComposables = async (uid: string) => {
      mockUser.value = { id: uid };
      mockSession.value = { user: { id: uid } };
      const { useChatThreads, useSaveChatMessage, useUpdateThread } =
        await import('./useChatThreads');
      const harness = withQueryClient(
        () => ({
          threads: useChatThreads(),
          save: useSaveChatMessage(),
          update: useUpdateThread(),
        }),
        new QueryClient({
          defaultOptions: {
            queries: { retry: false, gcTime: Infinity },
            mutations: { retry: false, gcTime: Infinity },
          },
        }),
      );
      cleanups.push(harness.cleanup);
      await flushPromises();
      return { result: harness.result, queryClient: harness.queryClient };
    };

    const cachedRow = (
      client: QueryClient,
      userId: string,
      threadId: string,
    ): ChatThreadSummaryDTO | undefined =>
      client
        .getQueryData<ChatThreadSummaryDTO[]>(threadsKey({ id: userId }))
        ?.find((row) => row.ThreadId === threadId);

    beforeEach(() => {
      server = makeServer();
      installMocks();
      listGates = [];
      patchGates = [];
      assistantGates = [];
    });

    afterEach(() => {
      cleanups.splice(0).forEach((cleanup) => cleanup());
    });

    const deferred = <T>() => {
      let resolve!: (_value: T) => void;
      const promise = new Promise<T>((res) => {
        resolve = res;
      });
      return { promise, resolve };
    };

    it('applies the confirmed SET over a cancelled pre-write GET and replaces it with exactly one post-commit GET', async () => {
      const uid = 'cr-set-user';
      server.seed({
        ThreadId: 't-1',
        title: 'Persisted',
        createdAt: 500,
        updatedAt: 1000,
        model: anthropicRow,
        lastLlmAt: 111,
      });
      const { result, queryClient } = await mountComposables(uid);
      expect(cachedRow(queryClient, uid, 't-1')?.lastLlmAt).toBe(111);

      // A same-client list GET is in flight while the assistant transaction
      // commits: its request-time snapshot predates the commit.
      const staleGet = deferred<void>();
      listGates = [staleGet.promise];
      void queryClient.invalidateQueries({ queryKey: chatKeys.threads(uid) });
      await flushPromises();

      const commitGate = deferred<void>();
      const respondGate = deferred<void>();
      assistantGates = [{ commit: commitGate.promise, respond: respondGate.promise }];
      const save = result.save.mutateAsync({
        threadId: 't-1',
        userId: uid,
        message: 'ai reply',
        isUser: false,
        lastLlmAt: T0,
      });
      await flushPromises();
      expect(server.rows.get('t-1')!.lastLlmAt).toBe(111); // not committed yet

      commitGate.resolve();
      await flushPromises();
      expect(server.rows.get('t-1')!.lastLlmAt).toBe(T0); // transaction committed

      respondGate.resolve();
      await save;
      await flushPromises();

      // The stale snapshot never publishes: the save cancelled it and issued
      // exactly one replacement GET whose snapshot postdates the commit. No
      // other fetch is added.
      expect(mockListChatThreads.mock.calls.length).toBe(3);
      expect(cachedRow(queryClient, uid, 't-1')?.lastLlmAt).toBe(T0);

      staleGet.resolve();
      await flushPromises();
      // The cancelled GET's dropped result cannot revert the confirmed value.
      expect(cachedRow(queryClient, uid, 't-1')?.lastLlmAt).toBe(T0);
    });

    it('applies the confirmed REMOVE and issues no fetch when no list GET is in flight', async () => {
      const uid = 'cr-remove-user';
      server.seed({
        ThreadId: 't-1',
        title: 'Persisted',
        createdAt: 500,
        updatedAt: 1000,
        model: anthropicRow,
        lastLlmAt: 111,
      });
      const { result, queryClient } = await mountComposables(uid);

      await result.save.mutateAsync({
        threadId: 't-1',
        userId: uid,
        message: 'ai reply',
        isUser: false,
      });

      expect(server.rows.get('t-1')!.lastLlmAt).toBeUndefined();
      expect(cachedRow(queryClient, uid, 't-1')?.lastLlmAt).toBeUndefined();
      expect(cachedRow(queryClient, uid, 't-1')?.updatedAt).toBe(1000); // no updatedAt bump
      // Nothing was in flight at success: nothing to replace — no redundant
      // post-assistant fetch (spec constraint).
      expect(mockListChatThreads.mock.calls.length).toBe(1);
    });

    it('inserts the first thread row with server-derived title, updatedAt and evidence via the replacement GET', async () => {
      const uid = 'cr-row-user';
      const { result, queryClient } = await mountComposables(uid);
      expect(result.threads.data.value).toEqual([]);

      // First user save creates the row with a server-derived title.
      await result.save.mutateAsync({
        threadId: 't-1',
        userId: uid,
        message: 'こんにちは、元気ですか？',
        isUser: true,
      });
      expect(server.rows.get('t-1')!.title).toBe('こんにちは、元気ですか？');

      // The page's post-user-save refresh GET snapshots the new row (without
      // evidence — the assistant turn has not committed) and is still
      // pending when the assistant save commits. A cancelled GET is the only
      // fetch that could have carried the row itself, so it must be
      // replaced, not merely dropped.
      const refresh = deferred<void>();
      listGates = [refresh.promise];
      void queryClient.invalidateQueries({ queryKey: chatKeys.threads(uid) });
      await flushPromises();

      const commitGate = deferred<void>();
      const respondGate = deferred<void>();
      assistantGates = [{ commit: commitGate.promise, respond: respondGate.promise }];
      const save = result.save.mutateAsync({
        threadId: 't-1',
        userId: uid,
        message: 'ai reply',
        isUser: false,
        lastLlmAt: T0,
      });
      await flushPromises();
      commitGate.resolve();
      await flushPromises();
      respondGate.resolve();
      await save;
      await flushPromises();

      // The superseded refresh never lands; the row reaches the cache
      // through the replacement GET with server-derived title, updatedAt
      // ordering and the committed evidence.
      expect(mockListChatThreads.mock.calls.length).toBe(3);
      const row = cachedRow(queryClient, uid, 't-1');
      expect(row?.title).toBe('こんにちは、元気ですか？');
      expect(row?.updatedAt).toBe(2_000);
      expect(row?.lastLlmAt).toBe(T0);

      refresh.resolve();
      await flushPromises();
      expect(cachedRow(queryClient, uid, 't-1')?.title).toBe('こんにちは、元気ですか？');
      expect(cachedRow(queryClient, uid, 't-1')?.lastLlmAt).toBe(T0);
    });

    it('settles the save while list GETs hang and issues the replacement instead of waiting', async () => {
      const uid = 'cr-hang-user';
      server.seed({
        ThreadId: 't-1',
        title: 'Persisted',
        createdAt: 500,
        updatedAt: 1000,
        model: anthropicRow,
        lastLlmAt: 111,
      });
      const { result, queryClient } = await mountComposables(uid);

      // The page's post-user-save refresh hangs (no HTTP timeout) and is
      // still pending when the assistant save resolves. The replacement
      // hangs too: the save must never wait on either.
      listGates = [new Promise<void>(() => {}), new Promise<void>(() => {})];
      void queryClient.invalidateQueries({ queryKey: chatKeys.threads(uid) });
      await flushPromises();

      await result.save.mutateAsync({
        threadId: 't-1',
        userId: uid,
        message: 'ai reply',
        isUser: false,
      });

      // The save settled without waiting on any GET, the confirmed REMOVE is
      // on the cache, and exactly one replacement GET was issued.
      expect(mockListChatThreads.mock.calls.length).toBe(3);
      expect(cachedRow(queryClient, uid, 't-1')?.lastLlmAt).toBeUndefined();
      expect(server.rows.get('t-1')!.lastLlmAt).toBeUndefined();
    });

    it('keeps evidence off the thread when a stale callback resolves after a model PATCH committed', async () => {
      const uid = 'cr-stale-user';
      server.seed({
        ThreadId: 't-1',
        title: 'Persisted',
        createdAt: 500,
        updatedAt: 1000,
        model: anthropicRow,
        lastLlmAt: T0 - 120_000,
      });
      const { result, queryClient } = await mountComposables(uid);

      // A delayed old-session assistant save: the transaction commits before
      // the PATCH, but its response only reaches the client afterwards.
      const commitGate = deferred<void>();
      const respondGate = deferred<void>();
      assistantGates = [{ commit: commitGate.promise, respond: respondGate.promise }];
      const save = result.save.mutateAsync({
        threadId: 't-1',
        userId: uid,
        message: 'late ai reply',
        isUser: false,
        lastLlmAt: T0,
        // In the app this closure is isStaleOperation(opGen, sessionGen);
        // true here = the save belongs to an operation/session that ended.
        isStale: () => true,
      });
      await flushPromises();

      // While the save is unobserved the user re-opens the thread and PATCHes
      // the model. Server commit order: assistant SET first, PATCH second —
      // final server truth is "no evidence on the new model".
      const patchGate = deferred<void>();
      patchGates = [{ commit: patchGate.promise }];
      const patch = result.update.mutateAsync({
        threadId: 't-1',
        patch: { model: openaiPair },
        userId: uid,
      });
      await flushPromises();
      expect(cachedRow(queryClient, uid, 't-1')?.model).toEqual(openaiPair); // optimistic

      const heldGet = deferred<void>();
      listGates = [heldGet.promise]; // hold the PATCH's onSettled refresh
      commitGate.resolve();
      await flushPromises();
      expect(server.rows.get('t-1')!.lastLlmAt).toBe(T0);

      patchGate.resolve();
      await flushPromises();
      expect(server.rows.get('t-1')!.lastLlmAt).toBeUndefined(); // final server truth
      expect(cachedRow(queryClient, uid, 't-1')?.model).toEqual(openaiPair);
      expect(cachedRow(queryClient, uid, 't-1')?.lastLlmAt).toBeUndefined();

      respondGate.resolve(); // only now does the stale callback resolve
      await save;
      await patch;
      await flushPromises();

      heldGet.resolve(); // the PATCH's refresh lands its truthful snapshot
      await flushPromises();

      // The stale callback touched nothing: the confirmed removal survives
      // and the truthful snapshot is not re-modelled by older evidence.
      expect(cachedRow(queryClient, uid, 't-1')?.model).toEqual(openaiPair);
      expect(cachedRow(queryClient, uid, 't-1')?.lastLlmAt).toBeUndefined();
      expect(server.rows.get('t-1')!.model).toEqual(openaiPair);
    });

    it('converges when the save resolves before the PATCH commits', async () => {
      const uid = 'cr-order-user';
      server.seed({
        ThreadId: 't-1',
        title: 'Persisted',
        createdAt: 500,
        updatedAt: 1000,
        model: anthropicRow,
        lastLlmAt: T0 - 120_000,
      });
      const { result, queryClient } = await mountComposables(uid);

      await result.save.mutateAsync({
        threadId: 't-1',
        userId: uid,
        message: 'ai reply',
        isUser: false,
        lastLlmAt: T0,
        isStale: () => true,
      });
      expect(server.rows.get('t-1')!.lastLlmAt).toBe(T0);

      await result.update.mutateAsync({
        threadId: 't-1',
        patch: { model: openaiPair },
        userId: uid,
      });
      await flushPromises();

      expect(server.rows.get('t-1')!.lastLlmAt).toBeUndefined();
      expect(cachedRow(queryClient, uid, 't-1')?.model).toEqual(openaiPair);
      expect(cachedRow(queryClient, uid, 't-1')?.lastLlmAt).toBeUndefined();
    });

    it('re-applies the confirmed model and cleared evidence after a mid-flight pre-PATCH GET landed and the follow-up refresh stalls', async () => {
      const uid = 'cr-patch-user';
      server.seed({
        ThreadId: 't-1',
        title: 'Persisted',
        createdAt: 500,
        updatedAt: 1000,
        model: anthropicRow,
        lastLlmAt: 111,
      });
      const { result, queryClient } = await mountComposables(uid);

      const patchGate = deferred<void>();
      patchGates = [{ commit: patchGate.promise }];
      const patch = result.update.mutateAsync({
        threadId: 't-1',
        patch: { model: openaiPair },
        userId: uid,
      });
      await flushPromises();
      expect(cachedRow(queryClient, uid, 't-1')?.model).toEqual(openaiPair); // optimistic

      // A GET that flew during the PATCH lands the pre-PATCH snapshot after
      // the optimistic write, reverting the row (last write wins).
      const midGet = deferred<void>();
      listGates = [midGet.promise];
      void queryClient.invalidateQueries({ queryKey: chatKeys.threads(uid) });
      await flushPromises();
      midGet.resolve();
      await flushPromises();
      expect(cachedRow(queryClient, uid, 't-1')?.model).toEqual(anthropicRow);
      expect(cachedRow(queryClient, uid, 't-1')?.lastLlmAt).toBe(111);

      // The PATCH succeeds server-side while its onSettled refresh hangs
      // forever (no HTTP timeout): the confirmed response must be applied to
      // the cache without waiting for it.
      listGates = [new Promise<void>(() => {})];
      patchGate.resolve();
      await flushPromises();
      await patch;

      expect(server.rows.get('t-1')!.model).toEqual(openaiPair);
      expect(server.rows.get('t-1')!.lastLlmAt).toBeUndefined();
      expect(cachedRow(queryClient, uid, 't-1')?.model).toEqual(openaiPair);
      expect(cachedRow(queryClient, uid, 't-1')?.lastLlmAt).toBeUndefined();
    });

    it('lets a fetched snapshot with genuinely newer server truth win over the last write', async () => {
      const uid = 'cr-newer-user';
      server.seed({
        ThreadId: 't-1',
        title: 'Persisted',
        createdAt: 500,
        updatedAt: 1000,
        model: anthropicRow,
      });
      const { result, queryClient } = await mountComposables(uid);

      await result.save.mutateAsync({
        threadId: 't-1',
        userId: uid,
        message: 'ai reply',
        isUser: false,
        lastLlmAt: T0,
      });
      expect(cachedRow(queryClient, uid, 't-1')?.lastLlmAt).toBe(T0);

      // Evidence disappears server-side through a channel this client did
      // not observe (e.g. another device — cross-client CAS stays deferred).
      // The contract under test: a fetch that READ the newer truth must
      // publish it; the client's last write value must not mask it based on
      // write/request ordering.
      server.commitAssistant('t-1', undefined);

      void queryClient.invalidateQueries({ queryKey: chatKeys.threads(uid) });
      await flushPromises();

      expect(cachedRow(queryClient, uid, 't-1')?.lastLlmAt).toBeUndefined();
      expect(mockListChatThreads.mock.calls.length).toBe(2);
    });

    // Reviewer findings on the PATCH path (residual review of 7c3314f):
    // same-thread PATCH callbacks must not overwrite newer confirmed metadata
    // when they resolve late, must not act after a session/account change, and
    // rollback must be scoped to the failed mutation's own thread/fields
    // instead of restoring a historical list snapshot.
    describe('PATCH ordering, session guards and rollback scope', () => {
      const anthropicRow: ChatThreadModelDTO = { provider: 'anthropic', model: 'claude-opus-5-5' };
      const openaiPair: ChatThreadModelDTO = { provider: 'openai', model: 'gpt-6.1-sol' };

      it('keeps the later rename confirmed when an earlier same-thread rename responds last', async () => {
        const uid = 'po-order-user';
        server.seed({ ThreadId: 't-1', title: 'Original', createdAt: 500, updatedAt: 1000 });
        const { result, queryClient } = await mountComposables(uid);

        const respond1 = deferred<void>();
        const respond2 = deferred<void>();
        patchGates = [{ respond: respond1.promise }, { respond: respond2.promise }];
        const patch1 = result.update.mutateAsync({
          threadId: 't-1',
          patch: { title: 'First' },
          userId: uid,
        });
        await flushPromises();
        expect(server.rows.get('t-1')!.title).toBe('First'); // commits in issue order
        const patch2 = result.update.mutateAsync({
          threadId: 't-1',
          patch: { title: 'Second' },
          userId: uid,
        });
        await flushPromises();
        expect(server.rows.get('t-1')!.title).toBe('Second');
        expect(cachedRow(queryClient, uid, 't-1')?.title).toBe('Second'); // optimistic

        // Responses return in reverse commit order. Hold the onSettled
        // refresh GETs forever: the callbacks must resolve the conflict
        // locally instead of relying on a refetch.
        listGates = [new Promise<void>(() => {}), new Promise<void>(() => {})];
        respond2.resolve();
        await flushPromises();
        respond1.resolve();
        await patch1;
        await patch2;
        await flushPromises();

        expect(server.rows.get('t-1')!.title).toBe('Second');
        expect(cachedRow(queryClient, uid, 't-1')?.title).toBe('Second');
      });

      it('restores only the failed rename and preserves a confirmed model change on another thread', async () => {
        const uid = 'po-cross-user';
        server.seed({ ThreadId: 't-1', title: 'Original', createdAt: 500, updatedAt: 1000 });
        server.seed({
          ThreadId: 't-2',
          title: 'Other',
          createdAt: 500,
          updatedAt: 1000,
          model: anthropicRow,
          lastLlmAt: 111,
        });
        const { result, queryClient } = await mountComposables(uid);

        const renameFail = deferred<void>();
        patchGates = [{ fail: new Error('rename failed'), respond: renameFail.promise }];
        const rename = result.update.mutateAsync({
          threadId: 't-1',
          patch: { title: 'Renamed' },
          userId: uid,
        });
        await flushPromises();
        expect(cachedRow(queryClient, uid, 't-1')?.title).toBe('Renamed'); // optimistic

        // A model change on another thread commits and confirms meanwhile.
        await result.update.mutateAsync({
          threadId: 't-2',
          patch: { model: openaiPair },
          userId: uid,
        });
        await flushPromises();
        expect(cachedRow(queryClient, uid, 't-2')?.model).toEqual(openaiPair);
        expect(cachedRow(queryClient, uid, 't-2')?.lastLlmAt).toBeUndefined();

        // The rename now fails: its rollback must not resurrect t-2's old
        // model or cache evidence. Its follow-up refresh GET is held
        // forever, so no fetch can heal a whole-list rollback afterwards.
        listGates = [new Promise<void>(() => {})];
        renameFail.resolve();
        await expect(rename).rejects.toThrow('rename failed');
        await flushPromises();

        expect(cachedRow(queryClient, uid, 't-1')?.title).toBe('Original');
        expect(cachedRow(queryClient, uid, 't-2')?.model).toEqual(openaiPair);
        expect(cachedRow(queryClient, uid, 't-2')?.lastLlmAt).toBeUndefined();
      });

      it('preserves a confirmed model change on the same thread when an earlier rename fails', async () => {
        const uid = 'po-same-user';
        server.seed({
          ThreadId: 't-1',
          title: 'Original',
          createdAt: 500,
          updatedAt: 1000,
          model: anthropicRow,
          lastLlmAt: 111,
        });
        const { result, queryClient } = await mountComposables(uid);

        const renameFail = deferred<void>();
        patchGates = [{ fail: new Error('rename failed'), respond: renameFail.promise }];
        const rename = result.update.mutateAsync({
          threadId: 't-1',
          patch: { title: 'Renamed' },
          userId: uid,
        });
        await flushPromises();
        expect(cachedRow(queryClient, uid, 't-1')?.title).toBe('Renamed');

        // A model change on the SAME thread commits and confirms while the
        // rename response is still outstanding; both follow-up refresh GETs
        // are held forever so no fetch can repair the cache afterwards.
        listGates = [new Promise<void>(() => {}), new Promise<void>(() => {})];
        await result.update.mutateAsync({
          threadId: 't-1',
          patch: { model: openaiPair },
          userId: uid,
        });
        await flushPromises();
        expect(cachedRow(queryClient, uid, 't-1')?.model).toEqual(openaiPair);
        expect(cachedRow(queryClient, uid, 't-1')?.lastLlmAt).toBeUndefined();

        renameFail.resolve();
        await expect(rename).rejects.toThrow('rename failed');
        await flushPromises();

        expect(cachedRow(queryClient, uid, 't-1')?.title).toBe('Original');
        expect(cachedRow(queryClient, uid, 't-1')?.model).toEqual(openaiPair);
        expect(cachedRow(queryClient, uid, 't-1')?.lastLlmAt).toBeUndefined();
      });

      it('leaves the cache and in-flight fetches alone when a PATCH callback outlives its session', async () => {
        const uid = 'po-session-user';
        server.seed({ ThreadId: 't-1', title: 'Original', createdAt: 500, updatedAt: 1000 });
        const { result, queryClient } = await mountComposables(uid);

        const commit = deferred<void>();
        const respond = deferred<void>();
        patchGates = [{ commit: commit.promise, respond: respond.promise }];
        const patch = result.update.mutateAsync({
          threadId: 't-1',
          patch: { title: 'Renamed' },
          userId: uid,
        });
        await flushPromises();
        expect(cachedRow(queryClient, uid, 't-1')?.title).toBe('Renamed'); // optimistic

        // Same-user session reset while the PATCH is uncommitted.
        mockSessionGeneration += 1;

        // A new-session list GET is in flight when the old callback resolves.
        const newGet = deferred<void>();
        listGates = [newGet.promise];
        void queryClient.invalidateQueries({ queryKey: chatKeys.threads(uid) });
        await flushPromises();
        const fetchesAtCallback = mockListChatThreads.mock.calls.length;

        commit.resolve();
        respond.resolve();
        await patch;
        await flushPromises();

        // The stale callback must not trigger another fetch, must not cancel
        // the in-flight one, and must not write the cache.
        expect(mockListChatThreads.mock.calls.length).toBe(fetchesAtCallback);
        newGet.resolve();
        await flushPromises();
        expect(cachedRow(queryClient, uid, 't-1')?.title).toBe('Original');
        expect(server.rows.get('t-1')!.title).toBe('Renamed'); // commit landed server-side
      });

      it('returns the title to the original value when both stacked renames fail', async () => {
        const uid = 'po-double-user';
        server.seed({ ThreadId: 't-1', title: 'Original', createdAt: 500, updatedAt: 1000 });
        const { result, queryClient } = await mountComposables(uid);

        const fail1 = deferred<void>();
        const fail2 = deferred<void>();
        patchGates = [
          { fail: new Error('rename failed'), respond: fail1.promise },
          { fail: new Error('rename failed'), respond: fail2.promise },
        ];
        const patch1 = result.update.mutateAsync({
          threadId: 't-1',
          patch: { title: 'First' },
          userId: uid,
        });
        await flushPromises();
        const patch2 = result.update.mutateAsync({
          threadId: 't-1',
          patch: { title: 'Second' },
          userId: uid,
        });
        await flushPromises();
        expect(cachedRow(queryClient, uid, 't-1')?.title).toBe('Second'); // optimistic

        // Hold both follow-up refresh GETs forever: the rollbacks must leave
        // the original title without relying on a refetch.
        listGates = [new Promise<void>(() => {}), new Promise<void>(() => {})];

        fail1.resolve();
        await expect(patch1).rejects.toThrow('rename failed');
        fail2.resolve();
        await expect(patch2).rejects.toThrow('rename failed');
        await flushPromises();

        // No rollback may resurrect a sibling's optimistic title: both failed,
        // so the chain terminates at the pre-optimistic value.
        expect(cachedRow(queryClient, uid, 't-1')?.title).toBe('Original');
        expect(server.rows.get('t-1')!.title).toBe('Original');
      });
    });
  });
});

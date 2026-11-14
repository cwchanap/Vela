import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref } from 'vue';
import { QueryClient } from '@tanstack/vue-query';
import { chatKeys } from '@vela/common';
import { withQueryClient } from 'src/test-utils/withQueryClient';
import { useChatThreads, useDeleteThread, useUpdateThread } from './useChatThreads';
import type { ChatThreadSummaryDTO } from 'src/services/chatHistoryService';

vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn(),
}));

import { fetchAuthSession } from 'aws-amplify/auth';

const mockFetchAuthSession = vi.mocked(fetchAuthSession);
const fetchMock = vi.fn();

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

const retryingClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: 1, retryDelay: 0, gcTime: 15 * 60 * 1000 },
      mutations: { retry: 1, retryDelay: 0, gcTime: 15 * 60 * 1000 },
    },
  });

const sessionFor = (sub: string) => ({
  tokens: {
    idToken: {
      toString: () => `id-token-${sub}`,
      payload: { sub },
    },
  },
});

const okJson = (body: unknown) => ({ ok: true, json: async () => body });

const userA = { id: 'user-a' };
const keyA = chatKeys.threads('user-a');
const keyB = chatKeys.threads('user-b');

const thread = (id: string, title: string, updatedAt = 1_000): ChatThreadSummaryDTO => ({
  ThreadId: id,
  title,
  createdAt: 500,
  updatedAt,
});

describe('chat thread identity binding', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    mockUser.value = null;
    mockSession.value = null;
    mockFetchAuthSession.mockResolvedValue(sessionFor('user-a'));
  });

  afterEach(() => {
    if (cleanup) {
      cleanup();
      cleanup = undefined;
    }
    vi.unstubAllGlobals();
  });

  it('retries the thread list for the same account', async () => {
    const threadsA = [thread('t-a', 'A thread')];
    fetchMock
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValue(okJson({ threads: threadsA }));
    mockUser.value = userA;
    mockSession.value = { user: userA };

    const { result, cleanup: qcCleanup } = withQueryClient(
      () => useChatThreads(),
      retryingClient(),
    );
    cleanup = qcCleanup;

    await vi.waitFor(() => expect(result.data.value).toEqual(threadsA));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never caches another account’s threads under the current key when the token switches mid-retry', async () => {
    const threadsB = [thread('t-b', 'B thread')];
    let rejectFetch!: (_reason?: unknown) => void;
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectFetch = reject;
          }),
      )
      .mockResolvedValue(okJson({ threads: threadsB }));

    mockUser.value = userA;
    mockSession.value = { user: userA };
    const {
      result,
      queryClient,
      cleanup: qcCleanup,
    } = withQueryClient(() => useChatThreads(), retryingClient());
    cleanup = qcCleanup;

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    mockFetchAuthSession.mockResolvedValue(sessionFor('user-b'));
    rejectFetch(new Error('network failure'));

    await vi.waitFor(() => {
      expect(queryClient.getQueryCache().find({ queryKey: keyA })?.state.status).not.toBe(
        'pending',
      );
    });
    expect(result.isError.value).toBe(true);
    expect(result.error.value?.message).toMatch(/account changed/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(keyA)).toBeUndefined();
    expect(queryClient.getQueryData(keyB)).toBeUndefined();
  });

  it('rejects a retried delete once the session switches accounts', async () => {
    let rejectFetch!: (_reason?: unknown) => void;
    fetchMock
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectFetch = reject;
          }),
      )
      .mockResolvedValue(okJson({ ok: true }));

    const {
      result,
      queryClient,
      cleanup: qcCleanup,
    } = withQueryClient(() => useDeleteThread(), retryingClient());
    cleanup = qcCleanup;
    queryClient.setQueryData(keyB, [thread('t-1', 'B thread with the same public id')]);

    const pending = result.mutateAsync({ threadId: 't-1', userId: 'user-a' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    mockFetchAuthSession.mockResolvedValue(sessionFor('user-b'));
    rejectFetch(new Error('network failure'));

    await expect(pending).rejects.toThrow(/account changed/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(keyB)).toEqual([
      thread('t-1', 'B thread with the same public id'),
    ]);
  });

  it('rolls back the optimistic thread update and never fetches when the session switches mid-request', async () => {
    const existing = [thread('t-1', 'Old title'), thread('t-2', 'Other')];
    let resolveAuth!: (_value: unknown) => void;
    mockFetchAuthSession
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveAuth = resolve;
          }),
      )
      .mockResolvedValue(sessionFor('user-b'));

    const {
      result,
      queryClient,
      cleanup: qcCleanup,
    } = withQueryClient(() => useUpdateThread(), retryingClient());
    cleanup = qcCleanup;
    queryClient.setQueryData(keyA, existing);

    const pending = result.mutateAsync({
      threadId: 't-1',
      patch: { title: 'Renamed' },
      userId: 'user-a',
    });

    await vi.waitFor(() => {
      expect(queryClient.getQueryData<ChatThreadSummaryDTO[]>(keyA)?.[0]?.title).toBe('Renamed');
    });

    resolveAuth(sessionFor('user-b'));
    await expect(pending).rejects.toThrow(/account changed/i);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(keyA)).toEqual(existing);
    expect(queryClient.getQueryData(keyB)).toBeUndefined();
  });
});

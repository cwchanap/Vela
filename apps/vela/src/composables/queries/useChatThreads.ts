import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { chatKeys } from '@vela/common';
import { useAuthStore } from 'src/stores/auth';
import {
  deleteChatThread,
  getChatMessages,
  listChatThreads,
  saveChatMessage,
  updateChatThread,
  type ChatHistoryItemDTO,
  type ChatThreadModelDTO,
  type ChatThreadSummaryDTO,
  type PatchChatThreadDTO,
} from 'src/services/chatHistoryService';

export { chatKeys };
export type { ChatHistoryItemDTO, ChatThreadSummaryDTO, PatchChatThreadDTO };

export function useChatThreads() {
  const authStore = useAuthStore();
  const { user, session } = storeToRefs(authStore);
  const userId = computed(() => user.value?.id ?? session.value?.user?.id ?? null);

  return useQuery({
    queryKey: computed(() => chatKeys.threads(userId.value)),
    queryFn: ({ queryKey }) => listChatThreads(queryKey[2] as string),
    enabled: computed(() => !!userId.value),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

// Serialization state for confirmed PATCH cache writes, keyed per
// user+thread. A sidebar rename and a header model change come from
// different composable instances, so the chain lives at module scope;
// entries exist only while a PATCH on that thread is in flight (deleted at
// the last settle), keeping the map bounded.
interface ThreadPatchChain {
  tail: Promise<unknown>;
  pending: number;
  seq: number;
  // Issue-order seq of the newest mutation owning each field: a settle
  // callback may only write fields it still owns (a delayed older callback
  // must never overwrite a newer confirmed value).
  lastWriter: { title: number; model: number };
  writers: { title: number; model: number };
  // Row snapshot taken before the chain's first optimistic write — the value
  // a rollback chain terminates at, even when sibling mutations stacked on
  // the same fields. Successful commits advance it to server truth.
  baselineRow?: ChatThreadSummaryDTO | undefined;
  confirmedUpdatedAt?: number | undefined;
}
const threadPatchChains = new Map<string, ThreadPatchChain>();

interface UpdateThreadContext {
  key: ReturnType<typeof chatKeys.threads>;
  stale: boolean;
  sessionGen?: number;
  chainKey?: string;
  seq?: number;
  fields?: { title: boolean; model: boolean };
}

export function useUpdateThread() {
  const queryClient = useQueryClient();
  const authStore = useAuthStore();
  const { user, session } = storeToRefs(authStore);
  const currentUserId = () => user.value?.id ?? session.value?.user?.id ?? null;
  // A missing store user is not staleness (the service resolves identity
  // itself); only a different signed-in user or a session-generation bump
  // invalidates a callback.
  const isStaleSession = (userId: string, sessionGen: number | undefined) => {
    const current = currentUserId();
    return (current !== null && current !== userId) || authStore.sessionGeneration !== sessionGen;
  };

  return useMutation({
    mutationFn: (variables: { threadId: string; patch: PatchChatThreadDTO; userId: string }) =>
      updateChatThread(variables.threadId, variables.patch, variables.userId),
    onMutate: async (variables): Promise<UpdateThreadContext> => {
      const key = chatKeys.threads(variables.userId);
      const sessionGen = authStore.sessionGeneration;
      // Issued after a session/account change: register nowhere, write
      // nothing — its settle callbacks are no-ops too.
      if (isStaleSession(variables.userId, sessionGen)) return { key, stale: true };
      const chainKey = `${variables.userId}|${variables.threadId}`;
      let chain = threadPatchChains.get(chainKey);
      if (!chain) {
        chain = {
          tail: Promise.resolve(),
          pending: 0,
          seq: 0,
          lastWriter: { title: 0, model: 0 },
          writers: { title: 0, model: 0 },
        };
        threadPatchChains.set(chainKey, chain);
      }
      const cachedRow = queryClient
        .getQueryData<ChatThreadSummaryDTO[]>(key)
        ?.find((thread) => thread.ThreadId === variables.threadId);
      const seq = ++chain.seq;
      chain.pending += 1;
      const fields = {
        title: variables.patch.title !== undefined,
        model: variables.patch.model !== undefined,
      };
      if (chain.writers.title === 0 && chain.writers.model === 0) {
        chain.baselineRow = cachedRow
          ? { ...cachedRow, model: cachedRow.model ? { ...cachedRow.model } : undefined }
          : undefined;
        chain.confirmedUpdatedAt = undefined;
      }
      if (fields.title) {
        chain.writers.title += 1;
        chain.lastWriter.title = seq;
      }
      if (fields.model) {
        chain.writers.model += 1;
        chain.lastWriter.model = seq;
      }
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ChatThreadSummaryDTO[]>(key);
      if (previous) {
        queryClient.setQueryData<ChatThreadSummaryDTO[]>(
          key,
          previous.map((thread) =>
            thread.ThreadId === variables.threadId
              ? {
                  ...thread,
                  ...(variables.patch.title !== undefined
                    ? { title: variables.patch.title.trim() }
                    : {}),
                  ...(variables.patch.model !== undefined
                    ? { model: variables.patch.model, lastLlmAt: undefined }
                    : {}),
                  updatedAt: Date.now(),
                }
              : thread,
          ),
        );
      }
      return { key, stale: false, sessionGen, chainKey, seq, fields };
    },
    // Settle callbacks run serialized in issue order on the per-thread chain,
    // regardless of response arrival order, and each writes only the fields
    // it still owns. Rollback is field-scoped on the affected thread's row —
    // never a whole-list restore — so a failure on one thread (or one field)
    // cannot erase confirmed changes elsewhere.
    onError: (_error, variables, context) => {
      if (!context || context.stale) return;
      const chain = threadPatchChains.get(context.chainKey!);
      if (!chain) return;
      const run = async () => {
        try {
          if (isStaleSession(variables.userId, context.sessionGen)) return;
          // Own the field only while no newer sibling mutation has claimed
          // it: superseded callbacks must not write their stale values.
          const ownsTitle = context.fields!.title && chain.lastWriter.title === context.seq;
          const ownsModel = context.fields!.model && chain.lastWriter.model === context.seq;
          const baseline = chain.baselineRow;
          if (!baseline || (!ownsTitle && !ownsModel)) return;
          queryClient.setQueryData<ChatThreadSummaryDTO[]>(context.key, (old) =>
            old?.map((thread) => {
              if (thread.ThreadId !== variables.threadId) return thread;
              return {
                ...thread,
                ...(ownsTitle ? { title: baseline.title } : {}),
                ...(ownsModel ? { model: baseline.model, lastLlmAt: baseline.lastLlmAt } : {}),
                updatedAt: chain.confirmedUpdatedAt ?? baseline.updatedAt,
              };
            }),
          );
        } catch (e) {
          console.error('chat thread patch rollback failed', e);
        } finally {
          if (context.fields!.title) chain.writers.title -= 1;
          if (context.fields!.model) chain.writers.model -= 1;
          chain.pending -= 1;
          if (chain.pending === 0) threadPatchChains.delete(context.chainKey!);
        }
      };
      const settled = chain.tail.then(run);
      chain.tail = settled.catch(() => {});
      return settled;
    },
    // Re-apply the confirmed patch over anything a list GET that flew during
    // the PATCH landed after the optimistic write (last write wins), and
    // advance the rollback baseline to server truth. Fields a newer sibling
    // mutation owns are left to that sibling. Any GET this cancel supersedes
    // is replaced by the onSettled invalidate below.
    onSuccess: async (_data, variables, context) => {
      if (!context || context.stale) return;
      const chain = threadPatchChains.get(context.chainKey!);
      if (!chain) return;
      const run = async () => {
        try {
          if (isStaleSession(variables.userId, context.sessionGen)) return;
          const ownsTitle = context.fields!.title && chain.lastWriter.title === context.seq;
          const ownsModel = context.fields!.model && chain.lastWriter.model === context.seq;
          if (ownsTitle && chain.baselineRow) {
            chain.baselineRow = { ...chain.baselineRow, title: _data.title };
          }
          if (ownsModel && chain.baselineRow) {
            chain.baselineRow = {
              ...chain.baselineRow,
              model: _data.model,
              lastLlmAt: undefined,
            };
          }
          if (!ownsTitle && !ownsModel) return;
          chain.confirmedUpdatedAt = _data.updatedAt;
          await queryClient.cancelQueries({ queryKey: context.key });
          queryClient.setQueryData<ChatThreadSummaryDTO[]>(context.key, (old) =>
            old?.map((thread) =>
              thread.ThreadId === variables.threadId
                ? {
                    ...thread,
                    ...(ownsTitle ? { title: variables.patch.title!.trim() } : {}),
                    ...(ownsModel ? { model: variables.patch.model!, lastLlmAt: undefined } : {}),
                    updatedAt: Date.now(),
                  }
                : thread,
            ),
          );
        } catch (e) {
          console.error('chat thread patch confirm failed', e);
        } finally {
          if (context.fields!.title) chain.writers.title -= 1;
          if (context.fields!.model) chain.writers.model -= 1;
          chain.pending -= 1;
          if (chain.pending === 0) threadPatchChains.delete(context.chainKey!);
        }
      };
      const settled = chain.tail.then(run);
      chain.tail = settled.catch(() => {});
      await settled;
    },
    onSettled: (_data, _error, variables, context) => {
      // A callback that outlived its session must not trigger fetches:
      // the invalidate would refetch the old key with the new session's
      // credentials.
      if (context && !context.stale && !isStaleSession(variables.userId, context.sessionGen)) {
        void queryClient.invalidateQueries({ queryKey: context.key });
      }
    },
  });
}

export function useDeleteThread() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: { threadId: string; userId: string }) =>
      deleteChatThread(variables.threadId, variables.userId),
    onMutate: (variables) => {
      const key = chatKeys.threads(variables.userId);
      return { key };
    },
    onSuccess: (_data, variables, context) => {
      if (context) {
        queryClient.setQueryData<ChatThreadSummaryDTO[]>(context.key, (old) =>
          old ? old.filter((t) => t.ThreadId !== variables.threadId) : [],
        );
        void queryClient.invalidateQueries({ queryKey: context.key });
      }
    },
  });
}

export function useSaveChatMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: {
      threadId: string;
      userId: string;
      message: string;
      isUser: boolean;
      model?: ChatThreadModelDTO;
      lastLlmAt?: number;
      isStale?: () => boolean;
    }) =>
      saveChatMessage(variables.threadId, variables.userId, variables.message, variables.isUser, {
        model: variables.model,
        lastLlmAt: variables.lastLlmAt,
      }),
    // The stale guard precedes every cache side effect: a save resolving
    // after an operation/session change must never touch the cache (e.g.
    // re-attach evidence after the thread's model changed).
    onSuccess: async (_data, variables) => {
      if (variables.isUser) return;
      if (variables.isStale?.()) return;
      const key = chatKeys.threads(variables.userId);
      // A list GET already in flight snapshotted before this commit; cancel
      // suppresses its publication entirely, so it cannot revert the write
      // below. cancelQueries rejects the retryer without waiting for the
      // queryFn, so a hung GET cannot hold the save open.
      const supersededGet = queryClient.getQueryState(key)?.fetchStatus !== 'idle';
      await queryClient.cancelQueries({ queryKey: key });
      // The transaction committed: persisted evidence lands on the cached
      // summary in place — no updatedAt bump. Absent evidence clears the
      // stored timestamp, matching the server's REMOVE. A row-less cached
      // list stays untouched (no fabricated row).
      queryClient.setQueryData<ChatThreadSummaryDTO[]>(key, (old) =>
        old?.map((thread) =>
          thread.ThreadId === variables.threadId
            ? { ...thread, lastLlmAt: variables.lastLlmAt }
            : thread,
        ),
      );
      // The superseded GET was the only fetch that could carry the row
      // itself (first save / deleted-thread restart) or its server-derived
      // title and updatedAt ordering, so exactly one replacement GET must be
      // issued: it necessarily reads post-commit truth. With no GET in
      // flight there is nothing to replace — no redundant post-assistant
      // fetch (spec constraint).
      if (supersededGet) void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

export function useChatMessages() {
  return {
    getMessages: (threadId: string, userId: string) => getChatMessages(threadId, userId),
  };
}

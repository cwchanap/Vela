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
// user + session generation + thread. A sidebar rename and a header model
// change come from different composable instances, so the chain lives at
// module scope; entries exist only while a PATCH on that thread is in
// flight for that session generation (deleted at the last settle), keeping
// the map bounded. The generation component fences sessions from each
// other: an old session's hung or queued request can never block a new
// session's PATCH, and its settle callbacks cannot leak baselines.
interface ThreadPatchChain {
  // Settle callbacks (cache writes) run serialized in issue order.
  tail: Promise<unknown>;
  // Actual PATCH HTTP requests run strictly in issue order per chain:
  // a request is transmitted only after the previous request on the same
  // thread settled, so server commit order matches the optimistic cache
  // write order. The slot is released when the HTTP request settles —
  // within one generation a hung PATCH blocks later same-thread PATCHes
  // (the HTTP client has no timeout; a new generation is never affected).
  requestTail: Promise<unknown>;
  pending: number;
  seq: number;
  // Issue-order seq of the newest mutation owning each field: a settle
  // callback may only write fields it still owns (a delayed older callback
  // must never overwrite a newer confirmed value).
  lastWriter: { title: number; model: number };
  writers: { title: number; model: number };
  // Per-field baselines captured when that field FIRST becomes owned in
  // the chain — the floor a rollback of that field terminates at, even
  // when sibling mutations stacked on the same fields. Capturing per
  // field (not per chain) keeps out-of-chain writers, notably completed
  // assistant saves updating lastLlmAt, part of the floor for fields
  // whose ownership starts after them.
  baselineTitle?: { title: string; updatedAt: number } | undefined;
  baselineModel?:
    | { model: ChatThreadModelDTO | undefined; lastLlmAt: number | undefined; updatedAt: number }
    | undefined;
  baselineUpdatedAt?: number | undefined;
  // Confirmed server truth advanced by EVERY successful predecessor —
  // including ones superseded optimistically — so a later failure rolls
  // back to the last confirmed commit, never to the pre-chain value.
  confirmedTitle?: { title: string; updatedAt: number } | undefined;
  confirmedModel?: { model: ChatThreadModelDTO | undefined; updatedAt: number } | undefined;
  confirmedUpdatedAt?: number | undefined;
  // The client stamp this chain last wrote optimistically (Date.now()).
  // A rollback uses it to tell its own optimistic write apart from a
  // fresher server-confirmed snapshot that a GET landed meanwhile, so a
  // failure can never rewind the visible updatedAt backwards.
  optimisticUpdatedAt?: number | undefined;
}
const threadPatchChains = new Map<string, ThreadPatchChain>();

interface UpdateThreadVariables {
  threadId: string;
  patch: PatchChatThreadDTO;
  userId: string;
}

// Bridges onMutate's issue-time decisions (chain registration, staleness)
// to mutationFn, which TanStack calls without context: a mutation whose
// session ended before its queued request was dequeued must not be
// transmitted. Entries die with their variables objects (WeakMap).
interface IssuedPatch {
  sessionGen: number;
  chainKey: string | null;
  // The ordering slot is taken once per logical mutation and released at
  // final settlement (onSettled), never per HTTP attempt: TanStack's retry
  // re-runs only mutationFn (same variables), and releasing early would
  // let a later PATCH overtake a retried earlier one.
  queued?: boolean | undefined;
  releaseSlot?: (() => void) | undefined;
}
const issuedPatchChains = new WeakMap<UpdateThreadVariables, IssuedPatch>();

// A request whose session ended before it could be sent settles with an
// unconsumed placeholder instead of an error: the operation never ran, so
// there is nothing to report to the caller that issued it. Its settle
// callbacks see a stale context and write nothing.
const skippedPatchRow = (variables: UpdateThreadVariables): ChatThreadSummaryDTO => ({
  ThreadId: variables.threadId,
  title: variables.patch.title ?? '',
  createdAt: 0,
  updatedAt: 0,
  ...(variables.patch.model !== undefined ? { model: variables.patch.model } : {}),
});

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
    mutationFn: async (variables: UpdateThreadVariables) => {
      const issued = issuedPatchChains.get(variables);
      if (!issued?.chainKey) return skippedPatchRow(variables);
      const chain = threadPatchChains.get(issued.chainKey);
      if (!chain) return skippedPatchRow(variables);
      // Queue the actual network execution behind earlier same-generation
      // same-thread PATCHes. The optimistic write already happened in
      // onMutate at issue time and is never delayed by this queue. One
      // slot per LOGICAL mutation: taken on the first attempt and held
      // through TanStack's retries (retry re-runs only mutationFn, with
      // the same variables) until final settlement (released in
      // onSettled) — releasing per HTTP attempt would let a later PATCH
      // overtake a retried earlier one and commit an older value last.
      if (!issued.queued) {
        issued.queued = true;
        let release!: () => void;
        const slot = new Promise<void>((resolve) => {
          release = resolve;
        });
        issued.releaseSlot = release;
        const predecessor = chain.requestTail;
        chain.requestTail = slot;
        await predecessor;
        // A request queued behind an in-flight predecessor whose session
        // has since ended must never be transmitted.
        if (isStaleSession(variables.userId, issued.sessionGen)) {
          return skippedPatchRow(variables);
        }
      } else if (isStaleSession(variables.userId, issued.sessionGen)) {
        // A retry re-runs mutationFn without re-joining the queue (the
        // ordering slot is already held): the retransmission must still
        // respect the ended-session fence the first dequeue enforced.
        return skippedPatchRow(variables);
      }
      return updateChatThread(variables.threadId, variables.patch, variables.userId);
    },
    onMutate: async (variables): Promise<UpdateThreadContext> => {
      const key = chatKeys.threads(variables.userId);
      const sessionGen = authStore.sessionGeneration;
      // Issued after a session/account change: register nowhere, write
      // nothing — its settle callbacks are no-ops too.
      if (isStaleSession(variables.userId, sessionGen)) {
        issuedPatchChains.set(variables, { sessionGen, chainKey: null });
        return { key, stale: true };
      }
      const chainKey = `${variables.userId}:${sessionGen}|${variables.threadId}`;
      const cachedRow = queryClient
        .getQueryData<ChatThreadSummaryDTO[]>(key)
        ?.find((thread) => thread.ThreadId === variables.threadId);
      let chain = threadPatchChains.get(chainKey);
      if (!chain) {
        chain = {
          tail: Promise.resolve(),
          requestTail: Promise.resolve(),
          pending: 0,
          seq: 0,
          lastWriter: { title: 0, model: 0 },
          writers: { title: 0, model: 0 },
          baselineUpdatedAt: cachedRow?.updatedAt,
        };
        threadPatchChains.set(chainKey, chain);
      }
      const seq = ++chain.seq;
      chain.pending += 1;
      const fields = {
        title: variables.patch.title !== undefined,
        model: variables.patch.model !== undefined,
      };
      // Capture each field's baseline when that field first becomes owned:
      // confirmed out-of-chain writers (completed assistant saves) that
      // landed before this moment are part of the floor a later rollback
      // must preserve. A prior ownership epoch's confirmed value dies with
      // its baseline: once the last writer settled, this fresh capture is at
      // least as new, and keeping the old confirmed entry would discard
      // evidence the new baseline recorded (e.g. a post-PATCH assistant save).
      if (fields.title && chain.writers.title === 0) {
        chain.confirmedTitle = undefined;
        chain.baselineTitle = cachedRow
          ? { title: cachedRow.title, updatedAt: cachedRow.updatedAt }
          : undefined;
      }
      if (fields.model && chain.writers.model === 0) {
        chain.confirmedModel = undefined;
        chain.baselineModel = cachedRow
          ? {
              model: cachedRow.model ? { ...cachedRow.model } : undefined,
              lastLlmAt: cachedRow.lastLlmAt,
              updatedAt: cachedRow.updatedAt,
            }
          : undefined;
      }
      if (fields.title) {
        chain.writers.title += 1;
        chain.lastWriter.title = seq;
      }
      if (fields.model) {
        chain.writers.model += 1;
        chain.lastWriter.model = seq;
      }
      issuedPatchChains.set(variables, { sessionGen, chainKey });
      await queryClient.cancelQueries({ queryKey: key });
      // The staleness verdict may have expired while the cancel was
      // pending: undo this registration completely and publish nothing.
      if (isStaleSession(variables.userId, sessionGen)) {
        if (fields.title) chain.writers.title -= 1;
        if (fields.model) chain.writers.model -= 1;
        chain.pending -= 1;
        if (chain.pending === 0) threadPatchChains.delete(chainKey);
        issuedPatchChains.set(variables, { sessionGen, chainKey: null });
        return { key, stale: true };
      }
      const previous = queryClient.getQueryData<ChatThreadSummaryDTO[]>(key);
      if (previous) {
        const optimisticAt = Date.now();
        chain.optimisticUpdatedAt = optimisticAt;
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
                  updatedAt: optimisticAt,
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
          if (!ownsTitle && !ownsModel) return;
          queryClient.setQueryData<ChatThreadSummaryDTO[]>(context.key, (old) =>
            old?.map((thread) => {
              if (thread.ThreadId !== variables.threadId) return thread;
              // A confirmed predecessor's commit beats the chain-start
              // baseline: a failed rename restores the last confirmed
              // title; a failed model change restores the last confirmed
              // model with evidence left cleared (the confirmed PATCH
              // removed it server-side), otherwise the captured baseline
              // evidence.
              const title = chain.confirmedTitle ?? chain.baselineTitle;
              const model = chain.confirmedModel ?? chain.baselineModel;
              const restoredUpdatedAt =
                chain.confirmedUpdatedAt ?? chain.baselineUpdatedAt ?? thread.updatedAt;
              // Never rewind a fresher server-confirmed snapshot (e.g. a
              // user save that committed meanwhile and landed via a GET):
              // anything in the row that is not this chain's own optimistic
              // stamp came from a newer source and must win.
              const updatedAt =
                chain.optimisticUpdatedAt !== undefined &&
                thread.updatedAt !== chain.optimisticUpdatedAt
                  ? Math.max(restoredUpdatedAt, thread.updatedAt)
                  : restoredUpdatedAt;
              return {
                ...thread,
                ...(ownsTitle && title ? { title: title.title } : {}),
                ...(ownsModel && model
                  ? {
                      model: model.model,
                      lastLlmAt: chain.confirmedModel ? undefined : chain.baselineModel?.lastLlmAt,
                    }
                  : {}),
                updatedAt,
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
          // Advance the confirmed floor for every committed field BEFORE
          // the ownership check: a superseded commit is still server truth,
          // and a later sibling's failure must roll back to it (never to
          // the chain-start baseline).
          if (context.fields!.title) {
            chain.confirmedTitle = { title: _data.title, updatedAt: _data.updatedAt };
          }
          if (context.fields!.model) {
            chain.confirmedModel = { model: _data.model, updatedAt: _data.updatedAt };
          }
          chain.confirmedUpdatedAt = _data.updatedAt;
          if (!ownsTitle && !ownsModel) return;
          await queryClient.cancelQueries({ queryKey: context.key });
          // Revalidate both verdicts after the await: the session may have
          // ended or a newer sibling mutation may have claimed a field while
          // the cancel was pending — publishing the pre-await verdict here
          // would overwrite newer state with stale captured values. The
          // cleanup below stays unconditional.
          if (isStaleSession(variables.userId, context.sessionGen)) return;
          const stillOwnsTitle = context.fields!.title && chain.lastWriter.title === context.seq;
          const stillOwnsModel = context.fields!.model && chain.lastWriter.model === context.seq;
          if (!stillOwnsTitle && !stillOwnsModel) return;
          queryClient.setQueryData<ChatThreadSummaryDTO[]>(context.key, (old) =>
            old?.map((thread) =>
              thread.ThreadId === variables.threadId
                ? {
                    ...thread,
                    ...(stillOwnsTitle ? { title: variables.patch.title!.trim() } : {}),
                    ...(stillOwnsModel
                      ? { model: variables.patch.model!, lastLlmAt: undefined }
                      : {}),
                    updatedAt: _data.updatedAt,
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
      // Final settlement of the logical mutation (after retries): only now
      // is the ordering slot released for the next queued PATCH.
      issuedPatchChains.get(variables)?.releaseSlot?.();
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
      // The pre-await guard expired while the cancel was pending: an
      // operation/session change since forbids both side effects below.
      if (variables.isStale?.()) return;
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

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

// --- confirmed cache-evidence reconciliation (feature-local) ---
// A same-client list GET whose request may have read the rows before an
// assistant save / model PATCH committed must not overwrite the confirmed
// evidence when it lands after the cache write: focus/mount/retry GETs are
// not enumerable, so ordering-by-await can neither close the race (Finding
// 1A) nor avoid stalling on a delayed GET (Finding 3). Instead, every
// successful server write records the value it confirmed, and the queryFn
// re-asserts that value over snapshots from fetches that started before the
// write. A fetch that started after the write cannot predate it, so its
// snapshot settles the record: same value = server truth confirmed, different
// value = a later server change won — the record is dropped either way and
// the fetched value passes through untouched, so the overlay never masks
// later server truth. Records are keyed per user+thread and capped; an
// evicted record merely loses stale-snapshot protection, never fabricates
// evidence.
interface EvidenceRecord {
  lastLlmAt: number | undefined;
  /** queryFn-invocation counter at write time */
  writeSeq: number;
}
const evidenceRecords = new Map<string, EvidenceRecord>();
let evidenceFetchSeq = 0;
const EVIDENCE_RECORD_CAP = 64;
const evidenceKey = (userId: string, threadId: string) => `${userId}\n${threadId}`;

const recordEvidence = (userId: string, threadId: string, lastLlmAt: number | undefined) => {
  evidenceRecords.set(evidenceKey(userId, threadId), {
    lastLlmAt,
    writeSeq: evidenceFetchSeq,
  });
  if (evidenceRecords.size > EVIDENCE_RECORD_CAP) {
    // Map iteration is insertion-ordered: evict the oldest record.
    const oldest = evidenceRecords.keys().next().value;
    if (oldest !== undefined) evidenceRecords.delete(oldest);
  }
};

const clearEvidence = (userId: string, threadId: string) => {
  evidenceRecords.delete(evidenceKey(userId, threadId));
};

const reconcileEvidence = (
  userId: string,
  rows: ChatThreadSummaryDTO[],
  fetchSeq: number,
): ChatThreadSummaryDTO[] => {
  const settled: string[] = [];
  const reconciled = rows.map((row) => {
    const record = evidenceRecords.get(evidenceKey(userId, row.ThreadId));
    if (!record) return row;
    if (fetchSeq > record.writeSeq) {
      // Post-write fetch: whatever this snapshot reports is server truth.
      settled.push(row.ThreadId);
      return row;
    }
    // Pre-write snapshot: the row cannot include the confirmed value yet.
    return record.lastLlmAt === row.lastLlmAt ? row : { ...row, lastLlmAt: record.lastLlmAt };
  });
  // A post-write fetch also settles records for rows it no longer returns
  // (thread deleted): there is no row left to protect.
  const present = new Set(reconciled.map((row) => row.ThreadId));
  for (const [key, record] of evidenceRecords) {
    const [recordUser, threadId] = key.split('\n');
    if (recordUser === userId && record.writeSeq < fetchSeq && !present.has(threadId!)) {
      settled.push(threadId!);
    }
  }
  for (const threadId of settled) clearEvidence(userId, threadId);
  return reconciled;
};

export function useChatThreads() {
  const authStore = useAuthStore();
  const { user, session } = storeToRefs(authStore);
  const userId = computed(() => user.value?.id ?? session.value?.user?.id ?? null);

  return useQuery({
    queryKey: computed(() => chatKeys.threads(userId.value)),
    queryFn: async ({ queryKey }) => {
      // Seq stamped per invocation: retries are separate HTTP reads.
      const fetchSeq = ++evidenceFetchSeq;
      const uid = queryKey[2] as string;
      return reconcileEvidence(uid, await listChatThreads(uid), fetchSeq);
    },
    enabled: computed(() => !!userId.value),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

// One generic title/model mutation: a model change also drops the cached
// cache-evidence timestamp (the server REMOVEs it in the same update) and a
// failure restores the whole previous row, including old model/lastLlmAt.
export function useUpdateThread() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (variables: { threadId: string; patch: PatchChatThreadDTO; userId: string }) =>
      updateChatThread(variables.threadId, variables.patch, variables.userId),
    onMutate: async (variables) => {
      const key = chatKeys.threads(variables.userId);
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
      return { key, previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(context.key, context.previous);
      }
    },
    onSuccess: (_data, variables) => {
      // A model change REMOVEs the evidence server-side in the same update;
      // record that confirmed removal so snapshots read before this PATCH
      // commit re-assert it instead of restoring the old model's timestamp.
      // Title-only PATCHes leave the evidence alone.
      if (variables.patch.model !== undefined) {
        recordEvidence(variables.userId, variables.threadId, undefined);
      }
    },
    onSettled: (_data, _error, _variables, context) => {
      if (context) {
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
        clearEvidence(variables.userId, variables.threadId);
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
    onSuccess: (_data, variables) => {
      if (variables.isUser) return;
      // The transaction committed: record the confirmed value so any
      // same-client snapshot read before this commit re-asserts it in the
      // queryFn instead of reverting the write below. Covers SET (lastLlmAt)
      // and REMOVE (undefined). Nothing here waits on a list GET, so a
      // stalled refresh can never hold the save open.
      recordEvidence(variables.userId, variables.threadId, variables.lastLlmAt);
      // A save resolving after an operation/session change must not touch the
      // cache (e.g. re-attach evidence after the thread's model changed).
      if (variables.isStale?.()) return;
      // Persisted cache evidence lands on the cached summary in place: no
      // updatedAt bump and no redundant list refetch. Absent evidence clears
      // the stored timestamp, matching the server's REMOVE.
      queryClient.setQueryData<ChatThreadSummaryDTO[]>(chatKeys.threads(variables.userId), (old) =>
        old?.map((thread) =>
          thread.ThreadId === variables.threadId
            ? { ...thread, lastLlmAt: variables.lastLlmAt }
            : thread,
        ),
      );
    },
  });
}

export function useChatMessages() {
  return {
    getMessages: (threadId: string, userId: string) => getChatMessages(threadId, userId),
  };
}

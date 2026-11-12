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
    // Re-apply the confirmed patch to the cache: a list GET that flew during
    // the PATCH may have landed its pre-PATCH snapshot after onMutate's
    // optimistic write (last write wins), and the onSettled refresh can
    // stall indefinitely — the confirmed response is authoritative now.
    // Rollback semantics (onError) are untouched. Any GET this cancel
    // supersedes is replaced by the onSettled invalidate below.
    onSuccess: async (_data, variables, context) => {
      if (!context) return;
      await queryClient.cancelQueries({ queryKey: context.key });
      queryClient.setQueryData<ChatThreadSummaryDTO[]>(context.key, (old) =>
        old?.map((thread) =>
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

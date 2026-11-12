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
      threadsRefreshed?: Promise<void>;
    }) =>
      saveChatMessage(variables.threadId, variables.userId, variables.message, variables.isUser, {
        model: variables.model,
        lastLlmAt: variables.lastLlmAt,
      }),
    onSuccess: async (_data, variables) => {
      if (variables.isUser) return;
      // The user-save list refresh may still be in flight with a snapshot read
      // before this assistant transaction; let the older snapshot land first
      // so the persisted evidence wins, without cancelling the refresh (which
      // carries newly created rows) or adding a fetch.
      await variables.threadsRefreshed?.catch(() => {});
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

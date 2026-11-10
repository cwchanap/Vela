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

export function useRenameThread() {
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
                  ...(variables.patch.model !== undefined ? { model: variables.patch.model } : {}),
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
  return useMutation({
    mutationFn: (variables: {
      threadId: string;
      userId: string;
      message: string;
      isUser: boolean;
    }) =>
      saveChatMessage(variables.threadId, variables.userId, variables.message, variables.isUser),
  });
}

export function useChatMessages() {
  return {
    getMessages: (threadId: string, userId: string) => getChatMessages(threadId, userId),
  };
}

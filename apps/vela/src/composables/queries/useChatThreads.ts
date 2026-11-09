import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import { chatKeys } from '@vela/common';
import { useAuthStore } from 'src/stores/auth';
import {
  deleteChatThread,
  listChatThreads,
  updateChatThread,
  type ChatThreadSummaryDTO,
  type PatchChatThreadDTO,
} from 'src/services/chatHistoryService';

export { chatKeys };

export function useChatThreads() {
  const authStore = useAuthStore();
  const { user, session } = storeToRefs(authStore);
  const userId = computed(() => user.value?.id ?? session.value?.user?.id ?? null);

  return useQuery({
    queryKey: computed(() => chatKeys.threads(userId.value)),
    queryFn: () => listChatThreads(),
    enabled: computed(() => !!userId.value),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
  });
}

export function useRenameThread() {
  const queryClient = useQueryClient();
  const authStore = useAuthStore();
  const { user, session } = storeToRefs(authStore);
  const currentUserId = () => user.value?.id ?? session.value?.user?.id ?? null;

  return useMutation({
    mutationFn: ({ threadId, patch }: { threadId: string; patch: PatchChatThreadDTO }) =>
      updateChatThread(threadId, patch),
    onMutate: async ({ threadId, patch }) => {
      const key = chatKeys.threads(currentUserId());
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<ChatThreadSummaryDTO[]>(key);
      if (previous) {
        queryClient.setQueryData<ChatThreadSummaryDTO[]>(
          key,
          previous.map((thread) =>
            thread.ThreadId === threadId
              ? {
                  ...thread,
                  ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
                  ...(patch.model !== undefined ? { model: patch.model } : {}),
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
  const authStore = useAuthStore();
  const { user, session } = storeToRefs(authStore);
  const currentUserId = () => user.value?.id ?? session.value?.user?.id ?? null;

  return useMutation({
    mutationFn: (threadId: string) => deleteChatThread(threadId),
    onMutate: () => {
      const key = chatKeys.threads(currentUserId());
      return { key };
    },
    onSuccess: (_data, _variables, context) => {
      if (context) {
        void queryClient.invalidateQueries({ queryKey: context.key });
      }
    },
  });
}

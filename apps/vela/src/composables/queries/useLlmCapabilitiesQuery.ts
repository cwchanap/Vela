import { useQuery } from '@tanstack/vue-query';
import { llmClient } from 'src/services/llm';
import { useAuthStore } from 'src/stores/auth';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';

const llmCapabilitiesKey = ['llm-capabilities'] as const;

export function useLlmCapabilitiesQuery() {
  const authStore = useAuthStore();
  const { user } = storeToRefs(authStore);

  const enabled = computed(() => !!user.value?.id);

  return useQuery({
    queryKey: llmCapabilitiesKey,
    queryFn: async () => {
      try {
        return await llmClient.capabilities();
      } catch (error) {
        const status =
          typeof error === 'object' && error !== null && 'status' in error
            ? error.status
            : 'network';
        console.warn('LLM capabilities request failed', { status });
        throw error;
      }
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    enabled,
  });
}

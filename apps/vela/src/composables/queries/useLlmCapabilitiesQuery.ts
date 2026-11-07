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
    queryFn: () => llmClient.capabilities(),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    enabled,
  });
}

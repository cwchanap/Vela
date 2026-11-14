import { computed } from 'vue';
import type { LlmProvider } from '@vela/common';
import { useAuthStore } from 'src/stores/auth';
import { confirmedServerKeyProviders } from 'src/utils/llmModelOptions';
import { useLlmCapabilitiesQuery } from './useLlmCapabilitiesQuery';

export function useServerKeyProviders() {
  const authStore = useAuthStore();
  const capabilitiesQuery = useLlmCapabilitiesQuery();

  const serverKeyProviders = computed<LlmProvider[]>(() =>
    confirmedServerKeyProviders(capabilitiesQuery.data.value, {
      isAuthenticated: authStore.isAuthenticated,
      isError: capabilitiesQuery.isError.value,
    }),
  );

  return {
    capabilitiesQuery,
    serverKeyProviders,
  };
}

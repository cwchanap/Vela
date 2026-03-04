import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { getTTSSettings, saveTTSSettings } from 'src/services/ttsService';
import { ttsKeys } from '@vela/common';
import { useAuthStore } from 'src/stores/auth';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';

/**
 * Hook to fetch TTS settings for the current user
 */
export function useTTSSettingsQuery() {
  const authStore = useAuthStore();
  const { user } = storeToRefs(authStore);

  const queryKey = computed(() => ttsKeys.settings(user.value?.id ?? null));
  const enabled = computed(() => !!user.value?.id);

  return useQuery({
    queryKey,
    queryFn: () => getTTSSettings(),
    staleTime: 5 * 60 * 1000, // 5 minutes - TTS settings change infrequently
    gcTime: 10 * 60 * 1000, // 10 minutes
    enabled,
  });
}

export interface TTSSettingsPayload {
  provider: string;
  apiKey: string;
  voiceId?: string | undefined;
  model?: string | undefined;
}

/**
 * Hook to update TTS settings
 */
export function useUpdateTTSSettingsMutation() {
  const queryClient = useQueryClient();
  const authStore = useAuthStore();
  const { user } = storeToRefs(authStore);

  return useMutation({
    mutationFn: ({ provider, apiKey, voiceId, model }: TTSSettingsPayload) =>
      saveTTSSettings(provider, apiKey, voiceId, model),
    onSuccess: () => {
      // Invalidate TTS settings to refetch updated data
      queryClient.invalidateQueries({ queryKey: ttsKeys.settings(user.value?.id ?? null) });
    },
  });
}

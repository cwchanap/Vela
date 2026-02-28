import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { getTTSSettings, saveTTSSettings } from 'src/services/ttsService';

/**
 * Query key factory for TTS-related queries
 */
export const ttsKeys = {
  all: ['tts'] as const,
  settings: () => [...ttsKeys.all, 'settings'] as const,
};

/**
 * Hook to fetch TTS settings for the current user
 */
export function useTTSSettingsQuery() {
  return useQuery({
    queryKey: ttsKeys.settings(),
    queryFn: () => getTTSSettings(),
    staleTime: 5 * 60 * 1000, // 5 minutes - TTS settings change infrequently
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
}

export interface TTSSettingsPayload {
  provider: string;
  apiKey: string;
  voiceId?: string;
  model?: string;
}

/**
 * Hook to update TTS settings
 */
export function useUpdateTTSSettingsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ provider, apiKey, voiceId, model }: TTSSettingsPayload) =>
      saveTTSSettings('', provider, apiKey, voiceId, model),
    onSuccess: () => {
      // Invalidate TTS settings to refetch updated data
      queryClient.invalidateQueries({ queryKey: ttsKeys.all });
    },
  });
}

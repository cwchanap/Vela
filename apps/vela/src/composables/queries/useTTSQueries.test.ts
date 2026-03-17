import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { ref } from 'vue';
import { withQueryClient } from 'src/test-utils/withQueryClient';

const mockGetTTSSettings = vi.fn();
const mockSaveTTSSettings = vi.fn();

vi.mock('src/services/ttsService', () => ({
  getTTSSettings: mockGetTTSSettings,
  saveTTSSettings: mockSaveTTSSettings,
}));

const mockUser = ref<{ id: string } | null>(null);

vi.mock('src/stores/auth', () => ({
  useAuthStore: () => ({
    user: mockUser,
  }),
}));

vi.mock('pinia', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pinia')>();
  return {
    ...actual,
    storeToRefs: (store: any) => {
      return { user: store.user };
    },
  };
});

vi.mock('@vela/common', () => ({
  ttsKeys: {
    settings: (userId: string | null) => ['tts', 'settings', userId],
  },
}));

describe('useTTSQueries', () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.value = null;
  });

  afterEach(() => {
    if (cleanup) {
      cleanup();
      cleanup = undefined;
    }
  });

  describe('useTTSSettingsQuery', () => {
    it('is disabled when user is null', async () => {
      mockUser.value = null;
      const { useTTSSettingsQuery } = await import('./useTTSQueries');
      const { result, cleanup: qcCleanup } = withQueryClient(() => useTTSSettingsQuery());
      cleanup = qcCleanup;
      expect(result).toBeDefined();
      expect(mockGetTTSSettings).not.toHaveBeenCalled();
    });

    it('returns a query object', async () => {
      mockUser.value = { id: 'user-123' };
      mockGetTTSSettings.mockResolvedValue({ provider: 'elevenlabs', apiKey: 'key' });
      const { useTTSSettingsQuery } = await import('./useTTSQueries');
      const { result, cleanup: qcCleanup } = withQueryClient(() => useTTSSettingsQuery());
      cleanup = qcCleanup;
      expect(result).toBeDefined();
    });

    it('calls getTTSSettings when user is set', async () => {
      mockUser.value = { id: 'user-123' };
      mockGetTTSSettings.mockResolvedValue({ provider: 'elevenlabs', apiKey: 'key' });
      const { useTTSSettingsQuery } = await import('./useTTSQueries');
      const { cleanup: qcCleanup } = withQueryClient(() => useTTSSettingsQuery());
      cleanup = qcCleanup;
      await flushPromises();
      expect(mockGetTTSSettings).toHaveBeenCalled();
    });
  });

  describe('useUpdateTTSSettingsMutation', () => {
    it('calls saveTTSSettings with correct arguments', async () => {
      mockUser.value = { id: 'user-123' };
      mockSaveTTSSettings.mockResolvedValueOnce({ success: true });
      const { useUpdateTTSSettingsMutation } = await import('./useTTSQueries');
      const { result, cleanup: qcCleanup } = withQueryClient(() => useUpdateTTSSettingsMutation());
      cleanup = qcCleanup;
      await result.mutateAsync({
        provider: 'elevenlabs',
        apiKey: 'test-key',
        voiceId: 'voice-1',
        model: 'eleven_turbo_v2',
      });
      expect(mockSaveTTSSettings).toHaveBeenCalledWith(
        'elevenlabs',
        'test-key',
        'voice-1',
        'eleven_turbo_v2',
      );
    });

    it('calls saveTTSSettings without optional fields', async () => {
      mockUser.value = { id: 'user-123' };
      mockSaveTTSSettings.mockResolvedValueOnce({ success: true });
      const { useUpdateTTSSettingsMutation } = await import('./useTTSQueries');
      const { result, cleanup: qcCleanup } = withQueryClient(() => useUpdateTTSSettingsMutation());
      cleanup = qcCleanup;
      await result.mutateAsync({ provider: 'openai', apiKey: 'openai-key' });
      expect(mockSaveTTSSettings).toHaveBeenCalledWith(
        'openai',
        'openai-key',
        undefined,
        undefined,
      );
    });

    it('invalidates TTS settings queries on success', async () => {
      mockUser.value = { id: 'user-123' };
      mockSaveTTSSettings.mockResolvedValueOnce({ success: true });
      const { useUpdateTTSSettingsMutation } = await import('./useTTSQueries');
      const {
        result,
        queryClient,
        cleanup: qcCleanup,
      } = withQueryClient(() => useUpdateTTSSettingsMutation());
      cleanup = qcCleanup;
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      await result.mutateAsync({ provider: 'elevenlabs', apiKey: 'key' });
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: expect.arrayContaining(['tts']) }),
      );
    });

    it('returns mutation object with mutateAsync', async () => {
      const { useUpdateTTSSettingsMutation } = await import('./useTTSQueries');
      const { result, cleanup: qcCleanup } = withQueryClient(() => useUpdateTTSSettingsMutation());
      cleanup = qcCleanup;
      expect(typeof result.mutateAsync).toBe('function');
    });
  });
});

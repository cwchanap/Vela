import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, VueWrapper, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { Quasar, Notify } from 'quasar';
import TtsSection from './TtsSection.vue';
import { useAuthStore } from 'src/stores/auth';
import {
  useTTSSettingsQuery,
  useUpdateTTSSettingsMutation,
} from '../../../composables/queries/useTTSQueries';

// Mock TTS queries composable
vi.mock('../../../composables/queries/useTTSQueries', () => ({
  useTTSSettingsQuery: vi.fn(() => ({
    data: { value: null },
  })),
  useUpdateTTSSettingsMutation: vi.fn(() => ({
    mutate: vi.fn(),
  })),
}));

const stubs = {
  'q-card': { template: '<div><slot /></div>' },
  'q-card-section': { template: '<div><slot /></div>' },
  'q-card-actions': { template: '<div><slot /></div>' },
  'q-separator': true,
  'q-select': {
    template: '<div />',
    props: ['modelValue', 'options'],
    emits: ['update:modelValue'],
  },
  'q-input': { template: '<div />', props: ['modelValue'], emits: ['update:modelValue'] },
  'q-btn': {
    template: '<button :disabled="disable" @click="$emit(\'click\')"><slot /></button>',
    props: ['disable', 'loading'],
    emits: ['click'],
  },
  'q-badge': { template: '<span><slot /></span>' },
  'q-icon': true,
};

describe('TtsSection', () => {
  let wrapper: VueWrapper;
  let authStore: ReturnType<typeof useAuthStore>;

  const mountComponent = () =>
    mount(TtsSection, {
      global: { plugins: [Quasar], stubs },
    });

  beforeEach(() => {
    setActivePinia(createPinia());
    authStore = useAuthStore();

    vi.clearAllMocks();
    Notify.create = vi.fn() as never;
    vi.mocked(useTTSSettingsQuery).mockReturnValue({
      data: { value: null },
    } as never);
    vi.mocked(useUpdateTTSSettingsMutation).mockReturnValue({
      mutate: vi.fn(),
    } as never);

    wrapper = mountComponent();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  describe('ttsApiKeyLabel computed', () => {
    it('returns ElevenLabs label for elevenlabs provider', () => {
      wrapper.vm.ttsProvider = 'elevenlabs';
      expect(wrapper.vm.ttsApiKeyLabel).toBe('ElevenLabs API Key');
    });

    it('returns OpenAI label for openai provider', () => {
      wrapper.vm.ttsProvider = 'openai';
      expect(wrapper.vm.ttsApiKeyLabel).toBe('OpenAI API Key');
    });

    it('returns Google AI label for gemini provider', () => {
      wrapper.vm.ttsProvider = 'gemini';
      expect(wrapper.vm.ttsApiKeyLabel).toBe('Google AI API Key');
    });
  });

  describe('ttsApiKeyHint computed', () => {
    it('returns ElevenLabs hint for elevenlabs provider', () => {
      wrapper.vm.ttsProvider = 'elevenlabs';
      expect(wrapper.vm.ttsApiKeyHint).toBe('Your ElevenLabs API key');
    });

    it('returns OpenAI hint for openai provider', () => {
      wrapper.vm.ttsProvider = 'openai';
      expect(wrapper.vm.ttsApiKeyHint).toBe('Your OpenAI API key (sk-...)');
    });

    it('returns Google hint for gemini provider', () => {
      wrapper.vm.ttsProvider = 'gemini';
      expect(wrapper.vm.ttsApiKeyHint).toBe('Your Google AI Studio API key');
    });
  });

  describe('canSaveTTS computed', () => {
    it('returns false when user is not authenticated', () => {
      authStore.user = null;
      authStore.setSession(null);
      expect(wrapper.vm.canSaveTTS).toBe(false);
    });

    it('returns true when user id is available', () => {
      authStore.user = {
        id: 'user-1',
        email: 'test@example.com',
        avatar_url: null,
        preferences: null,
      };
      expect(wrapper.vm.canSaveTTS).toBe(true);
    });
  });

  describe('isAuthenticated computed', () => {
    it('returns false when not authenticated', () => {
      expect(wrapper.vm.isAuthenticated).toBe(false);
    });

    it('returns true when authenticated', () => {
      authStore.user = {
        id: 'user-1',
        email: 'test@example.com',
        avatar_url: null,
        preferences: null,
      };
      authStore.setSession({ user: authStore.user });
      expect(wrapper.vm.isAuthenticated).toBe(true);
    });
  });

  describe('TTS provider watcher', () => {
    it('sets default voice for openai when changing to openai', async () => {
      wrapper.vm.ttsProvider = 'openai';
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.ttsVoiceId).toBe('alloy');
    });

    it('sets default voice for gemini when changing to gemini', async () => {
      wrapper.vm.ttsProvider = 'gemini';
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.ttsVoiceId).toBe('Kore');
    });

    it('clears openai voice when switching to elevenlabs', async () => {
      wrapper.vm.ttsProvider = 'openai';
      await wrapper.vm.$nextTick();
      // ttsVoiceId should be 'alloy'
      wrapper.vm.ttsProvider = 'elevenlabs';
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.ttsVoiceId).toBe('');
    });

    it('clears gemini voice when switching to elevenlabs', async () => {
      wrapper.vm.ttsProvider = 'gemini';
      await wrapper.vm.$nextTick();
      // ttsVoiceId should be 'Kore' (default gemini voice)
      expect(wrapper.vm.ttsVoiceId).toBe('Kore');
      wrapper.vm.ttsProvider = 'elevenlabs';
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.ttsVoiceId).toBe('');
    });

    it('clears openai model when switching to elevenlabs', async () => {
      wrapper.vm.ttsProvider = 'openai';
      await wrapper.vm.$nextTick();
      // openai sets default model 'tts-1'
      expect(wrapper.vm.ttsModel).toBe('tts-1');
      wrapper.vm.ttsProvider = 'elevenlabs';
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.ttsModel).toBe('');
    });

    it('clears gemini model when switching to elevenlabs', async () => {
      wrapper.vm.ttsProvider = 'gemini';
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.ttsModel).toBe('gemini-2.5-flash-preview-tts');
      wrapper.vm.ttsProvider = 'elevenlabs';
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.ttsModel).toBe('');
    });
  });

  describe('TTS settings query sync', () => {
    it('hydrates the local TTS form from loaded query data', async () => {
      wrapper.unmount();
      vi.mocked(useTTSSettingsQuery).mockReturnValue({
        data: {
          value: {
            provider: 'elevenlabs',
            voiceId: 'voice-123',
            model: 'eleven_multilingual_v2',
            hasApiKey: true,
          },
        },
      } as never);

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.vm.ttsProvider).toBe('elevenlabs');
      expect(wrapper.vm.ttsVoiceId).toBe('voice-123');
      expect(wrapper.vm.ttsModel).toBe('eleven_multilingual_v2');
      expect(wrapper.vm.hasTTSKey).toBe(true);
    });

    it('falls back to elevenlabs when loaded query data has no provider', async () => {
      wrapper.unmount();
      vi.mocked(useTTSSettingsQuery).mockReturnValue({
        data: {
          value: {
            provider: null,
            voiceId: 'voice-abc',
            model: null,
            hasApiKey: false,
          },
        },
      } as never);

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.vm.ttsProvider).toBe('elevenlabs');
    });
  });

  describe('saveSettingsHandler', () => {
    it('shows a sign-in notification when no authenticated user is available', async () => {
      authStore.user = null;
      authStore.setSession(null);
      wrapper.vm.ttsApiKeyInput = 'tts-key';

      await wrapper.vm.saveSettingsHandler();

      expect(Notify.create).toHaveBeenCalledWith({
        type: 'negative',
        message: 'Please sign in to save TTS settings',
        position: 'top',
      });
    });

    it('requires an API key before saving TTS settings', async () => {
      authStore.user = {
        id: 'user-1',
        email: 'test@example.com',
        avatar_url: null,
        preferences: null,
      };
      wrapper.vm.ttsApiKeyInput = '';

      await wrapper.vm.saveSettingsHandler();

      expect(Notify.create).toHaveBeenCalledWith({
        type: 'negative',
        message: 'Please enter an API key',
        position: 'top',
      });
    });

    it('passes the save payload to the mutation and shows success feedback', async () => {
      const mutate = vi.fn((_payload, options: any) => {
        options.onSuccess();
      });

      wrapper.unmount();
      vi.mocked(useUpdateTTSSettingsMutation).mockReturnValue({ mutate } as any);
      wrapper = mountComponent();

      authStore.user = {
        id: 'user-1',
        email: 'test@example.com',
        avatar_url: null,
        preferences: null,
      };
      wrapper.vm.ttsProvider = 'elevenlabs';
      wrapper.vm.ttsApiKeyInput = 'tts-key';
      wrapper.vm.ttsVoiceId = '';
      wrapper.vm.ttsModel = '';

      await wrapper.vm.saveSettingsHandler();

      expect(mutate).toHaveBeenCalledWith(
        {
          provider: 'elevenlabs',
          apiKey: 'tts-key',
          voiceId: undefined,
          model: undefined,
        },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      );
      expect(Notify.create).toHaveBeenCalledWith({
        type: 'positive',
        message: 'TTS settings saved successfully',
        position: 'top',
      });
    });

    it('shows a fallback error when the mutation fails with a non-Error value', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const mutate = vi.fn((_payload, options: any) => {
        options.onError('boom');
      });

      wrapper.unmount();
      vi.mocked(useUpdateTTSSettingsMutation).mockReturnValue({ mutate } as any);
      wrapper = mountComponent();

      authStore.user = {
        id: 'user-1',
        email: 'test@example.com',
        avatar_url: null,
        preferences: null,
      };
      wrapper.vm.ttsApiKeyInput = 'tts-key';

      await wrapper.vm.saveSettingsHandler();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error saving TTS settings:', 'boom');
      expect(Notify.create).toHaveBeenCalledWith({
        type: 'negative',
        message: 'Failed to save TTS settings',
        position: 'top',
      });
    });

    it('shows the error message when the mutation fails with an Error instance', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const saveError = new Error('Custom TTS error message');
        const mutate = vi.fn((_payload, options: any) => {
          options.onError(saveError);
        });

        wrapper.unmount();
        vi.mocked(useUpdateTTSSettingsMutation).mockReturnValue({ mutate } as any);
        wrapper = mountComponent();

        authStore.user = {
          id: 'user-1',
          email: 'test@example.com',
          avatar_url: null,
          preferences: null,
        };
        wrapper.vm.ttsApiKeyInput = 'tts-key';

        await wrapper.vm.saveSettingsHandler();

        expect(consoleErrorSpy).toHaveBeenCalledWith('Error saving TTS settings:', saveError);
        expect(Notify.create).toHaveBeenCalledWith({
          type: 'negative',
          message: 'Custom TTS error message',
          position: 'top',
        });
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });
  });

  describe('API key visibility toggles', () => {
    it('showTtsApiKey defaults to false (password input)', () => {
      expect(wrapper.vm.showTtsApiKey).toBe(false);
    });

    it('showTtsApiKey can be set to true', async () => {
      wrapper.vm.showTtsApiKey = true;
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.showTtsApiKey).toBe(true);
    });
  });

  describe('currentUserId computed', () => {
    it('returns user id when user is set', () => {
      authStore.user = {
        id: 'user-from-profile',
        email: 'a@b.com',
        avatar_url: null,
        preferences: null,
      };
      expect(wrapper.vm.currentUserId).toBe('user-from-profile');
    });

    it('falls back to session user id when user object has no id', () => {
      authStore.user = null;
      authStore.setSession({ user: { id: 'session-user-id', email: 'x@y.com' } });
      expect(wrapper.vm.currentUserId).toBe('session-user-id');
    });

    it('returns null when neither user nor session is set', () => {
      authStore.user = null;
      authStore.setSession(null);
      expect(wrapper.vm.currentUserId).toBeNull();
    });
  });
});

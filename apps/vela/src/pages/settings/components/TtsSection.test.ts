import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, VueWrapper, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { Quasar, Notify } from 'quasar';
import { ref, type Ref } from 'vue';
import TtsSection from './TtsSection.vue';
import { useAuthStore } from '@/stores/auth';
import {
  useTTSSettingsQuery,
  useUpdateTTSSettingsMutation,
} from '@/composables/queries/useTTSQueries';

// Mock TTS queries composable
vi.mock('@/composables/queries/useTTSQueries', () => ({
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
  let settingsData: Ref<unknown>;

  const mountComponent = () =>
    mount(TtsSection, {
      global: { plugins: [Quasar], stubs },
    });

  beforeEach(() => {
    setActivePinia(createPinia());
    authStore = useAuthStore();

    vi.clearAllMocks();
    Notify.create = vi.fn() as never;
    settingsData = ref<unknown>(null);
    vi.mocked(useTTSSettingsQuery).mockReturnValue({ data: settingsData } as never);
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
    it('sets default voice and model for openai when changing to openai', async () => {
      wrapper.vm.ttsProvider = 'openai';
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.ttsVoiceId).toBe('alloy');
      expect(wrapper.vm.ttsModel).toBe('gpt-realtime-2.1-mini');
    });

    it('sets default voice and model for gemini when changing to gemini', async () => {
      wrapper.vm.ttsProvider = 'gemini';
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.ttsVoiceId).toBe('Kore');
      expect(wrapper.vm.ttsModel).toBe('gemini-3.8-flash-tts');
    });

    it('resets an openai voice and model to the elevenlabs defaults when switching back', async () => {
      wrapper.vm.ttsProvider = 'openai';
      await wrapper.vm.$nextTick();
      wrapper.vm.ttsProvider = 'elevenlabs';
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.ttsVoiceId).toBe('ErXwobaYiN019PkySvjV');
      expect(wrapper.vm.ttsModel).toBe('eleven_v4');
    });

    it('does not carry an elevenlabs model or voice into openai', async () => {
      wrapper.vm.ttsModel = 'eleven_multilingual_v2';
      wrapper.vm.ttsVoiceId = 'custom-elevenlabs-voice';
      wrapper.vm.ttsProvider = 'openai';
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.ttsModel).toBe('gpt-realtime-2.1-mini');
      expect(wrapper.vm.ttsVoiceId).toBe('alloy');
    });

    it('clears a key typed for the previous provider on a provider switch', async () => {
      wrapper.vm.ttsApiKeyInput = 'typed-for-elevenlabs';
      wrapper.vm.ttsProvider = 'openai';
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.ttsApiKeyInput).toBe('');
    });

    it('restores the saved voice and model when switching away from the saved provider and back', async () => {
      settingsData.value = {
        provider: 'openai',
        voiceId: 'marin',
        model: 'gpt-realtime-2.1-mini',
        hasApiKey: true,
      };
      await flushPromises();

      expect(wrapper.vm.ttsProvider).toBe('openai');
      expect(wrapper.vm.ttsVoiceId).toBe('marin');
      expect(wrapper.vm.ttsModel).toBe('gpt-realtime-2.1-mini');

      wrapper.vm.ttsProvider = 'gemini';
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.ttsVoiceId).toBe('Kore');
      expect(wrapper.vm.ttsModel).toBe('gemini-3.8-flash-tts');

      wrapper.vm.ttsProvider = 'openai';
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.ttsVoiceId).toBe('marin');
      expect(wrapper.vm.ttsModel).toBe('gpt-realtime-2.1-mini');

      // Because the form is back to the saved state, a subsequent refetch applies cleanly.
      settingsData.value = {
        provider: 'openai',
        voiceId: 'cedar',
        model: 'gpt-realtime-2.1-mini',
        hasApiKey: true,
      };
      await flushPromises();
      expect(wrapper.vm.ttsVoiceId).toBe('cedar');
    });
  });

  describe('registry-backed options', () => {
    it('renders one provider option per registry provider', () => {
      expect(wrapper.vm.ttsProviderOptions).toEqual([
        { label: 'ElevenLabs', value: 'elevenlabs' },
        { label: 'OpenAI', value: 'openai' },
        { label: 'Google Gemini', value: 'gemini' },
      ]);
    });

    it('renders the elevenlabs models with the default marked', () => {
      expect(wrapper.vm.ttsModelOptions).toEqual([
        { label: 'Eleven v4 (default)', value: 'eleven_v4' },
        { label: 'Eleven Multilingual v2', value: 'eleven_multilingual_v2' },
      ]);
    });

    it('renders the single OpenAI model as the only choice', async () => {
      wrapper.vm.ttsProvider = 'openai';
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.ttsModelOptions).toEqual([
        { label: 'GPT Realtime 2.1 Mini (default)', value: 'gpt-realtime-2.1-mini' },
      ]);
    });

    it('renders the gemini models with the default marked', async () => {
      wrapper.vm.ttsProvider = 'gemini';
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.ttsModelOptions).toEqual([
        { label: 'Gemini 3.8 Flash TTS (default)', value: 'gemini-3.8-flash-tts' },
        { label: 'Gemini 3.8 Flash-Lite TTS', value: 'gemini-3.8-flash-lite-tts' },
      ]);
    });

    it('keeps elevenlabs voice free-form (no option list)', () => {
      expect(wrapper.vm.ttsVoiceOptions).toBeNull();
    });

    it('renders the official OpenAI voice list', async () => {
      wrapper.vm.ttsProvider = 'openai';
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.ttsVoiceOptions?.map((option) => option.value)).toEqual([
        'alloy',
        'ash',
        'ballad',
        'coral',
        'echo',
        'sage',
        'shimmer',
        'verse',
        'marin',
        'cedar',
      ]);
    });

    it('renders the official Gemini voices without the removed Iocaste', async () => {
      wrapper.vm.ttsProvider = 'gemini';
      await wrapper.vm.$nextTick();
      const values = wrapper.vm.ttsVoiceOptions?.map((option) => option.value) ?? [];
      expect(values).toHaveLength(30);
      expect(values).toContain('Kore');
      expect(values).not.toContain('Iocaste');
    });
  });

  describe('TTS settings query sync', () => {
    it('hydrates the local TTS form from loaded query data', async () => {
      settingsData.value = {
        provider: 'elevenlabs',
        voiceId: 'voice-123',
        model: 'eleven_multilingual_v2',
        hasApiKey: true,
      };
      await flushPromises();

      expect(wrapper.vm.ttsProvider).toBe('elevenlabs');
      expect(wrapper.vm.ttsVoiceId).toBe('voice-123');
      expect(wrapper.vm.ttsModel).toBe('eleven_multilingual_v2');
      expect(wrapper.vm.hasSavedKeyForSelectedProvider).toBe(true);
    });

    it('resolves an unsupported stored model to the registry default', async () => {
      settingsData.value = {
        provider: 'elevenlabs',
        voiceId: 'voice-123',
        model: 'eleven_turbo_v2',
        hasApiKey: true,
      };
      await flushPromises();

      expect(wrapper.vm.ttsModel).toBe('eleven_v4');
    });

    it('does not clobber an in-progress model edit when the query refetches', async () => {
      await flushPromises();

      wrapper.vm.ttsModel = 'eleven_multilingual_v2';
      await wrapper.vm.$nextTick();

      settingsData.value = {
        provider: 'elevenlabs',
        voiceId: 'ErXwobaYiN019PkySvjV',
        model: 'eleven_v4',
        hasApiKey: true,
      };
      await flushPromises();

      expect(wrapper.vm.ttsModel).toBe('eleven_multilingual_v2');
    });

    it('falls back to elevenlabs when loaded query data has no provider', async () => {
      settingsData.value = {
        provider: null,
        voiceId: 'voice-abc',
        model: null,
        hasApiKey: false,
      };
      await flushPromises();

      expect(wrapper.vm.ttsProvider).toBe('elevenlabs');
    });

    it('applies the deferred saved selection once the entered key is cleared', async () => {
      // The GET is still pending (data null) while the user types a key.
      wrapper.vm.ttsApiKeyInput = 'typed-key';
      await wrapper.vm.$nextTick();

      settingsData.value = {
        provider: 'elevenlabs',
        voiceId: 'saved-custom-voice',
        model: 'eleven_multilingual_v2',
        hasApiKey: true,
      };
      await flushPromises();

      // Hydration is skipped over the unsaved key; defaults remain.
      expect(wrapper.vm.ttsVoiceId).toBe('ErXwobaYiN019PkySvjV');
      expect(wrapper.vm.ttsModel).toBe('eleven_v4');

      wrapper.vm.ttsApiKeyInput = '';
      await flushPromises();

      expect(wrapper.vm.ttsProvider).toBe('elevenlabs');
      expect(wrapper.vm.ttsVoiceId).toBe('saved-custom-voice');
      expect(wrapper.vm.ttsModel).toBe('eleven_multilingual_v2');
    });
  });

  describe('saved key for the selected provider', () => {
    const SAVED_ELEVENLABS = {
      provider: 'elevenlabs',
      voiceId: 'ErXwobaYiN019PkySvjV',
      model: 'eleven_v4',
      hasApiKey: true,
    };

    const seedSettings = async (
      settings: unknown,
      mutate: ReturnType<typeof vi.fn> = vi.fn(),
    ): Promise<void> => {
      // The component captures `mutate` at setup, so install the mock before mounting.
      vi.mocked(useUpdateTTSSettingsMutation).mockReturnValue({ mutate } as never);
      settingsData.value = null;
      wrapper.unmount();
      wrapper = mountComponent();
      settingsData.value = settings;
      await flushPromises();
    };

    const signIn = () => {
      authStore.user = {
        id: 'user-1',
        email: 'test@example.com',
        avatar_url: null,
        preferences: null,
      };
    };

    it('enables saving a same-provider model change without a new key', async () => {
      const mutate = vi.fn();
      await seedSettings(SAVED_ELEVENLABS, mutate);
      signIn();
      await flushPromises();

      wrapper.vm.ttsModel = 'eleven_multilingual_v2';
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.hasSavedKeyForSelectedProvider).toBe(true);
      expect(wrapper.find('[data-testid="tts-save"]').attributes('disabled')).toBeUndefined();

      await wrapper.vm.saveSettingsHandler();

      expect(mutate).toHaveBeenCalledTimes(1);
      const [payload] = mutate.mock.calls[0] as [Record<string, unknown>, unknown];
      expect(payload).toEqual({
        provider: 'elevenlabs',
        voiceId: 'ErXwobaYiN019PkySvjV',
        model: 'eleven_multilingual_v2',
      });
      expect(payload).not.toHaveProperty('apiKey');
    });

    it('does not treat a saved ElevenLabs key as a key for an unsaved OpenAI selection', async () => {
      const mutate = vi.fn();
      await seedSettings(SAVED_ELEVENLABS, mutate);
      signIn();
      await flushPromises();

      wrapper.vm.ttsProvider = 'openai';
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.hasSavedKeyForSelectedProvider).toBe(false);
      expect(wrapper.find('[data-testid="tts-save"]').attributes('disabled')).toBeDefined();
      expect(wrapper.text()).toContain('Not configured');

      await wrapper.vm.saveSettingsHandler();

      expect(mutate).not.toHaveBeenCalled();
      expect(Notify.create).toHaveBeenCalledWith({
        type: 'negative',
        message: 'Please enter an API key',
        position: 'top',
      });
    });

    it('treats a cleared key input as blank and retains the saved key', async () => {
      const mutate = vi.fn();
      await seedSettings(SAVED_ELEVENLABS, mutate);
      signIn();
      await flushPromises();

      // q-input clearable can write null despite the string ref type.
      wrapper.vm.ttsApiKeyInput = null as unknown as string;
      await wrapper.vm.$nextTick();

      expect(wrapper.find('[data-testid="tts-save"]').attributes('disabled')).toBeUndefined();

      await wrapper.vm.saveSettingsHandler();

      const [payload] = mutate.mock.calls[0] as [Record<string, unknown>, unknown];
      expect(payload).not.toHaveProperty('apiKey');
    });

    it('shows the retention hint only for the provider that has a saved key', async () => {
      await seedSettings(SAVED_ELEVENLABS);
      await flushPromises();

      expect(wrapper.vm.ttsApiKeyHint).toContain('Leave blank to keep the saved ElevenLabs key');

      wrapper.vm.ttsProvider = 'openai';
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.ttsApiKeyHint).not.toContain('Leave blank');
    });

    it('keeps a voice edit made while a save is in flight after the refetch', async () => {
      const pending: { options?: { onSuccess: () => void } } = {};
      const mutate = vi.fn((_payload: unknown, options: { onSuccess: () => void }) => {
        pending.options = options;
      });
      await seedSettings(SAVED_ELEVENLABS, mutate);
      signIn();
      await flushPromises();

      wrapper.vm.ttsModel = 'eleven_multilingual_v2';
      await wrapper.vm.saveSettingsHandler();
      expect(pending.options).toBeDefined();

      // Inputs stay editable during the request; this edit was not submitted.
      wrapper.vm.ttsVoiceId = 'voice-edited-during-save';
      await wrapper.vm.$nextTick();

      pending.options?.onSuccess();
      await flushPromises();

      // Invalidation refetch: the submitted model with the original voice.
      settingsData.value = { ...SAVED_ELEVENLABS, model: 'eleven_multilingual_v2' };
      await flushPromises();

      expect(wrapper.vm.ttsModel).toBe('eleven_multilingual_v2');
      expect(wrapper.vm.ttsVoiceId).toBe('voice-edited-during-save');
    });

    it('keeps the submitted selection while the post-save refetch is pending', async () => {
      const pending: { options?: { onSuccess: () => void } } = {};
      const mutate = vi.fn((_payload: unknown, options: { onSuccess: () => void }) => {
        pending.options = options;
      });
      await seedSettings(SAVED_ELEVENLABS, mutate);
      signIn();
      await flushPromises();

      wrapper.vm.ttsApiKeyInput = 'replacement-key';
      wrapper.vm.ttsModel = 'eleven_multilingual_v2';
      await wrapper.vm.saveSettingsHandler();

      // The invalidation refetch is still in flight, so the query snapshot
      // still holds the pre-save selection when the key is cleared.
      pending.options?.onSuccess();
      await flushPromises();

      expect(wrapper.vm.ttsModel).toBe('eleven_multilingual_v2');

      settingsData.value = { ...SAVED_ELEVENLABS, model: 'eleven_multilingual_v2' };
      await flushPromises();

      expect(wrapper.vm.ttsModel).toBe('eleven_multilingual_v2');
    });

    it('does not mark a provider switch made during a save as saved', async () => {
      const pending: { options?: { onSuccess: () => void } } = {};
      const mutate = vi.fn((_payload: unknown, options: { onSuccess: () => void }) => {
        pending.options = options;
      });
      await seedSettings(SAVED_ELEVENLABS, mutate);
      signIn();
      await flushPromises();

      wrapper.vm.ttsModel = 'eleven_multilingual_v2';
      await wrapper.vm.saveSettingsHandler();

      wrapper.vm.ttsProvider = 'openai';
      await wrapper.vm.$nextTick();

      pending.options?.onSuccess();
      await flushPromises();

      settingsData.value = { ...SAVED_ELEVENLABS, model: 'eleven_multilingual_v2' };
      await flushPromises();

      expect(wrapper.vm.ttsProvider).toBe('openai');
      expect(wrapper.vm.ttsModel).toBe('gpt-realtime-2.1-mini');
    });

    it('does not move a key typed while the settings GET is pending to another provider', async () => {
      const mutate = vi.fn();
      await seedSettings(null, mutate);

      wrapper.vm.ttsApiKeyInput = 'eleven-key-typed';
      await wrapper.vm.$nextTick();

      settingsData.value = {
        provider: 'openai',
        voiceId: 'alloy',
        model: 'gpt-realtime-2.1-mini',
        hasApiKey: true,
      };
      await flushPromises();

      expect(wrapper.vm.ttsProvider).toBe('elevenlabs');
      expect(wrapper.vm.ttsApiKeyInput).toBe('eleven-key-typed');
      expect(wrapper.vm.ttsModel).toBe('eleven_v4');
      expect(wrapper.vm.ttsVoiceId).toBe('ErXwobaYiN019PkySvjV');
      expect(wrapper.vm.hasSavedKeyForSelectedProvider).toBe(false);
    });

    it('does not clear a newer key typed while the save is in flight', async () => {
      const pending: { options?: { onSuccess: () => void } } = {};
      const mutate = vi.fn((_payload: unknown, options: { onSuccess: () => void }) => {
        pending.options = options;
      });
      await seedSettings(SAVED_ELEVENLABS, mutate);
      signIn();
      await flushPromises();

      wrapper.vm.ttsApiKeyInput = 'submitted-key';
      await wrapper.vm.saveSettingsHandler();
      expect(pending.options).toBeDefined();

      wrapper.vm.ttsApiKeyInput = 'newer-key';
      await wrapper.vm.$nextTick();

      pending.options?.onSuccess();
      await flushPromises();

      expect(wrapper.vm.ttsApiKeyInput).toBe('newer-key');
    });

    it('clears an unchanged submitted key after success so later hydration applies', async () => {
      const mutate = vi.fn((_payload: unknown, options: { onSuccess: () => void }) => {
        options.onSuccess();
      });
      await seedSettings(null, mutate);
      signIn();

      wrapper.vm.ttsApiKeyInput = 'first-key';
      await wrapper.vm.saveSettingsHandler();

      expect(wrapper.vm.ttsApiKeyInput).toBe('');

      settingsData.value = { ...SAVED_ELEVENLABS, model: 'eleven_multilingual_v2' };
      await flushPromises();

      expect(wrapper.vm.ttsModel).toBe('eleven_multilingual_v2');
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
      expect(Notify.create).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'positive' }));
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

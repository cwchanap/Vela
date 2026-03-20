import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { Quasar } from 'quasar';
import { createRouter, createMemoryHistory } from 'vue-router';
import SettingsPage from './SettingsPage.vue';
import { useLLMSettingsStore } from 'src/stores/llmSettings';
import { useThemeStore } from 'src/stores/theme';
import { useAuthStore } from 'src/stores/auth';

// Mock TTS queries composable
vi.mock('../../composables/queries/useTTSQueries', () => ({
  useTTSSettingsQuery: vi.fn(() => ({
    data: { value: null },
  })),
  useUpdateTTSSettingsMutation: vi.fn(() => ({
    mutate: vi.fn(),
  })),
}));

const createTestRouter = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  });

describe('SettingsPage', () => {
  let wrapper: VueWrapper;
  let llmStore: ReturnType<typeof useLLMSettingsStore>;
  let themeStore: ReturnType<typeof useThemeStore>;
  let authStore: ReturnType<typeof useAuthStore>;

  beforeEach(async () => {
    setActivePinia(createPinia());
    const router = createTestRouter();
    await router.push('/');

    llmStore = useLLMSettingsStore();
    themeStore = useThemeStore();
    authStore = useAuthStore();

    vi.clearAllMocks();

    wrapper = mount(SettingsPage, {
      global: {
        plugins: [Quasar, router],
        stubs: {
          'q-page': { template: '<div data-testid="settings-page"><slot /></div>' },
          'q-card': { template: '<div><slot /></div>' },
          'q-card-section': { template: '<div><slot /></div>' },
          'q-card-actions': { template: '<div><slot /></div>' },
          'q-separator': true,
          'q-toggle': {
            template:
              '<input type="checkbox" @change="$emit(\'update:modelValue\', !modelValue)" />',
            props: ['modelValue'],
            emits: ['update:modelValue'],
          },
          'q-select': {
            template: '<div />',
            props: ['modelValue', 'options'],
            emits: ['update:modelValue'],
          },
          'q-input': { template: '<div />', props: ['modelValue'], emits: ['update:modelValue'] },
          'q-btn': {
            template: '<button @click="$emit(\'click\')"><slot /></button>',
            emits: ['click'],
          },
          'q-badge': { template: '<span><slot /></span>' },
          'q-icon': true,
        },
      },
    });
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  describe('Rendering', () => {
    it('renders without errors', () => {
      expect(wrapper.exists()).toBe(true);
    });

    it('shows App Settings header', () => {
      expect(wrapper.text()).toContain('App Settings');
    });

    it('shows Theme section', () => {
      expect(wrapper.text()).toContain('Theme');
    });

    it('shows LLM Provider section', () => {
      expect(wrapper.text()).toContain('LLM Provider');
    });

    it('shows Text-to-Speech section', () => {
      expect(wrapper.text()).toContain('Text-to-Speech');
    });
  });

  describe('activeSummary computed', () => {
    it('shows provider and model name', () => {
      // Default store values
      const summary = wrapper.vm.activeSummary;
      expect(summary).toContain(llmStore.provider);
      expect(summary).toContain(llmStore.currentModel);
    });

    it('uses bullet separator', () => {
      expect(wrapper.vm.activeSummary).toContain('•');
    });
  });

  describe('apiKeyHint computed', () => {
    it('shows enter API key hint when no key configured', () => {
      llmStore.setApiKey('');
      expect(wrapper.vm.apiKeyHint).toBe('Enter your API key for this provider');
    });

    it('shows personal API key hint when key is configured', () => {
      llmStore.setApiKey('my-api-key');
      expect(wrapper.vm.apiKeyHint).toBe('Your personal API key will be used for this provider');
    });
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
      (authStore as any).session = null;
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
  });

  describe('toggleDarkMode', () => {
    it('calls themeStore.toggle when dark mode is toggled', () => {
      const toggleSpy = vi.spyOn(themeStore, 'toggle').mockImplementation(() => {});
      wrapper.vm.toggleDarkMode();
      expect(toggleSpy).toHaveBeenCalled();
    });

    it('updates darkModeEnabled to reflect themeStore.isDark after toggle', () => {
      // Mock toggle to use $patch to properly update pinia state
      vi.spyOn(themeStore, 'toggle').mockImplementation(() => {
        themeStore.$patch({ darkMode: !themeStore.darkMode });
      });
      const initialDark = themeStore.isDark;
      wrapper.vm.toggleDarkMode();
      expect(wrapper.vm.darkModeEnabled).toBe(!initialDark);
    });
  });
});

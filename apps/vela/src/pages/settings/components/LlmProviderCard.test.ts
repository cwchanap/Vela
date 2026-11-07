import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, VueWrapper, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { Quasar, Notify } from 'quasar';
import LlmProviderCard from './LlmProviderCard.vue';
import { useLLMSettingsStore } from 'src/stores/llmSettings';
import { useAuthStore } from 'src/stores/auth';
import { LLM_PROVIDER_REGISTRY, type LlmProvider } from '@vela/common';
import type { LlmPreferences, UserPreferences } from 'src/types/shared';

const stubs = {
  'q-card': { template: '<div><slot /></div>' },
  'q-card-section': { template: '<div><slot /></div>' },
  'q-card-actions': { template: '<div><slot /></div>' },
  'q-separator': true,
  'q-expansion-item': {
    template:
      '<div class="q-expansion-item"><div class="exp-header" @click="$emit(\'update:modelValue\', !modelValue)">{{ label }}</div><div v-show="modelValue"><slot /></div></div>',
    props: ['modelValue', 'label'],
    emits: ['update:modelValue'],
  },
  'q-toggle': {
    template: '<input type="checkbox" />',
    props: ['modelValue'],
    emits: ['update:modelValue'],
  },
  'q-select': {
    template:
      '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="o in options" :key="optionValue(o)" :value="optionValue(o)">{{ optionLabel(o) }}</option></select>',
    props: ['modelValue', 'options'],
    emits: ['update:modelValue'],
    methods: {
      optionValue(o: unknown) {
        return typeof o === 'object' && o !== null ? (o as { value: unknown }).value : o;
      },
      optionLabel(o: unknown) {
        return typeof o === 'object' && o !== null ? (o as { label: unknown }).label : o;
      },
    },
  },
  'q-input': {
    template:
      '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
    props: ['modelValue'],
    emits: ['update:modelValue'],
  },
  'q-btn': {
    template: '<button :disabled="disable" @click="$emit(\'click\')"><slot /></button>',
    props: ['disable', 'loading'],
    emits: ['click'],
  },
  'q-badge': { template: '<span><slot /></span>' },
  'q-icon': true,
};

const llmFor = (overrides: Partial<LlmPreferences> = {}): LlmPreferences => ({
  keys: {},
  thinking: {},
  defaultModel: {
    provider: 'google',
    model: LLM_PROVIDER_REGISTRY.google.defaultModel,
  },
  ...overrides,
});

const setUser = (
  authStore: ReturnType<typeof useAuthStore>,
  llm: LlmPreferences | undefined,
  id = 'user-1',
) => {
  authStore.user = {
    id,
    email: 'test@example.com',
    username: 'testuser',
    current_level: 1,
    total_experience: 0,
    learning_streak: 0,
    native_language: 'en',
    preferences: (llm ? { llm } : {}) as UserPreferences,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  };
  authStore.setSession({ user: authStore.user, provider: 'cognito' });
};

describe('LlmProviderCard', () => {
  let wrapper: VueWrapper;
  let llmStore: ReturnType<typeof useLLMSettingsStore>;
  let authStore: ReturnType<typeof useAuthStore>;
  let updatePreferencesSpy: ReturnType<typeof vi.spyOn>;

  const mountCard = (provider: LlmProvider) =>
    mount(LlmProviderCard, {
      props: { provider },
      global: { plugins: [Quasar], stubs },
    });

  beforeEach(() => {
    setActivePinia(createPinia());
    llmStore = useLLMSettingsStore();
    authStore = useAuthStore();
    vi.clearAllMocks();
    Notify.create = vi.fn() as never;
    updatePreferencesSpy = vi
      .spyOn(authStore, 'updatePreferences')
      .mockImplementation(async (partial) => {
        if (!authStore.user) return false;
        authStore.user.preferences = {
          ...(authStore.user.preferences as UserPreferences),
          ...partial,
        };
        return true;
      });
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  describe('rendering', () => {
    it('renders the provider label and API key field', () => {
      wrapper = mountCard('google');
      expect(wrapper.text()).toContain('Google');
      expect(wrapper.find('[data-testid="llm-key-input-google"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="llm-save-google"]').exists()).toBe(true);
    });

    it('shows a "Key saved" badge only when a key is saved for the provider', async () => {
      setUser(authStore, llmFor({ keys: { openai: 'saved-openai-key' } }));
      wrapper = mountCard('openai');
      await flushPromises();
      expect(wrapper.text()).toContain('Key saved');
    });

    it('does not show "Key saved" for a provider without a key', async () => {
      setUser(authStore, llmFor({ keys: { google: 'google-key' } }));
      wrapper = mountCard('openai');
      await flushPromises();
      expect(wrapper.text()).not.toContain('Key saved');
    });

    it('renders one effort row per registry model for fixed providers', () => {
      wrapper = mountCard('anthropic');
      for (const model of LLM_PROVIDER_REGISTRY.anthropic.models ?? []) {
        expect(wrapper.find(`[data-testid="llm-effort-${model.id}"]`).exists()).toBe(true);
      }
      expect(wrapper.text()).toContain('High and above may time out in My Dictionaries');
    });

    it('offers Default plus the model native efforts as choices', () => {
      wrapper = mountCard('google');
      const select = wrapper.find('[data-testid="llm-effort-gemini-3.8-flash"]');
      const labels = select.findAll('option').map((o) => o.text());
      expect(labels).toEqual(['Default', 'low', 'medium', 'high']);
    });

    it('renders key only for OpenRouter with no effort or model inputs', () => {
      wrapper = mountCard('openrouter');
      expect(wrapper.find('[data-testid="llm-key-input-openrouter"]').exists()).toBe(true);
      expect(wrapper.findAll('select').length).toBe(0);
      expect(wrapper.text()).toContain('Free-form model IDs; no thinking controls');
    });
  });

  describe('draft hydration', () => {
    it('initializes the key draft and effort drafts from saved preferences', async () => {
      setUser(
        authStore,
        llmFor({
          keys: { google: 'saved-google-key' },
          thinking: { 'gemini-3.8-flash': 'high' },
        }),
      );
      wrapper = mountCard('google');
      await flushPromises();
      const keyInput = wrapper.find('[data-testid="llm-key-input-google"]');
      expect((keyInput.element as HTMLInputElement).value).toBe('saved-google-key');
      const effort = wrapper.find('[data-testid="llm-effort-gemini-3.8-flash"]');
      expect((effort.element as HTMLSelectElement).value).toBe('high');
    });

    it('clears drafts when the user signs out', async () => {
      setUser(authStore, llmFor({ keys: { google: 'saved-google-key' } }));
      wrapper = mountCard('google');
      await flushPromises();
      authStore.user = null;
      await flushPromises();
      const keyInput = wrapper.find('[data-testid="llm-key-input-google"]');
      expect((keyInput.element as HTMLInputElement).value).toBe('');
    });

    it('clears unsaved key and effort drafts when the account changes with identical saved values', async () => {
      setUser(authStore, llmFor(), 'user-a');
      wrapper = mountCard('google');
      await flushPromises();
      await wrapper.find('[data-testid="llm-key-input-google"]').setValue('draft-key');
      await wrapper.find('[data-testid="llm-effort-gemini-3.8-flash"]').setValue('high');

      setUser(authStore, llmFor(), 'user-b');
      await flushPromises();

      const keyInput = wrapper.find('[data-testid="llm-key-input-google"]');
      expect((keyInput.element as HTMLInputElement).value).toBe('');
      const effort = wrapper.find('[data-testid="llm-effort-gemini-3.8-flash"]');
      expect((effort.element as HTMLSelectElement).value).toBe('');
    });
  });

  describe('save', () => {
    it('saves only this provider through updatePreferences', async () => {
      setUser(authStore, llmFor({ keys: { google: 'keep-google' } }));
      wrapper = mountCard('openai');
      await flushPromises();
      await wrapper.find('[data-testid="llm-key-input-openai"]').setValue('openai-new');
      await wrapper.find('[data-testid="llm-save-openai"]').trigger('click');
      await flushPromises();

      expect(updatePreferencesSpy).toHaveBeenCalledTimes(1);
      const llm = updatePreferencesSpy.mock.calls[0]![0].llm as LlmPreferences;
      expect(llm.keys).toEqual({ google: 'keep-google', openai: 'openai-new' });
      expect(llmStore.llm.keys.openai).toBe('openai-new');
      expect(Notify.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'positive' }));
    });

    it('sends effort overrides and deletes overrides selected as Default', async () => {
      setUser(
        authStore,
        llmFor({
          thinking: { 'gemini-3.8-flash': 'high', 'gemini-4-argon': 'low' },
        }),
      );
      wrapper = mountCard('google');
      await flushPromises();

      await wrapper.find('[data-testid="llm-effort-gemini-3.8-flash"]').setValue('');
      await wrapper.find('[data-testid="llm-effort-gemini-4-argon"]').setValue('medium');
      await wrapper.find('[data-testid="llm-save-google"]').trigger('click');
      await flushPromises();

      const llm = updatePreferencesSpy.mock.calls[0]![0].llm as LlmPreferences;
      expect(llm.thinking['gemini-3.8-flash']).toBeUndefined();
      expect(llm.thinking['gemini-4-argon']).toBe('medium');
      expect(Notify.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'positive' }));
    });

    it('clears the key on empty draft without touching effort overrides', async () => {
      setUser(
        authStore,
        llmFor({
          keys: { openai: 'saved-key' },
          thinking: { 'gpt-6.1-sol': 'max' },
        }),
      );
      wrapper = mountCard('openai');
      await flushPromises();
      await wrapper.find('[data-testid="llm-key-input-openai"]').setValue('');
      await wrapper.find('[data-testid="llm-save-openai"]').trigger('click');
      await flushPromises();

      const llm = updatePreferencesSpy.mock.calls[0]![0].llm as LlmPreferences;
      expect(llm.keys).toEqual({});
      expect(llm.thinking).toEqual({ 'gpt-6.1-sol': 'max' });
    });

    it('keeps the draft editable and shows no success toast on a failed save', async () => {
      setUser(authStore, llmFor({ keys: { google: 'saved' } }));
      updatePreferencesSpy.mockResolvedValue(false);
      wrapper = mountCard('google');
      await flushPromises();
      await wrapper.find('[data-testid="llm-key-input-google"]').setValue('draft-unsaved');
      await wrapper.find('[data-testid="llm-save-google"]').trigger('click');
      await flushPromises();

      expect(Notify.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'negative' }));
      expect(Notify.create).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'positive' }));
      const keyInput = wrapper.find('[data-testid="llm-key-input-google"]');
      expect((keyInput.element as HTMLInputElement).value).toBe('draft-unsaved');
      expect(llmStore.llm.keys.google).toBe('saved');
    });
  });
});

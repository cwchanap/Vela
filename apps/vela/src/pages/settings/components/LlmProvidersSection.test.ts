import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, VueWrapper, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { Quasar, Notify } from 'quasar';
import LlmProvidersSection from './LlmProvidersSection.vue';
import LlmProviderCard from './LlmProviderCard.vue';
import { useLLMSettingsStore } from 'src/stores/llmSettings';
import { useAuthStore } from 'src/stores/auth';
import { LLM_PROVIDER_REGISTRY, LLM_PROVIDERS } from '@vela/common';
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

const GOOGLE_DEFAULT = LLM_PROVIDER_REGISTRY.google.defaultModel;

const llmFor = (overrides: Partial<LlmPreferences> = {}): LlmPreferences => ({
  keys: {},
  thinking: {},
  defaultModel: { provider: 'google', model: GOOGLE_DEFAULT },
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

describe('LlmProvidersSection', () => {
  let wrapper: VueWrapper;
  let llmStore: ReturnType<typeof useLLMSettingsStore>;
  let authStore: ReturnType<typeof useAuthStore>;
  let updatePreferencesSpy: ReturnType<typeof vi.spyOn>;

  const mountSection = () =>
    mount(LlmProvidersSection, {
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

  const cards = () => wrapper.findAllComponents(LlmProviderCard);
  const cardFor = (provider: string) => cards().find((c) => c.props('provider') === provider)!;
  const defaultSelect = () => wrapper.find('[data-testid="llm-default-model-select"]');

  describe('rendering', () => {
    it('mounts one card per provider in registry order', () => {
      wrapper = mountSection();
      expect(cards().map((c) => c.props('provider'))).toEqual([...LLM_PROVIDERS]);
    });

    it('shows the Default model selector atop the section', () => {
      wrapper = mountSection();
      expect(defaultSelect().exists()).toBe(true);
      expect(wrapper.find('[data-testid="llm-default-save"]').exists()).toBe(true);
    });
  });

  describe('default model options', () => {
    it('lists models only for providers that have a user key, keeping the current selection visible', async () => {
      setUser(
        authStore,
        llmFor({
          keys: { openai: 'openai-key' },
          defaultModel: { provider: 'google', model: GOOGLE_DEFAULT },
        }),
      );
      wrapper = mountSection();
      await flushPromises();

      const options = defaultSelect().findAll('option');
      const values = options.map((o) => (o.element as HTMLOptionElement).value);
      expect(values).toContain(`openai::${LLM_PROVIDER_REGISTRY.openai.defaultModel}`);
      expect(values.some((v) => v.startsWith('anthropic::'))).toBe(false);
      expect(values).toContain(`google::${GOOGLE_DEFAULT}`);
    });

    it('shows a missing-key status for the selected provider without reselecting', async () => {
      setUser(authStore, llmFor({ keys: { openai: 'openai-key' } }));
      wrapper = mountSection();
      await flushPromises();
      expect(wrapper.text()).toContain('No API key saved for Google');
      expect(llmStore.selection.provider).toBe('google');
    });

    it('does not reselect the default pair when its provider key is removed', async () => {
      setUser(
        authStore,
        llmFor({
          keys: { openai: 'openai-key' },
          defaultModel: { provider: 'openai', model: 'gpt-6.1-sol' },
        }),
      );
      wrapper = mountSection();
      await flushPromises();

      const openaiCard = cardFor('openai');
      await openaiCard.find('[data-testid="llm-key-input-openai"]').setValue('');
      await openaiCard.find('[data-testid="llm-save-openai"]').trigger('click');
      await flushPromises();

      expect(llmStore.llm.keys.openai).toBeUndefined();
      expect(llmStore.selection.provider).toBe('openai');
      expect(llmStore.selection.model).toBe('gpt-6.1-sol');
      expect(wrapper.text()).toContain('No API key saved for OpenAI');
    });
  });

  describe('default model save', () => {
    it('persists a fixed provider/model pair', async () => {
      setUser(authStore, llmFor({ keys: { openai: 'openai-key' } }));
      wrapper = mountSection();
      await flushPromises();
      await defaultSelect().setValue('openai::gpt-6-luna');
      await wrapper.find('[data-testid="llm-default-save"]').trigger('click');
      await flushPromises();

      const llm = updatePreferencesSpy.mock.calls[0]![0].llm as LlmPreferences;
      expect(llm.defaultModel).toEqual({ provider: 'openai', model: 'gpt-6-luna' });
      expect(llmStore.selection.model).toBe('gpt-6-luna');
      expect(Notify.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'positive' }));
    });

    it('shows a free-form input for OpenRouter and persists the custom ID', async () => {
      setUser(authStore, llmFor({ keys: { openrouter: 'or-key' } }));
      wrapper = mountSection();
      await flushPromises();
      expect(wrapper.find('[data-testid="llm-default-model-input"]').exists()).toBe(false);

      await defaultSelect().setValue('openrouter::__custom__');
      await wrapper.vm.$nextTick();
      const customInput = wrapper.find('[data-testid="llm-default-model-input"]');
      expect(customInput.exists()).toBe(true);
      await customInput.setValue('acme/custom-model:free');
      await wrapper.find('[data-testid="llm-default-save"]').trigger('click');
      await flushPromises();

      const llm = updatePreferencesSpy.mock.calls[0]![0].llm as LlmPreferences;
      expect(llm.defaultModel).toEqual({
        provider: 'openrouter',
        model: 'acme/custom-model:free',
      });
    });

    it('rejects an empty custom model id without saving', async () => {
      setUser(authStore, llmFor({ keys: { openrouter: 'or-key' } }));
      wrapper = mountSection();
      await flushPromises();
      await defaultSelect().setValue('openrouter::__custom__');
      await wrapper.vm.$nextTick();
      await wrapper.find('[data-testid="llm-default-model-input"]').setValue('   ');
      await wrapper.find('[data-testid="llm-default-save"]').trigger('click');
      await flushPromises();

      expect(updatePreferencesSpy).not.toHaveBeenCalled();
      expect(Notify.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'negative' }));
    });

    it('does not toast success when the default save fails', async () => {
      setUser(authStore, llmFor({ keys: { openai: 'openai-key' } }));
      updatePreferencesSpy.mockResolvedValue(false);
      wrapper = mountSection();
      await flushPromises();
      await defaultSelect().setValue('openai::gpt-6-luna');
      await wrapper.find('[data-testid="llm-default-save"]').trigger('click');
      await flushPromises();

      expect(Notify.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'negative' }));
      expect(Notify.create).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'positive' }));
      expect(llmStore.selection.model).toBe(GOOGLE_DEFAULT);
    });
  });

  describe('per-card draft isolation', () => {
    it('keeps a card draft when another card is expanded and edited', async () => {
      setUser(authStore, llmFor());
      wrapper = mountSection();
      await flushPromises();

      const googleCard = cardFor('google');
      const openaiCard = cardFor('openai');

      await googleCard.find('.exp-header').trigger('click');
      await googleCard.find('[data-testid="llm-key-input-google"]').setValue('google-draft');

      await openaiCard.find('.exp-header').trigger('click');
      await openaiCard.find('[data-testid="llm-key-input-openai"]').setValue('openai-draft');
      await flushPromises();

      const googleInput = googleCard.find('[data-testid="llm-key-input-google"]');
      expect((googleInput.element as HTMLInputElement).value).toBe('google-draft');
    });

    it('saving one card cannot overwrite another card saved values or drafts', async () => {
      setUser(authStore, llmFor({ keys: { google: 'saved-google', openai: 'saved-openai' } }));
      wrapper = mountSection();
      await flushPromises();

      const googleCard = cardFor('google');
      const openaiCard = cardFor('openai');

      await openaiCard
        .find('[data-testid="llm-key-input-openai"]')
        .setValue('openai-draft-unsaved');
      await googleCard.find('[data-testid="llm-key-input-google"]').setValue('google-updated');
      await googleCard.find('[data-testid="llm-save-google"]').trigger('click');
      await flushPromises();

      const llm = updatePreferencesSpy.mock.calls[0]![0].llm as LlmPreferences;
      expect(llm.keys).toEqual({ google: 'google-updated', openai: 'saved-openai' });
      const openaiInput = openaiCard.find('[data-testid="llm-key-input-openai"]');
      expect((openaiInput.element as HTMLInputElement).value).toBe('openai-draft-unsaved');
      expect(llmStore.llm.keys.openai).toBe('saved-openai');
    });
  });

  describe('account switching', () => {
    it('resets the section when a different user without llm preferences signs in', async () => {
      setUser(
        authStore,
        llmFor({
          keys: { anthropic: 'a-key' },
          defaultModel: { provider: 'anthropic', model: 'claude-opus-5-5' },
        }),
        'user-a',
      );
      wrapper = mountSection();
      await flushPromises();
      expect(llmStore.selection.provider).toBe('anthropic');

      setUser(authStore, undefined, 'user-b');
      await flushPromises();

      expect(llmStore.selection.provider).toBe('google');
      expect(llmStore.llm.keys).toEqual({});
      const select = defaultSelect();
      expect((select.element as HTMLSelectElement).value).toBe(`google::${GOOGLE_DEFAULT}`);
    });
  });
});

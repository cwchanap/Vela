import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, VueWrapper, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { Quasar, Notify } from 'quasar';
import { VueQueryPlugin, QueryClient } from '@tanstack/vue-query';
import LlmProvidersSection from './LlmProvidersSection.vue';
import { useLLMSettingsStore } from 'src/stores/llmSettings';
import { useAuthStore } from 'src/stores/auth';
import { LLM_PROVIDER_REGISTRY } from '@vela/common';
import type { LlmPreferences, UserPreferences } from 'src/types/shared';

const mockCapabilities = vi.hoisted(() => vi.fn());

vi.mock('src/services/llm', () => ({
  llmClient: {
    capabilities: mockCapabilities,
  },
}));

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

describe('LlmProvidersSection capabilities (real query)', () => {
  let wrapper: VueWrapper;
  let queryClient: QueryClient;
  let llmStore: ReturnType<typeof useLLMSettingsStore>;
  let authStore: ReturnType<typeof useAuthStore>;

  const mountSection = () => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });
    return mount(LlmProvidersSection, {
      global: { plugins: [Quasar, [VueQueryPlugin, { queryClient }]], stubs },
    });
  };

  beforeEach(() => {
    setActivePinia(createPinia());
    llmStore = useLLMSettingsStore();
    authStore = useAuthStore();
    vi.clearAllMocks();
    Notify.create = vi.fn() as never;
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    if (queryClient) queryClient.clear();
  });

  const defaultSelect = () => wrapper.find('[data-testid="llm-default-model-select"]');
  const optionValues = () =>
    defaultSelect()
      .findAll('option')
      .map((o) => (o.element as HTMLOptionElement).value);

  it('removes server-only eligibility and labels after a failed refetch while preserving the current pair', async () => {
    mockCapabilities.mockResolvedValue({ serverKeyProviders: ['google', 'openrouter'] });
    setUser(authStore, llmFor({ keys: { openai: 'openai-key' } }));
    wrapper = mountSection();
    await flushPromises();

    expect(optionValues()).toContain('google::gemini-4-argon');
    expect(optionValues()).toContain('openrouter::__custom__');
    expect(wrapper.text()).toContain('Server key available for chat');
    expect(wrapper.text()).toContain('Chat uses the server key');

    mockCapabilities.mockRejectedValue(new Error('Unauthorized'));
    await queryClient.invalidateQueries({ queryKey: ['llm-capabilities'] });
    await flushPromises();
    await wrapper.vm.$nextTick();

    const values = optionValues();
    expect(values).not.toContain('google::gemini-4-argon');
    expect(values).not.toContain('openrouter::__custom__');
    expect(wrapper.text()).not.toContain('server key');
    expect(wrapper.text()).toContain('No API key saved for Google');
    expect(llmStore.selection.provider).toBe('google');
    expect(llmStore.selection.model).toBe(GOOGLE_DEFAULT);
    expect(values).toContain(`google::${GOOGLE_DEFAULT}`);
    expect(optionValues()).toContain(`openai::${LLM_PROVIDER_REGISTRY.openai.defaultModel}`);
  });
});

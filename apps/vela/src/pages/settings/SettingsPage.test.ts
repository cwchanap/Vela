import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { Quasar, Notify } from 'quasar';
import { createRouter, createMemoryHistory } from 'vue-router';
import SettingsPage from './SettingsPage.vue';
import ThemeSection from './components/ThemeSection.vue';
import LlmProvidersSection from './components/LlmProvidersSection.vue';
import TtsSection from './components/TtsSection.vue';
import LlmProviderCard from './components/LlmProviderCard.vue';
import { LLM_PROVIDERS } from '@vela/common';

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
  let router: ReturnType<typeof createTestRouter>;

  const mountComponent = () =>
    mount(SettingsPage, {
      global: {
        plugins: [Quasar, router],
        stubs: {
          'q-page': { template: '<div data-testid="settings-page"><slot /></div>' },
          'q-card': { template: '<div><slot /></div>' },
          'q-card-section': { template: '<div><slot /></div>' },
          'q-card-actions': { template: '<div><slot /></div>' },
          'q-separator': true,
          'q-expansion-item': {
            template: '<div><div>{{ label }}</div><slot /></div>',
            props: ['modelValue', 'label'],
            emits: ['update:modelValue'],
          },
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
          'q-input': {
            template: '<div />',
            props: ['modelValue'],
            emits: ['update:modelValue'],
          },
          'q-btn': {
            template: '<button @click="$emit(\'click\')"><slot /></button>',
            emits: ['click'],
          },
          'q-badge': { template: '<span><slot /></span>' },
          'q-icon': true,
        },
      },
    });

  beforeEach(async () => {
    setActivePinia(createPinia());
    router = createTestRouter();
    await router.push('/');
    vi.clearAllMocks();
    Notify.create = vi.fn() as any;
    wrapper = mountComponent();
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
  });

  describe('section composition', () => {
    it('renders the Theme section', () => {
      expect(wrapper.findComponent(ThemeSection).exists()).toBe(true);
      expect(wrapper.text()).toContain('Theme');
    });

    it('renders the LLM providers section with one card per provider', () => {
      expect(wrapper.findComponent(LlmProvidersSection).exists()).toBe(true);
      const cards = wrapper.findAllComponents(LlmProviderCard);
      expect(cards.map((c) => c.props('provider'))).toEqual([...LLM_PROVIDERS]);
    });

    it('renders the Text-to-Speech section', () => {
      expect(wrapper.findComponent(TtsSection).exists()).toBe(true);
      expect(wrapper.text()).toContain('Text-to-Speech');
    });
  });
});

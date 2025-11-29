import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { computed, ref } from 'vue';
import { Quasar } from 'quasar';
import MyDictionariesPage from './MyDictionariesPage.vue';

const mockGetMyDictionaries = vi.fn();
const mockDeleteDictionaryEntry = vi.fn();
const mockNotify = vi.fn();

vi.mock('src/services/myDictionariesService', () => ({
  getMyDictionaries: (...args: unknown[]) => mockGetMyDictionaries(...args),
  deleteDictionaryEntry: (...args: unknown[]) => mockDeleteDictionaryEntry(...args),
}));

vi.mock('src/services/ttsService', () => ({
  generatePronunciation: vi.fn(),
  playAudio: vi.fn(),
}));

vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn(),
}));

vi.mock('src/config', () => ({
  config: {
    api: {
      url: '/api/',
    },
  },
}));

vi.mock('src/stores/llmSettings', () => {
  return {
    useLLMSettingsStore: () => ({
      provider: ref('openai'),
      currentModel: ref('gpt-4'),
      currentApiKey: ref('test-key'),
    }),
  };
});

const authUser = ref(null as { id: string } | null);
const authSession = ref(null as { user: { id: string } | null } | null);
const isAuthenticated = computed(() => Boolean(authUser.value && authSession.value));

vi.mock('src/stores/auth', () => ({
  useAuthStore: () => ({
    user: authUser,
    session: authSession,
    isAuthenticated,
  }),
}));

const mountPage = async () => {
  const wrapper = mount(MyDictionariesPage, {
    global: {
      plugins: [Quasar],
      stubs: {
        transition: false,
        teleport: false,
        QPage: { template: '<div class="q-page"><slot /></div>' },
        QLayout: { template: '<div class="q-layout"><slot /></div>' },
      },
    },
  });

  const $q = (wrapper.vm as { $q?: { notify?: typeof mockNotify } }).$q;
  if ($q) {
    $q.notify = mockNotify;
  }

  await flushPromises();
  return wrapper;
};

const mockEntries = [
  {
    user_id: 'user-1',
    sentence_id: 'sentence-1',
    sentence: '私は猫が好きです',
    source_url: 'https://example.com',
    context: 'Learning basic sentences',
    created_at: 1630000000000,
    updated_at: 1630000000000,
  },
  {
    user_id: 'user-1',
    sentence_id: 'sentence-2',
    sentence: '今日は晴れです',
    created_at: 1630000001000,
    updated_at: 1630000001000,
  },
];

describe('MyDictionariesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMyDictionaries.mockReset();
    mockDeleteDictionaryEntry.mockReset();
    authUser.value = null;
    authSession.value = null;
    mockNotify.mockReset();
  });

  it('loads and displays dictionary entries', async () => {
    mockGetMyDictionaries.mockResolvedValue(mockEntries);

    const wrapper = await mountPage();

    expect(mockGetMyDictionaries).toHaveBeenCalled();
    expect(wrapper.text()).toContain('私は猫が好きです');
    expect(wrapper.text()).toContain('今日は晴れです');
  });

  it('shows an error and retries loading entries when refresh is clicked', async () => {
    mockGetMyDictionaries.mockRejectedValueOnce(new Error('Failed to load dictionary entries'));
    mockGetMyDictionaries.mockResolvedValue(mockEntries);

    const wrapper = await mountPage();

    expect(wrapper.text()).toContain('Failed to load dictionary entries');

    const retryButton = wrapper.findAll('button').find((btn) => btn.text() === 'Retry');
    expect(retryButton).toBeTruthy();
    await retryButton!.trigger('click');

    await flushPromises();

    expect(mockGetMyDictionaries.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(wrapper.text()).toContain('今日は晴れです');
  });

  it('deletes a dictionary entry and notifies the user', async () => {
    mockGetMyDictionaries.mockResolvedValue(mockEntries);
    mockDeleteDictionaryEntry.mockResolvedValue(undefined);

    const wrapper = await mountPage();
    const vm = wrapper.vm as unknown as {
      confirmDelete: (_entry: (typeof mockEntries)[number]) => void;
      handleDelete: () => Promise<void>;
      entries: (typeof mockEntries)[];
    };

    vm.confirmDelete(mockEntries[0]);
    await vm.handleDelete();
    await flushPromises();

    expect(mockDeleteDictionaryEntry).toHaveBeenCalledWith('sentence-1');
    expect(vm.entries).toHaveLength(1);
    expect(vm.entries[0]?.sentence_id).toBe('sentence-2');
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'positive',
        message: 'Dictionary entry deleted successfully',
      }),
    );
  });
});

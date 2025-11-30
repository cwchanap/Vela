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
        teleport: true,
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

    const deleteButtons = wrapper
      .findAll('button')
      .filter((btn) => btn.text().trim().includes('Delete'));
    expect(deleteButtons[0]).toBeTruthy();

    await deleteButtons[0]!.trigger('click');
    await flushPromises();

    const deleteDialog = wrapper.find('.q-dialog');
    expect(deleteDialog.exists()).toBe(true);

    const confirmButton = deleteDialog
      .findAll('button')
      .find((btn) => btn.text().trim() === 'Delete');
    expect(confirmButton).toBeTruthy();

    await confirmButton!.trigger('click');
    await flushPromises();

    expect(mockDeleteDictionaryEntry).toHaveBeenCalledWith('sentence-1');
    expect(wrapper.findAll('.q-card')).toHaveLength(1);
    expect(wrapper.text()).toContain('今日は晴れです');
    expect(wrapper.text()).not.toContain('私は猫が好きです');
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'positive',
        message: 'Dictionary entry deleted successfully',
      }),
    );
  });
});

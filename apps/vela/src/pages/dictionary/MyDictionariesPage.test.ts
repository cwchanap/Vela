import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, VueWrapper, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { Quasar } from 'quasar';
import { createRouter, createMemoryHistory } from 'vue-router';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { fetchAuthSession } from 'aws-amplify/auth';
import MyDictionariesPage from './MyDictionariesPage.vue';
import * as myDictionariesService from 'src/services/myDictionariesService';
import * as ttsService from 'src/services/ttsService';
import * as vocabularyService from 'src/services/vocabularyService';
import type { MyDictionaryEntry } from 'src/services/myDictionariesService';
import { useAuthStore } from 'src/stores/auth';
import type { Token } from '@vela/common';
import { tokenize } from '@vela/common';

const SAMPLE_TOKENS: Token[] = [
  {
    surface_form: '日本語',
    reading: 'ニホンゴ',
    dictionary_form: '日本語',
    pos: '名詞',
    pos_detail_1: '一般',
  },
  {
    surface_form: 'を',
    reading: 'ヲ',
    dictionary_form: 'を',
    pos: '助詞',
    pos_detail_1: '格助詞',
  },
  {
    surface_form: '勉強',
    reading: 'ベンキョウ',
    dictionary_form: '勉強',
    pos: '名詞',
    pos_detail_1: 'サ変接続',
  },
  {
    surface_form: 'し',
    reading: 'シ',
    dictionary_form: 'する',
    pos: '動詞',
    pos_detail_1: '自立',
  },
  {
    surface_form: 'て',
    reading: 'テ',
    dictionary_form: 'て',
    pos: '助詞',
    pos_detail_1: '接続助詞',
  },
  {
    surface_form: 'い',
    reading: 'イ',
    dictionary_form: 'いる',
    pos: '動詞',
    pos_detail_1: '非自立',
  },
  {
    surface_form: 'ます',
    reading: 'マス',
    dictionary_form: 'ます',
    pos: '助動詞',
    pos_detail_1: '*',
  },
];

let notifyCreateSpy: ReturnType<typeof vi.fn>;

// Mock aws-amplify (must be before any imports that trigger amplify)
vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn().mockResolvedValue({
    tokens: { idToken: { toString: () => 'mock-token' } },
  }),
}));

// Mock authService to avoid Cognito configuration issues
vi.mock('src/services/authService', () => ({
  authService: {
    initialize: vi.fn().mockResolvedValue(undefined),
    signIn: vi.fn(),
    signOut: vi.fn(),
    getCurrentSession: vi.fn().mockResolvedValue(null),
  },
}));

// Mock services
vi.mock('src/services/myDictionariesService', () => ({
  getMyDictionaries: vi.fn().mockResolvedValue([]),
  deleteDictionaryEntry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('src/services/ttsService', () => ({
  generatePronunciation: vi.fn().mockResolvedValue({ audioUrl: 'http://example.com/audio.mp3' }),
  playAudio: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@vela/common', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vela/common')>();
  const tokens: import('@vela/common').Token[] = [
    {
      surface_form: '日本語',
      reading: 'ニホンゴ',
      dictionary_form: '日本語',
      pos: '名詞',
      pos_detail_1: '一般',
    },
    {
      surface_form: 'を',
      reading: 'ヲ',
      dictionary_form: 'を',
      pos: '助詞',
      pos_detail_1: '格助詞',
    },
    {
      surface_form: '勉強',
      reading: 'ベンキョウ',
      dictionary_form: '勉強',
      pos: '名詞',
      pos_detail_1: 'サ変接続',
    },
    {
      surface_form: 'し',
      reading: 'シ',
      dictionary_form: 'する',
      pos: '動詞',
      pos_detail_1: '自立',
    },
    {
      surface_form: 'て',
      reading: 'テ',
      dictionary_form: 'て',
      pos: '助詞',
      pos_detail_1: '接続助詞',
    },
    {
      surface_form: 'い',
      reading: 'イ',
      dictionary_form: 'いる',
      pos: '動詞',
      pos_detail_1: '非自立',
    },
    {
      surface_form: 'ます',
      reading: 'マス',
      dictionary_form: 'ます',
      pos: '助動詞',
      pos_detail_1: '*',
    },
  ];
  return {
    ...actual,
    tokenize: vi.fn().mockResolvedValue(tokens),
    configureDicPath: vi.fn(),
  };
});

vi.mock('src/services/vocabularyService', () => ({
  lookupWord: vi.fn().mockResolvedValue(null),
  addFlashcard: vi.fn(),
  clearLookupCache: vi.fn(),
}));

vi.mock('src/config', () => ({
  config: { api: { url: 'http://localhost:9005/api/' } },
}));

vi.mock('quasar', async () => {
  const actual = await vi.importActual<typeof import('quasar')>('quasar');
  return {
    ...actual,
    useQuasar: () => ({
      notify: notifyCreateSpy,
    }),
  };
});

const mockEntry: MyDictionaryEntry = {
  sentence_id: 'sent-1',
  sentence: '日本語を勉強しています',
  context: 'From study session',
  source_url: 'https://www.example.com/article',
  created_at: Date.now() - 1000 * 60 * 60 * 2, // 2 hours ago
};

const createTestRouter = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  });

describe('MyDictionariesPage', () => {
  let wrapper: VueWrapper;
  let router: ReturnType<typeof createTestRouter>;
  let authStore: ReturnType<typeof useAuthStore>;
  let originalFetch: typeof global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;
  let queryClient: QueryClient;

  beforeEach(async () => {
    setActivePinia(createPinia());
    router = createTestRouter();
    await router.push('/');
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false },
      },
    });
    originalFetch = global.fetch;
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof global.fetch;
    vi.resetAllMocks();
    authStore = useAuthStore();
    // Re-establish defaults cleared by resetAllMocks
    vi.mocked(myDictionariesService.getMyDictionaries).mockResolvedValue([]);
    vi.mocked(myDictionariesService.deleteDictionaryEntry).mockResolvedValue(undefined);
    vi.mocked(ttsService.generatePronunciation).mockResolvedValue({
      audioUrl: 'http://example.com/audio.mp3',
    });
    vi.mocked(ttsService.playAudio).mockReturnValue({
      audio: {} as HTMLAudioElement,
      finished: Promise.resolve(),
      stop: vi.fn(),
    });
    vi.mocked(fetchAuthSession).mockResolvedValue({
      tokens: { idToken: { toString: () => 'mock-token' } },
    } as Awaited<ReturnType<typeof fetchAuthSession>>);
    vi.mocked(vocabularyService.lookupWord).mockResolvedValue(null);
    vi.mocked(vocabularyService.addFlashcard).mockResolvedValue({
      vocabulary_id: 'vocab-123',
      created: true,
      alreadyInSRS: false,
    });
    vi.mocked(tokenize).mockResolvedValue(SAMPLE_TOKENS);
    notifyCreateSpy = vi.fn();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    global.fetch = originalFetch;
  });

  const mountComponent = () =>
    mount(MyDictionariesPage, {
      global: {
        plugins: [Quasar, router, [VueQueryPlugin, { queryClient }]],
        stubs: {
          'q-page': { template: '<div><slot /></div>' },
          'q-card': { template: '<div><slot /></div>' },
          'q-card-section': { template: '<div><slot /></div>' },
          'q-card-actions': { template: '<div><slot /></div>' },
          'q-banner': { template: '<div><slot /><slot name="action" /></div>' },
          'q-btn': {
            template: '<button @click="$emit(\'click\')"><slot /></button>',
            emits: ['click'],
          },
          'q-spinner': true,
          'q-icon': true,
          'q-tooltip': true,
          'q-dialog': { template: '<div v-if="modelValue"><slot /></div>', props: ['modelValue'] },
          'q-menu': { template: '<div v-if="modelValue"><slot /></div>', props: ['modelValue'] },
          'q-space': true,
          'q-separator': true,
          'q-badge': { template: '<span><slot /></span>' },
        },
      },
    });

  describe('Rendering', () => {
    it('renders without errors', () => {
      wrapper = mountComponent();
      expect(wrapper.exists()).toBe(true);
    });

    it('shows My Dictionaries heading', () => {
      wrapper = mountComponent();
      expect(wrapper.text()).toContain('My Dictionaries');
    });

    it('shows empty state when no entries', async () => {
      vi.mocked(myDictionariesService.getMyDictionaries).mockResolvedValue([]);
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.text()).toContain('No Dictionary Entries Yet');
    });

    it('shows entries when loaded', async () => {
      vi.mocked(myDictionariesService.getMyDictionaries).mockResolvedValue([mockEntry]);
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.text()).toContain('日本語を勉強しています');
    });

    it('shows error state when loading fails', async () => {
      vi.mocked(myDictionariesService.getMyDictionaries).mockRejectedValue(
        new Error('Network error'),
      );
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.text()).toContain('Network error');
    });
  });

  describe('formatDate', () => {
    it('formats recent timestamps as "Today at ..."', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));

      wrapper = mountComponent();
      const todayTimestamp = new Date('2024-01-15T10:00:00Z').getTime();
      const result = wrapper.vm.formatDate(todayTimestamp);
      expect(result).toContain('Today at');

      vi.useRealTimers();
    });

    it('formats yesterday timestamps as "Yesterday at ..."', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));

      wrapper = mountComponent();
      const yesterdayTimestamp = new Date('2024-01-14T10:00:00Z').getTime();
      const result = wrapper.vm.formatDate(yesterdayTimestamp);
      expect(result).toContain('Yesterday at');

      vi.useRealTimers();
    });

    it('formats timestamps within 7 days as "X days ago"', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));

      wrapper = mountComponent();
      const threeDaysAgo = new Date('2024-01-12T12:00:00Z').getTime();
      const result = wrapper.vm.formatDate(threeDaysAgo);
      expect(result).toBe('3 days ago');

      vi.useRealTimers();
    });

    it('formats older timestamps as locale date string', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-02-15T12:00:00Z'));

      wrapper = mountComponent();
      const oldTimestamp = new Date('2024-01-01T12:00:00Z').getTime();
      const result = wrapper.vm.formatDate(oldTimestamp);
      // Should contain month abbreviation or full date
      expect(result).toContain('Jan');

      vi.useRealTimers();
    });
  });

  describe('formatUrl', () => {
    it('extracts hostname from full URL', () => {
      wrapper = mountComponent();
      expect(wrapper.vm.formatUrl('https://www.example.com/article/123')).toBe('example.com');
    });

    it('removes www. prefix', () => {
      wrapper = mountComponent();
      expect(wrapper.vm.formatUrl('https://www.google.com')).toBe('google.com');
    });

    it('returns original string for invalid URLs', () => {
      wrapper = mountComponent();
      expect(wrapper.vm.formatUrl('not-a-url')).toBe('not-a-url');
    });

    it('handles URLs without www.', () => {
      wrapper = mountComponent();
      expect(wrapper.vm.formatUrl('https://news.bbc.co.uk/article')).toBe('news.bbc.co.uk');
    });
  });

  describe('Delete functionality', () => {
    it('confirmDelete sets entryToDelete and opens dialog', async () => {
      vi.mocked(myDictionariesService.getMyDictionaries).mockResolvedValue([mockEntry]);
      wrapper = mountComponent();
      await flushPromises();

      wrapper.vm.confirmDelete(mockEntry);
      expect(wrapper.vm.entryToDelete).toEqual(mockEntry);
      expect(wrapper.vm.deleteDialog).toBe(true);
    });

    it('handleDelete calls deleteDictionaryEntry with correct id', async () => {
      vi.mocked(myDictionariesService.getMyDictionaries).mockResolvedValue([mockEntry]);
      wrapper = mountComponent();
      await flushPromises();

      wrapper.vm.entryToDelete = mockEntry;
      await wrapper.vm.handleDelete();
      await flushPromises();

      expect(vi.mocked(myDictionariesService.deleteDictionaryEntry)).toHaveBeenCalledWith('sent-1');
    });

    it('removes deleted entry from list', async () => {
      vi.mocked(myDictionariesService.getMyDictionaries).mockResolvedValue([mockEntry]);
      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.vm.entries).toHaveLength(1);

      wrapper.vm.entryToDelete = mockEntry;
      await wrapper.vm.handleDelete();
      await flushPromises();

      expect(wrapper.vm.entries).toHaveLength(0);
    });

    it('does not call delete when entryToDelete is null', async () => {
      wrapper = mountComponent();
      wrapper.vm.entryToDelete = null;
      await wrapper.vm.handleDelete();

      expect(vi.mocked(myDictionariesService.deleteDictionaryEntry)).not.toHaveBeenCalled();
    });

    it('shows the delete error message when deletion fails', async () => {
      vi.mocked(myDictionariesService.getMyDictionaries).mockResolvedValue([mockEntry]);
      vi.mocked(myDictionariesService.deleteDictionaryEntry).mockRejectedValue(
        new Error('Delete failed'),
      );
      wrapper = mountComponent();
      await flushPromises();

      wrapper.vm.entryToDelete = mockEntry;
      await wrapper.vm.handleDelete();

      expect(notifyCreateSpy).toHaveBeenCalledWith({
        type: 'negative',
        message: 'Delete failed',
        position: 'top',
      });
      expect(wrapper.vm.deleting).toBe(false);
    });
  });

  describe('renderedMarkdown computed', () => {
    it('returns empty string when no text', () => {
      wrapper = mountComponent();
      expect(wrapper.vm.renderedMarkdown).toBe('');
    });

    it('renders markdown from streamingText', () => {
      wrapper = mountComponent();
      wrapper.vm.streamingText = '**bold text**';
      expect(wrapper.vm.renderedMarkdown).toContain('<strong>');
    });

    it('sanitizes HTML in markdown output', () => {
      wrapper = mountComponent();
      wrapper.vm.streamingText = '<script>alert("xss")</script>Normal text';
      const result = wrapper.vm.renderedMarkdown;
      expect(result).not.toContain('<script>');
    });
  });

  describe('Pronunciation functionality', () => {
    it('warns when pronunciation is requested without an authenticated session', async () => {
      wrapper = mountComponent();
      authStore.setUser({
        id: 'user-1',
        email: 'test@example.com',
        current_level: 1,
        total_experience: 0,
        learning_streak: 0,
        native_language: 'en',
        preferences: {} as any,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      authStore.setSession(null);

      await wrapper.vm.handlePronounce(mockEntry);

      expect(vi.mocked(ttsService.generatePronunciation)).not.toHaveBeenCalled();
      expect(notifyCreateSpy).toHaveBeenCalledWith({
        type: 'warning',
        message: 'Please sign in to use pronunciation features',
        position: 'top',
      });
    });

    it('uses the session user id for pronunciation when the profile is not loaded', async () => {
      wrapper = mountComponent();
      authStore.setUser({
        id: '',
        email: 'test@example.com',
        current_level: 1,
        total_experience: 0,
        learning_streak: 0,
        native_language: 'en',
        preferences: {} as any,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      authStore.setSession({
        user: { id: 'session-user-1', email: 'test@example.com' },
        provider: 'cognito',
      });

      await wrapper.vm.handlePronounce(mockEntry);

      expect(vi.mocked(ttsService.generatePronunciation)).toHaveBeenCalledWith(
        'sent-1',
        '日本語を勉強しています',
        'session-user-1',
      );
      expect(vi.mocked(ttsService.playAudio)).toHaveBeenCalledWith('http://example.com/audio.mp3');
    });

    it('shows a fallback error when pronunciation fails with a non-Error value', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      wrapper = mountComponent();
      authStore.setUser({
        id: 'user-1',
        email: 'test@example.com',
        current_level: 1,
        total_experience: 0,
        learning_streak: 0,
        native_language: 'en',
        preferences: {} as any,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      authStore.setSession({
        user: { id: 'session-user-1', email: 'test@example.com' },
        provider: 'cognito',
      });
      vi.mocked(ttsService.playAudio).mockReturnValue({
        audio: {} as HTMLAudioElement,
        finished: Promise.reject('boom'),
        stop: vi.fn(),
      });

      await wrapper.vm.handlePronounce(mockEntry);
      await flushPromises();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Pronunciation error:', 'boom');
      expect(notifyCreateSpy).toHaveBeenCalledWith({
        type: 'negative',
        message: 'Failed to play pronunciation. Please check your TTS settings.',
        position: 'top',
      });
    });

    it('shows the specific pronunciation error message when playback rejects with an Error', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      wrapper = mountComponent();
      authStore.setUser({
        id: 'user-1',
        email: 'test@example.com',
        current_level: 1,
        total_experience: 0,
        learning_streak: 0,
        native_language: 'en',
        preferences: {} as any,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      authStore.setSession({
        user: { id: 'session-user-1', email: 'test@example.com' },
        provider: 'cognito',
      });
      vi.mocked(ttsService.playAudio).mockReturnValue({
        audio: {} as HTMLAudioElement,
        finished: Promise.reject(new Error('Audio playback failed')),
        stop: vi.fn(),
      });

      await wrapper.vm.handlePronounce(mockEntry);
      await flushPromises();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Pronunciation error:', expect.any(Error));
      expect(notifyCreateSpy).toHaveBeenCalledWith({
        type: 'negative',
        message: 'Audio playback failed',
        position: 'top',
      });
    });
  });

  describe('AI analysis functionality', () => {
    it('streams sentence analysis and stores the final result', async () => {
      const encoder = new TextEncoder();
      const chunks = [
        'data: {"type":"metadata","sentence":"日本語を勉強しています","provider":"google","model":"gemini-2.5-flash-lite"}\n',
        'data: {"type":"chunk","text":"This sentence means "}\n',
        'data: {"type":"chunk","text":"studying Japanese."}\n',
        'data: {"type":"done"}\n',
      ];
      let index = 0;
      fetchMock.mockResolvedValue({
        ok: true,
        body: {
          getReader: () => ({
            read: async () =>
              index < chunks.length
                ? { done: false, value: encoder.encode(chunks[index++]) }
                : { done: true, value: undefined },
          }),
        },
      });
      wrapper = mountComponent();

      await wrapper.vm.handleAskAI(mockEntry);
      await flushPromises();

      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:9005/api/my-dictionaries/analyze',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-token',
            'Content-Type': 'application/json',
          }),
        }),
      );
      expect(wrapper.vm.aiDialog).toBe(true);
      expect(wrapper.vm.analyzing).toBe(false);
      expect(wrapper.vm.streamingText).toBe('This sentence means studying Japanese.');
      expect(wrapper.vm.analysisResult).toEqual({
        sentence: '日本語を勉強しています',
        analysis: 'This sentence means studying Japanese.',
        provider: 'google',
        model: 'gemini-2.5-flash-lite',
      });
    });

    it('shows an authentication error when analysis starts without an id token', async () => {
      vi.mocked(fetchAuthSession).mockResolvedValue({
        tokens: {},
      } as Awaited<ReturnType<typeof fetchAuthSession>>);
      wrapper = mountComponent();

      await wrapper.vm.handleAskAI(mockEntry);
      await flushPromises();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(wrapper.vm.analysisError).toBe('Not authenticated');
      expect(wrapper.vm.analyzing).toBe(false);
      expect(notifyCreateSpy).toHaveBeenCalledWith({
        type: 'negative',
        message: 'Not authenticated',
        position: 'top',
      });
    });

    it('shows the API error returned by the analysis endpoint', async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        json: vi.fn().mockResolvedValue({ error: 'Analysis failed' }),
      });
      wrapper = mountComponent();

      await wrapper.vm.handleAskAI(mockEntry);
      await flushPromises();

      expect(wrapper.vm.analysisError).toBe('Analysis failed');
      expect(wrapper.vm.analyzing).toBe(false);
      expect(notifyCreateSpy).toHaveBeenCalledWith({
        type: 'negative',
        message: 'Analysis failed',
        position: 'top',
      });
    });

    it('shows an error when the analysis response has no readable body', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        body: null,
      });
      wrapper = mountComponent();

      await wrapper.vm.handleAskAI(mockEntry);
      await flushPromises();

      expect(wrapper.vm.analysisError).toBe('No response body');
      expect(wrapper.vm.analyzing).toBe(false);
      expect(notifyCreateSpy).toHaveBeenCalledWith({
        type: 'negative',
        message: 'No response body',
        position: 'top',
      });
    });

    it('logs SSE error events without crashing the analysis flow', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const encoder = new TextEncoder();
      const chunks = [
        'data: {"type":"metadata","sentence":"日本語を勉強しています","provider":"google","model":"gemini-2.5-flash-lite"}\n',
        'data: {"type":"error","error":"SSE failure"}\n',
        'data: {"type":"done"}\n',
      ];
      let index = 0;
      fetchMock.mockResolvedValue({
        ok: true,
        body: {
          getReader: () => ({
            read: async () =>
              index < chunks.length
                ? { done: false, value: encoder.encode(chunks[index++]) }
                : { done: true, value: undefined },
          }),
        },
      });
      wrapper = mountComponent();

      await wrapper.vm.handleAskAI(mockEntry);
      await flushPromises();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error parsing SSE data:', expect.any(Error));
      expect(wrapper.vm.analysisError).toBe('');
      expect(wrapper.vm.analyzing).toBe(false);
    });

    it('logs malformed SSE payloads and continues streaming', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const encoder = new TextEncoder();
      const chunks = [
        'data: {"type":"metadata","sentence":"日本語を勉強しています","provider":"google","model":"gemini-2.5-flash-lite"}\n',
        'data: {invalid-json}\n',
        'data: {"type":"chunk","text":"Recovered output"}\n',
        'data: {"type":"done"}\n',
      ];
      let index = 0;
      fetchMock.mockResolvedValue({
        ok: true,
        body: {
          getReader: () => ({
            read: async () =>
              index < chunks.length
                ? { done: false, value: encoder.encode(chunks[index++]) }
                : { done: true, value: undefined },
          }),
        },
      });
      wrapper = mountComponent();

      await wrapper.vm.handleAskAI(mockEntry);
      await flushPromises();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error parsing SSE data:',
        expect.any(SyntaxError),
      );
      expect(wrapper.vm.streamingText).toBe('Recovered output');
      expect(wrapper.vm.analysisResult?.analysis).toBe('Recovered output');
      expect(wrapper.vm.analyzing).toBe(false);
    });
  });

  describe('word highlighting', () => {
    it('renders clickable buttons for content word tokens after load', async () => {
      vi.mocked(myDictionariesService.getMyDictionaries).mockResolvedValue([mockEntry]);

      wrapper = mountComponent();
      await flushPromises();

      const clickableTokens = wrapper.findAll('.clickable-token');
      expect(clickableTokens.length).toBeGreaterThan(0);
      expect(clickableTokens.every((token) => token.element.tagName === 'BUTTON')).toBe(true);
      expect(wrapper.find('span.clickable-token').exists()).toBe(false);
    });

    it('renders difficulty badge when tokenization completes', async () => {
      vi.mocked(myDictionariesService.getMyDictionaries).mockResolvedValue([mockEntry]);

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.find('[data-testid="difficulty-badge"]').exists()).toBe(true);
    });

    it('keeps the newest token lookup when an earlier lookup resolves late', async () => {
      vi.mocked(myDictionariesService.getMyDictionaries).mockResolvedValue([mockEntry]);

      let resolveFirstLookup: ((_value: vocabularyService.JishoResult | null) => void) | undefined;
      let resolveSecondLookup: ((_value: vocabularyService.JishoResult | null) => void) | undefined;
      vi.mocked(vocabularyService.lookupWord)
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirstLookup = resolve;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveSecondLookup = resolve;
            }),
        );

      wrapper = mountComponent();
      await flushPromises();

      const clickableTokens = wrapper.findAll('button.clickable-token');
      await clickableTokens[0]!.trigger('click');
      await clickableTokens[1]!.trigger('click');

      resolveFirstLookup?.({
        word: '日本語',
        reading: 'にほんご',
        meanings: ['Japanese language'],
        common: true,
      });
      await flushPromises();

      expect(wrapper.vm.popoverLookup).toBe('loading');

      resolveSecondLookup?.({
        word: '勉強',
        reading: 'べんきょう',
        meanings: ['study'],
        common: true,
      });
      await flushPromises();

      expect(wrapper.vm.popoverLookup).toEqual(
        expect.objectContaining({
          word: '勉強',
        }),
      );
    });

    it('ignores stale lookups for a different token instance with the same surface form', async () => {
      vi.mocked(myDictionariesService.getMyDictionaries).mockResolvedValue([mockEntry]);
      vi.mocked(tokenize).mockResolvedValue([
        {
          surface_form: 'はし',
          reading: 'ハシ',
          dictionary_form: '橋',
          pos: '名詞',
          pos_detail_1: '一般',
        },
        {
          surface_form: 'はし',
          reading: 'ハシ',
          dictionary_form: '箸',
          pos: '名詞',
          pos_detail_1: '一般',
        },
      ] as Token[]);

      let resolveFirstLookup: ((_value: vocabularyService.JishoResult | null) => void) | undefined;
      let resolveSecondLookup: ((_value: vocabularyService.JishoResult | null) => void) | undefined;
      vi.mocked(vocabularyService.lookupWord)
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirstLookup = resolve;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveSecondLookup = resolve;
            }),
        );

      wrapper = mountComponent();
      await flushPromises();

      const clickableTokens = wrapper.findAll('button.clickable-token');
      await clickableTokens[0]!.trigger('click');
      await clickableTokens[1]!.trigger('click');

      resolveSecondLookup?.({
        word: '箸',
        reading: 'はし',
        meanings: ['chopsticks'],
        common: true,
      });
      await flushPromises();

      resolveFirstLookup?.({
        word: '橋',
        reading: 'はし',
        meanings: ['bridge'],
        common: true,
      });
      await flushPromises();

      expect(wrapper.vm.popoverLookup).toEqual(
        expect.objectContaining({
          word: '箸',
        }),
      );
    });

    it('does not let a stale flashcard mutation overwrite the current token state', async () => {
      vi.mocked(myDictionariesService.getMyDictionaries).mockResolvedValue([mockEntry]);
      vi.mocked(vocabularyService.lookupWord)
        .mockResolvedValueOnce({
          word: '日本語',
          reading: 'にほんご',
          meanings: ['Japanese language'],
          common: true,
        })
        .mockResolvedValueOnce({
          word: '勉強',
          reading: 'べんきょう',
          meanings: ['study'],
          common: true,
        });

      let resolveAddFlashcard: ((_value: vocabularyService.AddFlashcardResult) => void) | undefined;
      vi.mocked(vocabularyService.addFlashcard).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveAddFlashcard = resolve;
          }),
      );

      wrapper = mountComponent();
      await flushPromises();

      const clickableTokens = wrapper.findAll('button.clickable-token');
      await clickableTokens[0]!.trigger('click');
      await flushPromises();

      const addButton = wrapper.find('[data-testid="btn-add-flashcard"]');
      await addButton.trigger('click');

      await clickableTokens[1]!.trigger('click');
      await flushPromises();

      resolveAddFlashcard?.({
        vocabulary_id: 'vocab-123',
        created: true,
        alreadyInSRS: false,
      });
      await flushPromises();

      expect(wrapper.vm.activeToken.token.dictionary_form).toBe('勉強');
      expect(wrapper.vm.flashcardState).toBe('idle');
    });

    describe('handleAddFlashcard', () => {
      it("sets flashcardState to 'added' when alreadyInSRS is false", async () => {
        vi.mocked(myDictionariesService.getMyDictionaries).mockResolvedValue([mockEntry]);
        vi.mocked(vocabularyService.addFlashcard).mockResolvedValue({
          vocabulary_id: 'vocab-1',
          created: true,
          alreadyInSRS: false,
        });

        wrapper = mountComponent();
        await flushPromises();

        wrapper.vm.activeToken = {
          token: {
            surface_form: '日本語',
            reading: 'ニホンゴ',
            dictionary_form: '日本語',
            pos: '名詞',
            pos_detail_1: '一般',
          },
          sentenceId: 'sent-1',
        };
        wrapper.vm.popoverLookup = {
          word: '日本語',
          reading: 'にほんご',
          meanings: ['Japanese language'],
          common: true,
        };

        await wrapper.vm.handleAddFlashcard();
        await flushPromises();

        expect(wrapper.vm.flashcardState).toBe('added');
      });

      it("sets flashcardState to 'exists' when alreadyInSRS is true", async () => {
        vi.mocked(myDictionariesService.getMyDictionaries).mockResolvedValue([mockEntry]);
        vi.mocked(vocabularyService.addFlashcard).mockResolvedValue({
          vocabulary_id: 'vocab-1',
          created: false,
          alreadyInSRS: true,
        });

        wrapper = mountComponent();
        await flushPromises();

        wrapper.vm.activeToken = {
          token: {
            surface_form: '日本語',
            reading: 'ニホンゴ',
            dictionary_form: '日本語',
            pos: '名詞',
            pos_detail_1: '一般',
          },
          sentenceId: 'sent-1',
        };
        wrapper.vm.popoverLookup = {
          word: '日本語',
          reading: 'にほんご',
          meanings: ['Japanese language'],
          common: true,
        };

        await wrapper.vm.handleAddFlashcard();
        await flushPromises();

        expect(wrapper.vm.flashcardState).toBe('exists');
      });

      it('normalizes uppercase JLPT labels before sending flashcard payloads', async () => {
        vi.mocked(myDictionariesService.getMyDictionaries).mockResolvedValue([mockEntry]);
        vi.mocked(vocabularyService.addFlashcard).mockResolvedValue({
          vocabulary_id: 'vocab-1',
          created: true,
          alreadyInSRS: false,
        });

        wrapper = mountComponent();
        await flushPromises();

        wrapper.vm.activeToken = {
          token: {
            surface_form: '日本語',
            reading: 'ニホンゴ',
            dictionary_form: '日本語',
            pos: '名詞',
            pos_detail_1: '一般',
          },
          sentenceId: 'sent-1',
        };
        wrapper.vm.popoverLookup = {
          word: '日本語',
          reading: 'にほんご',
          meanings: ['Japanese language'],
          jlpt: 'JLPT-N5',
          common: true,
        };

        await wrapper.vm.handleAddFlashcard();
        await flushPromises();

        expect(vi.mocked(vocabularyService.addFlashcard)).toHaveBeenCalledWith(
          expect.objectContaining({
            jlpt_level: 5,
          }),
        );
      });

      it("sets flashcardState to 'error' when the mutation throws", async () => {
        vi.mocked(myDictionariesService.getMyDictionaries).mockResolvedValue([mockEntry]);
        vi.mocked(vocabularyService.addFlashcard).mockRejectedValue(new Error('Server error'));

        wrapper = mountComponent();
        await flushPromises();

        wrapper.vm.activeToken = {
          token: {
            surface_form: '日本語',
            reading: 'ニホンゴ',
            dictionary_form: '日本語',
            pos: '名詞',
            pos_detail_1: '一般',
          },
          sentenceId: 'sent-1',
        };
        wrapper.vm.popoverLookup = {
          word: '日本語',
          reading: 'にほんご',
          meanings: ['Japanese language'],
          common: true,
        };

        await wrapper.vm.handleAddFlashcard();
        await flushPromises();

        expect(wrapper.vm.flashcardState).toBe('error');
      });

      it('sends the kuromoji token reading instead of Jisho reading', async () => {
        vi.mocked(myDictionariesService.getMyDictionaries).mockResolvedValue([mockEntry]);
        vi.mocked(vocabularyService.addFlashcard).mockResolvedValue({
          vocabulary_id: 'vocab-1',
          created: true,
          alreadyInSRS: false,
        });

        wrapper = mountComponent();
        await flushPromises();

        wrapper.vm.activeToken = {
          token: {
            surface_form: '今日',
            reading: 'こんにち', // kuromoji contextual reading
            dictionary_form: '今日',
            pos: '名詞',
            pos_detail_1: '副詞可能',
          },
          sentenceId: 'sent-1',
        };
        wrapper.vm.popoverLookup = {
          word: '今日',
          reading: 'きょう', // Jisho's first result — wrong for 今日は greeting
          meanings: ['today'],
          common: true,
        };

        await wrapper.vm.handleAddFlashcard();
        await flushPromises();

        expect(vi.mocked(vocabularyService.addFlashcard)).toHaveBeenCalledWith(
          expect.objectContaining({
            reading: 'こんにち', // kuromoji reading, NOT Jisho's きょう
          }),
        );
      });

      it('falls back to Jisho reading when token reading equals surface_form', async () => {
        vi.mocked(myDictionariesService.getMyDictionaries).mockResolvedValue([mockEntry]);
        vi.mocked(vocabularyService.addFlashcard).mockResolvedValue({
          vocabulary_id: 'vocab-1',
          created: true,
          alreadyInSRS: false,
        });

        wrapper = mountComponent();
        await flushPromises();

        wrapper.vm.activeToken = {
          token: {
            surface_form: '日本語',
            // Kuromoji doesn't know the reading so tokenizer substitutes surface_form
            reading: '日本語',
            dictionary_form: '日本語',
            pos: '名詞',
            pos_detail_1: '一般',
          },
          sentenceId: 'sent-1',
        };
        wrapper.vm.popoverLookup = {
          word: '日本語',
          reading: 'にほんご',
          meanings: ['Japanese language'],
          common: true,
        };

        await wrapper.vm.handleAddFlashcard();
        await flushPromises();

        expect(vi.mocked(vocabularyService.addFlashcard)).toHaveBeenCalledWith(
          expect.objectContaining({
            reading: 'にほんご', // Jisho reading, not the surface_form fallback
          }),
        );
      });
    });

    it('sets popoverLookup to notfound (not loading) when fetchQuery throws', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.mocked(myDictionariesService.getMyDictionaries).mockResolvedValue([mockEntry]);
      vi.mocked(vocabularyService.lookupWord).mockRejectedValue(new Error('Network error'));

      wrapper = mountComponent();
      await flushPromises();

      const clickableTokens = wrapper.findAll('button.clickable-token');
      await clickableTokens[0]!.trigger('click');
      await flushPromises();

      expect(wrapper.vm.popoverLookup).toBe('notfound');
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[Vela] Dictionary lookup failed:',
        expect.any(Error),
      );

      consoleErrorSpy.mockRestore();
    });
  });
});

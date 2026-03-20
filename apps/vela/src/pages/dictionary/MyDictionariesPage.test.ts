import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, VueWrapper, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { Quasar, Notify } from 'quasar';
import { createRouter, createMemoryHistory } from 'vue-router';
import MyDictionariesPage from './MyDictionariesPage.vue';
import * as myDictionariesService from 'src/services/myDictionariesService';
import type { MyDictionaryEntry } from 'src/services/myDictionariesService';

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

vi.mock('src/config', () => ({
  config: { api: { url: 'http://localhost:9005/api/' } },
}));

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

  beforeEach(async () => {
    setActivePinia(createPinia());
    const router = createTestRouter();
    await router.push('/');
    vi.resetAllMocks();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  const mountComponent = () =>
    mount(MyDictionariesPage, {
      global: {
        plugins: [[Quasar, { plugins: { Notify } }], createTestRouter()],
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
});

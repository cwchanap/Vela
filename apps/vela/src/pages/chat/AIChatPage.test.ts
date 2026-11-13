import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { Quasar, Notify } from 'quasar';
// QSelect reads iconSet.arrow.dropdown while rendering; the page mock replaces
// the whole $q object, so it needs those icon definitions present.
const mockIconSet = {
  arrow: { dropdown: 'arrow_drop_down' },
  select: { dropdownArrow: 'arrow_drop_down' },
  field: { clear: 'clear', error: 'warning' },
  chip: { remove: 'cancel', selected: 'check' },
};
import { VueQueryPlugin, QueryClient, focusManager } from '@tanstack/vue-query';
import { chatKeys } from '@vela/common';
import AIChatPage from './AIChatPage.vue';
import { useChatStore } from '../../stores/chat';
import { useLLMSettingsStore } from '../../stores/llmSettings';
import { useAuthStore } from '../../stores/auth';
import * as llmModule from '../../services/llm';
import type { LlmResponse, LlmUsage } from '@vela/common';
import type { ChatThreadSummaryDTO } from '../../services/chatHistoryService';
import * as awsAmplify from 'aws-amplify/auth';

// Mock modules
vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn(),
}));

vi.mock('../../services/llm', () => ({
  llmClient: {
    generate: vi.fn(),
    analyzeSentenceStream: vi.fn(),
    capabilities: vi.fn(),
  },
  describeLlmError: vi.fn((error: unknown, fallback: string) =>
    error instanceof Error && error.message ? error.message : fallback,
  ),
}));

vi.mock('../../utils/api', () => ({
  getApiUrl: vi.fn((path: string) => `/api/${path}`),
}));

// Mock marked and DOMPurify
vi.mock('marked', () => ({
  marked: {
    parse: vi.fn((text: string) => `<p>${text}</p>`),
    setOptions: vi.fn(),
  },
}));

vi.mock('dompurify', () => {
  const instance = {
    sanitize: vi.fn((text: string) => text),
    addHook: vi.fn(),
  };
  return { default: Object.assign(() => instance, instance) };
});

describe('AIChatPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let notifyCreateSpy: ReturnType<typeof vi.fn>;
  let queryClient: QueryClient;
  let originalFetch: typeof global.fetch;
  let wrapper: VueWrapper<any> | null = null;

  let threadRows: MockThread[];
  let messageRows: MockMessage[];
  let saveBodies: Array<Record<string, unknown>>;
  let fetchLog: Array<{ url: string; method: string }>;
  let saveFailures: { user: boolean; assistant: boolean };
  let saveNotFound: boolean;
  let saveNotFoundFor: Set<string>;
  let listFails: boolean;
  let messagesFail: boolean;
  let patchFails: boolean;
  let deleteFails: boolean;
  let patchDelay: Promise<void> | null;
  let saveDelay: Promise<void> | null;
  let deleteDelay: Promise<void> | null;
  let deleteDelayQueue: Array<Promise<void>>;
  let listDelay: Promise<void> | null;
  let messagesDelays: Record<string, Promise<void>>;
  let messagesFailFor: Set<string>;
  let listThreadsOverride: MockThread[] | null;

  const okJson = (data: unknown) => ({ ok: true, json: async () => data });
  const errJson = (status = 500) => ({
    ok: false,
    status,
    json: async () => ({ error: 'mock failure' }),
  });
  const deferred = <T>() => {
    let resolve!: (_value: T | PromiseLike<T>) => void;
    let reject!: (_reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };

  const installFetchRouter = () => {
    fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? 'GET';
      fetchLog.push({ url, method });

      if (url.includes('/api/chat-history/save') && method === 'POST') {
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        saveBodies.push(body);
        const respond = () => {
          if (saveNotFound || saveNotFoundFor.has(String(body.ThreadId ?? ''))) {
            return Promise.resolve({
              ok: false,
              status: 404,
              json: async () => ({ error: 'Thread not found' }),
            });
          }
          const isUser = body.is_user === true;
          if ((isUser && saveFailures.user) || (!isUser && saveFailures.assistant)) {
            return Promise.resolve(errJson());
          }
          if (isUser) {
            const threadId = String(body.ThreadId ?? '');
            const existing = threadRows.find((t) => t.ThreadId === threadId);
            if (existing) {
              existing.updatedAt = Date.now();
            } else {
              threadRows.push({
                ThreadId: threadId,
                title:
                  String(body.message ?? '')
                    .trim()
                    .slice(0, 60) || 'New conversation',
                createdAt: Date.now(),
                updatedAt: Date.now(),
              });
            }
          } else {
            // Server contract: the assistant-save transaction SETs lastLlmAt
            // on the thread row when present and REMOVEs it otherwise, in the
            // same transaction as the message write.
            const row = threadRows.find((t) => t.ThreadId === String(body.ThreadId ?? ''));
            if (row) {
              if (body.lastLlmAt === undefined) delete row.lastLlmAt;
              else row.lastLlmAt = body.lastLlmAt as number;
            }
          }
          return Promise.resolve(okJson({ ok: true }));
        };
        return (saveDelay ?? Promise.resolve()).then(respond);
      }

      if (url.includes('/api/chat-history/threads') && method === 'GET') {
        const respond = () => {
          if (listFails) return errJson();
          if (listThreadsOverride) return okJson({ threads: [...listThreadsOverride] });
          const sorted = [...threadRows].sort(
            (a, b) => b.updatedAt - a.updatedAt || a.ThreadId.localeCompare(b.ThreadId),
          );
          // Clone the rows: the client must not hold references that later
          // server-side commits (assistant SET/REMOVE, PATCH) would mutate
          // in place — a landed response is a snapshot of its read.
          return okJson({
            threads: sorted.map((t) => ({ ...t, model: t.model ? { ...t.model } : undefined })),
          });
        };
        // The server reads when the request arrives; a slow response can
        // still land after a concurrent save commits, so snapshot it up
        // front and delay only delivery — like the messages GET below.
        const response = respond();
        return (listDelay ?? Promise.resolve()).then(() => response);
      }

      if (url.includes('/api/chat-history/messages') && method === 'GET') {
        const threadId = new URL(url, 'http://localhost').searchParams.get('thread_id') ?? '';
        const respond = () => {
          if (messagesFail || messagesFailFor.has(threadId)) return errJson();
          if (!threadRows.some((t) => t.ThreadId === threadId)) {
            return {
              ok: false,
              status: 404,
              json: async () => ({ error: 'Thread not found' }),
            };
          }
          return okJson({ items: messageRows.filter((m) => m.ThreadId === threadId) });
        };
        // The server reads when the request arrives; a slow response can still
        // land after a concurrent DELETE completes, so snapshot it up front.
        const response = respond();
        return (messagesDelays[threadId] ?? Promise.resolve()).then(() => response);
      }

      const threadMatch = /\/api\/chat-history\/thread\/([^/?]+)$/.exec(url);
      if (threadMatch) {
        const threadId = decodeURIComponent(threadMatch[1]!);
        const thread = threadRows.find((t) => t.ThreadId === threadId);
        if (method === 'PATCH') {
          const respond = () => {
            if (patchFails) return errJson();
            if (!thread) {
              return {
                ok: false,
                status: 404,
                json: async () => ({ error: 'Thread not found' }),
              };
            }
            const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
            if (typeof body.title === 'string') thread.title = body.title.trim();
            // Server contract: a model PATCH SETs model and REMOVEs lastLlmAt
            // atomically; a title-only PATCH leaves both alone.
            if (body.model !== undefined) {
              thread.model = body.model as MockThread['model'];
              delete thread.lastLlmAt;
            }
            thread.updatedAt = Date.now();
            return okJson({ thread });
          };
          return (patchDelay ?? Promise.resolve()).then(respond);
        }
        if (method === 'DELETE') {
          const respond = () => {
            if (deleteFails) return errJson();
            if (!thread) {
              return {
                ok: false,
                status: 404,
                json: async () => ({ error: 'Thread not found' }),
              };
            }
            threadRows = threadRows.filter((t) => t.ThreadId !== threadId);
            return okJson({ ok: true });
          };
          const delay =
            deleteDelayQueue.length > 0
              ? deleteDelayQueue.shift()!
              : (deleteDelay ?? Promise.resolve());
          return delay.then(respond);
        }
      }

      return Promise.resolve(okJson({}));
    });
  };

  const threadFetches = () => fetchLog.filter((l) => l.url.includes('/chat-history/threads'));
  const saveFetches = () => fetchLog.filter((l) => l.url.includes('/chat-history/save'));
  const messageFetches = () => fetchLog.filter((l) => l.url.includes('/chat-history/messages'));
  const patchFetches = () => fetchLog.filter((l) => l.method === 'PATCH');
  const deleteFetches = () => fetchLog.filter((l) => l.method === 'DELETE');

  beforeEach(() => {
    // Create fresh Pinia instance for test isolation
    setActivePinia(createPinia());
    vi.clearAllMocks();

    // Reset store state for test isolation
    const chatStore = useChatStore();
    const llmSettingsStore = useLLMSettingsStore();
    const authStore = useAuthStore();

    chatStore.startNewChat();
    chatStore.setLoading(false);
    chatStore.setTyping(false);
    chatStore.setError(null);

    llmSettingsStore.llm = {
      keys: { google: 'test-google-key' },
      thinking: {},
      defaultModel: { provider: 'google', model: 'gemini-3.8-flash' },
    };

    authStore.user = null;
    authStore.session = null;
    signIn();

    threadRows = [];
    messageRows = [];
    saveBodies = [];
    fetchLog = [];
    saveFailures = { user: false, assistant: false };
    saveNotFound = false;
    saveNotFoundFor = new Set();
    listFails = false;
    messagesFail = false;
    patchFails = false;
    deleteFails = false;
    patchDelay = null;
    saveDelay = null;
    deleteDelay = null;
    deleteDelayQueue = [];
    listDelay = null;
    messagesDelays = {};
    messagesFailFor = new Set();
    listThreadsOverride = null;

    // Create a new QueryClient for each test
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    // Mock fetch and capture original for restoration
    originalFetch = global.fetch;
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof global.fetch;
    installFetchRouter();

    // Mock Quasar Notify
    notifyCreateSpy = vi.fn();
    Notify.create = notifyCreateSpy;

    // Default authenticated session for API calls using httpJsonAuth
    vi.mocked(awsAmplify.fetchAuthSession).mockResolvedValue(sessionFor('user-123'));
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    queryClient.clear();
    vi.restoreAllMocks();
    // Restore original fetch to prevent test pollution
    global.fetch = originalFetch;
  });

  // Type definition for mock user
  type MockUser = {
    id: string;
    email: string;
    username: string;
    current_level: number;
    total_experience: number;
    learning_streak: number;
    native_language: string;
    preferences: {
      dailyGoal: number;
      difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
      notifications: boolean;
      llm?: {
        keys: Record<string, string>;
        thinking: Record<string, string>;
        defaultModel: { provider: string; model: string };
      };
    };
    created_at: string;
    updated_at: string;
  };

  // Factory function to create mock user with optional overrides
  const createMockUser = (overrides: Partial<MockUser> = {}): MockUser => ({
    id: 'user-123',
    email: 'test@example.com',
    username: 'testuser',
    current_level: 1,
    total_experience: 0,
    learning_streak: 0,
    native_language: 'en',
    preferences: {
      dailyGoal: 20,
      difficulty: 'Beginner' as const,
      notifications: false,
      // Hydration overwrites the store from these prefs at the hook boundary,
      // so the default send-capable key must live here, not just in the store.
      llm: {
        keys: { google: 'test-google-key' },
        thinking: {},
        defaultModel: { provider: 'google', model: 'gemini-3.8-flash' },
      },
    },
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  });

  const mockUser = createMockUser();

  const signIn = (user: MockUser = mockUser) => {
    const authStore = useAuthStore();
    authStore.setSession({
      user: { id: user.id, email: user.email },
      provider: 'cognito',
    });
    authStore.user = user;
  };

  // Type definitions for better type safety
  type MockThread = {
    ThreadId: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    model?: { provider: 'google' | 'openai' | 'anthropic' | 'openrouter'; model: string };
    lastLlmAt?: number;
  };

  type MockMessage = {
    ThreadId: string;
    Timestamp: number;
    UserId: string;
    message: string;
    is_user: boolean;
  };

  // Reusable mock thread data to avoid duplication across tests
  const createMockThread = (overrides: Partial<MockThread> = {}): MockThread => ({
    ThreadId: 'thread-1',
    title: 'Test conversation',
    createdAt: Date.now() - 120_000,
    updatedAt: Date.now() - 60_000,
    ...overrides,
  });

  // Helper to mock LLM client response
  const mockLLMResponse = (text = 'AI response') => {
    vi.spyOn(llmModule.llmClient, 'generate').mockResolvedValue({ text } as LlmResponse);
  };

  // Helper to create mock messages for chat history
  const createMockMessage = (
    message: string,
    isUser: boolean,
    timestampOffset = 0,
    threadId = 'thread-1',
  ): MockMessage => ({
    ThreadId: threadId,
    Timestamp: Date.now() + timestampOffset,
    UserId: 'user-123',
    message,
    is_user: isUser,
  });

  const sessionFor = (sub: string) =>
    ({
      tokens: {
        idToken: {
          toString: () => `id-token-${sub}`,
          payload: { sub },
        },
      },
    }) as Awaited<ReturnType<typeof awsAmplify.fetchAuthSession>>;

  const mountComponent = (options: { narrowScreen?: boolean } = {}): VueWrapper<any> => {
    wrapper?.unmount();
    const mockQuasarInstance = {
      notify: notifyCreateSpy,
      platform: {
        is: {},
        has: {
          touch: false,
        },
        within: {
          iframe: false,
        },
      },
      iconMapFn: null,
      iconSet: mockIconSet,
      dark: {
        isActive: false,
        mode: false,
      },
      lang: {
        rtl: false,
        label: {},
      },
      screen: {
        width: options.narrowScreen ? 375 : 1280,
        height: options.narrowScreen ? 667 : 800,
        lt: { md: options.narrowScreen ?? false },
      },
    };

    const mountedWrapper = mount(AIChatPage, {
      global: {
        plugins: [
          [
            Quasar,
            {
              plugins: {
                Notify,
              },
            },
          ],
          [VueQueryPlugin, { queryClient }],
          {
            install(app) {
              app.config.globalProperties.$q =
                mockQuasarInstance as unknown as typeof app.config.globalProperties.$q;
            },
          },
        ],
        provide: {
          $q: mockQuasarInstance as unknown,
        },
        stubs: {
          Teleport: true,
          QTooltip: { template: '<div />' },
          QPage: {
            template: '<div data-testid="ai-chat-page"><slot /></div>',
          },
        },
      },
    });
    wrapper = mountedWrapper;
    return mountedWrapper;
  };

  const sendMessage = async (text = 'Test message') => {
    const w = wrapper!;
    const input = w.find('[data-testid="llm-chat-input"]');
    await input.setValue(text);
    await w.find('[data-testid="llm-chat-send"]').trigger('click');
  };

  const modelSelect = () =>
    // The model select is the picker's first QSelect; data-testid does not
    // surface on Quasar component wrappers.
    wrapper!.findAllComponents({ name: 'QSelect' })[0];
  const chooseModel = async (value: string) => {
    modelSelect()!.vm.$emit('update:modelValue', value);
    await flushPromises();
  };
  const anthropicRow = { provider: 'anthropic' as const, model: 'claude-opus-5-5' };
  const openaiPair = { provider: 'openai' as const, model: 'gpt-6.1-sol' };

  const openThreadMenu = async (index = 0) => {
    await wrapper!.findAll('[data-testid="chat-thread-menu"]')[index]!.trigger('click');
    await flushPromises();
  };

  describe('Initial Rendering', () => {
    it('should render the chat page', () => {
      mountComponent();
      expect(wrapper.find('[data-testid="ai-chat-page"]').exists()).toBe(true);
    });

    it('should show AI Chat heading', () => {
      mountComponent();
      expect(wrapper.text()).toContain('AI Chat');
    });

    it('should show New Chat button in the sidebar', () => {
      mountComponent();
      const newChatButton = wrapper.find('[data-testid="llm-chat-new"]');
      expect(newChatButton.exists()).toBe(true);
    });

    it('should render the desktop sidebar without a history toggle button', () => {
      mountComponent();
      expect(wrapper.find('[data-testid="chat-sidebar-pane"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="llm-chat-history"]').exists()).toBe(false);
    });

    it('should show the sidebar toggle instead of the aside on narrow screens', () => {
      const wrapper = mountComponent({ narrowScreen: true });
      expect(wrapper.find('[data-testid="chat-sidebar-pane"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="llm-chat-history"]').exists()).toBe(true);
    });

    it('should show chat input field', () => {
      mountComponent();
      const input = wrapper.find('[data-testid="llm-chat-input"]');
      expect(input.exists()).toBe(true);
    });

    it('should show send button', () => {
      mountComponent();
      const sendButton = wrapper.find('[data-testid="llm-chat-send"]');
      expect(sendButton.exists()).toBe(true);
    });

    it('should show greeting message on mount', async () => {
      mountComponent();
      await flushPromises();

      expect(wrapper.text()).toContain('こんにちは！日本語学習をお手伝いします');
      expect(wrapper.text()).toContain('What would you like to practice today?');
    });

    it('should show placeholder text when no messages', async () => {
      mountComponent();
      await flushPromises();

      // Clear messages after component has mounted (greeting was added)
      const chatStore = useChatStore();
      chatStore.setMessages([]);
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain('Start a conversation below');
    });
  });

  describe('Chat Input', () => {
    it('should allow typing in input field', async () => {
      mountComponent();
      const input = wrapper.find('[data-testid="llm-chat-input"]');

      await input.setValue('Hello');
      expect((input.element as HTMLInputElement).value).toBe('Hello');
    });

    it('should disable input when loading', async () => {
      const chatStore = useChatStore();
      chatStore.setLoading(true);

      mountComponent();
      await wrapper.vm.$nextTick();

      const input = wrapper.findComponent({ name: 'QInput' });
      expect(input.props('disable')).toBe(true);
    });

    it('should show loading state on send button when loading', async () => {
      const chatStore = useChatStore();
      chatStore.setLoading(true);

      mountComponent();
      await wrapper.vm.$nextTick();

      const sendButton = wrapper.find('[data-testid="llm-chat-send"]');
      const btn = sendButton.findComponent({ name: 'QBtn' });
      expect(btn.props('loading')).toBe(true);
    });
  });

  describe('Sending Messages', () => {
    it('should send message when send button is clicked', async () => {
      const chatStore = useChatStore();
      mockLLMResponse();

      mountComponent();
      await sendMessage('Test message');
      await flushPromises();

      const messages = chatStore.messages;
      expect(messages.some((m) => m.content === 'Test message' && m.type === 'user')).toBe(true);
    });

    it('should not send empty messages', async () => {
      mountComponent();
      await flushPromises(); // Wait for component to mount and add greeting

      const chatStore = useChatStore();
      const initialLength = chatStore.messages.length;

      const input = wrapper.find('[data-testid="llm-chat-input"]');
      await input.setValue('   ');
      await wrapper.find('[data-testid="llm-chat-send"]').trigger('click');
      await flushPromises();

      expect(chatStore.messages.length).toBe(initialLength);
    });

    it('should clear input after sending message', async () => {
      mockLLMResponse();

      mountComponent();
      const input = wrapper.find('[data-testid="llm-chat-input"]');

      await input.setValue('Test message');
      await wrapper.find('[data-testid="llm-chat-send"]').trigger('click');
      await flushPromises();

      expect((input.element as HTMLInputElement).value).toBe('');
    });

    it('should show typing indicator while AI is responding', async () => {
      // Create a controlled promise to test the typing indicator
      let resolveLLM: (_value: LlmResponse) => void = () => {};
      const llmPromise = new Promise<LlmResponse>((resolve) => {
        resolveLLM = resolve;
      });

      vi.spyOn(llmModule.llmClient, 'generate').mockReturnValueOnce(llmPromise);

      mountComponent();
      const chatStore = useChatStore();

      await sendMessage('Test message');
      await wrapper.vm.$nextTick();

      // At this point, LLM is processing and typing indicator should be visible
      expect(chatStore.isTyping).toBe(true);
      expect(wrapper.text()).toContain('AI is typing…');

      // Resolve the LLM promise
      resolveLLM({ text: 'AI response' });
      await flushPromises();

      expect(chatStore.isTyping).toBe(false);
    });

    it('should add AI response to messages', async () => {
      mockLLMResponse('This is AI response');

      mountComponent();
      const chatStore = useChatStore();

      await sendMessage('Hello AI');
      await flushPromises();

      const messages = chatStore.messages;
      expect(messages.some((m) => m.content === 'This is AI response' && m.type === 'ai')).toBe(
        true,
      );
    });

    it('should reject an empty AI response instead of storing an invalid empty turn', async () => {
      // A successful-but-empty reply stored as an assistant turn would make
      // the next request fail server-side validation (content min 1).
      mockLLMResponse('   ');

      mountComponent();
      const chatStore = useChatStore();

      await sendMessage('Test message');
      await flushPromises();

      expect(chatStore.error).toContain('empty');
      expect(chatStore.messages.some((m) => m.type === 'ai' && !m.content.trim())).toBe(false);
    });

    it('should handle API errors gracefully', async () => {
      vi.spyOn(llmModule.llmClient, 'generate').mockRejectedValue(
        new Error('API connection failed'),
      );

      mountComponent();
      const chatStore = useChatStore();

      await sendMessage('Test message');
      await flushPromises();

      // Check that error was captured in store
      expect(chatStore.error).toBeTruthy();
      expect(chatStore.error).toContain('failed');
    });

    it('should run user save, LLM request and assistant save in sequence', async () => {
      mockLLMResponse('Ordered reply');
      const generateSpy = vi.mocked(llmModule.llmClient.generate);

      mountComponent();
      await flushPromises();

      await sendMessage('Ordered message');
      await flushPromises();

      const callOrder = fetchMock.mock.invocationCallOrder;
      const saveCallOrders = fetchMock.mock.calls
        .map((call, index) => ({ index, url: String(call[0]) }))
        .filter((call) => call.url.includes('/api/chat-history/save'))
        .map((call) => callOrder[call.index]!);
      expect(saveCallOrders.length).toBe(2);
      const llmCallOrder = generateSpy.mock.invocationCallOrder[0]!;
      expect(saveCallOrders[0]!).toBeLessThan(llmCallOrder);
      expect(llmCallOrder).toBeLessThan(saveCallOrders[1]!);

      const userSave = saveBodies.find((b) => b.is_user === true);
      const assistantSave = saveBodies.find((b) => b.is_user === false);
      expect(userSave?.message).toBe('Ordered message');
      expect(assistantSave?.message).toBe('Ordered reply');
    });

    it('should refetch the thread list after a successful user save only', async () => {
      mockLLMResponse();

      mountComponent();
      await flushPromises();
      expect(threadFetches().length).toBe(1);

      await sendMessage('Creates a row');
      await flushPromises();

      expect(threadFetches().length).toBe(2);
      expect(saveFetches().length).toBe(2);
    });

    it('should warn but still get an AI reply when the user save fails', async () => {
      saveFailures.user = true;
      mockLLMResponse('Reply despite save failure');

      mountComponent();
      const chatStore = useChatStore();

      await sendMessage('Unsaved message');
      await flushPromises();

      expect(notifyCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'warning', message: 'Failed to save chat history' }),
      );
      expect(chatStore.messages.some((m) => m.content === 'Reply despite save failure')).toBe(true);
      expect(threadFetches().length).toBe(1);
    });

    it('should keep the AI reply when the assistant save fails', async () => {
      saveFailures.assistant = true;
      mockLLMResponse('Unsaved reply');

      mountComponent();
      const chatStore = useChatStore();

      await sendMessage('Saved message');
      await flushPromises();

      expect(chatStore.messages.some((m) => m.content === 'Unsaved reply')).toBe(true);
      expect(notifyCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'warning', message: 'Failed to save chat history' }),
      );
    });

    it('resets the chat ID and warns when save returns 404 for a deleted thread', async () => {
      mockLLMResponse('Reply to zombie');
      mountComponent();
      const chatStore = useChatStore();
      chatStore.setChatId('deleted-thread-id');
      saveNotFound = true;

      await sendMessage('Message to deleted thread');
      await flushPromises();

      expect(chatStore.chatId).not.toBe('deleted-thread-id');
      expect(notifyCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'warning',
          message: 'This conversation was deleted. Started a new chat.',
        }),
      );
    });

    it('drops the dead transcript and re-saves the send under a fresh thread after a 404', async () => {
      mockLLMResponse('Fresh reply');
      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();

      // The active thread, deleted on another device, still has its
      // transcript in memory when the next send goes out.
      const greeting =
        'こんにちは！日本語学習をお手伝いします。What would you like to practice today?';
      chatStore.setChatId('dead-thread');
      chatStore.setMessages([
        { id: 'm0', type: 'ai', content: greeting, timestamp: new Date() },
        { id: 'm1', type: 'user', content: 'old turn', timestamp: new Date() },
        { id: 'm2', type: 'ai', content: 'old reply', timestamp: new Date() },
      ]);
      saveNotFoundFor.add('dead-thread');

      await sendMessage('turn after delete');
      await flushPromises();

      const freshId = chatStore.chatId!;
      expect(freshId).not.toBe('dead-thread');

      // The visible transcript really is a new chat now: greeting plus the
      // turns from this send, with nothing from the deleted thread.
      expect(chatStore.messages.map((m) => `${m.type}:${m.content}`)).toEqual([
        `ai:${greeting}`,
        'user:turn after delete',
        'ai:Fresh reply',
      ]);

      // The reply was generated without the deleted transcript as context.
      const llmMessages = vi.mocked(llmModule.llmClient.generate).mock.calls[0]![0].messages;
      expect(llmMessages.map((m) => m.content)).toEqual([greeting, 'turn after delete']);

      // The fresh thread persisted exactly the turns now on screen.
      const persisted = saveBodies.filter((b) => b.ThreadId === freshId);
      expect(persisted.map((b) => `${String(b.is_user)}:${String(b.message)}`)).toEqual([
        'true:turn after delete',
        'false:Fresh reply',
      ]);

      // A follow-up send keeps appending to the same fresh thread, so the
      // stored history keeps matching the visible transcript.
      await sendMessage('follow-up turn');
      await flushPromises();
      expect(saveBodies.filter((b) => b.ThreadId === freshId).map((b) => b.message)).toEqual([
        'turn after delete',
        'Fresh reply',
        'follow-up turn',
        'Fresh reply',
      ]);
    });

    it('preserves the initial greeting message when sending the first message', async () => {
      mockLLMResponse('Welcome reply');
      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();

      expect(chatStore.messages[0]?.content).toContain('こんにちは！日本語学習をお手伝いします');

      await sendMessage('First user message');
      await flushPromises();

      expect(chatStore.messages[0]?.content).toContain('こんにちは！日本語学習をお手伝いします');
      expect(chatStore.messages[1]?.content).toBe('First user message');
      expect(chatStore.messages[2]?.content).toBe('Welcome reply');
    });

    it('should abort the send when the session account changed during persistence', async () => {
      mockLLMResponse('Reply after account change');
      mountComponent();
      await flushPromises();

      vi.mocked(awsAmplify.fetchAuthSession).mockResolvedValue(sessionFor('user-b'));

      const chatStore = useChatStore();
      await sendMessage('Sent during account switch');
      await flushPromises();

      expect(saveBodies.length).toBe(0);
      expect(llmModule.llmClient.generate).not.toHaveBeenCalled();
      expect(chatStore.error).toMatch(/account changed/i);
      expect(notifyCreateSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'negative' }));
      expect(chatStore.messages.some((m) => m.content === 'Reply after account change')).toBe(
        false,
      );
      expect(chatStore.isLoading).toBe(false);
      expect(chatStore.isTyping).toBe(false);
    });

    it('should not send the transcript or key through the real transport when the account changed mid-send', async () => {
      const actual =
        await vi.importActual<typeof import('../../services/llm')>('../../services/llm');
      vi.spyOn(llmModule.llmClient, 'generate').mockImplementation(actual.llmClient.generate);

      mountComponent();
      await flushPromises();

      const sessions = [sessionFor('user-123'), sessionFor('user-b'), sessionFor('user-b')];
      vi.mocked(awsAmplify.fetchAuthSession).mockImplementation(() =>
        Promise.resolve(sessions.length > 1 ? sessions.shift()! : sessions[0]!),
      );

      const chatStore = useChatStore();
      await sendMessage('Transcript and key snapshot');
      await flushPromises();

      expect(saveBodies.some((b) => b.is_user === true)).toBe(true);
      expect(fetchLog.filter((l) => l.url.includes('/api/llm-chat')).length).toBe(0);
      expect(chatStore.error).toMatch(/account changed/i);
      expect(chatStore.messages.filter((m) => m.type === 'ai').map((m) => m.content)).toEqual([
        'こんにちは！日本語学習をお手伝いします。What would you like to practice today?',
      ]);
      expect(chatStore.isLoading).toBe(false);
    });
  });

  describe('New Chat Functionality', () => {
    it('should start new chat when New Chat button is clicked', async () => {
      mountComponent();
      const chatStore = useChatStore();

      // Add some messages first
      chatStore.addMessage({ type: 'user', content: 'Old message' });

      const newChatButton = wrapper.find('[data-testid="llm-chat-new"]');
      await newChatButton.trigger('click');
      await flushPromises();

      // Should have cleared old messages and added greeting
      expect(chatStore.messages.length).toBe(1);
      expect(chatStore.messages[0]?.type).toBe('ai');
      expect(chatStore.messages[0]?.content).toContain('こんにちは');
    });

    it('should generate new chat ID', async () => {
      mountComponent();
      const chatStore = useChatStore();

      const oldChatId = chatStore.chatId;

      const newChatButton = wrapper.find('[data-testid="llm-chat-new"]');
      await newChatButton.trigger('click');
      await flushPromises();

      expect(chatStore.chatId).not.toBe(oldChatId);
      expect(chatStore.chatId).toBeTruthy();
    });

    it('keeps a new chat in memory until a user save creates the thread row', async () => {
      mockLLMResponse('First reply');
      mountComponent();
      await flushPromises();

      expect(wrapper.findAll('[data-testid="llm-chat-thread-item"]').length).toBe(0);

      const newChatButton = wrapper.find('[data-testid="llm-chat-new"]');
      await newChatButton.trigger('click');
      await flushPromises();
      expect(wrapper.findAll('[data-testid="llm-chat-thread-item"]').length).toBe(0);

      await sendMessage('First real message');
      await flushPromises();

      const items = wrapper.findAll('[data-testid="llm-chat-thread-item"]');
      expect(items.length).toBe(1);
      expect(items[0]!.text()).toContain('First real message');
    });
  });

  describe('Chat Sidebar', () => {
    it('shows the empty state when there are no threads', async () => {
      mountComponent();
      await flushPromises();

      expect(wrapper.find('[data-testid="chat-sidebar"]').exists()).toBe(true);
      expect(wrapper.text()).toContain('No conversations yet');
    });

    it('lists thread titles with relative timestamps', async () => {
      threadRows = [
        createMockThread({ ThreadId: 't-1', title: 'Recent chat', updatedAt: Date.now() }),
        createMockThread({
          ThreadId: 't-2',
          title: 'Older chat',
          updatedAt: Date.now() - 5 * 60_000,
        }),
      ];

      mountComponent();
      await flushPromises();

      const items = wrapper.findAll('[data-testid="llm-chat-thread-item"]');
      expect(items.length).toBe(2);
      expect(items[0]!.text()).toContain('Recent chat');
      expect(items[0]!.text()).toContain('just now');
      expect(items[1]!.text()).toContain('Older chat');
      expect(items[1]!.text()).toContain('5 minutes ago');
    });

    it('shows a loading state while fetching threads', async () => {
      let resolveThreads: (_value: unknown) => void = () => {};
      const threadsPromise = new Promise((resolve) => {
        resolveThreads = resolve;
      });
      fetchMock.mockImplementationOnce(() => threadsPromise);

      mountComponent();
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain('Loading threads');

      resolveThreads({ ok: true, json: async () => ({ threads: [] }) });
      await flushPromises();
    });

    it('shows an error state and retries the thread list', async () => {
      listFails = true;
      mountComponent();
      await flushPromises();

      expect(wrapper.text()).toContain('Failed to load conversations');

      listFails = false;
      threadRows = [createMockThread({ title: 'Recovered chat' })];
      await wrapper.find('[data-testid="chat-sidebar-retry"]').trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('Recovered chat');
    });

    it('should load thread messages when a thread is selected', async () => {
      threadRows = [createMockThread({ ThreadId: 'thread-1' })];
      messageRows = [createMockMessage('Hello', true), createMockMessage('Hi there', false, 1000)];

      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();

      const threadItem = wrapper.find('[data-testid="llm-chat-thread-item"]');
      await threadItem.trigger('click');
      await flushPromises();

      expect(messageFetches().length).toBe(1);
      expect(messageFetches()[0]!.url).toContain('thread_id=thread-1');
      expect(chatStore.chatId).toBe('thread-1');
      expect(chatStore.messages.some((m) => m.content === 'Hello' && m.type === 'user')).toBe(true);
      expect(chatStore.messages.some((m) => m.content === 'Hi there' && m.type === 'ai')).toBe(
        true,
      );
    });

    it('prepends the greeting when a restored thread lacks it', async () => {
      threadRows = [createMockThread({ ThreadId: 'thread-1' })];
      messageRows = [createMockMessage('Hello', true), createMockMessage('Hi there', false, 1000)];

      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();

      await wrapper.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await flushPromises();

      expect(chatStore.messages.length).toBe(3);
      expect(chatStore.messages[0]!.content).toContain('こんにちは');
    });

    it('skips prepending greeting when loaded thread already starts with greeting', async () => {
      const GREETING_MESSAGE =
        'こんにちは！日本語学習をお手伝いします。What would you like to practice today?';

      threadRows = [createMockThread({ ThreadId: 'thread-1' })];
      messageRows = [
        createMockMessage(GREETING_MESSAGE, false),
        createMockMessage('How do I say hello?', true, 1000),
      ];

      mountComponent();
      await flushPromises();

      await wrapper.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await flushPromises();

      const chatStore = useChatStore();
      // Should have exactly 2 messages, not 3 (no extra greeting prepended)
      expect(chatStore.messages.length).toBe(2);
      expect(chatStore.messages[0]!.content).toBe(GREETING_MESSAGE);
    });

    it('highlights the active thread after selection', async () => {
      threadRows = [
        createMockThread({ ThreadId: 'thread-1', title: 'Selected thread' }),
        createMockThread({ ThreadId: 'thread-2', title: 'Other thread' }),
      ];

      mountComponent();
      await flushPromises();

      await wrapper.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await flushPromises();

      const items = wrapper.findAll('[data-testid="llm-chat-thread-item"]');
      expect(items[0]!.classes()).toContain('chat-sidebar__thread--active');
      expect(items[1]!.classes()).not.toContain('chat-sidebar__thread--active');
    });

    it('logs an error when loading thread messages fails', async () => {
      threadRows = [createMockThread({ ThreadId: 'thread-1' })];
      messagesFail = true;
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mountComponent();
      await flushPromises();

      const threadItem = wrapper.find('[data-testid="llm-chat-thread-item"]');
      await threadItem.trigger('click');
      await flushPromises();

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(notifyCreateSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'negative' }));
      consoleErrorSpy.mockRestore();
    });

    it('fetches threads using the session identity before the profile loads', async () => {
      const authStore = useAuthStore();
      authStore.user = null;
      authStore.session = {
        user: { id: 'session-user-123', email: 'test@example.com' },
        provider: 'cognito',
      } as typeof authStore.session;
      vi.mocked(awsAmplify.fetchAuthSession).mockResolvedValue(sessionFor('session-user-123'));
      threadRows = [createMockThread({ title: 'Session thread' })];

      mountComponent();
      await flushPromises();

      expect(threadFetches().length).toBeGreaterThan(0);
      expect(wrapper.text()).toContain('Session thread');
      expect(wrapper.text()).not.toContain('Failed to load conversations');
    });

    it('keeps thread lists isolated per account after an account switch', async () => {
      signIn();
      threadRows = [createMockThread({ ThreadId: 'a-1', title: 'A thread' })];

      mountComponent();
      await flushPromises();
      expect(wrapper.text()).toContain('A thread');
      expect(queryClient.getQueryData<MockThread[]>(chatKeys.threads('user-123'))).toHaveLength(1);

      vi.mocked(awsAmplify.fetchAuthSession).mockResolvedValue(sessionFor('user-b'));
      signIn(createMockUser({ id: 'user-b', username: 'otheruser' }));
      threadRows = [createMockThread({ ThreadId: 'b-1', title: 'B thread' })];
      await flushPromises();

      expect(wrapper.text()).toContain('B thread');
      expect(wrapper.text()).not.toContain('A thread');
      expect(queryClient.getQueryData<MockThread[]>(chatKeys.threads('user-123'))![0]!.title).toBe(
        'A thread',
      );
      expect(queryClient.getQueryData<MockThread[]>(chatKeys.threads('user-b'))![0]!.title).toBe(
        'B thread',
      );
    });

    it('opens the sidebar inside a left dialog on narrow screens and closes after selection', async () => {
      signIn();
      threadRows = [createMockThread({ ThreadId: 'thread-1' })];
      messageRows = [createMockMessage('Restored', false)];

      const wrapper = mountComponent({ narrowScreen: true });
      await flushPromises();

      expect(wrapper.find('[data-testid="chat-sidebar-pane"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="llm-chat-history"]').exists()).toBe(true);

      await wrapper.find('[data-testid="llm-chat-history"]').trigger('click');
      await flushPromises();

      const dialogSidebar = wrapper.find('.q-dialog [data-testid="chat-sidebar"]');
      expect(dialogSidebar.exists()).toBe(true);
      expect(dialogSidebar.text()).toContain('Test conversation');

      await dialogSidebar.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await flushPromises();

      expect(wrapper.find('.q-dialog [data-testid="chat-sidebar"]').exists()).toBe(false);
      const chatStore = useChatStore();
      expect(chatStore.chatId).toBe('thread-1');
      expect(chatStore.messages.some((m) => m.content === 'Restored')).toBe(true);
    });
  });

  describe('Rename Functionality', () => {
    it('renames a thread inline via Enter and persists it', async () => {
      signIn();
      threadRows = [createMockThread({ ThreadId: 'thread-1', title: 'Old title' })];

      mountComponent();
      await flushPromises();

      await openThreadMenu();
      await wrapper.find('[data-testid="chat-thread-rename"]').trigger('click');
      await flushPromises();

      const renameInput = wrapper.find('[data-testid="chat-thread-rename-input"]');
      await renameInput.setValue('Renamed title');
      await renameInput.trigger('keydown', { key: 'Enter' });
      await flushPromises();

      expect(patchFetches().length).toBe(1);
      const patchCall = fetchMock.mock.calls[fetchLog.indexOf(patchFetches()[0]!)];
      const patchBody = JSON.parse(String(patchCall[1]?.body)) as Record<string, unknown>;
      expect(patchBody).toEqual({ title: 'Renamed title' });
      expect(patchCall[0]).toContain('/api/chat-history/thread/thread-1');

      const item = wrapper.find('[data-testid="llm-chat-thread-item"]');
      expect(item.text()).toContain('Renamed title');
      expect(threadRows[0]!.title).toBe('Renamed title');
    });

    it('commits a trimmed title via the save button', async () => {
      signIn();
      threadRows = [createMockThread({ ThreadId: 'thread-1', title: 'Old title' })];

      mountComponent();
      await flushPromises();

      await openThreadMenu();
      await wrapper.find('[data-testid="chat-thread-rename"]').trigger('click');
      await flushPromises();

      await wrapper.find('[data-testid="chat-thread-rename-input"]').setValue('  Padded title  ');
      await wrapper.find('[data-testid="chat-thread-rename-save"]').trigger('click');
      await flushPromises();

      const patchCall = fetchMock.mock.calls[fetchLog.indexOf(patchFetches()[0]!)];
      const patchBody = JSON.parse(String(patchCall[1]?.body)) as Record<string, unknown>;
      expect(patchBody).toEqual({ title: 'Padded title' });
    });

    it('cancels the rename with Escape without calling PATCH', async () => {
      signIn();
      threadRows = [createMockThread({ ThreadId: 'thread-1', title: 'Old title' })];

      mountComponent();
      await flushPromises();

      await openThreadMenu();
      await wrapper.find('[data-testid="chat-thread-rename"]').trigger('click');
      await flushPromises();

      await wrapper.find('[data-testid="chat-thread-rename-input"]').setValue('Discarded title');
      await wrapper
        .find('[data-testid="chat-thread-rename-input"]')
        .trigger('keydown', { key: 'Escape' });
      await flushPromises();

      expect(patchFetches().length).toBe(0);
      expect(wrapper.find('[data-testid="chat-thread-rename-input"]').exists()).toBe(false);
      expect(wrapper.text()).toContain('Old title');
      expect(wrapper.text()).not.toContain('Discarded title');
    });

    it('rejects a blank title without calling PATCH', async () => {
      signIn();
      threadRows = [createMockThread({ ThreadId: 'thread-1', title: 'Old title' })];

      mountComponent();
      await flushPromises();

      await openThreadMenu();
      await wrapper.find('[data-testid="chat-thread-rename"]').trigger('click');
      await flushPromises();

      await wrapper.find('[data-testid="chat-thread-rename-input"]').setValue('   ');
      await wrapper
        .find('[data-testid="chat-thread-rename-input"]')
        .trigger('keydown', { key: 'Enter' });
      await flushPromises();

      expect(patchFetches().length).toBe(0);
      expect(wrapper.text()).toContain('Old title');
    });

    it('applies the optimistic title before the server resolves', async () => {
      signIn();
      threadRows = [createMockThread({ ThreadId: 'thread-1', title: 'Old title' })];
      let resolvePatch: () => void = () => {};
      patchDelay = new Promise<void>((resolve) => {
        resolvePatch = resolve;
      });

      mountComponent();
      await flushPromises();

      await openThreadMenu();
      await wrapper.find('[data-testid="chat-thread-rename"]').trigger('click');
      await flushPromises();

      await wrapper.find('[data-testid="chat-thread-rename-input"]').setValue('Optimistic title');
      await wrapper
        .find('[data-testid="chat-thread-rename-input"]')
        .trigger('keydown', { key: 'Enter' });
      await flushPromises();

      expect(wrapper.find('[data-testid="llm-chat-thread-item"]').text()).toContain(
        'Optimistic title',
      );

      resolvePatch();
      await flushPromises();
      expect(wrapper.find('[data-testid="llm-chat-thread-item"]').text()).toContain(
        'Optimistic title',
      );
    });

    it('rolls back the sidebar title when the rename fails', async () => {
      signIn();
      threadRows = [createMockThread({ ThreadId: 'thread-1', title: 'Original title' })];
      patchFails = true;

      mountComponent();
      await flushPromises();

      await openThreadMenu();
      await wrapper.find('[data-testid="chat-thread-rename"]').trigger('click');
      await flushPromises();

      await wrapper.find('[data-testid="chat-thread-rename-input"]').setValue('Rejected title');
      await wrapper
        .find('[data-testid="chat-thread-rename-input"]')
        .trigger('keydown', { key: 'Enter' });
      await flushPromises();

      expect(wrapper.find('[data-testid="llm-chat-thread-item"]').text()).toContain(
        'Original title',
      );
      expect(wrapper.find('[data-testid="llm-chat-thread-item"]').text()).not.toContain(
        'Rejected title',
      );
      expect(notifyCreateSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'negative' }));
    });
  });

  describe('Delete Thread Functionality', () => {
    it('should show delete confirmation dialog from the row menu', async () => {
      threadRows = [createMockThread()];

      mountComponent();
      await flushPromises();

      await openThreadMenu();
      await wrapper.find('[data-testid="llm-chat-delete-thread"]').trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('Delete Conversation?');
      expect(wrapper.text()).toContain('This action cannot be undone');
    });

    it('should cancel deletion without calling DELETE', async () => {
      threadRows = [createMockThread()];

      mountComponent();
      await flushPromises();

      await openThreadMenu();
      await wrapper.find('[data-testid="llm-chat-delete-thread"]').trigger('click');
      await flushPromises();

      const cancelButton = wrapper
        .findAllComponents({ name: 'QBtn' })
        .find((b) => b.text() === 'Cancel');
      await cancelButton!.trigger('click');
      await flushPromises();

      expect(deleteFetches().length).toBe(0);
      expect(wrapper.text()).not.toContain('Delete Conversation?');
      expect(wrapper.text()).toContain('Test conversation');
    });

    it('should delete thread when confirmed and remove it from the list', async () => {
      threadRows = [createMockThread()];

      mountComponent();
      await flushPromises();

      await openThreadMenu();
      await wrapper.find('[data-testid="llm-chat-delete-thread"]').trigger('click');
      await flushPromises();

      const confirmButton = wrapper.find('[data-testid="llm-chat-confirm-delete"]');
      await confirmButton.trigger('click');
      await flushPromises();

      expect(deleteFetches().length).toBe(1);
      expect(deleteFetches()[0]!.url).toContain('/api/chat-history/thread/thread-1');

      expect(wrapper.findAll('[data-testid="llm-chat-thread-item"]').length).toBe(0);
      expect(wrapper.text()).toContain('No conversations yet');
      expect(notifyCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'positive',
          message: 'Conversation deleted successfully',
        }),
      );
    });

    it('should preserve the row when deletion fails', async () => {
      threadRows = [createMockThread()];
      deleteFails = true;

      mountComponent();
      await flushPromises();

      await openThreadMenu();
      await wrapper.find('[data-testid="llm-chat-delete-thread"]').trigger('click');
      await flushPromises();

      const confirmButton = wrapper.find('[data-testid="llm-chat-confirm-delete"]');
      await confirmButton.trigger('click');
      await flushPromises();

      expect(deleteFetches().length).toBe(1);
      expect(wrapper.text()).toContain('Test conversation');
      expect(notifyCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'negative', message: 'Failed to delete conversation' }),
      );
    });

    it('should start a new chat when the currently-active thread is deleted', async () => {
      const chatStore = useChatStore();
      const activeThreadId = 'thread-active';
      threadRows = [createMockThread({ ThreadId: activeThreadId, title: 'Active thread' })];
      messageRows = [createMockMessage('Old message', false, 0, activeThreadId)];

      mountComponent();
      await flushPromises();

      await wrapper.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await flushPromises();
      expect(chatStore.chatId).toBe(activeThreadId);

      await openThreadMenu();
      await wrapper.find('[data-testid="llm-chat-delete-thread"]').trigger('click');
      await flushPromises();

      const confirmButton = wrapper.find('[data-testid="llm-chat-confirm-delete"]');
      await confirmButton.trigger('click');
      await flushPromises();

      expect(chatStore.chatId).not.toBe(activeThreadId);
      expect(chatStore.chatId).toBeTruthy();
      expect(chatStore.messages.length).toBe(1);
      expect(chatStore.messages[0]!.content).toContain('こんにちは');
    });

    it('should keep the current chat when deleting a non-active thread', async () => {
      const chatStore = useChatStore();
      chatStore.setChatId('other-thread');
      threadRows = [createMockThread({ ThreadId: 'thread-1' })];

      mountComponent();
      await flushPromises();

      await openThreadMenu();
      await wrapper.find('[data-testid="llm-chat-delete-thread"]').trigger('click');
      await flushPromises();

      const confirmButton = wrapper.find('[data-testid="llm-chat-confirm-delete"]');
      await confirmButton.trigger('click');
      await flushPromises();

      expect(chatStore.chatId).toBe('other-thread');
    });

    it('does not cancel in-flight thread loading when an unrelated thread is deleted', async () => {
      threadRows = [
        createMockThread({ ThreadId: 'thread-1', title: 'Thread 1', updatedAt: Date.now() }),
        createMockThread({
          ThreadId: 'thread-2',
          title: 'Thread 2',
          updatedAt: Date.now() - 60_000,
        }),
      ];
      messageRows = [createMockMessage('body of thread 2', false, 0, 'thread-2')];

      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();

      const thread2Gate = deferred<void>();
      messagesDelays['thread-2'] = thread2Gate.promise;

      // Click thread-2 to select it (starts in-flight load)
      await wrapper.findAll('[data-testid="llm-chat-thread-item"]')[1]!.trigger('click');
      await flushPromises();

      // Delete thread-1 while thread-2 is loading
      await openThreadMenu(0);
      await wrapper.find('[data-testid="llm-chat-delete-thread"]').trigger('click');
      await flushPromises();
      await wrapper.find('[data-testid="llm-chat-confirm-delete"]').trigger('click');
      await flushPromises();

      // Resolve thread-2's message load
      thread2Gate.resolve();
      await flushPromises();

      expect(chatStore.chatId).toBe('thread-2');
      expect(chatStore.messages.some((m) => m.content === 'body of thread 2')).toBe(true);
    });
  });

  describe('Busy gating', () => {
    const startDeferredSend = async () => {
      let resolveLLM: (_value: LlmResponse) => void = () => {};
      const llmPromise = new Promise<LlmResponse>((resolve) => {
        resolveLLM = resolve;
      });
      vi.spyOn(llmModule.llmClient, 'generate').mockReturnValueOnce(llmPromise);
      mountComponent();
      await flushPromises();
      await sendMessage('In-flight message');
      await wrapper.vm.$nextTick();
      return { resolveLLM };
    };

    it('should block thread selection while a send is in flight', async () => {
      threadRows = [createMockThread({ ThreadId: 'thread-1' })];
      const chatStore = useChatStore();
      const { resolveLLM } = await startDeferredSend();
      expect(chatStore.isLoading).toBe(true);

      const messagesBefore = messageFetches().length;
      await wrapper!.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await flushPromises();

      expect(messageFetches().length).toBe(messagesBefore);
      expect(chatStore.chatId).not.toBe('thread-1');

      resolveLLM({ text: 'Late reply' });
      await flushPromises();
      expect(chatStore.isLoading).toBe(false);
    });

    it('should block new chat while a send is in flight', async () => {
      const chatStore = useChatStore();
      const { resolveLLM } = await startDeferredSend();
      const chatIdDuringSend = chatStore.chatId;

      await wrapper!.find('[data-testid="llm-chat-new"]').trigger('click');
      await flushPromises();

      expect(chatStore.chatId).toBe(chatIdDuringSend);

      resolveLLM({ text: 'Late reply' });
      await flushPromises();
    });

    it('should block delete while a send is in flight', async () => {
      threadRows = [createMockThread({ ThreadId: 'thread-1' })];
      const { resolveLLM } = await startDeferredSend();

      const menuButton = wrapper!.find('[data-testid="chat-thread-menu"]');
      await menuButton.trigger('click');
      await flushPromises();

      const deleteItem = wrapper!.find('[data-testid="llm-chat-delete-thread"]');
      if (deleteItem.exists()) {
        await deleteItem.trigger('click');
        await flushPromises();
      }
      expect(wrapper!.text()).not.toContain('Delete Conversation?');
      expect(deleteFetches().length).toBe(0);

      resolveLLM({ text: 'Late reply' });
      await flushPromises();
    });

    it('disables sidebar actions while loading', async () => {
      const chatStore = useChatStore();
      chatStore.setLoading(true);
      mountComponent();
      await wrapper.vm.$nextTick();

      const newButton = wrapper.find('[data-testid="llm-chat-new"]');
      expect(newButton.findComponent({ name: 'QBtn' }).props('disable')).toBe(true);
    });
  });

  describe('Stale operation guards', () => {
    const deferred = <T>() => {
      let resolve!: (_value: T | PromiseLike<T>) => void;
      let reject!: (_reason?: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };

    const switchToAccountB = async () => {
      vi.mocked(awsAmplify.fetchAuthSession).mockResolvedValue(sessionFor('user-b'));
      signIn(createMockUser({ id: 'user-b', username: 'otheruser', email: 'b@example.com' }));
      await flushPromises();
    };

    it('keeps the newer selection when an older selection resolves last', async () => {
      threadRows = [
        createMockThread({ ThreadId: 't-newer', title: 'Newer', updatedAt: Date.now() }),
        createMockThread({
          ThreadId: 't-older',
          title: 'Older',
          updatedAt: Date.now() - 60_000,
        }),
      ];
      messageRows = [
        createMockMessage('older thread body', false, 0, 't-older'),
        createMockMessage('newer thread body', false, 0, 't-newer'),
      ];
      const slow = deferred<void>();
      messagesDelays['t-older'] = slow.promise;

      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();

      const items = wrapper.findAll('[data-testid="llm-chat-thread-item"]');
      await items[1]!.trigger('click');
      await items[0]!.trigger('click');
      await flushPromises();
      expect(chatStore.chatId).toBe('t-newer');

      slow.resolve();
      await flushPromises();

      expect(chatStore.chatId).toBe('t-newer');
      expect(chatStore.messages.some((m) => m.content === 'newer thread body')).toBe(true);
      expect(chatStore.messages.some((m) => m.content === 'older thread body')).toBe(false);
    });

    it('does not let a pending selection overwrite a new chat', async () => {
      threadRows = [createMockThread({ ThreadId: 't-1', title: 'Slow thread' })];
      messageRows = [createMockMessage('slow thread body', false, 0, 't-1')];
      const slow = deferred<void>();
      messagesDelays['t-1'] = slow.promise;

      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();

      await wrapper.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await wrapper.find('[data-testid="llm-chat-new"]').trigger('click');
      await flushPromises();
      const freshChatId = chatStore.chatId;
      expect(freshChatId).not.toBe('t-1');

      slow.resolve();
      await flushPromises();

      expect(chatStore.chatId).toBe(freshChatId);
      expect(chatStore.messages.length).toBe(1);
      expect(chatStore.messages[0]!.content).toContain('こんにちは');
      expect(chatStore.messages.some((m) => m.content === 'slow thread body')).toBe(false);
    });

    it('does not let a pending selection overwrite an in-flight send', async () => {
      threadRows = [createMockThread({ ThreadId: 't-1', title: 'Slow thread' })];
      messageRows = [createMockMessage('late thread body', false, 0, 't-1')];
      const slow = deferred<void>();
      messagesDelays['t-1'] = slow.promise;
      const llmGate = deferred<LlmResponse>();
      vi.spyOn(llmModule.llmClient, 'generate').mockReturnValueOnce(llmGate.promise);

      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();

      await wrapper.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await sendMessage('Send while selecting');
      await flushPromises();

      slow.resolve();
      await flushPromises();

      expect(chatStore.messages.some((m) => m.content === 'late thread body')).toBe(false);
      expect(chatStore.messages.some((m) => m.content === 'Send while selecting')).toBe(true);
      expect(chatStore.chatId).not.toBe('t-1');

      llmGate.resolve({ text: 'busy reply' });
      await flushPromises();
      expect(chatStore.messages.some((m) => m.content === 'busy reply')).toBe(true);
    });

    it('does not apply an LLM reply that resolves after switching accounts', async () => {
      const llmGate = deferred<LlmResponse>();
      vi.spyOn(llmModule.llmClient, 'generate').mockReturnValueOnce(llmGate.promise);

      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();
      await sendMessage('Question under account A');
      await flushPromises();
      const aChatId = chatStore.chatId;

      await switchToAccountB();

      llmGate.resolve({ text: 'Reply for account A' });
      await flushPromises();

      expect(chatStore.messages.some((m) => m.content === 'Reply for account A')).toBe(false);
      expect(chatStore.messages.some((m) => m.content === 'Question under account A')).toBe(false);
      expect(chatStore.messages.length).toBe(1);
      expect(chatStore.messages[0]!.type).toBe('ai');
      expect(chatStore.chatId).not.toBe(aChatId);
      expect(chatStore.isLoading).toBe(false);
      expect(chatStore.isTyping).toBe(false);
    });

    it('does not clear a newer send loading state when a stale send finishes', async () => {
      const gateA = deferred<LlmResponse>();
      vi.spyOn(llmModule.llmClient, 'generate').mockReturnValueOnce(gateA.promise);

      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();
      await sendMessage('A in-flight');
      await flushPromises();

      await switchToAccountB();

      const gateB = deferred<LlmResponse>();
      vi.spyOn(llmModule.llmClient, 'generate').mockReturnValueOnce(gateB.promise);
      await sendMessage('B in-flight');
      await flushPromises();
      expect(chatStore.isLoading).toBe(true);

      gateA.resolve({ text: 'stale A reply' });
      await flushPromises();

      expect(chatStore.isLoading).toBe(true);
      expect(chatStore.messages.some((m) => m.content === 'stale A reply')).toBe(false);

      gateB.resolve({ text: 'B reply' });
      await flushPromises();
      expect(chatStore.isLoading).toBe(false);
      expect(chatStore.messages.some((m) => m.content === 'B reply')).toBe(true);
    });

    it('does not apply a pending selection that resolves after switching accounts', async () => {
      threadRows = [createMockThread({ ThreadId: 't-1', title: 'A thread' })];
      messageRows = [createMockMessage('A thread body', false, 0, 't-1')];
      const slow = deferred<void>();
      messagesDelays['t-1'] = slow.promise;

      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();

      await wrapper.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await switchToAccountB();

      slow.resolve();
      await flushPromises();

      expect(chatStore.chatId).not.toBe('t-1');
      expect(chatStore.messages.some((m) => m.content === 'A thread body')).toBe(false);
      expect(chatStore.messages.length).toBe(1);
    });

    it('does not run delete success effects after switching accounts mid-delete', async () => {
      threadRows = [createMockThread({ ThreadId: 't-1', title: 'Doomed thread' })];
      const gate = deferred<void>();
      deleteDelay = gate.promise;

      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();

      await openThreadMenu();
      await wrapper.find('[data-testid="llm-chat-delete-thread"]').trigger('click');
      await flushPromises();
      await wrapper.find('[data-testid="llm-chat-confirm-delete"]').trigger('click');
      await flushPromises();
      expect(deleteFetches().length).toBe(1);

      await switchToAccountB();

      gate.resolve();
      await flushPromises();

      expect(notifyCreateSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'positive',
          message: 'Conversation deleted successfully',
        }),
      );
      expect(chatStore.messages.length).toBe(1);
    });

    it('resets leftover account-A conversation when remounting under account B', async () => {
      mockLLMResponse('Reply under A');
      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();
      await sendMessage('A transcript');
      await flushPromises();
      expect(chatStore.messages.length).toBeGreaterThan(1);
      const aChatId = chatStore.chatId;

      wrapper!.unmount();
      vi.mocked(awsAmplify.fetchAuthSession).mockResolvedValue(sessionFor('user-b'));
      signIn(createMockUser({ id: 'user-b', username: 'otheruser', email: 'b@example.com' }));
      mountComponent();
      await flushPromises();

      expect(chatStore.chatId).not.toBe(aChatId);
      expect(chatStore.messages.length).toBe(1);
      expect(chatStore.messages[0]!.content).toContain('こんにちは');
      expect(chatStore.messages.some((m) => m.content === 'A transcript')).toBe(false);
    });

    it('keeps the conversation when remounting under the same session', async () => {
      mockLLMResponse('kept reply');
      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();
      await sendMessage('Kept transcript');
      await flushPromises();
      const firstChatId = chatStore.chatId;

      wrapper!.unmount();
      mountComponent();
      await flushPromises();

      expect(chatStore.chatId).toBe(firstChatId);
      expect(chatStore.messages.some((m) => m.content === 'Kept transcript')).toBe(true);
      expect(chatStore.messages.some((m) => m.content === 'kept reply')).toBe(true);
    });

    it('drops a pending send across unmount and re-authentication with the same user id', async () => {
      const gate = deferred<LlmResponse>();
      vi.spyOn(llmModule.llmClient, 'generate').mockReturnValueOnce(gate.promise);

      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();
      await sendMessage('Pending under first session');
      await flushPromises();
      const firstChatId = chatStore.chatId;

      wrapper!.unmount();
      vi.mocked(awsAmplify.fetchAuthSession).mockResolvedValue(sessionFor('user-b'));
      signIn(createMockUser({ id: 'user-b', username: 'otheruser', email: 'b@example.com' }));
      vi.mocked(awsAmplify.fetchAuthSession).mockResolvedValue(sessionFor('user-123'));
      signIn();
      mountComponent();
      await flushPromises();

      gate.resolve({ text: 'revived reply' });
      await flushPromises();

      expect(chatStore.messages.some((m) => m.content === 'revived reply')).toBe(false);
      expect(chatStore.messages.length).toBe(1);
      expect(chatStore.chatId).not.toBe(firstChatId);
      expect(chatStore.isLoading).toBe(false);
    });

    it('resets sending state when the session generation changes within one batch', async () => {
      const gateA = deferred<LlmResponse>();
      vi.spyOn(llmModule.llmClient, 'generate').mockReturnValueOnce(gateA.promise);

      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();
      await sendMessage('A in-flight');
      await flushPromises();
      const aChatId = chatStore.chatId;
      expect(chatStore.isLoading).toBe(true);

      vi.mocked(awsAmplify.fetchAuthSession).mockResolvedValue(sessionFor('user-b'));
      signIn(createMockUser({ id: 'user-b', username: 'otheruser', email: 'b@example.com' }));
      vi.mocked(awsAmplify.fetchAuthSession).mockResolvedValue(sessionFor('user-123'));
      signIn();
      await flushPromises();

      expect(chatStore.chatId).not.toBe(aChatId);
      expect(chatStore.messages.length).toBe(1);
      expect(chatStore.messages[0]!.content).toContain('こんにちは');

      gateA.resolve({ text: 'batched stale reply' });
      await flushPromises();

      expect(chatStore.isLoading).toBe(false);
      expect(chatStore.isTyping).toBe(false);
      expect(chatStore.messages.some((m) => m.content === 'batched stale reply')).toBe(false);
    });

    it('does not leak the previous account delete dialog into the next account', async () => {
      threadRows = [
        createMockThread({ ThreadId: 't-a', title: 'A thread', updatedAt: Date.now() }),
        createMockThread({
          ThreadId: 't-b',
          title: 'B thread',
          updatedAt: Date.now() - 60_000,
        }),
      ];
      const gate = deferred<void>();
      deleteDelay = gate.promise;

      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();

      await openThreadMenu(0);
      await wrapper.find('[data-testid="llm-chat-delete-thread"]').trigger('click');
      await flushPromises();
      expect(wrapper.text()).toContain('Delete Conversation?');
      expect(wrapper.text()).toContain('A thread');

      await wrapper.find('[data-testid="llm-chat-confirm-delete"]').trigger('click');
      await flushPromises();
      expect(deleteFetches().length).toBe(1);

      await switchToAccountB();
      expect(wrapper.text()).not.toContain('Delete Conversation?');

      await openThreadMenu(1);
      await wrapper.find('[data-testid="llm-chat-delete-thread"]').trigger('click');
      await flushPromises();
      expect(wrapper.text()).toContain('Delete Conversation?');
      expect(wrapper.text()).toContain('B thread');

      gate.resolve();
      await flushPromises();

      expect(wrapper.text()).toContain('Delete Conversation?');
      expect(wrapper.text()).toContain('B thread');
      expect(notifyCreateSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'positive',
          message: 'Conversation deleted successfully',
        }),
      );
      expect(chatStore.messages.length).toBe(1);
    });

    it('does not let an unrelated rename cancel a pending selection', async () => {
      threadRows = [
        createMockThread({ ThreadId: 't-1', title: 'Slow select', updatedAt: Date.now() }),
        createMockThread({
          ThreadId: 't-2',
          title: 'Renamed soon',
          updatedAt: Date.now() - 60_000,
        }),
      ];
      messageRows = [createMockMessage('selected thread body', false, 0, 't-1')];
      const slow = deferred<void>();
      messagesDelays['t-1'] = slow.promise;

      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();

      await wrapper.findAll('[data-testid="llm-chat-thread-item"]')[0]!.trigger('click');

      await openThreadMenu(1);
      await wrapper.find('[data-testid="chat-thread-rename"]').trigger('click');
      await flushPromises();
      await wrapper.find('[data-testid="chat-thread-rename-input"]').setValue('Renamed other');
      await wrapper
        .find('[data-testid="chat-thread-rename-input"]')
        .trigger('keydown', { key: 'Enter' });
      await flushPromises();
      expect(patchFetches().length).toBe(1);

      slow.resolve();
      await flushPromises();

      expect(chatStore.chatId).toBe('t-1');
      expect(chatStore.messages.some((m) => m.content === 'selected thread body')).toBe(true);
    });

    it('still resets the active thread when a pending delete succeeds after an unrelated rename', async () => {
      threadRows = [
        createMockThread({ ThreadId: 't-1', title: 'Active delete', updatedAt: Date.now() }),
        createMockThread({
          ThreadId: 't-2',
          title: 'Renamed soon',
          updatedAt: Date.now() - 60_000,
        }),
      ];
      messageRows = [createMockMessage('active thread body', false, 0, 't-1')];
      const gate = deferred<void>();
      deleteDelay = gate.promise;

      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();

      await wrapper.findAll('[data-testid="llm-chat-thread-item"]')[0]!.trigger('click');
      await flushPromises();
      expect(chatStore.chatId).toBe('t-1');

      await openThreadMenu(0);
      await wrapper.find('[data-testid="llm-chat-delete-thread"]').trigger('click');
      await flushPromises();
      await wrapper.find('[data-testid="llm-chat-confirm-delete"]').trigger('click');
      await flushPromises();
      expect(deleteFetches().length).toBe(1);

      await openThreadMenu(1);
      await wrapper.find('[data-testid="chat-thread-rename"]').trigger('click');
      await flushPromises();
      await wrapper.find('[data-testid="chat-thread-rename-input"]').setValue('Renamed other');
      await wrapper
        .find('[data-testid="chat-thread-rename-input"]')
        .trigger('keydown', { key: 'Enter' });
      await flushPromises();
      expect(patchFetches().length).toBe(1);

      gate.resolve();
      await flushPromises();

      expect(chatStore.chatId).not.toBe('t-1');
      expect(chatStore.messages.length).toBe(1);
      expect(chatStore.messages[0]!.content).toContain('こんにちは');
      expect(notifyCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'positive',
          message: 'Conversation deleted successfully',
        }),
      );
    });

    it('does not let a selection resurrect a thread while its delete is in flight', async () => {
      threadRows = [
        createMockThread({ ThreadId: 't-1', title: 'Doomed', updatedAt: Date.now() }),
        createMockThread({ ThreadId: 't-2', title: 'Survivor', updatedAt: Date.now() - 60_000 }),
      ];
      messageRows = [createMockMessage('doomed body', false, 0, 't-1')];
      const gate = deferred<void>();
      deleteDelay = gate.promise;

      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();

      await openThreadMenu(0);
      await wrapper.find('[data-testid="llm-chat-delete-thread"]').trigger('click');
      await flushPromises();
      await wrapper.find('[data-testid="llm-chat-confirm-delete"]').trigger('click');
      await flushPromises();
      expect(deleteFetches().length).toBe(1);

      await wrapper.findAll('[data-testid="llm-chat-thread-item"]')[0]!.trigger('click');
      await flushPromises();

      expect(messageFetches().filter((f) => f.url.includes('thread_id=t-1')).length).toBe(0);
      expect(chatStore.chatId).not.toBe('t-1');

      gate.resolve();
      await flushPromises();

      expect(chatStore.messages.some((m) => m.content === 'doomed body')).toBe(false);
      expect(chatStore.chatId).not.toBe('t-1');
    });

    it('lets a thread be selected again after its delete fails', async () => {
      threadRows = [createMockThread({ ThreadId: 't-1', title: 'Survivor' })];
      messageRows = [createMockMessage('survivor body', false, 0, 't-1')];
      deleteFails = true;
      const gate = deferred<void>();
      deleteDelay = gate.promise;

      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();

      await openThreadMenu(0);
      await wrapper.find('[data-testid="llm-chat-delete-thread"]').trigger('click');
      await flushPromises();
      await wrapper.find('[data-testid="llm-chat-confirm-delete"]').trigger('click');
      await flushPromises();
      expect(deleteFetches().length).toBe(1);

      await wrapper.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await flushPromises();
      expect(messageFetches().filter((f) => f.url.includes('thread_id=t-1')).length).toBe(0);

      gate.resolve();
      await flushPromises();
      expect(notifyCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'negative', message: 'Failed to delete conversation' }),
      );

      await wrapper.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await flushPromises();

      expect(messageFetches().filter((f) => f.url.includes('thread_id=t-1')).length).toBe(1);
      expect(chatStore.chatId).toBe('t-1');
      expect(chatStore.messages.some((m) => m.content === 'survivor body')).toBe(true);
    });

    it('does not leak a deletion tombstone into the next account for the same thread id', async () => {
      threadRows = [createMockThread({ ThreadId: 't-1', title: 'A shared id' })];

      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();

      await openThreadMenu(0);
      await wrapper.find('[data-testid="llm-chat-delete-thread"]').trigger('click');
      await flushPromises();
      await wrapper.find('[data-testid="llm-chat-confirm-delete"]').trigger('click');
      await flushPromises();
      expect(deleteFetches().length).toBe(1);

      await switchToAccountB();
      threadRows.push(createMockThread({ ThreadId: 't-1', title: 'B shared id' }));
      messageRows = [createMockMessage('B thread body', false, 0, 't-1')];
      await queryClient.invalidateQueries({ queryKey: chatKeys.threads('user-b') });
      await flushPromises();
      expect(wrapper.text()).toContain('B shared id');

      await wrapper.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await flushPromises();

      expect(messageFetches().filter((f) => f.url.includes('thread_id=t-1')).length).toBe(1);
      expect(chatStore.chatId).toBe('t-1');
      expect(chatStore.messages.some((m) => m.content === 'B thread body')).toBe(true);
    });

    it('cannot release account B deletion guard when a stale A delete fails', async () => {
      threadRows = [createMockThread({ ThreadId: 't-1', title: 'Shared id' })];
      const gateA = deferred<void>();
      const gateB = deferred<void>();
      deleteDelayQueue = [gateA.promise, gateB.promise];

      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();

      await openThreadMenu(0);
      await wrapper.find('[data-testid="llm-chat-delete-thread"]').trigger('click');
      await flushPromises();
      await wrapper.find('[data-testid="llm-chat-confirm-delete"]').trigger('click');
      await flushPromises();
      expect(deleteFetches().length).toBe(1);

      await switchToAccountB();

      await openThreadMenu(0);
      await wrapper.find('[data-testid="llm-chat-delete-thread"]').trigger('click');
      await flushPromises();
      await wrapper.find('[data-testid="llm-chat-confirm-delete"]').trigger('click');
      await flushPromises();
      expect(deleteFetches().length).toBe(2);

      deleteFails = true;
      gateA.resolve();
      await flushPromises();
      deleteFails = false;

      await wrapper.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await flushPromises();
      expect(messageFetches().filter((f) => f.url.includes('thread_id=t-1')).length).toBe(0);
      expect(chatStore.chatId).not.toBe('t-1');

      gateB.resolve();
      await flushPromises();
      expect(notifyCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'positive',
          message: 'Conversation deleted successfully',
        }),
      );
    });

    it('does not let a stale delayed delete failure release the newer session pending guard', async () => {
      threadRows = [createMockThread({ ThreadId: 't-1', title: 'Shared id' })];
      messageRows = [createMockMessage('shared body', false, 0, 't-1')];
      const gateOld = deferred<void>();
      const gateNew = deferred<void>();
      deleteDelayQueue = [gateOld.promise, gateNew.promise];

      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();

      await openThreadMenu(0);
      await wrapper.find('[data-testid="llm-chat-delete-thread"]').trigger('click');
      await flushPromises();
      await wrapper.find('[data-testid="llm-chat-confirm-delete"]').trigger('click');
      await flushPromises();
      expect(deleteFetches().length).toBe(1);

      await switchToAccountB();
      vi.mocked(awsAmplify.fetchAuthSession).mockResolvedValue(sessionFor('user-123'));
      signIn();
      await flushPromises();

      await wrapper.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await flushPromises();
      expect(chatStore.chatId).toBe('t-1');
      expect(messageFetches().filter((f) => f.url.includes('thread_id=t-1')).length).toBe(1);

      await openThreadMenu(0);
      await wrapper.find('[data-testid="llm-chat-delete-thread"]').trigger('click');
      await flushPromises();
      await wrapper.find('[data-testid="llm-chat-confirm-delete"]').trigger('click');
      await flushPromises();
      expect(deleteFetches().length).toBe(2);

      deleteFails = true;
      gateOld.resolve();
      await flushPromises();
      deleteFails = false;
      expect(notifyCreateSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'negative', message: 'Failed to delete conversation' }),
      );

      await wrapper.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await flushPromises();
      expect(messageFetches().filter((f) => f.url.includes('thread_id=t-1')).length).toBe(1);

      gateNew.resolve();
      await flushPromises();

      expect(chatStore.chatId).not.toBe('t-1');
      expect(chatStore.messages.length).toBe(1);
      expect(chatStore.messages[0]!.content).toContain('こんにちは');
      expect(notifyCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'positive',
          message: 'Conversation deleted successfully',
        }),
      );
    });

    it('does not let a stale delayed delete success release the newer session pending guard', async () => {
      threadRows = [createMockThread({ ThreadId: 't-1', title: 'Shared id' })];
      messageRows = [createMockMessage('shared body', false, 0, 't-1')];
      const gateOld = deferred<void>();
      const gateNew = deferred<void>();
      deleteDelayQueue = [gateOld.promise, gateNew.promise];

      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();

      await openThreadMenu(0);
      await wrapper.find('[data-testid="llm-chat-delete-thread"]').trigger('click');
      await flushPromises();
      await wrapper.find('[data-testid="llm-chat-confirm-delete"]').trigger('click');
      await flushPromises();
      expect(deleteFetches().length).toBe(1);

      await switchToAccountB();
      vi.mocked(awsAmplify.fetchAuthSession).mockResolvedValue(sessionFor('user-123'));
      signIn();
      await flushPromises();

      await wrapper.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await flushPromises();
      expect(chatStore.chatId).toBe('t-1');
      expect(messageFetches().filter((f) => f.url.includes('thread_id=t-1')).length).toBe(1);

      await openThreadMenu(0);
      await wrapper.find('[data-testid="llm-chat-delete-thread"]').trigger('click');
      await flushPromises();
      await wrapper.find('[data-testid="llm-chat-confirm-delete"]').trigger('click');
      await flushPromises();
      expect(deleteFetches().length).toBe(2);

      gateOld.resolve();
      await flushPromises();
      expect(notifyCreateSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'positive',
          message: 'Conversation deleted successfully',
        }),
      );

      threadRows.push(createMockThread({ ThreadId: 't-1', title: 'Recreated row' }));
      messageRows.push(createMockMessage('recreated body', false, 0, 't-1'));
      await queryClient.invalidateQueries({ queryKey: chatKeys.threads('user-123') });
      await flushPromises();
      expect(wrapper.text()).toContain('Recreated row');

      await wrapper.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await flushPromises();
      expect(messageFetches().filter((f) => f.url.includes('thread_id=t-1')).length).toBe(1);
      expect(chatStore.messages.some((m) => m.content === 'recreated body')).toBe(false);

      gateNew.resolve();
      await flushPromises();

      expect(chatStore.chatId).not.toBe('t-1');
      expect(chatStore.messages.length).toBe(1);
      expect(chatStore.messages[0]!.content).toContain('こんにちは');
      expect(notifyCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'positive',
          message: 'Conversation deleted successfully',
        }),
      );
    });

    it('lets a legitimately recreated thread be selected after authoritative refresh', async () => {
      threadRows = [createMockThread({ ThreadId: 't-1', title: 'Doomed' })];

      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();

      await openThreadMenu(0);
      await wrapper.find('[data-testid="llm-chat-delete-thread"]').trigger('click');
      await flushPromises();
      await wrapper.find('[data-testid="llm-chat-confirm-delete"]').trigger('click');
      await flushPromises();
      expect(deleteFetches().length).toBe(1);
      expect(wrapper.text()).toContain('No conversations yet');

      threadRows.push(createMockThread({ ThreadId: 't-1', title: 'Recreated row' }));
      messageRows = [createMockMessage('recreated body', false, 0, 't-1')];
      await queryClient.invalidateQueries({ queryKey: chatKeys.threads('user-123') });
      await flushPromises();
      expect(wrapper.text()).toContain('Recreated row');

      await wrapper.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await flushPromises();

      expect(messageFetches().filter((f) => f.url.includes('thread_id=t-1')).length).toBe(1);
      expect(chatStore.chatId).toBe('t-1');
      expect(chatStore.messages.some((m) => m.content === 'recreated body')).toBe(true);
    });

    it('lets a recreated thread be selected when the post-delete refresh already returns it', async () => {
      threadRows = [createMockThread({ ThreadId: 't-1', title: 'Doomed' })];
      messageRows = [createMockMessage('recreated body', false, 0, 't-1')];

      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();

      const listGate = deferred<void>();
      listDelay = listGate.promise;
      // The post-delete refresh snapshots its response when the request
      // reaches the server: a row recreated before that read is part of the
      // snapshot it lands.
      listThreadsOverride = [createMockThread({ ThreadId: 't-1', title: 'Recreated row' })];

      await openThreadMenu(0);
      await wrapper.find('[data-testid="llm-chat-delete-thread"]').trigger('click');
      await flushPromises();
      await wrapper.find('[data-testid="llm-chat-confirm-delete"]').trigger('click');
      await flushPromises();
      expect(deleteFetches().length).toBe(1);

      // The messages endpoint reads threadRows, so the recreated row must
      // exist there once the landed refresh makes it selectable.
      threadRows.push(createMockThread({ ThreadId: 't-1', title: 'Recreated row' }));
      listThreadsOverride = null;
      listGate.resolve();
      await flushPromises();
      expect(wrapper.text()).toContain('Recreated row');

      await wrapper.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await flushPromises();

      expect(messageFetches().filter((f) => f.url.includes('thread_id=t-1')).length).toBe(1);
      expect(chatStore.chatId).toBe('t-1');
      expect(chatStore.messages.some((m) => m.content === 'recreated body')).toBe(true);
    });

    it('does not let a selection started before deletion resurrect the deleted thread', async () => {
      threadRows = [
        createMockThread({ ThreadId: 't-1', title: 'Doomed', updatedAt: Date.now() }),
        createMockThread({ ThreadId: 't-2', title: 'Survivor', updatedAt: Date.now() - 60_000 }),
      ];
      messageRows = [createMockMessage('doomed body', false, 0, 't-1')];
      const slow = deferred<void>();
      messagesDelays['t-1'] = slow.promise;

      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();

      await wrapper.findAll('[data-testid="llm-chat-thread-item"]')[0]!.trigger('click');

      await openThreadMenu(0);
      await wrapper.find('[data-testid="llm-chat-delete-thread"]').trigger('click');
      await flushPromises();
      await wrapper.find('[data-testid="llm-chat-confirm-delete"]').trigger('click');
      await flushPromises();
      expect(deleteFetches().length).toBe(1);

      slow.resolve();
      await flushPromises();

      expect(chatStore.chatId).not.toBe('t-1');
      expect(chatStore.messages.some((m) => m.content === 'doomed body')).toBe(false);
    });

    it('does not install a delayed selection while its delete is still pending', async () => {
      threadRows = [
        createMockThread({ ThreadId: 't-1', title: 'Doomed', updatedAt: Date.now() }),
        createMockThread({ ThreadId: 't-2', title: 'Survivor', updatedAt: Date.now() - 60_000 }),
      ];
      messageRows = [createMockMessage('doomed body', false, 0, 't-1')];
      const slowGet = deferred<void>();
      messagesDelays['t-1'] = slowGet.promise;
      const deleteGate = deferred<void>();
      deleteDelay = deleteGate.promise;

      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();

      // Select t-1, then delete it while the messages response is in flight.
      await wrapper.findAll('[data-testid="llm-chat-thread-item"]')[0]!.trigger('click');
      await openThreadMenu(0);
      await wrapper.find('[data-testid="llm-chat-delete-thread"]').trigger('click');
      await flushPromises();
      await wrapper.find('[data-testid="llm-chat-confirm-delete"]').trigger('click');
      await flushPromises();
      expect(deleteFetches().length).toBe(1);

      // The selection's response arrives while the DELETE is still pending.
      slowGet.resolve();
      await flushPromises();
      expect(chatStore.chatId).not.toBe('t-1');
      expect(chatStore.messages.some((m) => m.content === 'doomed body')).toBe(false);

      deleteGate.resolve();
      await flushPromises();
      expect(chatStore.chatId).not.toBe('t-1');
    });

    it('removes the deleted thread from the sidebar immediately on delete even while refetch is pending', async () => {
      threadRows = [
        createMockThread({ ThreadId: 't-1', title: 'Doomed', updatedAt: Date.now() }),
        createMockThread({ ThreadId: 't-2', title: 'Survivor', updatedAt: Date.now() - 60_000 }),
      ];
      messageRows = [createMockMessage('doomed body', false, 0, 't-1')];

      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();

      await wrapper.findAll('[data-testid="llm-chat-thread-item"]')[0]!.trigger('click');
      await flushPromises();
      expect(chatStore.chatId).toBe('t-1');

      const listGate = deferred<void>();
      listDelay = listGate.promise;

      await openThreadMenu(0);
      await wrapper.find('[data-testid="llm-chat-delete-thread"]').trigger('click');
      await flushPromises();
      await wrapper.find('[data-testid="llm-chat-confirm-delete"]').trigger('click');
      await flushPromises();
      expect(deleteFetches().length).toBe(1);
      expect(chatStore.chatId).not.toBe('t-1');
      // The row is removed from cache immediately on delete success
      expect(wrapper.text()).not.toContain('Doomed');
      expect(wrapper.text()).toContain('Survivor');

      listGate.resolve();
      await flushPromises();
      expect(wrapper.text()).not.toContain('Doomed');
      expect(wrapper.text()).toContain('Survivor');
    });

    it('allows starting a new chat while post-delete refetch is still pending', async () => {
      threadRows = [createMockThread({ ThreadId: 't-1', title: 'Doomed' })];

      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();

      const listGate = deferred<void>();
      listDelay = listGate.promise;

      await openThreadMenu(0);
      await wrapper.find('[data-testid="llm-chat-delete-thread"]').trigger('click');
      await flushPromises();
      await wrapper.find('[data-testid="llm-chat-confirm-delete"]').trigger('click');
      await flushPromises();
      expect(deleteFetches().length).toBe(1);
      expect(wrapper.text()).not.toContain('Doomed');

      await wrapper.find('[data-testid="llm-chat-new"]').trigger('click');
      await flushPromises();
      expect(chatStore.messages[0]?.content).toContain('こんにちは！日本語学習をお手伝いします');

      listGate.resolve();
      await flushPromises();
    });

    it('does not replay recovered turns into the next account after a mid-recovery switch', async () => {
      const llmGate = deferred<LlmResponse>();
      vi.spyOn(llmModule.llmClient, 'generate').mockReturnValueOnce(llmGate.promise);

      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();
      chatStore.setChatId('dead-thread');

      // Hold the first save to the replacement thread so the account can
      // switch while the recovery write is still in flight.
      const underlying = fetchMock.getMockImplementation()!;
      const replayGate = deferred<void>();
      fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const method = init?.method ?? 'GET';
        if (url.includes('/api/chat-history/save') && method === 'POST') {
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          if (body.ThreadId !== 'dead-thread') {
            return replayGate.promise.then(() => underlying(input, init));
          }
        }
        return underlying(input, init);
      });

      await sendMessage('A turn');
      await flushPromises();

      // The user save landed, but the thread dies before the assistant save,
      // so recovery replays both turns under a fresh thread id.
      saveNotFoundFor.add('dead-thread');
      llmGate.resolve({ text: 'A reply' });
      await flushPromises();

      await switchToAccountB();

      replayGate.resolve();
      await flushPromises();

      expect(chatStore.messages.some((m) => m.content === 'A turn')).toBe(false);
      expect(chatStore.messages.some((m) => m.content === 'A reply')).toBe(false);
      expect(chatStore.messages.length).toBe(1);
      expect(chatStore.messages[0]!.content).toContain('こんにちは');
      // The old account's reply is never re-persisted after the switch; only
      // its original 404'd attempt was logged.
      expect(saveBodies.filter((b) => b.message === 'A reply').length).toBe(1);
    });
  });

  describe('Pending delete guards', () => {
    const deferred = <T>() => {
      let resolve!: (_value: T | PromiseLike<T>) => void;
      let reject!: (_reason?: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    };

    const selectFirstThread = async () => {
      await wrapper!.findAll('[data-testid="llm-chat-thread-item"]')[0]!.trigger('click');
      await flushPromises();
    };

    const confirmPendingDelete = async (index = 0) => {
      await openThreadMenu(index);
      await wrapper!.find('[data-testid="llm-chat-delete-thread"]').trigger('click');
      await flushPromises();
      await wrapper!.find('[data-testid="llm-chat-confirm-delete"]').trigger('click');
      await flushPromises();
    };

    const deleteDialog = () =>
      wrapper!.findAllComponents({ name: 'QDialog' }).find((d) => d.props('position') !== 'left');
    const deleteDialogOpen = () => deleteDialog()?.text().includes('Delete Conversation?') ?? false;

    it('keeps the delete confirmation dialog open while deletion is pending', async () => {
      threadRows = [createMockThread({ ThreadId: 't-1', title: 'Doomed' })];
      const gate = deferred<void>();
      deleteDelay = gate.promise;

      mountComponent();
      await flushPromises();

      await openThreadMenu(0);
      await wrapper.find('[data-testid="llm-chat-delete-thread"]').trigger('click');
      await flushPromises();
      expect(deleteDialogOpen()).toBe(true);
      expect(deleteDialog()?.props('persistent') ?? false).toBe(false);

      await wrapper.find('[data-testid="llm-chat-confirm-delete"]').trigger('click');
      await flushPromises();
      expect(deleteFetches().length).toBe(1);
      expect(deleteDialog()?.props('persistent')).toBe(true);

      await wrapper.find('.q-dialog__backdrop').trigger('click');
      await wrapper.trigger('keyup.esc');
      await flushPromises();
      expect(deleteDialogOpen()).toBe(true);

      gate.resolve();
      await flushPromises();
      expect(deleteDialogOpen()).toBe(false);
    });

    it('refuses to send into the active thread while its deletion is pending', async () => {
      threadRows = [createMockThread({ ThreadId: 't-1', title: 'Doomed' })];
      messageRows = [createMockMessage('doomed body', false, 0, 't-1')];
      const gate = deferred<void>();
      deleteDelay = gate.promise;
      mockLLMResponse('late reply');

      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();
      await selectFirstThread();
      expect(chatStore.chatId).toBe('t-1');

      await confirmPendingDelete(0);
      expect(deleteFetches().length).toBe(1);

      const input = wrapper.find('[data-testid="llm-chat-input"]');
      await input.setValue('Into doomed thread');
      await wrapper.find('[data-testid="llm-chat-send"]').trigger('click');
      await flushPromises();

      expect(saveBodies.length).toBe(0);
      expect(llmModule.llmClient.generate).not.toHaveBeenCalled();
      expect(chatStore.messages.some((m) => m.content === 'Into doomed thread')).toBe(false);
      expect((input.element as HTMLInputElement).value).toBe('Into doomed thread');

      gate.resolve();
      await flushPromises();

      expect(chatStore.chatId).not.toBe('t-1');
      expect(chatStore.messages.length).toBe(1);
      expect(chatStore.messages[0]!.content).toContain('こんにちは');
      expect(notifyCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'positive',
          message: 'Conversation deleted successfully',
        }),
      );
    });

    it('still resets the deleted active thread when a failed selection bumps the generation', async () => {
      threadRows = [
        createMockThread({ ThreadId: 't-1', title: 'Doomed', updatedAt: Date.now() }),
        createMockThread({
          ThreadId: 't-2',
          title: 'Failing load',
          updatedAt: Date.now() - 60_000,
        }),
      ];
      messageRows = [createMockMessage('doomed body', false, 0, 't-1')];
      messagesFailFor.add('t-2');
      const gate = deferred<void>();
      deleteDelay = gate.promise;
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();
      await selectFirstThread();
      expect(chatStore.chatId).toBe('t-1');

      await confirmPendingDelete(0);
      expect(deleteFetches().length).toBe(1);

      await wrapper.findAll('[data-testid="llm-chat-thread-item"]')[1]!.trigger('click');
      await flushPromises();
      expect(notifyCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'negative', message: 'Failed to load conversation' }),
      );
      expect(chatStore.chatId).toBe('t-1');

      gate.resolve();
      await flushPromises();

      expect(chatStore.chatId).not.toBe('t-1');
      expect(chatStore.messages.length).toBe(1);
      expect(chatStore.messages[0]!.content).toContain('こんにちは');
      expect(notifyCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'positive',
          message: 'Conversation deleted successfully',
        }),
      );
      consoleErrorSpy.mockRestore();
    });

    it('does not reset a different conversation selected while the active thread delete is in flight', async () => {
      threadRows = [
        createMockThread({ ThreadId: 't-1', title: 'Doomed', updatedAt: Date.now() }),
        createMockThread({
          ThreadId: 't-2',
          title: 'Survivor',
          updatedAt: Date.now() - 60_000,
        }),
      ];
      messageRows = [
        createMockMessage('doomed body', false, 0, 't-1'),
        createMockMessage('survivor body', false, 0, 't-2'),
      ];
      const gate = deferred<void>();
      deleteDelay = gate.promise;

      mountComponent();
      const chatStore = useChatStore();
      await flushPromises();
      await selectFirstThread();
      expect(chatStore.chatId).toBe('t-1');

      await confirmPendingDelete(0);
      expect(deleteFetches().length).toBe(1);

      // While the DELETE is in flight the user lands on another conversation
      // (e.g. by navigating away and back, which remounts the page).
      await wrapper.findAll('[data-testid="llm-chat-thread-item"]')[1]!.trigger('click');
      await flushPromises();
      expect(chatStore.chatId).toBe('t-2');
      expect(chatStore.messages.some((m) => m.content === 'survivor body')).toBe(true);

      gate.resolve();
      await flushPromises();

      expect(chatStore.chatId).toBe('t-2');
      expect(chatStore.messages.some((m) => m.content === 'survivor body')).toBe(true);
      expect(notifyCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'positive',
          message: 'Conversation deleted successfully',
        }),
      );
    });
  });

  describe('Store Integration', () => {
    it('should have access to chat store', () => {
      mountComponent();
      const chatStore = useChatStore();
      expect(chatStore).toBeDefined();
    });

    it('should have access to LLM settings store', () => {
      mountComponent();
      const llmSettings = useLLMSettingsStore();
      expect(llmSettings).toBeDefined();
    });

    it('should have access to auth store', () => {
      mountComponent();
      const authStore = useAuthStore();
      expect(authStore).toBeDefined();
    });

    it('should pass the current provider/model/key snapshot explicitly on send', async () => {
      const llmSettings = useLLMSettingsStore();
      llmSettings.llm = {
        keys: { google: 'snapshot-key' },
        thinking: {},
        defaultModel: { provider: 'google', model: 'gemini-3.8-flash' },
      };
      mockLLMResponse();

      mountComponent();
      await flushPromises();

      const input = wrapper.find('[data-testid="llm-chat-input"]');
      await input.setValue('Snapshot test');
      await wrapper.find('[data-testid="llm-chat-send"]').trigger('click');
      await flushPromises();

      expect(llmModule.llmClient.generate).toHaveBeenCalledWith(
        {
          provider: 'google',
          model: 'gemini-3.8-flash',
          apiKey: 'snapshot-key',
          system: expect.stringContaining('Japanese learning assistant'),
          messages: expect.arrayContaining([{ role: 'user', content: 'Snapshot test' }]),
        },
        'user-123',
      );
      // temperature is no longer part of the request contract
      const call = vi.mocked(llmModule.llmClient.generate).mock.calls[0]![0];
      expect(call).not.toHaveProperty('temperature');
      expect(call).not.toHaveProperty('thinking');
    });

    it('should send only the explicitly saved thinking override on send', async () => {
      const llmSettings = useLLMSettingsStore();
      llmSettings.llm = {
        keys: { google: 'snapshot-key' },
        thinking: { 'gemini-3.8-flash': 'high' },
        defaultModel: { provider: 'google', model: 'gemini-3.8-flash' },
      };
      mockLLMResponse();

      mountComponent();
      await flushPromises();

      const input = wrapper.find('[data-testid="llm-chat-input"]');
      await input.setValue('Thinking test');
      await wrapper.find('[data-testid="llm-chat-send"]').trigger('click');
      await flushPromises();

      expect(llmModule.llmClient.generate).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'google',
          model: 'gemini-3.8-flash',
          apiKey: 'snapshot-key',
          thinking: 'high',
        }),
        'user-123',
      );
    });
  });

  describe('Chat model picker', () => {
    const enableOpenai = () => {
      useLLMSettingsStore().llm.keys.openai = 'test-openai-key';
    };

    it('seeds the Settings default model into a fresh chat on mount', async () => {
      mountComponent();
      await flushPromises();
      const chatStore = useChatStore();
      expect(chatStore.activeModel).toEqual({
        provider: 'google',
        model: 'gemini-3.8-flash',
      });
    });

    // The mount-time seed can read the unhydrated emptyLlm default when the
    // session exists but auth.user has not landed yet. Hydration leaves
    // getUserId() unchanged, so the identity watcher never reseeds — the
    // default-model watcher must follow the arriving preference instead.
    const hydratedUser = () =>
      createMockUser({
        preferences: {
          dailyGoal: 20,
          difficulty: 'Beginner' as const,
          notifications: false,
          llm: {
            keys: { openai: 'test-openai-key' },
            thinking: {},
            defaultModel: { provider: 'openai', model: 'gpt-6.1-sol' },
          },
        },
      });

    it('reseeds an untouched fresh chat when the hydrated default arrives', async () => {
      const authStore = useAuthStore();
      authStore.user = null; // session remains; llm falls back to emptyLlm
      await flushPromises();
      mountComponent();
      await flushPromises();
      const chatStore = useChatStore();
      expect(chatStore.activeModel).toEqual({ provider: 'google', model: 'gemini-3.8-flash' });

      authStore.user = hydratedUser();
      await flushPromises();

      expect(chatStore.activeModel).toEqual(openaiPair);
    });

    it('keeps an explicit model pick when the hydrated default arrives', async () => {
      const authStore = useAuthStore();
      authStore.user = null;
      await flushPromises();
      mountComponent();
      await flushPromises();
      const chatStore = useChatStore();
      await chooseModel('openai::gpt-6.1-sol');
      expect(chatStore.activeModel).toEqual(openaiPair);

      authStore.user = hydratedUser();
      await flushPromises();

      expect(chatStore.activeModel).toEqual(openaiPair);
    });

    it('keeps the seeded model for a started turn when the hydrated default arrives', async () => {
      const authStore = useAuthStore();
      authStore.user = null;
      await flushPromises();
      // The seeded default needs a key or the send is blocked before any
      // message is added.
      useLLMSettingsStore().llm.keys.google = 'test-google-key';
      // A failed first save leaves isPersistedThread false: only the user
      // turn's presence may veto the reseed.
      saveFailures.user = true;
      mountComponent();
      await flushPromises();
      const chatStore = useChatStore();
      mockLLMResponse();
      await sendMessage('started turn');
      await flushPromises();
      expect(chatStore.messages.some((m) => m.type === 'user')).toBe(true);
      expect(chatStore.isPersistedThread).toBe(false);

      authStore.user = hydratedUser();
      await flushPromises();

      expect(chatStore.activeModel).toEqual({ provider: 'google', model: 'gemini-3.8-flash' });
    });

    it('preserves the active model and transcript when navigating away and back', async () => {
      enableOpenai();
      mountComponent();
      await flushPromises();
      await chooseModel('openai::gpt-6.1-sol');
      const chatStore = useChatStore();
      chatStore.addMessage({ type: 'user', content: 'persisted across nav' });

      wrapper!.unmount();
      wrapper = null;
      mountComponent();
      await flushPromises();

      expect(chatStore.activeModel).toEqual(openaiPair);
      expect(chatStore.messages.some((m) => m.content === 'persisted across nav')).toBe(true);
    });

    it('restores the stored model, cache timestamp and persistence when selecting a saved thread', async () => {
      threadRows = [
        createMockThread({ ThreadId: 'thread-1', model: anthropicRow, lastLlmAt: 1700000000000 }),
      ];
      messageRows = [createMockMessage('Hello', true)];
      mountComponent();
      await flushPromises();

      await wrapper.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await flushPromises();

      const chatStore = useChatStore();
      expect(chatStore.activeModel).toEqual(anthropicRow);
      expect(chatStore.cacheStartedAt).toBe(1700000000000);
      expect(chatStore.isPersistedThread).toBe(true);
      // The stored provider has no key in this test: the picker must show the
      // unavailable-current option instead of silently substituting a model.
      expect(wrapper.find('[data-testid="chat-model-unavailable"]').exists()).toBe(true);
    });

    it('clears the ephemeral thinking choice when selecting a thread', async () => {
      threadRows = [createMockThread({ ThreadId: 'thread-1' })];
      messageRows = [createMockMessage('Hello', true)];
      mountComponent();
      await flushPromises();
      const chatStore = useChatStore();
      chatStore.setThinkingOverride('high');

      await wrapper.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await flushPromises();

      expect(chatStore.thinkingOverride).toBeNull();
    });

    it('carries the active model on the first user save', async () => {
      mountComponent();
      await flushPromises();
      mockLLMResponse();

      await sendMessage('pin my model');
      await flushPromises();

      const userSave = saveBodies.find((body) => body.is_user === true);
      expect(userSave).toBeDefined();
      expect(userSave!.model).toEqual({ provider: 'google', model: 'gemini-3.8-flash' });
    });

    it('updates the model locally without PATCH before the first save despite a non-null chat id', async () => {
      enableOpenai();
      mountComponent();
      await flushPromises();
      const chatStore = useChatStore();
      // New chats already carry a client UUID that is NOT a saved row.
      expect(chatStore.chatId).not.toBeNull();
      expect(chatStore.isPersistedThread).toBe(false);

      await chooseModel('openai::gpt-6.1-sol');

      expect(patchFetches().length).toBe(0);
      expect(chatStore.activeModel).toEqual(openaiPair);
    });

    it('PATCHes the model after a successful save even when the thread list is stale', async () => {
      enableOpenai();
      mountComponent();
      await flushPromises();
      mockLLMResponse();
      await sendMessage('persist me');
      await flushPromises();
      const chatStore = useChatStore();
      expect(chatStore.isPersistedThread).toBe(true);

      // The sidebar refetch lags the successful save: the row is absent from
      // the query cache, yet the persistence flag still unlocks the PATCH.
      listThreadsOverride = [];
      await chooseModel('openai::gpt-6.1-sol');

      expect(patchFetches().length).toBe(1);
      expect(chatStore.activeModel).toEqual(openaiPair);
    });

    it('keeps model changes local when the first user save failed', async () => {
      enableOpenai();
      saveFailures.user = true;
      mountComponent();
      await flushPromises();
      mockLLMResponse();
      await sendMessage('save fails');
      await flushPromises();
      const chatStore = useChatStore();
      expect(chatStore.isPersistedThread).toBe(false);

      await chooseModel('openai::gpt-6.1-sol');

      expect(patchFetches().length).toBe(0);
      expect(chatStore.activeModel).toEqual(openaiPair);
    });

    it('rolls back the active model when a saved-thread PATCH fails', async () => {
      enableOpenai();
      threadRows = [createMockThread({ ThreadId: 'thread-1', model: anthropicRow })];
      messageRows = [createMockMessage('Hello', true)];
      mountComponent();
      await flushPromises();
      await wrapper.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await flushPromises();
      const chatStore = useChatStore();
      expect(chatStore.activeModel).toEqual(anthropicRow);

      patchFails = true;
      await chooseModel('openai::gpt-6.1-sol');

      expect(patchFetches().length).toBe(1);
      expect(chatStore.activeModel).toEqual(anthropicRow);
      expect(notifyCreateSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'negative' }));
    });

    it('locks model edits and sending while a model PATCH is pending', async () => {
      enableOpenai();
      threadRows = [createMockThread({ ThreadId: 'thread-1' })];
      messageRows = [createMockMessage('Hello', true)];
      mountComponent();
      await flushPromises();
      await wrapper.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await flushPromises();

      const patchDeferred = deferred();
      patchDelay = patchDeferred.promise;
      await chooseModel('openai::gpt-6.1-sol');

      expect(modelSelect()!.props('disable')).toBe(true);
      expect(
        (wrapper.find('[data-testid="llm-chat-input"]').element as HTMLInputElement).disabled,
      ).toBe(true);

      patchDeferred.resolve();
      await flushPromises();

      expect(useChatStore().activeModel).toEqual(openaiPair);
      expect(modelSelect()!.props('disable')).toBe(false);
      expect(
        (wrapper.find('[data-testid="llm-chat-input"]').element as HTMLInputElement).disabled,
      ).toBe(false);
    });

    it('disables the sidebar and refuses reselection while a delayed model PATCH is pending, then fails without rollback', async () => {
      enableOpenai();
      threadRows = [createMockThread({ ThreadId: 'thread-1', model: anthropicRow })];
      messageRows = [createMockMessage('Hello', true)];
      mountComponent();
      await flushPromises();
      await wrapper.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await flushPromises();
      const chatStore = useChatStore();
      const messageFetchesBefore = messageFetches().length;

      const patchDeferred = deferred();
      patchDelay = patchDeferred.promise;
      patchFails = true; // the PATCH fails once it resolves
      await chooseModel('openai::gpt-6.1-sol');

      expect(wrapper.findComponent({ name: 'ChatSidebar' }).props('disabled')).toBe(true);

      // Reselecting the same thread while the PATCH is pending must not
      // install the stored row and must not bypass the pending transition.
      await wrapper.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await flushPromises();
      expect(messageFetches().length).toBe(messageFetchesBefore);
      expect(chatStore.chatId).toBe('thread-1');
      expect(chatStore.activeModel).toEqual(anthropicRow);
      expect(chatStore.modelPatchPending).toBe(true);

      patchDeferred.resolve();
      await flushPromises();

      expect(patchFetches().length).toBe(1);
      expect(chatStore.activeModel).toEqual(anthropicRow);
      expect(chatStore.modelPatchPending).toBe(false);
      expect(notifyCreateSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'negative' }));
    });

    it('does not let a selection that lands during a model PATCH install over the patched model', async () => {
      enableOpenai();
      threadRows = [
        createMockThread({ ThreadId: 'thread-1' }),
        createMockThread({ ThreadId: 'thread-2', model: anthropicRow }),
      ];
      messageRows = [
        createMockMessage('one', true, 0, 'thread-1'),
        createMockMessage('two', true, 0, 'thread-2'),
      ];
      mountComponent();
      await flushPromises();
      await wrapper.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await flushPromises();
      expect(useChatStore().chatId).toBe('thread-1');

      // Start selecting thread-2 but hold its history fetch.
      const selectionDeferred = deferred();
      messagesDelays['thread-2'] = selectionDeferred.promise;
      await wrapper.findAll('[data-testid="llm-chat-thread-item"]')[1]!.trigger('click');
      await flushPromises();

      // Start a model PATCH for thread-1 while the selection is in flight.
      const patchDeferred = deferred();
      patchDelay = patchDeferred.promise;
      await chooseModel('openai::gpt-6.1-sol');
      expect(patchFetches().length).toBe(1);

      selectionDeferred.resolve();
      await flushPromises();
      const chatStore = useChatStore();
      // The operation-generation stale check must discard the delayed
      // selection instead of installing thread-2's stored model.
      expect(chatStore.chatId).toBe('thread-1');
      expect(chatStore.activeModel).not.toEqual(anthropicRow);
      expect(chatStore.modelPatchPending).toBe(true);

      patchDeferred.resolve();
      await flushPromises();
      expect(chatStore.activeModel).toEqual(openaiPair);
      expect(chatStore.modelPatchPending).toBe(false);
    });

    it('keeps a pending model PATCH locked across a remount until it resolves', async () => {
      enableOpenai();
      threadRows = [createMockThread({ ThreadId: 'thread-1' })];
      messageRows = [createMockMessage('Hello', true)];
      mountComponent();
      await flushPromises();
      await wrapper.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await flushPromises();

      const patchDeferred = deferred();
      patchDelay = patchDeferred.promise;
      await chooseModel('openai::gpt-6.1-sol');

      // Route remount while the PATCH is still in flight: the replacement
      // page must inherit the pending lock from the shared store.
      wrapper!.unmount();
      wrapper = null;
      mountComponent();
      await flushPromises();

      const chatStore = useChatStore();
      expect(chatStore.modelPatchPending).toBe(true);
      expect(modelSelect()!.props('disable')).toBe(true);
      expect(
        (wrapper.find('[data-testid="llm-chat-input"]').element as HTMLInputElement).disabled,
      ).toBe(true);
      expect(wrapper.findComponent({ name: 'ChatSidebar' }).props('disabled')).toBe(true);

      patchDeferred.resolve();
      await flushPromises();

      expect(chatStore.activeModel).toEqual(openaiPair);
      expect(chatStore.modelPatchPending).toBe(false);
      expect(modelSelect()!.props('disable')).toBe(false);
    });

    it('sends the new provider, key and complete history after a mid-chat model change', async () => {
      enableOpenai();
      mountComponent();
      await flushPromises();
      mockLLMResponse();
      await sendMessage('first question');
      await flushPromises();
      await chooseModel('openai::gpt-6.1-sol');
      await sendMessage('second question');
      await flushPromises();

      const calls = vi.mocked(llmModule.llmClient.generate).mock.calls;
      expect(calls.length).toBe(2);
      const second = calls[1]![0];
      expect(second.provider).toBe('openai');
      expect(second.model).toBe('gpt-6.1-sol');
      expect(second.apiKey).toBe('test-openai-key');
      // Greeting + user1 + ai1 + user2: the transcript is fully preserved.
      expect(second.messages.map((m) => m.role)).toEqual([
        'assistant',
        'user',
        'assistant',
        'user',
      ]);
      expect(second.messages.some((m) => m.content === 'first question')).toBe(true);
      expect(second.messages.some((m) => m.content === 'AI response')).toBe(true);
      expect(second.messages.some((m) => m.content === 'second question')).toBe(true);
    });

    it('sends an explicit thinking override and clears it when the model changes', async () => {
      enableOpenai();
      mockLLMResponse();
      mountComponent();
      await flushPromises();
      const chatStore = useChatStore();
      chatStore.setThinkingOverride('low');

      await sendMessage('thinking check');
      await flushPromises();

      expect(vi.mocked(llmModule.llmClient.generate).mock.calls[0]![0].thinking).toBe('low');

      await chooseModel('openai::gpt-6.1-sol');
      expect(chatStore.thinkingOverride).toBeNull();
    });

    it('resolves key and saved effort right before generation when Settings change mid-send', async () => {
      const saveDeferred = deferred();
      saveDelay = saveDeferred.promise;
      mountComponent();
      await flushPromises();
      mockLLMResponse();

      await sendMessage('settings drift');
      await flushPromises();
      expect(saveFetches().length).toBe(1);

      // Settings edits while the awaited user save is still in flight.
      const llmSettingsStore = useLLMSettingsStore();
      llmSettingsStore.llm.keys.google = 'rotated-key';
      llmSettingsStore.llm.thinking['gemini-3.8-flash'] = 'high';

      saveDeferred.resolve();
      await flushPromises();

      const payload = vi.mocked(llmModule.llmClient.generate).mock.calls[0]![0];
      expect(payload.apiKey).toBe('rotated-key');
      expect(payload.thinking).toBe('high');
    });

    it('blocks sending when the stored model id is unavailable despite a provider key', async () => {
      threadRows = [
        createMockThread({
          ThreadId: 'thread-1',
          model: { provider: 'google', model: 'retired-model' },
        }),
      ];
      messageRows = [createMockMessage('Hello', true)];
      mountComponent();
      await flushPromises();
      await wrapper.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await flushPromises();
      const chatStore = useChatStore();
      const retiredPair = { provider: 'google' as const, model: 'retired-model' };
      expect(chatStore.activeModel).toEqual(retiredPair);
      expect(wrapper.find('[data-testid="chat-model-unavailable"]').exists()).toBe(true);
      mockLLMResponse();

      await sendMessage('send into a retired model');
      await flushPromises();

      expect(llmModule.llmClient.generate).not.toHaveBeenCalled();
      expect(saveFetches().length).toBe(0);
      expect(notifyCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'warning',
          message: expect.stringContaining('no longer available'),
        }),
      );
      // The unusable selection stays visible; nothing silently substituted.
      expect(chatStore.activeModel).toEqual(retiredPair);
      expect(wrapper.find('[data-testid="chat-model-unavailable"]').exists()).toBe(true);
    });

    it('blocks sending without a user key or confirmed server key and hints at settings', async () => {
      const llmSettingsStore = useLLMSettingsStore();
      llmSettingsStore.llm = {
        keys: {},
        thinking: {},
        defaultModel: { provider: 'google', model: 'gemini-3.8-flash' },
      };
      vi.mocked(llmModule.llmClient.capabilities).mockRejectedValue(new Error('down'));
      // Re-establish the send spy: prior restores leave the factory vi.fn
      // non-recording, matching the file's other send-assertion tests.
      mockLLMResponse();
      mountComponent();
      await flushPromises();

      await sendMessage('blocked');
      await flushPromises();

      expect(llmModule.llmClient.generate).not.toHaveBeenCalled();
      expect(saveFetches().length).toBe(0);
      expect(notifyCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'warning',
          message: expect.stringContaining('No API key for Google'),
        }),
      );
    });

    it('rechecks key availability before generate when the key is removed during the awaited save', async () => {
      const llmSettingsStore = useLLMSettingsStore();
      llmSettingsStore.llm = {
        keys: { anthropic: 'test-anthropic-key' },
        thinking: {},
        defaultModel: { provider: 'anthropic', model: 'claude-opus-5-5' },
      };
      // Only Google is server-key eligible: it must not authorize Anthropic.
      vi.mocked(llmModule.llmClient.capabilities).mockResolvedValue({
        serverKeyProviders: ['google'],
      });
      mockLLMResponse();
      mountComponent();
      await flushPromises();

      const saveGate = deferred<void>();
      saveDelay = saveGate.promise;
      const sendPromise = sendMessage('key removed mid-save');
      await flushPromises();
      // Removal (not rotation) while the user save is in flight.
      delete llmSettingsStore.llm.keys.anthropic;
      saveGate.resolve();
      await sendPromise;
      await flushPromises();

      expect(llmModule.llmClient.generate).not.toHaveBeenCalled();
      expect(notifyCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'warning',
          message: expect.stringContaining('No API key for Anthropic'),
        }),
      );
      expect(saveBodies.some((b) => b.is_user === true)).toBe(true);
      expect(saveBodies.some((b) => b.is_user === false)).toBe(false);
      expect(useChatStore().isLoading).toBe(false);
    });

    it('sends without a user key when capabilities confirm the server key', async () => {
      const llmSettingsStore = useLLMSettingsStore();
      llmSettingsStore.llm = {
        keys: {},
        thinking: {},
        defaultModel: { provider: 'google', model: 'gemini-3.8-flash' },
      };
      vi.mocked(llmModule.llmClient.capabilities).mockResolvedValue({
        serverKeyProviders: ['google'],
      });
      mockLLMResponse();
      mountComponent();
      await flushPromises();

      await sendMessage('via server key');
      await flushPromises();

      expect(llmModule.llmClient.generate).toHaveBeenCalledTimes(1);
      const payload = vi.mocked(llmModule.llmClient.generate).mock.calls[0]![0];
      expect(payload.provider).toBe('google');
      expect(payload.model).toBe('gemini-3.8-flash');
      expect(payload.apiKey).toBeUndefined();
    });

    it('resets the model state and reseeds the default on an account switch', async () => {
      mountComponent();
      await flushPromises();
      const chatStore = useChatStore();
      chatStore.setActiveModel(openaiPair);
      chatStore.setThinkingOverride('high');
      chatStore.setCacheStartedAt(123);
      chatStore.setIsPersistedThread(true);

      signIn(createMockUser({ id: 'user-999' }));
      await flushPromises();

      expect(chatStore.activeModel).toEqual({
        provider: 'google',
        model: 'gemini-3.8-flash',
      });
      expect(chatStore.thinkingOverride).toBeNull();
      expect(chatStore.cacheStartedAt).toBeNull();
      expect(chatStore.isPersistedThread).toBe(false);
    });

    it('keeps the selected model but drops cache evidence on a deleted-thread restart', async () => {
      mountComponent();
      await flushPromises();
      mockLLMResponse();
      await sendMessage('first');
      await flushPromises();
      const chatStore = useChatStore();
      chatStore.setCacheStartedAt(555);
      saveNotFoundFor = new Set([chatStore.chatId!]);

      await sendMessage('second');
      await flushPromises();

      expect(chatStore.activeModel).toEqual({
        provider: 'google',
        model: 'gemini-3.8-flash',
      });
      expect(chatStore.cacheStartedAt).toBeNull();
      // The replayed user save re-persists the replacement thread.
      expect(chatStore.isPersistedThread).toBe(true);
      const replaySave = saveBodies.find(
        (body) => body.ThreadId === chatStore.chatId && body.is_user === true,
      );
      expect(replaySave!.model).toEqual({ provider: 'google', model: 'gemini-3.8-flash' });
    });

    it('stacks the header controls on narrow screens and keeps them inline otherwise', () => {
      mountComponent({ narrowScreen: true });
      expect(wrapper.find('.chat-header--stacked').exists()).toBe(true);
      expect(wrapper.find('[data-testid="chat-model-picker"]').exists()).toBe(true);

      wrapper!.unmount();
      wrapper = null;
      mountComponent();
      expect(wrapper.find('.chat-header--stacked').exists()).toBe(false);
      expect(wrapper.find('[data-testid="chat-model-picker"]').exists()).toBe(true);
    });
  });

  describe('Chat cache reminder', () => {
    const T0 = 1_700_000_000_000;

    const anthropicUsage = (overrides: Partial<LlmUsage> = {}): LlmUsage => ({
      inputTokens: 200,
      outputTokens: 50,
      cachedInputTokens: 150,
      cacheWriteTokens: 0,
      ...overrides,
    });

    // spyOn, not vi.mocked().mock*: earlier tests' spyOn+restoreAllMocks cycle
    // leaves generate as a plain function without mock methods.
    const mockLLMResponseWithUsage = (text: string, usage: LlmUsage) => {
      vi.spyOn(llmModule.llmClient, 'generate').mockResolvedValue({ text, usage });
    };

    const enableAnthropic = () => {
      useLLMSettingsStore().llm.keys.anthropic = 'test-anthropic-key';
    };

    const cacheChip = () => wrapper!.find('[data-testid="chat-cache-reminder"]');
    const assistantSaveBody = () => saveBodies.find((b) => b.is_user === false);
    const patchCalls = () =>
      fetchMock.mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
      );

    afterEach(() => {
      vi.useRealTimers();
    });

    // Fake time must be installed before mounting: Quasar's QBtn click path
    // stops dispatching when Date is swapped mid-mounted-component.
    const mountWithFakeTime = (time = T0) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(time);
      mountComponent();
      return flushPromises();
    };

    it('shows the chip and persists the request-start timestamp on positive cached reads', async () => {
      enableAnthropic();
      await mountWithFakeTime();
      await chooseModel('anthropic::claude-opus-5-5');
      mockLLMResponseWithUsage('Cached reply', anthropicUsage());

      await sendMessage('cache me');
      await flushPromises();

      expect(cacheChip().find('[role="timer"]').text()).toBe('Cache likely warm · 5:00 left');
      expect(useChatStore().cacheStartedAt).toBe(T0);
      expect(assistantSaveBody()!.lastLlmAt).toBe(T0);
    });

    it('treats positive cache writes as evidence too', async () => {
      enableAnthropic();
      await mountWithFakeTime();
      await chooseModel('anthropic::claude-opus-5-5');
      mockLLMResponseWithUsage(
        'Write-cached reply',
        anthropicUsage({ cachedInputTokens: 0, cacheWriteTokens: 40 }),
      );

      await sendMessage('write cache');
      await flushPromises();

      expect(cacheChip().exists()).toBe(true);
      expect(assistantSaveBody()!.lastLlmAt).toBe(T0);
    });

    it('omits lastLlmAt and clears a prior timer on a zero-cache response', async () => {
      enableAnthropic();
      await mountWithFakeTime();
      await chooseModel('anthropic::claude-opus-5-5');
      const chatStore = useChatStore();
      chatStore.setCacheStartedAt(T0 - 30_000);
      await flushPromises();
      expect(cacheChip().exists()).toBe(true);
      mockLLMResponseWithUsage(
        'No cache reply',
        anthropicUsage({ cachedInputTokens: 0, cacheWriteTokens: 0 }),
      );

      await sendMessage('zero cache');
      await flushPromises();

      expect(cacheChip().exists()).toBe(false);
      expect(chatStore.cacheStartedAt).toBeNull();
      expect(assistantSaveBody()).toBeTruthy();
      expect('lastLlmAt' in assistantSaveBody()!).toBe(false);
    });

    it('keeps the previous estimate and synthesizes no evidence when the request errors', async () => {
      enableAnthropic();
      await mountWithFakeTime();
      await chooseModel('anthropic::claude-opus-5-5');
      const chatStore = useChatStore();
      chatStore.setCacheStartedAt(T0 - 30_000);
      vi.spyOn(llmModule.llmClient, 'generate').mockRejectedValue(new Error('provider down'));

      await sendMessage('boom');
      await flushPromises();

      expect(chatStore.cacheStartedAt).toBe(T0 - 30_000);
      expect(cacheChip().exists()).toBe(true);
      expect(saveBodies.some((b) => b.is_user === false)).toBe(false);
      expect(chatStore.error).toContain('provider down');
    });

    it('keeps a local chip but claims no durable marker when the assistant save fails', async () => {
      enableAnthropic();
      // The cached summary already carries durable evidence: a failed save
      // must leave it untouched while the local chip reflects the response.
      const priorEvidence = T0 - 60_000;
      threadRows = [
        createMockThread({
          ThreadId: 't-1',
          title: 'Persisted',
          model: anthropicRow,
          lastLlmAt: priorEvidence,
        }),
      ];
      await mountWithFakeTime();
      await wrapper.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await flushPromises();
      expect(useChatStore().cacheStartedAt).toBe(priorEvidence);
      saveFailures.assistant = true;
      mockLLMResponseWithUsage('Unsaved reply', anthropicUsage());

      await sendMessage('local only');
      await flushPromises();

      expect(useChatStore().cacheStartedAt).toBe(T0);
      expect(cacheChip().exists()).toBe(true);
      const cached = queryClient.getQueryData<ChatThreadSummaryDTO[]>(chatKeys.threads('user-123'));
      expect(cached?.find((t) => t.ThreadId === 't-1')?.lastLlmAt).toBe(priorEvidence);
      expect(notifyCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'warning', message: 'Failed to save chat history' }),
      );
    });

    // Regression: the user-save list refresh reads the row before the
    // assistant transaction. A GET still in flight at save success is
    // cancelled and replaced, so its pre-commit snapshot can never overwrite
    // the freshly persisted evidence.
    const sendWithDelayedThreadList = async (
      usage: LlmUsage,
      text: string,
    ): Promise<{ resolveList: () => void }> => {
      const listGate = deferred<void>();
      listDelay = listGate.promise;
      mockLLMResponseWithUsage('Delayed refresh reply', usage);
      await sendMessage(text);
      await flushPromises();
      return { resolveList: () => listGate.resolve() };
    };

    it('keeps the persisted timestamp when a delayed thread-list GET lands after the assistant save', async () => {
      enableAnthropic();
      threadRows = [
        createMockThread({
          ThreadId: 't-1',
          title: 'Persisted',
          model: anthropicRow,
          lastLlmAt: T0 - 120_000,
        }),
      ];
      await mountWithFakeTime();
      await wrapper.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await flushPromises();

      const { resolveList } = await sendWithDelayedThreadList(anthropicUsage(), 'cache me');
      resolveList();
      await flushPromises();

      const cached = queryClient.getQueryData<ChatThreadSummaryDTO[]>(chatKeys.threads('user-123'));
      expect(cached?.find((t) => t.ThreadId === 't-1')?.lastLlmAt).toBe(T0);
      expect(useChatStore().cacheStartedAt).toBe(T0);
    });

    it('keeps a cleared timestamp when a delayed thread-list GET lands after the assistant save', async () => {
      enableAnthropic();
      threadRows = [
        createMockThread({
          ThreadId: 't-1',
          title: 'Persisted',
          model: anthropicRow,
          lastLlmAt: T0 - 60_000,
        }),
      ];
      await mountWithFakeTime();
      await wrapper.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await flushPromises();

      const { resolveList } = await sendWithDelayedThreadList(
        anthropicUsage({ cachedInputTokens: 0, cacheWriteTokens: 0 }),
        'zero cache',
      );
      resolveList();
      await flushPromises();

      const cached = queryClient.getQueryData<ChatThreadSummaryDTO[]>(chatKeys.threads('user-123'));
      expect(cached?.find((t) => t.ThreadId === 't-1')?.lastLlmAt).toBeUndefined();
      expect(useChatStore().cacheStartedAt).toBeNull();
      expect(cacheChip().exists()).toBe(false);
    });

    it('preserves evidence on a newly created thread when its first list GET lands late', async () => {
      enableAnthropic();
      await mountWithFakeTime();
      await chooseModel('anthropic::claude-opus-5-5');

      const { resolveList } = await sendWithDelayedThreadList(anthropicUsage(), 'first turn');
      resolveList();
      await flushPromises();

      const cached = queryClient.getQueryData<ChatThreadSummaryDTO[]>(chatKeys.threads('user-123'));
      const row = cached?.find((t) => t.title === 'first turn');
      expect(row).toBeTruthy();
      expect(row?.lastLlmAt).toBe(T0);
      expect(useChatStore().cacheStartedAt).toBe(T0);
    });

    it('records the request-start time, not the completion time, as cache evidence', async () => {
      enableAnthropic();
      await mountWithFakeTime();
      await chooseModel('anthropic::claude-opus-5-5');
      const gen = deferred<{ text: string; usage: LlmUsage }>();
      vi.spyOn(llmModule.llmClient, 'generate').mockImplementation(() => gen.promise);

      await sendMessage('slow provider');
      await flushPromises();
      vi.setSystemTime(T0 + 5000);
      gen.resolve({ text: 'Slow reply', usage: anthropicUsage() });
      await flushPromises();

      expect(assistantSaveBody()!.lastLlmAt).toBe(T0);
      expect(useChatStore().cacheStartedAt).toBe(T0);
    });

    it('hides the chip and omits lastLlmAt for Gemini even with positive usage', async () => {
      await mountWithFakeTime();
      mockLLMResponseWithUsage('Gemini reply', anthropicUsage({ cachedInputTokens: 999 }));

      await sendMessage('google cache');
      await flushPromises();

      expect(cacheChip().exists()).toBe(false);
      expect(useChatStore().cacheStartedAt).toBeNull();
      expect(assistantSaveBody()).toBeTruthy();
      expect('lastLlmAt' in assistantSaveBody()!).toBe(false);
    });

    it('restores a recent persisted window on thread selection and hides a stale historical one', async () => {
      threadRows = [
        createMockThread({ ThreadId: 'thread-1', model: anthropicRow, lastLlmAt: T0 - 60_000 }),
        createMockThread({ ThreadId: 'thread-2', model: anthropicRow, lastLlmAt: T0 - 601_000 }),
      ];
      messageRows = [createMockMessage('Hello', true)];
      await mountWithFakeTime();

      await wrapper.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await flushPromises();
      expect(cacheChip().find('[role="timer"]').text()).toBe('Cache likely warm · 4:00 left');
      expect(useChatStore().cacheStartedAt).toBe(T0 - 60_000);

      await wrapper.findAll('[data-testid="llm-chat-thread-item"]')[1]!.trigger('click');
      await flushPromises();
      // Display-only hide: the stored timestamp survives for the record.
      expect(cacheChip().exists()).toBe(false);
      expect(useChatStore().cacheStartedAt).toBe(T0 - 601_000);
    });

    it('clears the timer on a saved-thread model change without an extra PATCH or stale optimistic timestamp', async () => {
      enableAnthropic();
      useLLMSettingsStore().llm.keys.openai = 'test-openai-key';
      threadRows = [
        createMockThread({ ThreadId: 'thread-1', model: anthropicRow, lastLlmAt: T0 - 60_000 }),
      ];
      messageRows = [createMockMessage('Hello', true)];
      await mountWithFakeTime();
      await wrapper.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await flushPromises();
      expect(cacheChip().exists()).toBe(true);

      await chooseModel('openai::gpt-6.1-sol');
      await flushPromises();

      expect(cacheChip().exists()).toBe(false);
      expect(useChatStore().cacheStartedAt).toBeNull();
      expect(patchCalls()).toHaveLength(1);
      const patchBody = JSON.parse(String((patchCalls()[0]![1] as RequestInit).body));
      expect(patchBody.model).toEqual(openaiPair);
      expect('lastLlmAt' in patchBody).toBe(false);
      const threads = queryClient.getQueryData<ChatThreadSummaryDTO[]>(
        chatKeys.threads('user-123'),
      );
      expect(threads!.find((t) => t.ThreadId === 'thread-1')!.lastLlmAt).toBeUndefined();
    });

    it('keeps the chip across route navigation away and back', async () => {
      enableAnthropic();
      await mountWithFakeTime();
      await chooseModel('anthropic::claude-opus-5-5');
      mockLLMResponseWithUsage('Nav reply', anthropicUsage());
      await sendMessage('persist me');
      await flushPromises();
      expect(cacheChip().exists()).toBe(true);

      wrapper!.unmount();
      wrapper = null;
      mountComponent();
      await flushPromises();

      expect(cacheChip().find('[role="timer"]').text()).toBe('Cache likely warm · 5:00 left');
    });

    it('replays the user model and this response\u0027s evidence when the assistant save hits a deleted thread', async () => {
      enableAnthropic();
      await mountWithFakeTime();
      await chooseModel('anthropic::claude-opus-5-5');
      const chatStore = useChatStore();
      chatStore.setChatId('dead-thread');
      // Stale evidence from the doomed thread must not survive the restart.
      chatStore.setCacheStartedAt(T0 - 10 * 60 * 1000);
      const gen = deferred<{ text: string; usage: LlmUsage }>();
      vi.spyOn(llmModule.llmClient, 'generate').mockImplementation(() => gen.promise);

      await sendMessage('recover me');
      await flushPromises();
      // The user save landed; now the deleted thread also eats the assistant save.
      saveNotFoundFor.add('dead-thread');
      gen.resolve({ text: 'Recovered reply', usage: anthropicUsage() });
      await flushPromises();

      const freshId = chatStore.chatId!;
      expect(freshId).not.toBe('dead-thread');
      const freshUser = saveBodies.find((b) => b.ThreadId === freshId && b.is_user === true);
      expect(freshUser!.model).toEqual(anthropicRow);
      const freshAssistant = saveBodies.find((b) => b.ThreadId === freshId && b.is_user === false);
      expect(freshAssistant!.lastLlmAt).toBe(T0);
      expect(chatStore.cacheStartedAt).toBe(T0);
      expect(cacheChip().find('[role="timer"]').text()).toBe('Cache likely warm · 5:00 left');
    });
  });

  describe('Message Rendering', () => {
    it('should render user messages', async () => {
      const chatStore = useChatStore();
      chatStore.addMessage({ type: 'user', content: 'User message' });

      mountComponent();
      await wrapper.vm.$nextTick();

      const messages = wrapper.findAllComponents({ name: 'QChatMessage' });
      const userMessage = messages.find((m) => m.props('sent') === true);

      expect(userMessage?.exists()).toBe(true);
    });

    it('should render AI messages', async () => {
      const chatStore = useChatStore();
      chatStore.addMessage({ type: 'ai', content: 'AI message' });

      mountComponent();
      await wrapper.vm.$nextTick();

      const messages = wrapper.findAllComponents({ name: 'QChatMessage' });
      const aiMessage = messages.find((m) => m.props('sent') === false);

      expect(aiMessage?.exists()).toBe(true);
    });

    it('should display message timestamps', async () => {
      const chatStore = useChatStore();
      chatStore.addMessage({ type: 'user', content: 'Test' });

      mountComponent();
      await wrapper.vm.$nextTick();

      const message = wrapper.findComponent({ name: 'QChatMessage' });
      expect(message.props('stamp')).toBeTruthy();
    });

    it('should render multiple messages in order', async () => {
      const chatStore = useChatStore();
      chatStore.addMessage({ type: 'user', content: 'First message' });
      chatStore.addMessage({ type: 'ai', content: 'Second message' });
      chatStore.addMessage({ type: 'user', content: 'Third message' });

      mountComponent();
      await wrapper.vm.$nextTick();

      const messages = wrapper.findAllComponents({ name: 'QChatMessage' });
      expect(messages.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Markdown Rendering', () => {
    it('should render AI messages with markdown', async () => {
      const chatStore = useChatStore();
      chatStore.addMessage({ type: 'ai', content: '**Bold text**' });

      mountComponent();
      await wrapper.vm.$nextTick();

      const aiMessages = wrapper.findAll('.ai-message');
      expect(aiMessages.length).toBeGreaterThan(0);
    });

    it('should not render user messages with markdown', async () => {
      const chatStore = useChatStore();
      chatStore.addMessage({ type: 'user', content: '**Bold text**' });

      mountComponent();
      await wrapper.vm.$nextTick();

      const userMessages = wrapper.findAll('.user-message');
      expect(userMessages.length).toBeGreaterThan(0);
    });
  });

  describe('Keyboard Shortcuts', () => {
    it('should send message on Enter key', async () => {
      mockLLMResponse();

      mountComponent();
      const chatStore = useChatStore();
      const input = wrapper.find('[data-testid="llm-chat-input"]');

      await input.setValue('Test message');
      await input.trigger('keydown', { key: 'Enter' });
      await flushPromises();

      const messages = chatStore.messages;
      expect(messages.some((m) => m.content === 'Test message' && m.type === 'user')).toBe(true);
    });
  });

  describe('UI Components', () => {
    it('should have chat container element', () => {
      mountComponent();
      const container = wrapper.find('.chat-container');
      expect(container.exists()).toBe(true);
    });

    it('should have proper data-testid attributes', () => {
      mountComponent();

      expect(wrapper.find('[data-testid="ai-chat-page"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="llm-chat-new"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="chat-sidebar"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="llm-chat-input"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="llm-chat-send"]').exists()).toBe(true);
    });

    it('should show button icons', () => {
      mountComponent();
      const icons = wrapper.findAllComponents({ name: 'QIcon' });
      expect(icons.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should handle thread list failure without crashing', async () => {
      listFails = true;

      mountComponent();
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.text()).toContain('Failed to load conversations');
    });

    it('should handle missing auth token gracefully', async () => {
      // Mock a session with missing tokens
      vi.mocked(awsAmplify.fetchAuthSession).mockResolvedValue({
        tokens: undefined,
      } as Awaited<ReturnType<typeof awsAmplify.fetchAuthSession>>);
      mockLLMResponse('Reply despite auth error');

      mountComponent();
      await flushPromises();

      const chatStore = useChatStore();
      await sendMessage('Message with no token');
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
      expect(notifyCreateSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning' }));
      expect(chatStore.messages.some((m) => m.content === 'Reply despite auth error')).toBe(true);
    });
  });

  describe('Chat Session Management', () => {
    it('should create chat ID when sending first message', async () => {
      const chatStore = useChatStore();
      chatStore.setChatId(null);

      mockLLMResponse();

      mountComponent();
      await sendMessage('First message');
      await flushPromises();

      expect(chatStore.chatId).toBeTruthy();
    });

    it('should save messages to history', async () => {
      mockLLMResponse();

      mountComponent();
      await sendMessage('Test message');
      await flushPromises();

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/chat-history/save'),
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });
  });

  // Regression coverage for the residual cache-evidence races investigated at
  // 22f04f1 (.superpowers/sdd/2026-11-10-hpa758-chat-model-picker-cache-reminder/
  // residual-findings.md). Production code cancels any in-flight list GET at
  // each confirmed write (assistant save, model PATCH) and re-applies the
  // confirmed response to the cache, superseding stale snapshots with exactly
  // one replacement GET when a fetch was actually cancelled, so every test
  // below states the expected behavior.
  describe('Assistant cache evidence: same-client race regressions', () => {
    const T0 = 1_700_000_000_000;

    const anthropicUsage = (overrides: Partial<LlmUsage> = {}): LlmUsage => ({
      inputTokens: 200,
      outputTokens: 50,
      cachedInputTokens: 150,
      cacheWriteTokens: 0,
      ...overrides,
    });

    const mockLLMResponseWithUsage = (text: string, usage: LlmUsage) => {
      vi.spyOn(llmModule.llmClient, 'generate').mockResolvedValue({ text, usage });
    };

    const enableAnthropic = () => {
      useLLMSettingsStore().llm.keys.anthropic = 'test-anthropic-key';
    };

    afterEach(() => {
      vi.useRealTimers();
      // Reset the shared focusManager to its neutral override (undefined =
      // follow real focus events): pinning `false` here would leak into
      // later tests and suppress their window-focus refetches.
      focusManager.setFocused(undefined);
    });

    const mountWithFakeTime = (time = T0) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(time);
      mountComponent();
      return flushPromises();
    };

    const selectPersistedThread = async () => {
      await wrapper.find('[data-testid="llm-chat-thread-item"]').trigger('click');
      await flushPromises();
    };

    const cachedThreads = () =>
      queryClient.getQueryData<ChatThreadSummaryDTO[]>(chatKeys.threads('user-123'));

    const threadRow = (id: string) => cachedThreads()?.find((t) => t.ThreadId === id);

    const persistedThreadSetup = async () => {
      enableAnthropic();
      threadRows = [
        createMockThread({
          ThreadId: 't-1',
          title: 'Persisted',
          model: anthropicRow,
          lastLlmAt: T0 - 120_000,
        }),
      ];
      await mountWithFakeTime();
      await selectPersistedThread();
    };

    // Finding 1A: a second same-client GET whose snapshot predates the
    // assistant transaction but which is still in flight when the save
    // resolves must not revert the persisted evidence. Window-focus refetch,
    // refetch-on-mount and a sidebar retry all enter through this same
    // query-core fetch path: the save cancels it (publication-suppressed)
    // and issues exactly one replacement GET whose post-commit snapshot
    // carries the confirmed evidence.
    it('supersedes a stale mid-flight GET at the assistant save and lands the evidence via the replacement GET', async () => {
      await persistedThreadSetup();

      // Hold generate so the turn stays mid-flight while the second GET starts.
      const gen = deferred<{ text: string; usage: LlmUsage }>();
      vi.spyOn(llmModule.llmClient, 'generate').mockImplementation(() => gen.promise);
      await sendMessage('cache me');
      await flushPromises();
      // At this point the post-user-save refresh has already resolved with its
      // pre-assistant snapshot.

      // A new GET issued while generate is still pending: its snapshot
      // predates the assistant transaction.
      const fetchesBefore = threadFetches().length;
      const gateB = deferred<void>();
      listDelay = gateB.promise;
      void queryClient.refetchQueries({ queryKey: chatKeys.threads('user-123') });
      await flushPromises();
      expect(threadFetches().length).toBe(fetchesBefore + 1);

      gen.resolve({ text: 'Late race reply', usage: anthropicUsage() });
      await flushPromises();
      // The assistant save landed its write; the stale snapshot was
      // cancelled and replaced by a post-commit GET.
      expect(threadRow('t-1')?.lastLlmAt).toBe(T0);

      // Releasing the stale GET's response changes nothing: the cancelled
      // fetch never publishes (retryer revert), and the replacement already
      // published the confirmed value.
      gateB.resolve();
      await flushPromises();

      expect(threadRow('t-1')?.lastLlmAt).toBe(T0);
    });

    // Finding 2a: the deleted-thread restart used to let its list refresh
    // dedupe into the still-pending pre-creation initial GET, so no snapshot
    // containing the replacement row ever reached the cache. The refresh now
    // cancels that GET and replaces it with one issued after the replayed
    // user turn created the row.
    it('restores the replacement thread row with server-derived title and evidence after the pre-creation GET is cancelled', async () => {
      enableAnthropic();
      const gate = deferred<void>();
      listDelay = gate.promise;
      // The initial GET arrives before the thread exists: its snapshot is
      // frozen at request arrival, so it can never carry the row.
      listThreadsOverride = [];
      await mountWithFakeTime();
      // Later GETs must snapshot real rows: their requests arrive after the
      // replayed save commits.
      listThreadsOverride = null;
      await chooseModel('anthropic::claude-opus-5-5');
      mockLLMResponseWithUsage('Recovered reply', anthropicUsage());
      const chatStore = useChatStore();
      chatStore.setChatId('dead-thread');
      saveNotFoundFor.add('dead-thread');

      await sendMessage('recover me');
      await flushPromises();

      const freshId = chatStore.chatId!;
      expect(freshId).not.toBe('dead-thread');
      // The stalled pre-creation GET was cancelled at the user-save refresh;
      // the post-user-save refresh (snapshot without the evidence) was in
      // turn cancelled at the assistant save and replaced by exactly one
      // post-commit GET — stale snapshots are superseded, never deduped
      // into, and the replacement is the only extra request.
      expect(threadFetches().length).toBe(3);
      // The assistant save really persisted evidence server-side...
      const freshAssistant = saveBodies.find((b) => b.ThreadId === freshId && b.is_user === false);
      expect(freshAssistant?.lastLlmAt).toBe(T0);

      // Releasing the stall lets the replacement GET — whose arrival-time
      // snapshot postdates row creation — land the row and the evidence.
      gate.resolve();
      await flushPromises();

      const row = threadRow(freshId);
      expect(row?.title).toBe('recover me'); // server-derived title
      expect(row?.lastLlmAt).toBe(T0);
    });

    // Finding 2b: while the initial list GET was still pending (no cached
    // data), the post-save invalidation deduped into it (Query.fetch returns
    // the in-flight promise when state.data is undefined), so the
    // pre-creation snapshot was all the cache ever received.
    it('inserts the first thread row with evidence via the post-creation replacement GET instead of the pending pre-creation snapshot', async () => {
      enableAnthropic();
      const gate = deferred<void>();
      listDelay = gate.promise;
      // The initial GET arrives before the thread exists: its snapshot is
      // frozen at request arrival, so it can never carry the row.
      listThreadsOverride = [];
      await mountWithFakeTime();
      // Later GETs must snapshot real rows: their requests arrive after the
      // first turn's save commits.
      listThreadsOverride = null;
      await chooseModel('anthropic::claude-opus-5-5');
      mockLLMResponseWithUsage('First turn reply', anthropicUsage());

      await sendMessage('first turn');
      await flushPromises();

      // The pending pre-creation initial GET was cancelled at the user-save
      // refresh; its post-creation replacement was cancelled at the
      // assistant save and replaced by exactly one post-commit GET.
      expect(threadFetches().length).toBe(3);

      gate.resolve();
      await flushPromises();

      const row = cachedThreads()?.find((t) => t.title === 'first turn');
      expect(row?.title).toBe('first turn'); // server-derived title
      expect(row?.lastLlmAt).toBe(T0);
    });

    // Finding 3: TanStack awaits the mutation onSuccess, so an await inside it
    // on a stalled list GET kept mutateAsync pending: the page's finally never
    // ran and the composer/picker/sidebar stayed locked despite a successful
    // assistant save. The onSuccess no longer waits on any GET.
    it('unlocks the page immediately after a successful assistant save even while a list GET stalls', async () => {
      enableAnthropic();
      threadRows = [createMockThread({ ThreadId: 't-1', title: 'Persisted', model: anthropicRow })];
      await mountWithFakeTime();
      await selectPersistedThread();

      const gate = deferred<void>(); // never released: the GET stalls
      listDelay = gate.promise;
      mockLLMResponseWithUsage('Stalled reply', anthropicUsage());
      await sendMessage('stall me');
      await flushPromises();
      await flushPromises();

      const chatStore = useChatStore();
      expect(chatStore.isLoading).toBe(false);
      expect(chatStore.isTyping).toBe(false);
    });

    // Finding 1B: a save callback outliving a session reset must not write
    // evidence over a transition. The mutation-level isStale guard plus the
    // model PATCH's confirmed re-apply keep the timestamp off the
    // re-opened, re-modelled thread.
    it('keeps cache evidence off the thread when a save callback outlives a session reset and a model change', async () => {
      enableAnthropic();
      useLLMSettingsStore().llm.keys.openai = 'test-openai-key';
      threadRows = [
        createMockThread({
          ThreadId: 't-1',
          title: 'Persisted',
          model: anthropicRow,
          lastLlmAt: T0 - 120_000,
        }),
      ];
      messageRows = [createMockMessage('hello', true, 0, 't-1')];
      await mountWithFakeTime();
      await selectPersistedThread();

      const gate = deferred<void>(); // the turn's list refresh stalls
      listDelay = gate.promise;
      mockLLMResponseWithUsage('Deferring reply', anthropicUsage());
      await sendMessage('evidence me');
      await flushPromises();
      // Assistant save resolved; its write landed before any transition.

      // Same-user session reset: generation bump re-runs resetForUser, which
      // clears isLoading while the send continuation is still in flight.
      const chatStore = useChatStore();
      const authStore = useAuthStore();
      authStore.clearAuth();
      signIn();
      await flushPromises();
      expect(chatStore.isLoading).toBe(false); // premature unlock (the enabler)

      // Reopen the thread and change its model while the turn's list refresh
      // is still stalled: the PATCH re-applies the confirmed removal to the
      // cache, so no snapshot can restore the old model's timestamp.
      await wrapper.findAll('[data-testid="llm-chat-thread-item"]')[0]!.trigger('click');
      await flushPromises();
      await chooseModel('openai::gpt-6.1-sol'); // PATCH t-1: model=openai, evidence removed
      await flushPromises();
      expect(threadRow('t-1')?.model).toEqual(openaiPair);
      expect(threadRow('t-1')?.lastLlmAt).toBeUndefined();

      // Releasing the stall lets the PATCH onSettled GET (gated by the same
      // listDelay) land and re-converge the cache to server truth.
      gate.resolve();
      await flushPromises();

      expect(threadRow('t-1')?.lastLlmAt).toBeUndefined();
    });

    // REMOVE counterpart of the mid-flight race: a zero-cache response
    // removes the stored timestamp server-side, and a pre-commit snapshot
    // must not resurrect it — the save cancels the GET and the replacement
    // GET publishes the post-commit truth (no timestamp).
    it('keeps the removed timestamp cleared when an untracked same-client GET lands after a zero-cache assistant save', async () => {
      await persistedThreadSetup();

      const gen = deferred<{ text: string; usage: LlmUsage }>();
      vi.spyOn(llmModule.llmClient, 'generate').mockImplementation(() => gen.promise);
      await sendMessage('clear cache');
      await flushPromises();

      // Untracked GET issued while generate is pending: its snapshot still
      // carries the old timestamp.
      const fetchesBefore = threadFetches().length;
      const gateB = deferred<void>();
      listDelay = gateB.promise;
      void queryClient.refetchQueries({ queryKey: chatKeys.threads('user-123') });
      await flushPromises();
      expect(threadFetches().length).toBe(fetchesBefore + 1);

      gen.resolve({
        text: 'No cache reply',
        usage: anthropicUsage({ cachedInputTokens: 0, cacheWriteTokens: 0 }),
      });
      await flushPromises();
      // The save omitted lastLlmAt: the server transaction REMOVEs it...
      expect('lastLlmAt' in saveBodies.find((b) => b.is_user === false)!).toBe(false);
      // ...and the write cleared the cached timestamp; the stale GET was
      // cancelled and replaced by a post-commit GET.
      expect(threadRow('t-1')?.lastLlmAt).toBeUndefined();

      // Releasing the stale GET's response cannot resurrect the timestamp:
      // the cancelled fetch never publishes, and the replacement already
      // published the confirmed removal.
      gateB.resolve();
      await flushPromises();

      expect(threadRow('t-1')?.lastLlmAt).toBeUndefined();
    });

    // A save resolving after an account switch is a stale operation: it must
    // not write into the previous account's cached list.
    it('suppresses the cache write when the assistant save resolves after an account switch', async () => {
      await persistedThreadSetup();

      const gen = deferred<{ text: string; usage: LlmUsage }>();
      vi.spyOn(llmModule.llmClient, 'generate').mockImplementation(() => gen.promise);
      await sendMessage('account me');
      await flushPromises();
      // Park the send inside generate: the assistant save has not been
      // issued yet.
      const saveGate = deferred<void>();
      saveDelay = saveGate.promise;
      gen.resolve({ text: 'Late reply', usage: anthropicUsage() });
      await flushPromises();
      // The assistant save POST is now in flight.

      // Switch to a different account while the save is in flight.
      const authStore = useAuthStore();
      authStore.clearAuth();
      signIn(createMockUser({ id: 'user-456', email: 'other@example.com', username: 'other' }));
      await flushPromises();

      saveGate.resolve();
      await flushPromises();
      // The save still committed server-side for the original account...
      expect(saveBodies.find((b) => b.is_user === false)?.lastLlmAt).toBe(T0);
      // ...but the stale callback must not touch the previous account's cache.
      expect(threadRow('t-1')?.lastLlmAt).toBe(T0 - 120_000);
    });

    // Window-focus refetches use the same fetch path with cancelRefetch:
    // false, so a focus-triggered GET started mid-turn is superseded at the
    // assistant save exactly like any other same-client GET.
    it('supersedes a mid-turn window-focus refetch at the assistant save', async () => {
      await persistedThreadSetup();

      const gen = deferred<{ text: string; usage: LlmUsage }>();
      vi.spyOn(llmModule.llmClient, 'generate').mockImplementation(() => gen.promise);
      await sendMessage('focus me');
      await flushPromises();

      // A real focus transition refetches the invalidated threads query; gate
      // the GET so its pre-assistant snapshot lands after the save. Mark the
      // query stale without refetching (as after a failed refresh), so the
      // focus event itself is what starts the GET.
      queryClient.invalidateQueries({
        queryKey: chatKeys.threads('user-123'),
        refetchType: 'none',
      });
      focusManager.setFocused(false);
      await flushPromises();
      const fetchesBefore = threadFetches().length;
      const gateB = deferred<void>();
      listDelay = gateB.promise;
      focusManager.setFocused(true);
      await flushPromises();
      expect(threadFetches().length).toBe(fetchesBefore + 1);

      gen.resolve({ text: 'Focus race reply', usage: anthropicUsage() });
      await flushPromises();
      expect(threadRow('t-1')?.lastLlmAt).toBe(T0);

      gateB.resolve();
      await flushPromises();

      expect(threadRow('t-1')?.lastLlmAt).toBe(T0);
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { Quasar, Notify } from 'quasar';
import { VueQueryPlugin, QueryClient } from '@tanstack/vue-query';
import { chatKeys } from '@vela/common';
import AIChatPage from './AIChatPage.vue';
import { useChatStore } from '../../stores/chat';
import { useLLMSettingsStore } from '../../stores/llmSettings';
import { useAuthStore } from '../../stores/auth';
import * as llmModule from '../../services/llm';
import type { LlmResponse } from '@vela/common';
import * as awsAmplify from 'aws-amplify/auth';

// Mock modules
vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn(),
}));

vi.mock('../../services/llm', () => ({
  llmClient: {
    generate: vi.fn(),
    analyzeSentenceStream: vi.fn(),
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
  let deleteDelay: Promise<void> | null;
  let deleteDelayQueue: Array<Promise<void>>;
  let listDelay: Promise<void> | null;
  let messagesDelays: Record<string, Promise<void>>;
  let messagesFailFor: Set<string>;

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
        }
        return Promise.resolve(okJson({ ok: true }));
      }

      if (url.includes('/api/chat-history/threads') && method === 'GET') {
        const respond = () => {
          if (listFails) return errJson();
          const sorted = [...threadRows].sort(
            (a, b) => b.updatedAt - a.updatedAt || a.ThreadId.localeCompare(b.ThreadId),
          );
          return okJson({ threads: sorted });
        };
        return (listDelay ?? Promise.resolve()).then(respond);
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
      keys: {},
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
    deleteDelay = null;
    deleteDelayQueue = [];
    listDelay = null;
    messagesDelays = {};
    messagesFailFor = new Set();

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
      iconSet: {},
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

      await openThreadMenu(0);
      await wrapper.find('[data-testid="llm-chat-delete-thread"]').trigger('click');
      await flushPromises();
      await wrapper.find('[data-testid="llm-chat-confirm-delete"]').trigger('click');
      await flushPromises();
      expect(deleteFetches().length).toBe(1);

      threadRows.push(createMockThread({ ThreadId: 't-1', title: 'Recreated row' }));
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
});

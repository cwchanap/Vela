import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { Quasar, Notify } from 'quasar';
import { VueQueryPlugin, QueryClient } from '@tanstack/vue-query';
import AIChatPage from './AIChatPage.vue';
import { useChatStore } from '../../stores/chat';
import { useLLMSettingsStore } from '../../stores/llmSettings';
import { useAuthStore } from '../../stores/auth';
import * as llmModule from '../../services/llm';
import * as awsAmplify from 'aws-amplify/auth';

// Mock modules
vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn(),
}));

vi.mock('../../services/llm', () => ({
  llmService: {
    generate: vi.fn(),
    setProvider: vi.fn(),
    setModel: vi.fn(),
    setApiKey: vi.fn(),
  },
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

vi.mock('dompurify', () => ({
  default: {
    sanitize: vi.fn((text: string) => text),
    addHook: vi.fn(),
  },
}));

describe('AIChatPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let notifyCreateSpy: ReturnType<typeof vi.fn>;
  let queryClient: QueryClient;

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

    llmSettingsStore.setProvider('google');
    llmSettingsStore.setModel('gemini-2.5-flash-lite');

    authStore.user = null;

    // Create a new QueryClient for each test
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    // Mock fetch
    fetchMock = vi.fn();
    global.fetch = fetchMock;

    // Mock Quasar Notify
    notifyCreateSpy = vi.fn();
    Notify.create = notifyCreateSpy;
  });

  afterEach(() => {
    queryClient.clear();
    vi.restoreAllMocks();
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

  // Type definitions for better type safety
  type MockThread = {
    ThreadId: string;
    lastTimestamp: number;
    title: string;
    messageCount: number;
  };

  type MockMessage = {
    ThreadId: string;
    Timestamp: number;
    UserId: string;
    message: string;
    is_user: boolean;
  };

  type MockResponse<T = Record<string, unknown>> = {
    ok: boolean;
    json: () => Promise<T>;
  };

  // Reusable mock thread data to avoid duplication across tests
  const createMockThread = (overrides: Partial<MockThread> = {}): MockThread => ({
    ThreadId: 'thread-1',
    lastTimestamp: Date.now(),
    title: 'Test conversation',
    messageCount: 5,
    ...overrides,
  });

  // Helper to mock LLM service response
  const mockLLMServiceResponse = (
    text = 'AI response',
    usage = { prompt: 0, completion: 0, total: 0 },
  ) => {
    vi.spyOn(llmModule.llmService, 'generate').mockResolvedValue({
      text,
      usage,
    });
  };

  // Helper to mock successful save operations (chat history, etc.)
  const mockSuccessfulSaveResponse = <T = Record<string, unknown>>(data = {} as T) => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => data,
    } as MockResponse<T>);
  };

  // Helper to mock two successful saves (user message + AI response)
  const mockChatMessageSaves = () => {
    mockSuccessfulSaveResponse(); // User message save
    mockSuccessfulSaveResponse(); // AI response save
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

  // Helper to mock auth session with token
  const mockAuthSession = (token = 'mock-token') => {
    vi.mocked(awsAmplify.fetchAuthSession).mockResolvedValue({
      tokens: {
        accessToken: {
          toString: () => token,
        },
      },
    } as ReturnType<typeof awsAmplify.fetchAuthSession>);
  };

  const mountComponent = (props = {}) => {
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
    };

    return mount(AIChatPage, {
      global: {
        plugins: [
          [
            Quasar,
            {
              plugins: {},
            },
          ],
          [VueQueryPlugin, { queryClient }],
          {
            install(app) {
              app.config.globalProperties.$q = mockQuasarInstance;
            },
          },
        ],
        provide: {
          $q: mockQuasarInstance,
        },
        stubs: {
          QTooltip: { template: '<div />' },
          QPage: {
            template: '<div data-testid="ai-chat-page"><slot /></div>',
          },
        },
      },
      props,
    });
  };

  describe('Initial Rendering', () => {
    it('should render the chat page', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('[data-testid="ai-chat-page"]').exists()).toBe(true);
    });

    it('should show AI Chat heading', () => {
      const wrapper = mountComponent();
      expect(wrapper.text()).toContain('AI Chat');
    });

    it('should show New Chat button', () => {
      const wrapper = mountComponent();
      const newChatButton = wrapper.find('[data-testid="llm-chat-new"]');
      expect(newChatButton.exists()).toBe(true);
    });

    it('should show History button', () => {
      const wrapper = mountComponent();
      const historyButton = wrapper.find('[data-testid="llm-chat-history"]');
      expect(historyButton.exists()).toBe(true);
    });

    it('should show chat input field', () => {
      const wrapper = mountComponent();
      const input = wrapper.find('[data-testid="llm-chat-input"]');
      expect(input.exists()).toBe(true);
    });

    it('should show send button', () => {
      const wrapper = mountComponent();
      const sendButton = wrapper.find('[data-testid="llm-chat-send"]');
      expect(sendButton.exists()).toBe(true);
    });

    it('should show greeting message on mount', async () => {
      const wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.text()).toContain('こんにちは！日本語学習をお手伝いします');
      expect(wrapper.text()).toContain('What would you like to practice today?');
    });

    it('should show placeholder text when no messages', () => {
      const chatStore = useChatStore();
      chatStore.setMessages([]);

      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('Start a conversation below');
    });
  });

  describe('Chat Input', () => {
    it('should allow typing in input field', async () => {
      const wrapper = mountComponent();
      const input = wrapper.find('[data-testid="llm-chat-input"]');

      await input.setValue('Hello');
      expect((input.element as HTMLInputElement).value).toBe('Hello');
    });

    it('should disable input when loading', async () => {
      const chatStore = useChatStore();
      chatStore.setLoading(true);

      const wrapper = mountComponent();
      await wrapper.vm.$nextTick();

      const input = wrapper.findComponent({ name: 'QInput' });
      expect(input.props('disable')).toBe(true);
    });

    it('should show loading state on send button when loading', async () => {
      const chatStore = useChatStore();
      chatStore.setLoading(true);

      const wrapper = mountComponent();
      await wrapper.vm.$nextTick();

      const sendButton = wrapper.find('[data-testid="llm-chat-send"]');
      const btn = sendButton.findComponent({ name: 'QBtn' });
      expect(btn.props('loading')).toBe(true);
    });
  });

  describe('Sending Messages', () => {
    it('should send message when send button is clicked', async () => {
      const chatStore = useChatStore();
      mockLLMServiceResponse();
      mockSuccessfulSaveResponse();

      const wrapper = mountComponent();
      const input = wrapper.find('[data-testid="llm-chat-input"]');

      await input.setValue('Test message');
      await wrapper.find('[data-testid="llm-chat-send"]').trigger('click');
      await flushPromises();

      const messages = chatStore.messages;
      expect(messages.some((m) => m.content === 'Test message' && m.type === 'user')).toBe(true);
    });

    it('should not send empty messages', async () => {
      const wrapper = mountComponent();
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
      mockLLMServiceResponse();
      mockSuccessfulSaveResponse();

      const wrapper = mountComponent();
      const input = wrapper.find('[data-testid="llm-chat-input"]');

      await input.setValue('Test message');
      await wrapper.find('[data-testid="llm-chat-send"]').trigger('click');
      await flushPromises();

      expect((input.element as HTMLInputElement).value).toBe('');
    });

    it('should show typing indicator while AI is responding', async () => {
      // Create a controlled promise to test the typing indicator
      type LLMResponse = {
        text: string;
        usage: { prompt: number; completion: number; total: number };
      };
      let resolveLLM: (_value: LLMResponse) => void;
      const llmPromise = new Promise<LLMResponse>((resolve) => {
        resolveLLM = resolve;
      });

      vi.spyOn(llmModule.llmService, 'generate').mockReturnValueOnce(llmPromise);
      mockSuccessfulSaveResponse();

      const wrapper = mountComponent();
      const chatStore = useChatStore();
      const input = wrapper.find('[data-testid="llm-chat-input"]');

      await input.setValue('Test message');
      await wrapper.find('[data-testid="llm-chat-send"]').trigger('click');
      await wrapper.vm.$nextTick();

      // At this point, LLM is processing and typing indicator should be visible
      expect(chatStore.isTyping).toBe(true);
      expect(wrapper.text()).toContain('AI is typing…');

      // Resolve the LLM promise
      resolveLLM!({ text: 'AI response', usage: { prompt: 0, completion: 0, total: 0 } });
      await flushPromises();

      expect(chatStore.isTyping).toBe(false);
    });

    it('should add AI response to messages', async () => {
      mockLLMServiceResponse('This is AI response');
      mockChatMessageSaves();

      const wrapper = mountComponent();
      const chatStore = useChatStore();
      const input = wrapper.find('[data-testid="llm-chat-input"]');

      await input.setValue('Hello AI');
      await wrapper.find('[data-testid="llm-chat-send"]').trigger('click');
      await flushPromises();

      const messages = chatStore.messages;
      expect(messages.some((m) => m.content === 'This is AI response' && m.type === 'ai')).toBe(
        true,
      );
    });

    it('should handle API errors gracefully', async () => {
      vi.spyOn(llmModule.llmService, 'generate').mockRejectedValue(
        new Error('API connection failed'),
      );
      mockSuccessfulSaveResponse(); // User message save succeeds

      const wrapper = mountComponent();
      const chatStore = useChatStore();
      const input = wrapper.find('[data-testid="llm-chat-input"]');

      await input.setValue('Test message');
      await wrapper.find('[data-testid="llm-chat-send"]').trigger('click');
      await flushPromises();

      // Check that error was captured and notification was shown
      expect(chatStore.error).toBeTruthy();
      expect(notifyCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'negative',
          message: expect.stringContaining('Failed'),
        }),
      );
    });
  });

  describe('New Chat Functionality', () => {
    it('should start new chat when New Chat button is clicked', async () => {
      const wrapper = mountComponent();
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
      const wrapper = mountComponent();
      const chatStore = useChatStore();

      const oldChatId = chatStore.chatId;

      const newChatButton = wrapper.find('[data-testid="llm-chat-new"]');
      await newChatButton.trigger('click');
      await flushPromises();

      expect(chatStore.chatId).not.toBe(oldChatId);
      expect(chatStore.chatId).toBeTruthy();
    });
  });

  describe('Chat History', () => {
    it('should open history dialog when History button is clicked', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ threads: [] }),
      });

      const wrapper = mountComponent();
      const historyButton = wrapper.find('[data-testid="llm-chat-history"]');

      await historyButton.trigger('click');
      await flushPromises();

      const dialogs = wrapper.findAllComponents({ name: 'QDialog' });
      expect(dialogs.length).toBeGreaterThan(0);
    });

    it('should load threads when opening history', async () => {
      const mockThreads = [createMockThread()];

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ threads: mockThreads }),
      });

      const wrapper = mountComponent();
      const authStore = useAuthStore();
      authStore.user = mockUser;

      const historyButton = wrapper.find('[data-testid="llm-chat-history"]');
      await historyButton.trigger('click');
      await flushPromises();

      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/chat-history/threads'));
      expect(wrapper.text()).toContain('Test conversation');
    });

    it('should show loading state while fetching threads', async () => {
      // Create a promise that we can control when it resolves
      type FetchResponse = MockResponse<{ threads: MockThread[] }>;
      let resolveFetch: (_value: FetchResponse) => void;
      const fetchPromise = new Promise<FetchResponse>((resolve) => {
        resolveFetch = resolve;
      });

      fetchMock.mockReturnValueOnce(fetchPromise);

      const wrapper = mountComponent();
      const historyButton = wrapper.find('[data-testid="llm-chat-history"]');

      await historyButton.trigger('click');
      await wrapper.vm.$nextTick();

      // At this point, fetch is in progress and loading state should be visible
      expect(wrapper.text()).toContain('Loading threads');

      // Clean up by resolving the promise
      resolveFetch!({ ok: true, json: async () => ({ threads: [] }) });
      await flushPromises();
    });

    it('should show empty state when no threads exist', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ threads: [] }),
      });

      const wrapper = mountComponent();
      const historyButton = wrapper.find('[data-testid="llm-chat-history"]');

      await historyButton.trigger('click');
      await flushPromises();

      expect(wrapper.text()).toContain('No previous conversations found');
    });

    it('should load thread messages when thread is selected', async () => {
      const mockThreads = [createMockThread({ messageCount: 2 })];
      const mockMessages = [
        createMockMessage('Hello', true),
        createMockMessage('Hi there', false, 1000),
      ];

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ threads: mockThreads }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ items: mockMessages }),
        });

      const wrapper = mountComponent();
      const chatStore = useChatStore();

      const historyButton = wrapper.find('[data-testid="llm-chat-history"]');
      await historyButton.trigger('click');
      await flushPromises();

      const threadItem = wrapper.find('[data-testid="llm-chat-thread-item"]');
      await threadItem.trigger('click');
      await flushPromises();

      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/chat-history/messages'));
      expect(chatStore.messages.length).toBeGreaterThan(0);
    });
  });

  describe('Delete Thread Functionality', () => {
    it('should show delete confirmation dialog', async () => {
      const mockThreads = [createMockThread()];

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ threads: mockThreads }),
      });

      const wrapper = mountComponent();
      const historyButton = wrapper.find('[data-testid="llm-chat-history"]');

      await historyButton.trigger('click');
      await flushPromises();

      const deleteButton = wrapper.find('[data-testid="llm-chat-delete-thread"]');
      await deleteButton.trigger('click');
      await wrapper.vm.$nextTick();

      expect(wrapper.text()).toContain('Delete Conversation?');
      expect(wrapper.text()).toContain('This action cannot be undone');
    });

    it('should delete thread when confirmed', async () => {
      const mockThreads = [createMockThread()];
      mockAuthSession();

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ threads: mockThreads }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({}),
        });

      const wrapper = mountComponent();
      const historyButton = wrapper.find('[data-testid="llm-chat-history"]');

      await historyButton.trigger('click');
      await flushPromises();

      const deleteButton = wrapper.find('[data-testid="llm-chat-delete-thread"]');
      await deleteButton.trigger('click');
      await wrapper.vm.$nextTick();

      const confirmButton = wrapper.find('[data-testid="llm-chat-confirm-delete"]');
      await confirmButton.trigger('click');
      await flushPromises();

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/chat-history/thread'),
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({
            Authorization: 'Bearer mock-token',
          }),
        }),
      );

      expect(notifyCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'positive',
          message: 'Conversation deleted successfully',
        }),
      );
    });

    it('should handle delete errors', async () => {
      const mockThreads = [createMockThread()];
      mockAuthSession();

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ threads: mockThreads }),
        })
        .mockResolvedValueOnce({
          ok: false,
          json: async () => ({ error: 'Delete failed' }),
        });

      const wrapper = mountComponent();
      const historyButton = wrapper.find('[data-testid="llm-chat-history"]');

      await historyButton.trigger('click');
      await flushPromises();

      const deleteButton = wrapper.find('[data-testid="llm-chat-delete-thread"]');
      await deleteButton.trigger('click');
      await wrapper.vm.$nextTick();

      const confirmButton = wrapper.find('[data-testid="llm-chat-confirm-delete"]');
      await confirmButton.trigger('click');
      await flushPromises();

      expect(notifyCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'negative',
          message: 'Failed to delete conversation',
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

    it('should sync LLM service with settings on mount', async () => {
      const llmSettings = useLLMSettingsStore();
      llmSettings.setProvider('google');
      llmSettings.setModel('gemini-2.5-flash-lite');

      mountComponent();
      await flushPromises();

      expect(llmModule.llmService.setProvider).toHaveBeenCalled();
      expect(llmModule.llmService.setModel).toHaveBeenCalled();
      expect(llmModule.llmService.setApiKey).toHaveBeenCalled();
    });
  });

  describe('Message Rendering', () => {
    it('should render user messages', async () => {
      const chatStore = useChatStore();
      chatStore.addMessage({ type: 'user', content: 'User message' });

      const wrapper = mountComponent();
      await wrapper.vm.$nextTick();

      const messages = wrapper.findAllComponents({ name: 'QChatMessage' });
      const userMessage = messages.find((m) => m.props('sent') === true);

      expect(userMessage?.exists()).toBe(true);
    });

    it('should render AI messages', async () => {
      const chatStore = useChatStore();
      chatStore.addMessage({ type: 'ai', content: 'AI message' });

      const wrapper = mountComponent();
      await wrapper.vm.$nextTick();

      const messages = wrapper.findAllComponents({ name: 'QChatMessage' });
      const aiMessage = messages.find((m) => m.props('sent') === false);

      expect(aiMessage?.exists()).toBe(true);
    });

    it('should display message timestamps', async () => {
      const chatStore = useChatStore();
      chatStore.addMessage({ type: 'user', content: 'Test' });

      const wrapper = mountComponent();
      await wrapper.vm.$nextTick();

      const message = wrapper.findComponent({ name: 'QChatMessage' });
      expect(message.props('stamp')).toBeTruthy();
    });

    it('should render multiple messages in order', async () => {
      const chatStore = useChatStore();
      chatStore.addMessage({ type: 'user', content: 'First message' });
      chatStore.addMessage({ type: 'ai', content: 'Second message' });
      chatStore.addMessage({ type: 'user', content: 'Third message' });

      const wrapper = mountComponent();
      await wrapper.vm.$nextTick();

      const messages = wrapper.findAllComponents({ name: 'QChatMessage' });
      expect(messages.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Markdown Rendering', () => {
    it('should render AI messages with markdown', async () => {
      const chatStore = useChatStore();
      chatStore.addMessage({ type: 'ai', content: '**Bold text**' });

      const wrapper = mountComponent();
      await wrapper.vm.$nextTick();

      const aiMessages = wrapper.findAll('.ai-message');
      expect(aiMessages.length).toBeGreaterThan(0);
    });

    it('should not render user messages with markdown', async () => {
      const chatStore = useChatStore();
      chatStore.addMessage({ type: 'user', content: '**Bold text**' });

      const wrapper = mountComponent();
      await wrapper.vm.$nextTick();

      const userMessages = wrapper.findAll('.user-message');
      expect(userMessages.length).toBeGreaterThan(0);
    });
  });

  describe('Keyboard Shortcuts', () => {
    it('should send message on Enter key', async () => {
      mockLLMServiceResponse();
      mockChatMessageSaves();

      const wrapper = mountComponent();
      const chatStore = useChatStore();
      const input = wrapper.find('[data-testid="llm-chat-input"]');

      await input.setValue('Test message');
      await input.trigger('keyup.enter');
      await flushPromises();

      const messages = chatStore.messages;
      expect(messages.some((m) => m.content === 'Test message' && m.type === 'user')).toBe(true);
    });
  });

  describe('UI Components', () => {
    it('should have chat container element', () => {
      const wrapper = mountComponent();
      const container = wrapper.find('.chat-container');
      expect(container.exists()).toBe(true);
    });

    it('should have proper data-testid attributes', () => {
      const wrapper = mountComponent();

      expect(wrapper.find('[data-testid="ai-chat-page"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="llm-chat-new"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="llm-chat-history"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="llm-chat-input"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="llm-chat-send"]').exists()).toBe(true);
    });

    it('should show QPage component', () => {
      const wrapper = mountComponent();
      const page = wrapper.findComponent({ name: 'QPage' });
      expect(page.exists()).toBe(true);
    });

    it('should show button icons', () => {
      const wrapper = mountComponent();
      const icons = wrapper.findAllComponents({ name: 'QIcon' });
      expect(icons.length).toBeGreaterThan(0);
    });
  });

  describe('Error Handling', () => {
    it('should display error notification on fetch failure', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const wrapper = mountComponent();
      const historyButton = wrapper.find('[data-testid="llm-chat-history"]');

      await historyButton.trigger('click');
      await flushPromises();

      expect(notifyCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'negative',
        }),
      );
    });

    it('should handle missing auth token gracefully', async () => {
      vi.mocked(awsAmplify.fetchAuthSession).mockResolvedValue({
        tokens: undefined,
      } as any);

      const mockThreads = [createMockThread()];

      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ threads: mockThreads }),
      });

      const wrapper = mountComponent();
      const historyButton = wrapper.find('[data-testid="llm-chat-history"]');

      await historyButton.trigger('click');
      await flushPromises();

      const deleteButton = wrapper.find('[data-testid="llm-chat-delete-thread"]');
      await deleteButton.trigger('click');
      await wrapper.vm.$nextTick();

      const confirmButton = wrapper.find('[data-testid="llm-chat-confirm-delete"]');
      await confirmButton.trigger('click');
      await flushPromises();

      expect(notifyCreateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'negative',
        }),
      );
    });
  });

  describe('Chat Session Management', () => {
    it('should create chat ID when sending first message', async () => {
      const chatStore = useChatStore();
      chatStore.setChatId(null);

      mockLLMServiceResponse();
      mockChatMessageSaves();

      const wrapper = mountComponent();
      const input = wrapper.find('[data-testid="llm-chat-input"]');

      await input.setValue('First message');
      await wrapper.find('[data-testid="llm-chat-send"]').trigger('click');
      await flushPromises();

      expect(chatStore.chatId).toBeTruthy();
    });

    it('should save messages to history', async () => {
      mockLLMServiceResponse();
      mockChatMessageSaves();

      const wrapper = mountComponent();
      const input = wrapper.find('[data-testid="llm-chat-input"]');

      await input.setValue('Test message');
      await wrapper.find('[data-testid="llm-chat-send"]').trigger('click');
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

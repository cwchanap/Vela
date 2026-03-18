import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// Stub crypto.randomUUID for deterministic tests
let uuidCounter = 0;
vi.stubGlobal('crypto', {
  randomUUID: () => `test-uuid-${++uuidCounter}`,
});

describe('useChatStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    uuidCounter = 0;
    vi.clearAllMocks();
  });

  describe('initial state', () => {
    it('starts with empty messages', async () => {
      const { useChatStore } = await import('./chat');
      const store = useChatStore();
      expect(store.messages).toEqual([]);
    });

    it('starts with isTyping false', async () => {
      const { useChatStore } = await import('./chat');
      const store = useChatStore();
      expect(store.isTyping).toBe(false);
    });

    it('starts with isLoading false', async () => {
      const { useChatStore } = await import('./chat');
      const store = useChatStore();
      expect(store.isLoading).toBe(false);
    });

    it('starts with error null', async () => {
      const { useChatStore } = await import('./chat');
      const store = useChatStore();
      expect(store.error).toBeNull();
    });

    it('starts with chatId null', async () => {
      const { useChatStore } = await import('./chat');
      const store = useChatStore();
      expect(store.chatId).toBeNull();
    });
  });

  describe('addMessage', () => {
    it('adds a user message with generated id and timestamp', async () => {
      const { useChatStore } = await import('./chat');
      const store = useChatStore();

      store.addMessage({ type: 'user', content: 'Hello' });

      expect(store.messages).toHaveLength(1);
      expect(store.messages[0].type).toBe('user');
      expect(store.messages[0].content).toBe('Hello');
      expect(store.messages[0].id).toBe('test-uuid-1');
      expect(store.messages[0].timestamp).toBeInstanceOf(Date);
    });

    it('adds an AI message', async () => {
      const { useChatStore } = await import('./chat');
      const store = useChatStore();

      store.addMessage({ type: 'ai', content: 'こんにちは！' });

      expect(store.messages[0].type).toBe('ai');
      expect(store.messages[0].content).toBe('こんにちは！');
    });

    it('accumulates multiple messages', async () => {
      const { useChatStore } = await import('./chat');
      const store = useChatStore();

      store.addMessage({ type: 'user', content: 'First' });
      store.addMessage({ type: 'ai', content: 'Second' });
      store.addMessage({ type: 'user', content: 'Third' });

      expect(store.messages).toHaveLength(3);
    });

    it('preserves optional context field', async () => {
      const { useChatStore } = await import('./chat');
      const store = useChatStore();
      const context = { sentence: '日本語', vocabulary: ['日', '本', '語'] };

      store.addMessage({ type: 'user', content: 'Analyze this', context });

      expect(store.messages[0].context).toEqual(context);
    });
  });

  describe('setMessages', () => {
    it('replaces all messages', async () => {
      const { useChatStore } = await import('./chat');
      const store = useChatStore();

      store.addMessage({ type: 'user', content: 'Old message' });

      const newMessages = [
        {
          id: 'msg-1',
          type: 'user' as const,
          content: 'New message 1',
          timestamp: new Date(),
        },
        {
          id: 'msg-2',
          type: 'ai' as const,
          content: 'New message 2',
          timestamp: new Date(),
        },
      ];

      store.setMessages(newMessages);

      expect(store.messages).toHaveLength(2);
      expect(store.messages[0].id).toBe('msg-1');
      expect(store.messages[1].id).toBe('msg-2');
    });

    it('sets empty messages array', async () => {
      const { useChatStore } = await import('./chat');
      const store = useChatStore();

      store.addMessage({ type: 'user', content: 'Message' });
      store.setMessages([]);

      expect(store.messages).toHaveLength(0);
    });
  });

  describe('setTyping', () => {
    it('sets isTyping to true', async () => {
      const { useChatStore } = await import('./chat');
      const store = useChatStore();

      store.setTyping(true);
      expect(store.isTyping).toBe(true);
    });

    it('sets isTyping to false', async () => {
      const { useChatStore } = await import('./chat');
      const store = useChatStore();

      store.setTyping(true);
      store.setTyping(false);
      expect(store.isTyping).toBe(false);
    });
  });

  describe('setLoading', () => {
    it('sets isLoading to true', async () => {
      const { useChatStore } = await import('./chat');
      const store = useChatStore();

      store.setLoading(true);
      expect(store.isLoading).toBe(true);
    });

    it('sets isLoading to false', async () => {
      const { useChatStore } = await import('./chat');
      const store = useChatStore();

      store.setLoading(true);
      store.setLoading(false);
      expect(store.isLoading).toBe(false);
    });
  });

  describe('setError', () => {
    it('sets error message', async () => {
      const { useChatStore } = await import('./chat');
      const store = useChatStore();

      store.setError('Something went wrong');
      expect(store.error).toBe('Something went wrong');
    });

    it('clears error by setting to null', async () => {
      const { useChatStore } = await import('./chat');
      const store = useChatStore();

      store.setError('Error');
      store.setError(null);
      expect(store.error).toBeNull();
    });
  });

  describe('setChatId', () => {
    it('sets chat ID', async () => {
      const { useChatStore } = await import('./chat');
      const store = useChatStore();

      store.setChatId('thread-123');
      expect(store.chatId).toBe('thread-123');
    });

    it('clears chat ID by setting to null', async () => {
      const { useChatStore } = await import('./chat');
      const store = useChatStore();

      store.setChatId('thread-123');
      store.setChatId(null);
      expect(store.chatId).toBeNull();
    });
  });

  describe('startNewChat', () => {
    it('generates a new chat ID', async () => {
      const { useChatStore } = await import('./chat');
      const store = useChatStore();

      expect(store.chatId).toBeNull();
      store.startNewChat();
      expect(store.chatId).toBe('test-uuid-1');
    });

    it('clears existing messages', async () => {
      const { useChatStore } = await import('./chat');
      const store = useChatStore();

      store.addMessage({ type: 'user', content: 'Old message' });
      store.startNewChat();
      expect(store.messages).toHaveLength(0);
    });

    it('clears existing error', async () => {
      const { useChatStore } = await import('./chat');
      const store = useChatStore();

      store.setError('Old error');
      store.startNewChat();
      expect(store.error).toBeNull();
    });

    it('generates different chat IDs on repeated calls', async () => {
      const { useChatStore } = await import('./chat');
      const store = useChatStore();

      store.startNewChat();
      const firstId = store.chatId;
      store.startNewChat();
      const secondId = store.chatId;
      expect(firstId).not.toBe(secondId);
    });
  });

  describe('clearMessages', () => {
    it('clears messages array', async () => {
      const { useChatStore } = await import('./chat');
      const store = useChatStore();

      store.addMessage({ type: 'user', content: 'Message 1' });
      store.addMessage({ type: 'ai', content: 'Message 2' });
      store.clearMessages();

      expect(store.messages).toHaveLength(0);
    });

    it('preserves the chatId', async () => {
      const { useChatStore } = await import('./chat');
      const store = useChatStore();

      store.setChatId('thread-456');
      store.addMessage({ type: 'user', content: 'Message' });
      store.clearMessages();

      expect(store.chatId).toBe('thread-456');
    });
  });

  describe('clearError', () => {
    it('clears error', async () => {
      const { useChatStore } = await import('./chat');
      const store = useChatStore();

      store.setError('Some error');
      store.clearError();
      expect(store.error).toBeNull();
    });

    it('is a no-op when no error', async () => {
      const { useChatStore } = await import('./chat');
      const store = useChatStore();

      store.clearError();
      expect(store.error).toBeNull();
    });
  });
});

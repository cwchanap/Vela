import { describe, it, expect } from 'vitest';
import type {
  ChatMessage,
  LLMBridgeRequest,
  ChatHistoryItem,
  ChatThreadSummary,
} from '../src/types';

describe('Types', () => {
  describe('ChatMessage', () => {
    it('should allow valid roles', () => {
      const systemMessage: ChatMessage = { role: 'system', content: 'Test system' };
      const userMessage: ChatMessage = { role: 'user', content: 'Test user' };
      const assistantMessage: ChatMessage = { role: 'assistant', content: 'Test assistant' };

      expect(systemMessage.role).toBe('system');
      expect(userMessage.role).toBe('user');
      expect(assistantMessage.role).toBe('assistant');
    });

    it('should have content property', () => {
      const message: ChatMessage = { role: 'user', content: 'Hello world' };
      expect(message.content).toBe('Hello world');
    });
  });

  describe('LLMBridgeRequest', () => {
    it('should allow google provider', () => {
      const request: LLMBridgeRequest = { provider: 'google' };
      expect(request.provider).toBe('google');
    });

    it('should allow openrouter provider', () => {
      const request: LLMBridgeRequest = { provider: 'openrouter' };
      expect(request.provider).toBe('openrouter');
    });

    it('should have optional properties', () => {
      const request: LLMBridgeRequest = {
        provider: 'google',
        model: 'gemini-2.5-flash-lite',
        temperature: 0.7,
        maxTokens: 1024,
        prompt: 'Hello',
        system: 'You are helpful',
        appName: 'Test App',
        referer: 'https://example.com',
      };

      expect(request.model).toBe('gemini-2.5-flash-lite');
      expect(request.temperature).toBe(0.7);
      expect(request.maxTokens).toBe(1024);
    });
  });

  describe('ChatHistoryItem', () => {
    it('should have required properties', () => {
      const item: ChatHistoryItem = {
        ThreadId: 'thread-123',
        Timestamp: 1693440000000,
        UserId: 'user-456',
        message: 'Hello',
        is_user: true,
      };

      expect(item.ThreadId).toBe('thread-123');
      expect(item.Timestamp).toBe(1693440000000);
      expect(item.UserId).toBe('user-456');
      expect(item.message).toBe('Hello');
      expect(item.is_user).toBe(true);
    });
  });

  describe('ChatThreadSummary', () => {
    it('should have required properties', () => {
      const summary: ChatThreadSummary = {
        ThreadId: 'thread-123',
        lastTimestamp: 1693440000000,
        title: 'Test Thread',
        messageCount: 5,
      };

      expect(summary.ThreadId).toBe('thread-123');
      expect(summary.lastTimestamp).toBe(1693440000000);
      expect(summary.title).toBe('Test Thread');
      expect(summary.messageCount).toBe(5);
    });
  });
});

import { describe, test, expect } from 'bun:test';
import {
  ChatHistoryItemSchema,
  ChatMessageSchema,
  LLMBridgeRequestSchema,
  jlptField,
  UserIdQuerySchema,
  ThreadIdQuerySchema,
} from '../src/validation';
import { z } from 'zod';
import { LLM_PROVIDERS } from '@vela/common/contracts/llm';

describe('ChatHistoryItemSchema', () => {
  test('accepts valid chat history item', () => {
    const result = ChatHistoryItemSchema.safeParse({
      ThreadId: 'thread-1',
      Timestamp: 1700000000,
      UserId: 'user-1',
      message: 'Hello',
      is_user: true,
    });
    expect(result.success).toBe(true);
  });

  test('rejects empty ThreadId', () => {
    const result = ChatHistoryItemSchema.safeParse({
      ThreadId: '',
      Timestamp: 1700000000,
      UserId: 'user-1',
      message: 'Hello',
      is_user: true,
    });
    expect(result.success).toBe(false);
  });

  test('rejects negative Timestamp', () => {
    const result = ChatHistoryItemSchema.safeParse({
      ThreadId: 'thread-1',
      Timestamp: -1,
      UserId: 'user-1',
      message: 'Hello',
      is_user: true,
    });
    expect(result.success).toBe(false);
  });

  test('rejects empty message', () => {
    const result = ChatHistoryItemSchema.safeParse({
      ThreadId: 'thread-1',
      Timestamp: 1700000000,
      UserId: 'user-1',
      message: '',
      is_user: true,
    });
    expect(result.success).toBe(false);
  });

  test('accepts an optional model pair for a user turn', () => {
    const result = ChatHistoryItemSchema.safeParse({
      ThreadId: 'thread-1',
      Timestamp: 1700000000,
      UserId: 'user-1',
      message: 'Hello',
      is_user: true,
      model: { provider: 'anthropic', model: 'claude-opus-4' },
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.model).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-4',
    });
  });

  test('accepts payloads without model or lastLlmAt', () => {
    const result = ChatHistoryItemSchema.safeParse({
      ThreadId: 'thread-1',
      Timestamp: 1700000000,
      UserId: 'user-1',
      message: 'Hello',
      is_user: true,
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.model).toBeUndefined();
    expect(result.success && result.data.lastLlmAt).toBeUndefined();
  });

  test('accepts an optional positive lastLlmAt for an assistant turn', () => {
    const result = ChatHistoryItemSchema.safeParse({
      ThreadId: 'thread-1',
      Timestamp: 1700000000,
      UserId: 'user-1',
      message: 'こんにちは',
      is_user: false,
      lastLlmAt: 1700000000000,
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.lastLlmAt).toBe(1700000000000);
  });

  test.each([0, -5, 1.5, '1700000000000'])('rejects lastLlmAt value %p', (lastLlmAt) => {
    const result = ChatHistoryItemSchema.safeParse({
      ThreadId: 'thread-1',
      Timestamp: 1700000000,
      UserId: 'user-1',
      message: 'Hello',
      is_user: false,
      lastLlmAt,
    });
    expect(result.success).toBe(false);
  });

  test('rejects an unsupported model provider', () => {
    const result = ChatHistoryItemSchema.safeParse({
      ThreadId: 'thread-1',
      Timestamp: 1700000000,
      UserId: 'user-1',
      message: 'Hello',
      is_user: true,
      model: { provider: 'bedrock', model: 'x' },
    });
    expect(result.success).toBe(false);
  });

  test('rejects an empty model id', () => {
    const result = ChatHistoryItemSchema.safeParse({
      ThreadId: 'thread-1',
      Timestamp: 1700000000,
      UserId: 'user-1',
      message: 'Hello',
      is_user: true,
      model: { provider: 'google', model: '' },
    });
    expect(result.success).toBe(false);
  });
});

describe('ChatMessageSchema', () => {
  test('accepts valid roles', () => {
    for (const role of ['system', 'user', 'assistant'] as const) {
      const result = ChatMessageSchema.safeParse({ role, content: 'Hello' });
      expect(result.success).toBe(true);
    }
  });

  test('rejects invalid role', () => {
    const result = ChatMessageSchema.safeParse({ role: 'moderator', content: 'Hello' });
    expect(result.success).toBe(false);
  });

  test('rejects empty content', () => {
    const result = ChatMessageSchema.safeParse({ role: 'user', content: '' });
    expect(result.success).toBe(false);
  });
});

describe('LLMBridgeRequestSchema', () => {
  test('accepts request with prompt', () => {
    const result = LLMBridgeRequestSchema.safeParse({
      provider: 'google',
      prompt: 'Translate this',
    });
    expect(result.success).toBe(true);
  });

  test('accepts request with messages', () => {
    const result = LLMBridgeRequestSchema.safeParse({
      provider: 'openrouter',
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(result.success).toBe(true);
  });

  test('rejects request with neither prompt nor messages', () => {
    const result = LLMBridgeRequestSchema.safeParse({ provider: 'google' });
    expect(result.success).toBe(false);
  });

  test('accepts every provider in the shared tuple', () => {
    for (const provider of LLM_PROVIDERS) {
      const result = LLMBridgeRequestSchema.safeParse({ provider, prompt: 'Hello' });
      expect(result.success).toBe(true);
    }
  });

  test('rejects invalid provider', () => {
    const result = LLMBridgeRequestSchema.safeParse({
      provider: 'chutes',
      prompt: 'Hello',
    });
    expect(result.success).toBe(false);
  });

  test('strips the removed temperature field instead of forwarding it', () => {
    const result = LLMBridgeRequestSchema.safeParse({
      provider: 'google',
      prompt: 'Hello',
      temperature: 0.7,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect('temperature' in result.data).toBe(false);
    }
  });

  test('rejects empty prompt with no messages', () => {
    const result = LLMBridgeRequestSchema.safeParse({ provider: 'google', prompt: '' });
    expect(result.success).toBe(false);
  });

  test('rejects an empty messages array with no prompt', () => {
    const result = LLMBridgeRequestSchema.safeParse({ provider: 'google', messages: [] });
    expect(result.success).toBe(false);
  });

  test('accepts optional fields including thinking', () => {
    const result = LLMBridgeRequestSchema.safeParse({
      provider: 'google',
      prompt: 'Hello',
      model: 'gemini-3.8-flash',
      thinking: 'low',
      maxTokens: 1000,
      appName: 'vela',
    });
    expect(result.success).toBe(true);
  });
});

describe('jlptField', () => {
  const schema = z.object({ jlpt: jlptField });

  test('accepts undefined', () => {
    const result = schema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data?.jlpt).toBeUndefined();
  });

  test('accepts valid single level', () => {
    const result = schema.safeParse({ jlpt: '5' });
    expect(result.success).toBe(true);
    expect(result.data?.jlpt).toEqual([5]);
  });

  test('accepts comma-separated levels', () => {
    const result = schema.safeParse({ jlpt: '1,2,3' });
    expect(result.success).toBe(true);
    expect(result.data?.jlpt).toEqual([1, 2, 3]);
  });

  test('deduplicates repeated levels', () => {
    const result = schema.safeParse({ jlpt: '5,5,4' });
    expect(result.success).toBe(true);
    expect(result.data?.jlpt).toEqual([5, 4]);
  });

  test('rejects level 0', () => {
    const result = schema.safeParse({ jlpt: '0' });
    expect(result.success).toBe(false);
  });

  test('rejects level 6', () => {
    const result = schema.safeParse({ jlpt: '6' });
    expect(result.success).toBe(false);
  });

  test('rejects non-integer string', () => {
    const result = schema.safeParse({ jlpt: '1.5' });
    expect(result.success).toBe(false);
  });

  test('rejects alphabetic string', () => {
    const result = schema.safeParse({ jlpt: 'N5' });
    expect(result.success).toBe(false);
  });

  test('returns undefined for empty string', () => {
    const result = schema.safeParse({ jlpt: '' });
    expect(result.success).toBe(true);
    expect(result.data?.jlpt).toBeUndefined();
  });
});

describe('UserIdQuerySchema', () => {
  test('accepts valid user_id', () => {
    const result = UserIdQuerySchema.safeParse({ user_id: 'abc' });
    expect(result.success).toBe(true);
  });

  test('rejects empty user_id', () => {
    const result = UserIdQuerySchema.safeParse({ user_id: '' });
    expect(result.success).toBe(false);
  });

  test('rejects missing user_id', () => {
    const result = UserIdQuerySchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('ThreadIdQuerySchema', () => {
  test('accepts valid thread_id', () => {
    const result = ThreadIdQuerySchema.safeParse({ thread_id: 'thread-abc' });
    expect(result.success).toBe(true);
  });

  test('rejects empty thread_id', () => {
    const result = ThreadIdQuerySchema.safeParse({ thread_id: '' });
    expect(result.success).toBe(false);
  });
});

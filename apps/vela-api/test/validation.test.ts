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

  test('rejects invalid provider', () => {
    const result = LLMBridgeRequestSchema.safeParse({
      provider: 'anthropic',
      prompt: 'Hello',
    });
    expect(result.success).toBe(false);
  });

  test('rejects temperature out of range', () => {
    const result = LLMBridgeRequestSchema.safeParse({
      provider: 'google',
      prompt: 'Hello',
      temperature: 3,
    });
    expect(result.success).toBe(false);
  });

  test('accepts optional fields', () => {
    const result = LLMBridgeRequestSchema.safeParse({
      provider: 'google',
      prompt: 'Hello',
      model: 'gemini-pro',
      temperature: 0.7,
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

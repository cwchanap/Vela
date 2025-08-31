import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { chatHistory } from '../src/routes/chat-history';
import type { ChatHistoryItem, Env } from '../src/types';

// Mock AWS SDK
const mockPutCommand = vi.fn();
const mockQueryCommand = vi.fn();
const mockSend = vi.fn();

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn().mockReturnValue({
      send: mockSend,
    }),
  },
  PutCommand: vi.fn().mockImplementation((input: any) => {
    mockPutCommand(input);
    return { input };
  }),
  QueryCommand: vi.fn().mockImplementation((input: any) => {
    mockQueryCommand(input);
    return { input };
  }),
}));

// Create a test app that includes the environment
function createTestApp(env: Env = {}) {
  const app = new Hono<{ Bindings: Env }>();

  // Add environment to context
  app.use('*', async (c, next) => {
    // Initialize c.env if it doesn't exist and assign our test env
    c.env = c.env || {};
    Object.assign(c.env, env);
    await next();
  });

  // Mount the routes
  app.route('/', chatHistory);

  return app;
}

describe('Chat History Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('CORS handling', () => {
    it('should handle OPTIONS request', async () => {
      const app = createTestApp();
      const req = new Request('http://localhost/threads', { method: 'OPTIONS' });
      const res = await app.request(req);

      expect(res.status).toBe(200);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET,POST,OPTIONS');
    });
  });

  describe('POST /save', () => {
    it('should save a chat message', async () => {
      const chatItem: ChatHistoryItem = {
        ThreadId: 'thread-123',
        Timestamp: Date.now(),
        UserId: 'user-456',
        message: 'Hello world',
        is_user: true,
      };

      mockSend.mockResolvedValueOnce({});

      const app = createTestApp({
        AWS_ACCESS_KEY_ID: 'test-key',
        AWS_SECRET_ACCESS_KEY: 'test-secret',
        DDB_TABLE: 'test-table',
      });

      const req = new Request('http://localhost/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chatItem),
      });

      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(mockPutCommand).toHaveBeenCalledWith({
        TableName: 'test-table',
        Item: chatItem,
      });
    });

    it('should handle DynamoDB errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('DynamoDB error'));

      const app = createTestApp({
        AWS_ACCESS_KEY_ID: 'test-key',
        AWS_SECRET_ACCESS_KEY: 'test-secret',
      });

      const req = new Request('http://localhost/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ThreadId: 'thread-123',
          Timestamp: Date.now(),
          UserId: 'user-456',
          message: 'Hello',
          is_user: true,
        }),
      });

      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe('DynamoDB error');
    });

    it('should handle missing AWS credentials', async () => {
      const app = createTestApp({}); // No AWS credentials

      const req = new Request('http://localhost/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ThreadId: 'thread-123',
          Timestamp: Date.now(),
          UserId: 'user-456',
          message: 'Hello',
          is_user: true,
        }),
      });

      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toBe('Missing AWS credentials');
    });
  });

  describe('GET /threads', () => {
    it('should return thread summaries for a user', async () => {
      const mockItems: ChatHistoryItem[] = [
        {
          ThreadId: 'thread-1',
          Timestamp: 1693440000000,
          UserId: 'user-123',
          message: 'First message',
          is_user: true,
        },
        {
          ThreadId: 'thread-1',
          Timestamp: 1693440001000,
          UserId: 'user-123',
          message: 'Assistant response',
          is_user: false,
        },
        {
          ThreadId: 'thread-2',
          Timestamp: 1693440002000,
          UserId: 'user-123',
          message: 'Another thread',
          is_user: true,
        },
      ];

      mockSend.mockResolvedValueOnce({
        Items: mockItems,
        LastEvaluatedKey: undefined,
      });

      const app = createTestApp({
        AWS_ACCESS_KEY_ID: 'test-key',
        AWS_SECRET_ACCESS_KEY: 'test-secret',
        DDB_TABLE: 'test-table',
      });

      const req = new Request('http://localhost/threads?user_id=user-123');

      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.threads).toHaveLength(2);
      expect(json.threads[0].ThreadId).toBe('thread-2'); // Latest first
      expect(json.threads[1].ThreadId).toBe('thread-1');
      expect(json.threads[1].messageCount).toBe(2);
    });

    it('should return 400 when user_id is missing', async () => {
      const app = createTestApp({});
      const req = new Request('http://localhost/threads');
      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe('user_id is required');
    });
  });

  describe('GET /messages', () => {
    it('should return messages for a thread', async () => {
      const mockItems: ChatHistoryItem[] = [
        {
          ThreadId: 'thread-123',
          Timestamp: 1693440000000,
          UserId: 'user-456',
          message: 'First message',
          is_user: true,
        },
        {
          ThreadId: 'thread-123',
          Timestamp: 1693440001000,
          UserId: 'user-456',
          message: 'Assistant response',
          is_user: false,
        },
      ];

      mockSend.mockResolvedValueOnce({
        Items: mockItems,
        LastEvaluatedKey: undefined,
      });

      const app = createTestApp({
        AWS_ACCESS_KEY_ID: 'test-key',
        AWS_SECRET_ACCESS_KEY: 'test-secret',
        DDB_TABLE: 'test-table',
      });

      const req = new Request('http://localhost/messages?thread_id=thread-123');

      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.items).toHaveLength(2);
      expect(json.items[0].message).toBe('First message');
      expect(json.items[1].message).toBe('Assistant response');
    });

    it('should return 400 when thread_id is missing', async () => {
      const app = createTestApp({});
      const req = new Request('http://localhost/messages');
      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBe('thread_id is required');
    });
  });
});

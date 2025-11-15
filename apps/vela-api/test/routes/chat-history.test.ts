import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { chatHistory } from '../../src/routes/chat-history';
import { corsMiddleware } from '../../src/middleware/cors';
import type { ChatHistoryItem, Env } from '../../src/types';

// Mock AWS SDK
let mockPutCommand: any;
let mockQueryCommand: any;
let mockScanCommand: any;
let mockSend: any;

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn().mockImplementation(() => ({
      send: (...args: any[]) => mockSend(...args),
    })),
  },
  PutCommand: vi.fn().mockImplementation((input: any) => {
    if (!mockPutCommand) mockPutCommand = vi.fn();
    mockPutCommand(input);
    return { input };
  }),
  QueryCommand: vi.fn().mockImplementation((input: any) => {
    if (!mockQueryCommand) mockQueryCommand = vi.fn();
    mockQueryCommand(input);
    return { input };
  }),
  ScanCommand: vi.fn().mockImplementation((input: any) => {
    if (!mockScanCommand) mockScanCommand = vi.fn();
    mockScanCommand(input);
    return { input };
  }),
}));

// Initialize mockSend after mocks are set up
beforeEach(() => {
  mockSend = vi.fn();
  mockPutCommand = vi.fn();
  mockQueryCommand = vi.fn();
});

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

  // Apply CORS middleware (now centralized)
  app.use('*', corsMiddleware);

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
      const app = createTestApp({
        CORS_ALLOWED_ORIGINS: 'http://localhost:9000',
      });
      const req = new Request('http://localhost/threads', { method: 'OPTIONS' });
      const res = await app.request(req);

      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect(res.headers.get('Access-Control-Allow-Methods')).toBe(
        'GET, POST, PUT, DELETE, OPTIONS',
      );
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
        DDB_TABLE: 'vela-chat-history',
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
      expect(mockPutCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'vela-chat-history',
          Item: expect.objectContaining(chatItem),
        }),
      );
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
      expect(json.error).toContain('DynamoDB error');
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
      expect(json.error).toContain('Missing AWS credentials');
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
        DDB_TABLE: 'vela-chat-history',
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
      const app = createTestApp({
        AWS_ACCESS_KEY_ID: 'test-key',
        AWS_SECRET_ACCESS_KEY: 'test-secret',
      });
      const req = new Request('http://localhost/threads');
      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('user_id is required');
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
        DDB_TABLE: 'vela-chat-history',
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
      const app = createTestApp({
        AWS_ACCESS_KEY_ID: 'test-key',
        AWS_SECRET_ACCESS_KEY: 'test-secret',
      });
      const req = new Request('http://localhost/messages');
      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('thread_id is required');
    });
  });
});

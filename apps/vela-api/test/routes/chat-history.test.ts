import { describe, test, expect, beforeEach, vi } from 'bun:test';
import { Hono } from 'hono';
import { corsMiddleware } from '../../src/middleware/cors';
import type { ChatHistoryItem, Env } from '../../src/types';

// Mock AWS SDK
let mockPutCommand: any;
let mockQueryCommand: any;
let mockScanCommand: any;
let mockSend: any;
let chatHistory: typeof import('../../src/routes/chat-history').chatHistory;
const globalMock = globalThis as typeof globalThis & {
  __dynamoMockSend?: ReturnType<typeof vi.fn>;
  __dynamoMockPutCommand?: ReturnType<typeof vi.fn>;
  __dynamoMockQueryCommand?: ReturnType<typeof vi.fn>;
  __dynamoMockScanCommand?: ReturnType<typeof vi.fn>;
};

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn().mockImplementation(() => ({
      send: (...args: any[]) => globalMock.__dynamoMockSend?.(...args),
    })),
  },
  GetCommand: vi.fn().mockImplementation((input: any) => ({ input })),
  BatchGetCommand: vi.fn().mockImplementation((input: any) => ({ input })),
  UpdateCommand: vi.fn().mockImplementation((input: any) => ({ input })),
  DeleteCommand: vi.fn().mockImplementation((input: any) => ({ input })),
  PutCommand: vi.fn().mockImplementation((input: any) => {
    if (!globalMock.__dynamoMockPutCommand) {
      globalMock.__dynamoMockPutCommand = vi.fn();
    }
    globalMock.__dynamoMockPutCommand(input);
    return { input };
  }),
  QueryCommand: vi.fn().mockImplementation((input: any) => {
    if (!globalMock.__dynamoMockQueryCommand) {
      globalMock.__dynamoMockQueryCommand = vi.fn();
    }
    globalMock.__dynamoMockQueryCommand(input);
    return { input };
  }),
  ScanCommand: vi.fn().mockImplementation((input: any) => {
    if (!globalMock.__dynamoMockScanCommand) {
      globalMock.__dynamoMockScanCommand = vi.fn();
    }
    globalMock.__dynamoMockScanCommand(input);
    return { input };
  }),
  BatchWriteCommand: vi.fn().mockImplementation((input: any) => ({ input })),
}));

vi.mock('../../src/middleware/auth', () => ({
  requireAuth: async (c: any, next: () => Promise<void>) => {
    c.set('userId', 'user-123');
    c.set('userEmail', 'test@example.com');
    await next();
  },
}));

({ chatHistory } = await import('../../src/routes/chat-history'));

// Initialize mockSend after mocks are set up
beforeEach(() => {
  mockSend = vi.fn();
  mockPutCommand = vi.fn();
  mockQueryCommand = vi.fn();
  mockScanCommand = vi.fn();
  globalMock.__dynamoMockSend = mockSend;
  globalMock.__dynamoMockPutCommand = mockPutCommand;
  globalMock.__dynamoMockQueryCommand = mockQueryCommand;
  globalMock.__dynamoMockScanCommand = mockScanCommand;
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
    test('should handle OPTIONS request', async () => {
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
    test('should save a chat message', async () => {
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
          Item: expect.objectContaining({
            ThreadId: chatItem.ThreadId,
            message: chatItem.message,
            is_user: chatItem.is_user,
            UserId: 'user-123',
            Timestamp: expect.any(Number),
          }),
        }),
      );
    });

    test('should handle DynamoDB errors', async () => {
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

    test('should handle missing AWS credentials', async () => {
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
    test('should return thread summaries for a user', async () => {
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

    test('should return 400 when user_id is missing', async () => {
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
    test('should return messages for a thread', async () => {
      const mockItems: ChatHistoryItem[] = [
        {
          ThreadId: 'thread-123',
          Timestamp: 1693440000000,
          UserId: 'user-123',
          message: 'First message',
          is_user: true,
        },
        {
          ThreadId: 'thread-123',
          Timestamp: 1693440001000,
          UserId: 'user-123',
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

    test('should return 400 when thread_id is missing', async () => {
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

  describe('DELETE /thread', () => {
    test('should delete thread when all messages belong to authenticated user', async () => {
      mockSend
        .mockResolvedValueOnce({
          Items: [
            {
              ThreadId: 'thread-123',
              Timestamp: 1693440000000,
              UserId: 'user-123',
              message: 'hello',
              is_user: true,
            },
          ],
        })
        .mockResolvedValueOnce({
          Items: [
            {
              ThreadId: 'thread-123',
              Timestamp: 1693440000000,
              UserId: 'user-123',
              message: 'hello',
              is_user: true,
            },
          ],
          LastEvaluatedKey: undefined,
        })
        .mockResolvedValueOnce({
          UnprocessedItems: {},
        });

      const app = createTestApp({
        AWS_ACCESS_KEY_ID: 'test-key',
        AWS_SECRET_ACCESS_KEY: 'test-secret',
      });

      const req = new Request('http://localhost/thread?thread_id=thread-123', {
        method: 'DELETE',
      });
      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
    });

    test('should reject deletion when thread has mixed ownership', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          {
            ThreadId: 'thread-123',
            Timestamp: 1693440000000,
            UserId: 'user-123',
            message: 'hello',
            is_user: true,
          },
          {
            ThreadId: 'thread-123',
            Timestamp: 1693440001000,
            UserId: 'other-user',
            message: 'intruder',
            is_user: false,
          },
        ],
      });

      const app = createTestApp({
        AWS_ACCESS_KEY_ID: 'test-key',
        AWS_SECRET_ACCESS_KEY: 'test-secret',
      });

      const req = new Request('http://localhost/thread?thread_id=thread-123', {
        method: 'DELETE',
      });
      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error).toContain('Forbidden');
    });
  });
});

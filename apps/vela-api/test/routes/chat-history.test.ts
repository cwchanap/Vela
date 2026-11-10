import { describe, test, expect, beforeEach, vi } from 'bun:test';
import { createHash } from 'crypto';
import { Hono } from 'hono';
import { corsMiddleware } from '../../src/middleware/cors';
import type { ChatHistoryItem, Env } from '../../src/types';

// Mock AWS SDK
let mockPutCommand: any;
let mockGetCommand: any;
let mockQueryCommand: any;
let mockUpdateCommand: any;
let mockDeleteCommand: any;
let mockBatchWriteCommand: any;
let mockTransactWriteCommand: any;
let mockSend: any;
let chatHistory: typeof import('../../src/routes/chat-history').chatHistory;
const globalMock = globalThis as typeof globalThis & {
  __authUserId?: string;
  __dynamoMockSend?: ReturnType<typeof vi.fn>;
  __dynamoMockPutCommand?: ReturnType<typeof vi.fn>;
  __dynamoMockGetCommand?: ReturnType<typeof vi.fn>;
  __dynamoMockQueryCommand?: ReturnType<typeof vi.fn>;
  __dynamoMockUpdateCommand?: ReturnType<typeof vi.fn>;
  __dynamoMockDeleteCommand?: ReturnType<typeof vi.fn>;
  __dynamoMockBatchWriteCommand?: ReturnType<typeof vi.fn>;
  __dynamoMockTransactWriteCommand?: ReturnType<typeof vi.fn>;
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
  GetCommand: vi.fn().mockImplementation((input: any) => {
    if (!globalMock.__dynamoMockGetCommand) {
      globalMock.__dynamoMockGetCommand = vi.fn();
    }
    globalMock.__dynamoMockGetCommand(input);
    return { input, __type: 'GetCommand' };
  }),
  BatchGetCommand: vi.fn().mockImplementation((input: any) => ({
    input,
    __type: 'BatchGetCommand',
  })),
  UpdateCommand: vi.fn().mockImplementation((input: any) => {
    if (!globalMock.__dynamoMockUpdateCommand) {
      globalMock.__dynamoMockUpdateCommand = vi.fn();
    }
    globalMock.__dynamoMockUpdateCommand(input);
    return { input, __type: 'UpdateCommand' };
  }),
  DeleteCommand: vi.fn().mockImplementation((input: any) => {
    if (!globalMock.__dynamoMockDeleteCommand) {
      globalMock.__dynamoMockDeleteCommand = vi.fn();
    }
    globalMock.__dynamoMockDeleteCommand(input);
    return { input, __type: 'DeleteCommand' };
  }),
  PutCommand: vi.fn().mockImplementation((input: any) => {
    if (!globalMock.__dynamoMockPutCommand) {
      globalMock.__dynamoMockPutCommand = vi.fn();
    }
    globalMock.__dynamoMockPutCommand(input);
    return { input, __type: 'PutCommand' };
  }),
  QueryCommand: vi.fn().mockImplementation((input: any) => {
    if (!globalMock.__dynamoMockQueryCommand) {
      globalMock.__dynamoMockQueryCommand = vi.fn();
    }
    globalMock.__dynamoMockQueryCommand(input);
    return { input, __type: 'QueryCommand' };
  }),
  ScanCommand: vi.fn().mockImplementation((input: any) => ({ input, __type: 'ScanCommand' })),
  BatchWriteCommand: vi.fn().mockImplementation((input: any) => {
    if (!globalMock.__dynamoMockBatchWriteCommand) {
      globalMock.__dynamoMockBatchWriteCommand = vi.fn();
    }
    globalMock.__dynamoMockBatchWriteCommand(input);
    return { input, __type: 'BatchWriteCommand' };
  }),
  TransactWriteCommand: vi.fn().mockImplementation((input: any) => {
    if (!globalMock.__dynamoMockTransactWriteCommand) {
      globalMock.__dynamoMockTransactWriteCommand = vi.fn();
    }
    globalMock.__dynamoMockTransactWriteCommand(input);
    return { input, __type: 'TransactWriteCommand' };
  }),
}));

vi.mock('../../src/middleware/auth', () => ({
  requireAuth: async (c: any, next: () => Promise<void>) => {
    c.set('userId', globalMock.__authUserId ?? 'user-123');
    c.set('userEmail', 'test@example.com');
    await next();
  },
}));

({ chatHistory } = await import('../../src/routes/chat-history'));

// Initialize mockSend after mocks are set up
beforeEach(() => {
  mockSend = vi.fn();
  mockPutCommand = vi.fn();
  mockGetCommand = vi.fn();
  mockQueryCommand = vi.fn();
  mockUpdateCommand = vi.fn();
  mockDeleteCommand = vi.fn();
  mockBatchWriteCommand = vi.fn();
  mockTransactWriteCommand = vi.fn();
  globalMock.__authUserId = 'user-123';
  globalMock.__dynamoMockSend = mockSend;
  globalMock.__dynamoMockPutCommand = mockPutCommand;
  globalMock.__dynamoMockGetCommand = mockGetCommand;
  globalMock.__dynamoMockQueryCommand = mockQueryCommand;
  globalMock.__dynamoMockUpdateCommand = mockUpdateCommand;
  globalMock.__dynamoMockDeleteCommand = mockDeleteCommand;
  globalMock.__dynamoMockBatchWriteCommand = mockBatchWriteCommand;
  globalMock.__dynamoMockTransactWriteCommand = mockTransactWriteCommand;
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

const partitionKey = (userId: string, threadId: string) =>
  createHash('sha256')
    .update(JSON.stringify([userId, threadId]))
    .digest('hex');

const PARTITION = partitionKey('user-123', 'thread-123');

const sentCommandTypes = () => mockSend.mock.calls.map((call: any[]) => (call[0] as any).__type);
const sentTxnItems = () =>
  mockTransactWriteCommand.mock.calls.map((call: any[]) => (call[0] as any).TransactItems);

const transactionConditionError = () =>
  Object.assign(new Error('Transaction cancelled'), {
    name: 'TransactionCanceledException',
    CancellationReasons: [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }],
  });

const stubTimeout = () =>
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
    fn();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout);

const threadRow = (overrides: Record<string, unknown> = {}) => ({
  UserId: 'user-123',
  ThreadId: 'thread-123',
  title: 'My thread',
  createdAt: 1693440000000,
  updatedAt: 1693440005000,
  ...overrides,
});

const messageRow = (overrides: Record<string, unknown> = {}): ChatHistoryItem => ({
  ThreadId: PARTITION,
  Timestamp: 1693440000000,
  UserId: 'user-123',
  message: 'hello',
  is_user: true,
  ...overrides,
});

const saveRequest = (body: Record<string, unknown>) =>
  new Request('http://localhost/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const validSaveBody = (overrides: Record<string, unknown> = {}) => ({
  ThreadId: 'thread-123',
  Timestamp: Date.now(),
  UserId: 'user-456',
  message: 'Hello world',
  is_user: true,
  ...overrides,
});

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
        'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      );
    });
  });

  describe('POST /save', () => {
    test('should upsert thread metadata and write a first user message atomically', async () => {
      mockSend.mockResolvedValue({});

      const app = createTestApp({
        AWS_ACCESS_KEY_ID: 'test-key',
        AWS_SECRET_ACCESS_KEY: 'test-secret',
        DDB_TABLE: 'vela-chat-history',
      });

      const res = await app.request(saveRequest(validSaveBody()));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);

      expect(sentCommandTypes()).toEqual(['TransactWriteCommand']);
      const [updateInput, putInput] = [sentTxnItems()[0][0].Update, sentTxnItems()[0][1].Put];

      expect(updateInput.TableName).toBe('vela-chat-threads');
      expect(updateInput.Key).toEqual({ UserId: 'user-123', ThreadId: 'thread-123' });
      expect(updateInput.UpdateExpression).toContain('if_not_exists(#title, :title)');
      expect(updateInput.UpdateExpression).toContain('if_not_exists(#createdAt, :now)');
      expect(updateInput.UpdateExpression).toContain('#updatedAt = :now');
      expect(updateInput.ConditionExpression).toContain('attribute_not_exists(#deleting)');
      expect(updateInput.ConditionExpression).toContain('#updatedAt <= :now');
      expect(updateInput.ExpressionAttributeValues[':title']).toBe('Hello world');
      expect(updateInput.ExpressionAttributeValues[':now']).toEqual(expect.any(Number));

      expect(putInput.TableName).toBe('vela-chat-history');
      expect(putInput.Item).toEqual(
        expect.objectContaining({
          ThreadId: PARTITION,
          message: 'Hello world',
          is_user: true,
          UserId: 'user-123',
          Timestamp: expect.any(Number),
        }),
      );
      expect(putInput.Item.ThreadId).not.toBe('thread-123');
    });

    test('should trim and truncate a long first user message to a 60-character title', async () => {
      mockSend.mockResolvedValue({});
      const app = createTestApp({});

      const longMessage = `   ${'a'.repeat(70)}   `;
      const res = await app.request(saveRequest(validSaveBody({ message: longMessage })));

      expect(res.status).toBe(200);
      const updateInput = sentTxnItems()[0][0].Update;
      expect(updateInput.ExpressionAttributeValues[':title']).toBe('a'.repeat(60));
    });

    test('should not split a surrogate pair at the 60-character title boundary', async () => {
      mockSend.mockResolvedValue({});
      const app = createTestApp({});

      const res = await app.request(
        saveRequest(validSaveBody({ message: `${'a'.repeat(59)}🔥 tail` })),
      );

      expect(res.status).toBe(200);
      const updateInput = sentTxnItems()[0][0].Update;
      expect(updateInput.ExpressionAttributeValues[':title']).toBe('a'.repeat(59));
    });

    test('should store the New conversation fallback title for a whitespace-only first message', async () => {
      mockSend.mockResolvedValue({});
      const app = createTestApp({});

      const res = await app.request(saveRequest(validSaveBody({ message: '   ' })));

      expect(res.status).toBe(200);
      const updateInput = sentTxnItems()[0][0].Update;
      expect(updateInput.ExpressionAttributeValues[':title']).toBe('New conversation');
    });

    test('should preserve an existing title and model on later user saves while bumping updatedAt', async () => {
      mockSend.mockResolvedValue({});
      const app = createTestApp({});

      const res = await app.request(
        saveRequest(validSaveBody({ message: 'A completely different follow-up question' })),
      );

      expect(res.status).toBe(200);
      const updateInput = sentTxnItems()[0][0].Update;
      expect(updateInput.UpdateExpression).toContain('if_not_exists(#title, :title)');
      expect(updateInput.UpdateExpression).not.toContain('#model');
      expect(updateInput.UpdateExpression).toContain('#updatedAt = :now');
    });

    test('should still write the message when the stored updatedAt is already newer', async () => {
      mockSend.mockRejectedValueOnce(transactionConditionError()).mockResolvedValueOnce({});
      const app = createTestApp({});

      const res = await app.request(saveRequest(validSaveBody()));

      expect(res.status).toBe(200);
      expect(mockSend).toHaveBeenCalledTimes(2);
      const fallbackItems = sentTxnItems()[1];
      expect(Object.keys(fallbackItems[0])).toEqual(['ConditionCheck']);
      expect(fallbackItems[0].ConditionCheck.TableName).toBe('vela-chat-threads');
      expect(fallbackItems[0].ConditionCheck.Key).toEqual({
        UserId: 'user-123',
        ThreadId: 'thread-123',
      });
      expect(fallbackItems[0].ConditionCheck.ConditionExpression).toContain(
        'attribute_not_exists(#deleting)',
      );
      expect(fallbackItems[1].Put.TableName).toBe('vela-chat-history');
      expect(fallbackItems[1].Put.Item.message).toBe('Hello world');
    });

    test('should write only the message for an assistant save', async () => {
      mockSend.mockResolvedValue({});
      const app = createTestApp({});

      const res = await app.request(saveRequest(validSaveBody({ is_user: false })));

      expect(res.status).toBe(200);
      expect(sentCommandTypes()).toEqual(['TransactWriteCommand']);
      const [conditionCheck, put] = sentTxnItems()[0];
      expect(conditionCheck.ConditionCheck.TableName).toBe('vela-chat-threads');
      expect(conditionCheck.ConditionCheck.Key).toEqual({
        UserId: 'user-123',
        ThreadId: 'thread-123',
      });
      expect(put.Put).toEqual(
        expect.objectContaining({
          TableName: 'vela-chat-history',
          Item: expect.objectContaining({
            ThreadId: PARTITION,
            is_user: false,
            UserId: 'user-123',
          }),
        }),
      );
    });

    test('should overwrite a stale client timestamp with the server time', async () => {
      mockSend.mockResolvedValue({});
      const app = createTestApp({});

      const before = Date.now();
      const res = await app.request(saveRequest(validSaveBody({ Timestamp: 1 })));

      expect(res.status).toBe(200);
      const putInput = sentTxnItems()[0][1].Put;
      expect(putInput.Item.Timestamp).toBeGreaterThanOrEqual(before);
    });

    test('should return 404 when a save lands while the thread is being deleted', async () => {
      mockSend
        .mockRejectedValueOnce(transactionConditionError())
        .mockRejectedValueOnce(transactionConditionError());
      const app = createTestApp({});

      const res = await app.request(saveRequest(validSaveBody()));
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toBe('Thread not found');
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    test('should return 404 when an assistant save lands after the thread row is gone', async () => {
      mockSend.mockRejectedValueOnce(transactionConditionError());
      const app = createTestApp({});

      const res = await app.request(saveRequest(validSaveBody({ is_user: false })));
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toBe('Thread not found');
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    test('should not write the message when the save transaction fails', async () => {
      mockSend.mockRejectedValueOnce(new Error('Metadata write failed'));
      const app = createTestApp({});

      const res = await app.request(saveRequest(validSaveBody()));
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toContain('Metadata write failed');
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    test('should retry and succeed when a transient transaction conflict occurs on save', async () => {
      const conflictError = Object.assign(new Error('Transaction conflict'), {
        name: 'TransactionCanceledException',
        CancellationReasons: [{ Code: 'TransactionConflict' }],
      });
      mockSend.mockRejectedValueOnce(conflictError).mockResolvedValueOnce({});
      const app = createTestApp({});

      const res = await app.request(saveRequest(validSaveBody()));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    test('should retry and succeed when TransactionConflictException occurs on assistant save', async () => {
      const conflictError = Object.assign(new Error('Transaction conflict'), {
        name: 'TransactionConflictException',
      });
      mockSend.mockRejectedValueOnce(conflictError).mockResolvedValueOnce({});
      const app = createTestApp({});

      const res = await app.request(saveRequest(validSaveBody({ is_user: false })));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    test('should return 500 when a non-condition transaction error occurs', async () => {
      mockSend.mockRejectedValueOnce(new Error('Message write failed'));
      const app = createTestApp({});

      const res = await app.request(saveRequest(validSaveBody()));
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toContain('Message write failed');
      expect(sentCommandTypes()).toEqual(['TransactWriteCommand']);
    });

    test('should handle DynamoDB errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('DynamoDB error'));
      const app = createTestApp({});

      const res = await app.request(saveRequest(validSaveBody({ is_user: false })));
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toContain('DynamoDB error');
    });

    test('should save without static AWS credentials in Hono bindings', async () => {
      mockSend.mockResolvedValue({});
      const app = createTestApp({});

      const res = await app.request(saveRequest(validSaveBody()));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET /threads', () => {
    test('should return thread metadata sorted by updatedAt descending for the authenticated user', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          threadRow({ ThreadId: 'thread-b', title: 'B', updatedAt: 1693440002000 }),
          threadRow({ ThreadId: 'thread-c', title: 'C', updatedAt: 1693440001000 }),
          threadRow({ ThreadId: 'thread-a', title: 'A', updatedAt: 1693440001000 }),
        ],
        LastEvaluatedKey: undefined,
      });

      const app = createTestApp({
        AWS_ACCESS_KEY_ID: 'test-key',
        AWS_SECRET_ACCESS_KEY: 'test-secret',
      });

      const res = await app.request(new Request('http://localhost/threads'));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.threads).toHaveLength(3);
      expect(json.threads[0].ThreadId).toBe('thread-b'); // Latest first
      expect(json.threads[1].ThreadId).toBe('thread-a');
      expect(json.threads[2].ThreadId).toBe('thread-c');
      expect(json.threads[0]).toEqual(
        expect.objectContaining({
          title: 'B',
          createdAt: expect.any(Number),
          updatedAt: 1693440002000,
        }),
      );

      expect(mockQueryCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'vela-chat-threads',
          KeyConditionExpression: 'UserId = :userId',
          ExpressionAttributeValues: { ':userId': 'user-123' },
        }),
      );
      const queryInput = mockQueryCommand.mock.calls[0][0];
      expect(queryInput).not.toHaveProperty('IndexName');
      expect(queryInput).not.toHaveProperty('ScanIndexForward');
    });

    test('should paginate through all thread metadata pages', async () => {
      mockSend
        .mockResolvedValueOnce({
          Items: [threadRow({ ThreadId: 'thread-1', updatedAt: 300 })],
          LastEvaluatedKey: { UserId: 'user-123', ThreadId: 'thread-1' },
        })
        .mockResolvedValueOnce({
          Items: [threadRow({ ThreadId: 'thread-2', updatedAt: 200 })],
          LastEvaluatedKey: undefined,
        });

      const app = createTestApp({});
      const res = await app.request(new Request('http://localhost/threads'));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.threads.map((t: any) => t.ThreadId)).toEqual(['thread-1', 'thread-2']);
      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(mockQueryCommand).toHaveBeenLastCalledWith(
        expect.objectContaining({
          ExclusiveStartKey: { UserId: 'user-123', ThreadId: 'thread-1' },
        }),
      );
    });

    test('should return an empty thread list when the user has no threads', async () => {
      mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
      const app = createTestApp({});

      const res = await app.request(new Request('http://localhost/threads'));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.threads).toEqual([]);
    });

    test('should issue strongly consistent reads on every metadata page', async () => {
      mockSend
        .mockResolvedValueOnce({
          Items: [threadRow({ ThreadId: 'thread-1', updatedAt: 300 })],
          LastEvaluatedKey: { UserId: 'user-123', ThreadId: 'thread-1' },
        })
        .mockResolvedValueOnce({
          Items: [threadRow({ ThreadId: 'thread-2', updatedAt: 200 })],
          LastEvaluatedKey: undefined,
        });

      const app = createTestApp({});
      const res = await app.request(new Request('http://localhost/threads'));

      expect(res.status).toBe(200);
      expect(mockSend).toHaveBeenCalledTimes(2);
      for (const [input] of mockQueryCommand.mock.calls) {
        expect(input.ConsistentRead).toBe(true);
      }
    });

    test('should return an acknowledged thread save despite replica lag', async () => {
      const saved = threadRow({ ThreadId: 'just-saved' });
      mockSend.mockImplementation((command: any) => {
        if (command.__type === 'QueryCommand') {
          const consistent = command.input.ConsistentRead === true;
          return Promise.resolve({ Items: consistent ? [saved] : [] });
        }
        return Promise.resolve({});
      });

      const app = createTestApp({});
      const res = await app.request(new Request('http://localhost/threads'));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.threads.map((t: any) => t.ThreadId)).toEqual(['just-saved']);
      expect(mockQueryCommand).toHaveBeenCalledWith(
        expect.objectContaining({ ConsistentRead: true }),
      );
    });

    test('should hide threads that carry a deleting tombstone', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          threadRow({ ThreadId: 'alive' }),
          threadRow({ ThreadId: 'mid-delete', deleting: true, updatedAt: 1693440009000 }),
        ],
      });

      const app = createTestApp({});
      const res = await app.request(new Request('http://localhost/threads'));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.threads.map((t: any) => t.ThreadId)).toEqual(['alive']);
    });

    test('should include the stored model on thread metadata when present', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [
          threadRow({
            ThreadId: 'thread-1',
            model: { provider: 'google', model: 'gemini-3.8-flash' },
          }),
        ],
      });

      const app = createTestApp({});
      const res = await app.request(new Request('http://localhost/threads'));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.threads[0].model).toEqual({ provider: 'google', model: 'gemini-3.8-flash' });
    });

    test('should return 500 when the metadata query fails', async () => {
      mockSend.mockRejectedValueOnce(new Error('Access denied'));
      const app = createTestApp({});

      const res = await app.request(new Request('http://localhost/threads'));
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toContain('Access denied');
    });

    test('should list threads without static AWS credentials in Hono bindings', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });
      const app = createTestApp({});
      const res = await app.request(new Request('http://localhost/threads'));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.threads).toEqual([]);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET /messages', () => {
    test('should fetch the thread metadata row before querying messages', async () => {
      mockSend.mockResolvedValueOnce({ Item: threadRow() }).mockResolvedValueOnce({
        Items: [messageRow()],
        LastEvaluatedKey: undefined,
      });

      const app = createTestApp({});
      const res = await app.request(new Request('http://localhost/messages?thread_id=thread-123'));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.items).toHaveLength(1);
      expect(json.items[0].ThreadId).toBe('thread-123');
      expect(sentCommandTypes()).toEqual(['GetCommand', 'QueryCommand']);
      expect(mockGetCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'vela-chat-threads',
          Key: { UserId: 'user-123', ThreadId: 'thread-123' },
        }),
      );
      expect(mockQueryCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'vela-chat-history',
          KeyConditionExpression: 'ThreadId = :threadId',
          ExpressionAttributeValues: { ':threadId': PARTITION },
        }),
      );
    });

    test('should return 404 Thread not found for a missing or unowned thread row', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      const app = createTestApp({});

      const res = await app.request(
        new Request('http://localhost/messages?thread_id=other-users-thread'),
      );
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toBe('Thread not found');
      expect(mockQueryCommand).not.toHaveBeenCalled();
    });

    test('should issue a strongly consistent read for the thread metadata existence check', async () => {
      mockSend
        .mockResolvedValueOnce({ Item: threadRow() })
        .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

      const app = createTestApp({});
      const res = await app.request(new Request('http://localhost/messages?thread_id=thread-123'));

      expect(res.status).toBe(200);
      expect(mockGetCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'vela-chat-threads',
          Key: { UserId: 'user-123', ThreadId: 'thread-123' },
          ConsistentRead: true,
        }),
      );
    });

    test('should return 404 Thread not found when the thread carries a deleting tombstone', async () => {
      mockSend.mockResolvedValueOnce({ Item: threadRow({ deleting: true }) });

      const app = createTestApp({});
      const res = await app.request(new Request('http://localhost/messages?thread_id=thread-123'));
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toBe('Thread not found');
      expect(mockQueryCommand).not.toHaveBeenCalled();
    });

    test('should return 200 with an empty items list for an owned empty thread', async () => {
      mockSend
        .mockResolvedValueOnce({ Item: threadRow() })
        .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

      const app = createTestApp({});
      const res = await app.request(new Request('http://localhost/messages?thread_id=thread-123'));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.items).toEqual([]);
    });

    test('should load all message pages for a thread', async () => {
      mockSend
        .mockResolvedValueOnce({ Item: threadRow() })
        .mockResolvedValueOnce({
          Items: [messageRow({ Timestamp: 1 })],
          LastEvaluatedKey: { ThreadId: PARTITION, Timestamp: 1 },
        })
        .mockResolvedValueOnce({
          Items: [messageRow({ Timestamp: 2 })],
          LastEvaluatedKey: undefined,
        });

      const app = createTestApp({});
      const res = await app.request(new Request('http://localhost/messages?thread_id=thread-123'));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.items).toHaveLength(2);
      expect(json.items.map((m: any) => m.Timestamp)).toEqual([1, 2]);
      expect(mockSend).toHaveBeenCalledTimes(3);
      expect(mockQueryCommand).toHaveBeenLastCalledWith(
        expect.objectContaining({
          ExclusiveStartKey: { ThreadId: PARTITION, Timestamp: 1 },
        }),
      );
    });

    test('should issue strongly consistent reads on every message page', async () => {
      mockSend
        .mockResolvedValueOnce({ Item: threadRow() })
        .mockResolvedValueOnce({
          Items: [messageRow({ Timestamp: 1 })],
          LastEvaluatedKey: { ThreadId: PARTITION, Timestamp: 1 },
        })
        .mockResolvedValueOnce({
          Items: [messageRow({ Timestamp: 2 })],
          LastEvaluatedKey: undefined,
        });

      const app = createTestApp({});
      const res = await app.request(new Request('http://localhost/messages?thread_id=thread-123'));

      expect(res.status).toBe(200);
      for (const [input] of mockQueryCommand.mock.calls) {
        expect(input.ConsistentRead).toBe(true);
      }
    });

    test('should return an acknowledged saved message despite replica lag', async () => {
      const saved = messageRow({ message: 'acknowledged save' });
      mockSend.mockImplementation((command: any) => {
        if (command.__type === 'GetCommand') {
          return Promise.resolve({ Item: threadRow() });
        }
        if (command.__type === 'QueryCommand') {
          const consistent = command.input.ConsistentRead === true;
          return Promise.resolve({ Items: consistent ? [saved] : [] });
        }
        return Promise.resolve({});
      });

      const app = createTestApp({});
      const res = await app.request(new Request('http://localhost/messages?thread_id=thread-123'));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.items).toHaveLength(1);
      expect(json.items[0].message).toBe('acknowledged save');
      expect(mockQueryCommand).toHaveBeenCalledWith(
        expect.objectContaining({ ConsistentRead: true }),
      );
    });

    test('should return 403 when stored messages belong to a different user', async () => {
      mockSend.mockResolvedValueOnce({ Item: threadRow() }).mockResolvedValueOnce({
        Items: [
          messageRow(),
          messageRow({ Timestamp: 1693440001000, UserId: 'other-user', message: 'intruder' }),
        ],
      });

      const app = createTestApp({});
      const res = await app.request(new Request('http://localhost/messages?thread_id=thread-123'));
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error).toContain('Forbidden');
    });

    test('should return 400 when thread_id is missing', async () => {
      const app = createTestApp({});
      const res = await app.request(new Request('http://localhost/messages'));
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('thread_id is required');
    });

    test('should return 500 when the metadata Get fails', async () => {
      mockSend.mockRejectedValueOnce(new Error('DynamoDB connection error'));
      const app = createTestApp({});

      const res = await app.request(new Request('http://localhost/messages?thread_id=thread-123'));
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toContain('DynamoDB connection error');
    });

    test('should get messages without static AWS credentials in Hono bindings', async () => {
      mockSend.mockResolvedValueOnce({ Item: threadRow() }).mockResolvedValueOnce({ Items: [] });
      const app = createTestApp({});

      const res = await app.request(new Request('http://localhost/messages?thread_id=thread-123'));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.items).toEqual([]);
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });

  describe('PATCH /thread/:id', () => {
    test('should rename a thread and return the updated row', async () => {
      const updatedRow = threadRow({ title: 'Renamed thread', updatedAt: 1693440009000 });
      mockSend.mockResolvedValueOnce({ Attributes: updatedRow });

      const app = createTestApp({});
      const res = await app.request(
        new Request('http://localhost/thread/thread-123', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: '  Renamed thread  ' }),
        }),
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.thread).toEqual(updatedRow);

      const updateInput = mockUpdateCommand.mock.calls[0][0];
      expect(updateInput.TableName).toBe('vela-chat-threads');
      expect(updateInput.Key).toEqual({ UserId: 'user-123', ThreadId: 'thread-123' });
      expect(updateInput.ConditionExpression).toContain('attribute_exists');
      expect(updateInput.UpdateExpression).toContain('#title = :title');
      expect(updateInput.UpdateExpression).toContain('#updatedAt = :updatedAt');
      expect(updateInput.ExpressionAttributeValues[':title']).toBe('Renamed thread');
      expect(updateInput.ExpressionAttributeValues[':updatedAt']).toEqual(expect.any(Number));
      expect(updateInput.ReturnValues).toBe('ALL_NEW');
    });

    test('should store a validated model pair', async () => {
      const updatedRow = threadRow({ model: { provider: 'google', model: 'gemini-3.8-flash' } });
      mockSend.mockResolvedValueOnce({ Attributes: updatedRow });

      const app = createTestApp({});
      const res = await app.request(
        new Request('http://localhost/thread/thread-123', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: { provider: 'google', model: 'gemini-3.8-flash' } }),
        }),
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.thread.model).toEqual({ provider: 'google', model: 'gemini-3.8-flash' });
      const updateInput = mockUpdateCommand.mock.calls[0][0];
      expect(updateInput.UpdateExpression).toContain('#model = :model');
      expect(updateInput.ExpressionAttributeValues[':model']).toEqual({
        provider: 'google',
        model: 'gemini-3.8-flash',
      });
    });

    test('should update title and model together', async () => {
      mockSend.mockResolvedValueOnce({ Attributes: threadRow() });
      const app = createTestApp({});

      const res = await app.request(
        new Request('http://localhost/thread/thread-123', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'New title',
            model: { provider: 'anthropic', model: 'claude-opus-4' },
          }),
        }),
      );

      expect(res.status).toBe(200);
      const updateInput = mockUpdateCommand.mock.calls[0][0];
      expect(updateInput.ExpressionAttributeValues[':title']).toBe('New title');
      expect(updateInput.ExpressionAttributeValues[':model']).toEqual({
        provider: 'anthropic',
        model: 'claude-opus-4',
      });
    });

    test.each([
      ['an empty body', {}],
      ['an empty title', { title: '' }],
      ['a whitespace-only title', { title: '   ' }],
      ['a title over 60 characters', { title: 'a'.repeat(61) }],
      ['a non-string title', { title: 42 }],
      ['an empty model object', { model: {} }],
      ['an unsupported provider', { model: { provider: 'bedrock', model: 'x' } }],
      ['an empty model id', { model: { provider: 'google', model: '' } }],
    ])('should return 400 for %s', async (_label, body) => {
      const app = createTestApp({});
      const res = await app.request(
        new Request('http://localhost/thread/thread-123', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toBeDefined();
      expect(mockUpdateCommand).not.toHaveBeenCalled();
    });

    test('should accept a title of exactly 60 characters', async () => {
      mockSend.mockResolvedValueOnce({ Attributes: threadRow() });
      const app = createTestApp({});

      const res = await app.request(
        new Request('http://localhost/thread/thread-123', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'a'.repeat(60) }),
        }),
      );

      expect(res.status).toBe(200);
    });

    test('should apply the patch without rewinding a newer stored updatedAt', async () => {
      const conditionalError = Object.assign(new Error('Condition check failed'), {
        name: 'ConditionalCheckFailedException',
      });
      const updatedRow = threadRow({ title: 'Renamed thread', updatedAt: 1693440009999 });
      mockSend.mockRejectedValueOnce(conditionalError).mockResolvedValueOnce({
        Attributes: updatedRow,
      });

      const app = createTestApp({});
      const res = await app.request(
        new Request('http://localhost/thread/thread-123', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Renamed thread' }),
        }),
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.thread).toEqual(updatedRow);
      expect(mockSend).toHaveBeenCalledTimes(2);
      const retryInput = mockUpdateCommand.mock.calls[1][0];
      expect(retryInput.UpdateExpression).not.toContain('#updatedAt');
      expect(retryInput.UpdateExpression).toContain('#title = :title');
      expect(retryInput.ConditionExpression).toContain('attribute_exists');
    });

    test('should return 404 Thread not found when the thread row does not exist', async () => {
      const conditionalError = Object.assign(new Error('Condition check failed'), {
        name: 'ConditionalCheckFailedException',
      });
      // Both the timestamp-bumping attempt and the fields-only retry must fail.
      mockSend.mockRejectedValue(conditionalError);

      const app = createTestApp({});
      const res = await app.request(
        new Request('http://localhost/thread/missing-thread', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Whatever' }),
        }),
      );
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toBe('Thread not found');
    });

    test('should return 500 on other DynamoDB errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('Throughput exceeded'));
      const app = createTestApp({});

      const res = await app.request(
        new Request('http://localhost/thread/thread-123', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Whatever' }),
        }),
      );
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toContain('Throughput exceeded');
    });
  });

  describe('DELETE /thread/:id', () => {
    test('should tombstone the thread row first, then delete its messages in batches', async () => {
      mockSend
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ Items: [messageRow()], LastEvaluatedKey: undefined })
        .mockResolvedValueOnce({ UnprocessedItems: {} });

      const app = createTestApp({});
      const res = await app.request(
        new Request('http://localhost/thread/thread-123', { method: 'DELETE' }),
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(sentCommandTypes()).toEqual([
        'UpdateCommand',
        'QueryCommand',
        'BatchWriteCommand',
        'DeleteCommand',
      ]);

      const markInput = mockUpdateCommand.mock.calls[0][0];
      expect(markInput.TableName).toBe('vela-chat-threads');
      expect(markInput.Key).toEqual({ UserId: 'user-123', ThreadId: 'thread-123' });
      expect(markInput.UpdateExpression).toContain('SET #deleting = :true');
      expect(markInput.ConditionExpression).toContain('attribute_exists(ThreadId)');
      expect(markInput.ConditionExpression).toContain('attribute_not_exists(#deleting)');
      expect(markInput.ConditionExpression).toContain('#deleteLease < :now');

      const queryInput = mockQueryCommand.mock.calls[0][0];
      expect(queryInput.ExpressionAttributeValues[':threadId']).toBe(PARTITION);
      const batchInput = mockBatchWriteCommand.mock.calls[0][0];
      expect(batchInput.RequestItems['vela-chat-history']).toEqual([
        {
          DeleteRequest: {
            Key: { ThreadId: PARTITION, Timestamp: messageRow().Timestamp },
          },
        },
      ]);
      // Success removes the metadata row so no permanent tombstone marker remains.
      expect(mockDeleteCommand).toHaveBeenCalledTimes(1);
      const finalizeInput = mockDeleteCommand.mock.calls[0][0];
      expect(finalizeInput.TableName).toBe('vela-chat-threads');
      expect(finalizeInput.Key).toEqual({ UserId: 'user-123', ThreadId: 'thread-123' });
      expect(finalizeInput.ConditionExpression).toContain('#deleteToken = :deleteToken');
    });

    test('should return 404 Thread not found for a missing or unowned thread row', async () => {
      const conditionalError = Object.assign(new Error('Condition check failed'), {
        name: 'ConditionalCheckFailedException',
      });
      mockSend.mockRejectedValueOnce(conditionalError).mockResolvedValueOnce({ Item: undefined });
      const app = createTestApp({});

      const res = await app.request(
        new Request('http://localhost/thread/other-users-thread', { method: 'DELETE' }),
      );
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toBe('Thread not found');
      expect(sentCommandTypes()).toEqual(['UpdateCommand', 'GetCommand']);
      expect(mockQueryCommand).not.toHaveBeenCalled();
    });

    test('should return 404 Thread not found on repeat delete after thread is deleted', async () => {
      const conditionalError = Object.assign(new Error('Condition check failed'), {
        name: 'ConditionalCheckFailedException',
      });
      // The thread metadata row was already deleted, so GetCommand returns undefined.
      mockSend.mockRejectedValueOnce(conditionalError).mockResolvedValueOnce({ Item: undefined });

      const app = createTestApp({});
      const res = await app.request(
        new Request('http://localhost/thread/thread-123', { method: 'DELETE' }),
      );
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toBe('Thread not found');
      expect(sentCommandTypes()).toEqual(['UpdateCommand', 'GetCommand']);
      expect(mockQueryCommand).not.toHaveBeenCalled();
      expect(mockUpdateCommand).toHaveBeenCalledTimes(1);
    });

    test('should wait for in-flight delete and return 404 once deleted rather than premature ok', async () => {
      const conditionalError = Object.assign(new Error('Condition check failed'), {
        name: 'ConditionalCheckFailedException',
      });
      // Another delete is in progress with an active lease. On next check after waiting,
      // the first delete has completed and the row is gone.
      mockSend
        .mockRejectedValueOnce(conditionalError)
        .mockResolvedValueOnce({
          Item: threadRow({
            deleting: true,
            deleteToken: 'other-delete',
            deleteLease: Date.now() + 60_000,
          }),
        })
        .mockRejectedValueOnce(conditionalError)
        .mockResolvedValueOnce({ Item: undefined });

      const app = createTestApp({});
      const res = await app.request(
        new Request('http://localhost/thread/thread-123', { method: 'DELETE' }),
      );
      const json = await res.json();

      expect(res.status).toBe(404);
      expect(json.error).toBe('Thread not found');
      expect(mockQueryCommand).not.toHaveBeenCalled();
      expect(mockBatchWriteCommand).not.toHaveBeenCalled();
    });

    test('should take over a stale barrier left by a delete that never finished', async () => {
      const conditionalError = Object.assign(new Error('Condition check failed'), {
        name: 'ConditionalCheckFailedException',
      });
      // The first acquire loses to a lease that was still live at evaluation;
      // by the read it has expired, so the retry steals the barrier and the
      // delete proceeds normally.
      mockSend
        .mockRejectedValueOnce(conditionalError)
        .mockResolvedValueOnce({
          Item: threadRow({
            deleting: true,
            deleteToken: 'dead-delete',
            deleteLease: Date.now() - 60_000,
          }),
        })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined })
        .mockResolvedValueOnce({});

      const app = createTestApp({});
      const res = await app.request(
        new Request('http://localhost/thread/thread-123', { method: 'DELETE' }),
      );

      expect(res.status).toBe(200);
      expect(sentCommandTypes()).toEqual([
        'UpdateCommand',
        'GetCommand',
        'UpdateCommand',
        'QueryCommand',
        'DeleteCommand',
      ]);
      const reacquireInput = mockUpdateCommand.mock.calls[1][0];
      expect(reacquireInput.UpdateExpression).toContain('SET #deleting = :true');
      const finalizeInput = mockDeleteCommand.mock.calls[0][0];
      expect(finalizeInput.ConditionExpression).toContain('#deleteToken = :deleteToken');
    });

    test('should retry the barrier acquire when the flag clears before the read', async () => {
      const conditionalError = Object.assign(new Error('Condition check failed'), {
        name: 'ConditionalCheckFailedException',
      });
      mockSend
        .mockRejectedValueOnce(conditionalError)
        .mockResolvedValueOnce({ Item: threadRow() })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined })
        .mockResolvedValueOnce({});

      const app = createTestApp({});
      const res = await app.request(
        new Request('http://localhost/thread/thread-123', { method: 'DELETE' }),
      );

      expect(res.status).toBe(200);
      expect(sentCommandTypes()).toEqual([
        'UpdateCommand',
        'GetCommand',
        'UpdateCommand',
        'QueryCommand',
        'DeleteCommand',
      ]);
    });

    test('should reject deletion when stored messages belong to another user', async () => {
      mockSend
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({
          Items: [
            messageRow(),
            messageRow({ Timestamp: 1693440001000, UserId: 'other-user', message: 'intruder' }),
          ],
          LastEvaluatedKey: undefined,
        })
        .mockResolvedValueOnce({});

      const app = createTestApp({});
      const res = await app.request(
        new Request('http://localhost/thread/thread-123', { method: 'DELETE' }),
      );
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error).toContain('Forbidden');
      expect(mockBatchWriteCommand).not.toHaveBeenCalled();
      // The tombstone is cleared so the thread stays usable. The clear is
      // fenced on this delete's token so it cannot remove another barrier.
      expect(mockUpdateCommand).toHaveBeenCalledTimes(2);
      const clearInput = mockUpdateCommand.mock.calls[1][0];
      expect(clearInput.UpdateExpression).toContain('REMOVE #deleting');
      expect(clearInput.ConditionExpression).toContain('#deleteToken = :deleteToken');
    });

    test('should reject deletion when a foreign message row appears on a later page', async () => {
      mockSend
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({
          Items: [messageRow({ Timestamp: 1 })],
          LastEvaluatedKey: { ThreadId: PARTITION, Timestamp: 1 },
        })
        .mockResolvedValueOnce({
          Items: [messageRow({ Timestamp: 2, UserId: 'other-user', message: 'intruder' })],
          LastEvaluatedKey: undefined,
        })
        .mockResolvedValueOnce({});

      const app = createTestApp({});
      const res = await app.request(
        new Request('http://localhost/thread/thread-123', { method: 'DELETE' }),
      );
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error).toContain('Forbidden');
      expect(mockSend).toHaveBeenCalledTimes(4);
      expect(mockBatchWriteCommand).not.toHaveBeenCalled();
      expect(mockUpdateCommand.mock.calls[1][0].UpdateExpression).toContain('REMOVE #deleting');
    });

    test('should tombstone an owned empty thread without batch deletes', async () => {
      mockSend
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined })
        .mockResolvedValueOnce({});

      const app = createTestApp({});
      const res = await app.request(
        new Request('http://localhost/thread/thread-123', { method: 'DELETE' }),
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(sentCommandTypes()).toEqual(['UpdateCommand', 'QueryCommand', 'DeleteCommand']);
      expect(mockBatchWriteCommand).not.toHaveBeenCalled();
    });

    test('should enumerate all message pages before deleting', async () => {
      mockSend
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({
          Items: [messageRow({ Timestamp: 1 })],
          LastEvaluatedKey: { ThreadId: PARTITION, Timestamp: 1 },
        })
        .mockResolvedValueOnce({
          Items: [messageRow({ Timestamp: 2 })],
          LastEvaluatedKey: undefined,
        })
        .mockResolvedValueOnce({ UnprocessedItems: {} });

      const app = createTestApp({});
      const res = await app.request(
        new Request('http://localhost/thread/thread-123', { method: 'DELETE' }),
      );

      expect(res.status).toBe(200);
      expect(mockQueryCommand).toHaveBeenLastCalledWith(
        expect.objectContaining({
          ExclusiveStartKey: { ThreadId: PARTITION, Timestamp: 1 },
        }),
      );
      expect(sentCommandTypes()).toEqual([
        'UpdateCommand',
        'QueryCommand',
        'QueryCommand',
        'BatchWriteCommand',
        'DeleteCommand',
      ]);
    });

    test('should issue strongly consistent reads on every delete-enumeration page', async () => {
      mockSend
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({
          Items: [messageRow({ Timestamp: 1 })],
          LastEvaluatedKey: { ThreadId: PARTITION, Timestamp: 1 },
        })
        .mockResolvedValueOnce({
          Items: [messageRow({ Timestamp: 2 })],
          LastEvaluatedKey: undefined,
        })
        .mockResolvedValueOnce({ UnprocessedItems: {} });

      const app = createTestApp({});
      const res = await app.request(
        new Request('http://localhost/thread/thread-123', { method: 'DELETE' }),
      );

      expect(res.status).toBe(200);
      expect(mockQueryCommand.mock.calls.length).toBe(2);
      for (const [input] of mockQueryCommand.mock.calls) {
        expect(input.ConsistentRead).toBe(true);
      }
    });

    test('should fully delete an acknowledged saved message despite replica lag', async () => {
      const saved = messageRow({ Timestamp: 4242, message: 'acknowledged save' });
      mockSend.mockImplementation((command: any) => {
        if (command.__type === 'QueryCommand') {
          const consistent = command.input.ConsistentRead === true;
          return Promise.resolve({ Items: consistent ? [saved] : [] });
        }
        if (command.__type === 'BatchWriteCommand') {
          return Promise.resolve({ UnprocessedItems: {} });
        }
        return Promise.resolve({});
      });

      const app = createTestApp({});
      const res = await app.request(
        new Request('http://localhost/thread/thread-123', { method: 'DELETE' }),
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(mockQueryCommand).toHaveBeenCalledWith(
        expect.objectContaining({ ConsistentRead: true }),
      );
      expect(mockBatchWriteCommand).toHaveBeenCalledTimes(1);
      expect(mockBatchWriteCommand.mock.calls[0][0].RequestItems['vela-chat-history']).toEqual([
        {
          DeleteRequest: {
            Key: { ThreadId: PARTITION, Timestamp: saved.Timestamp },
          },
        },
      ]);
    });

    test('should chunk message deletes into batches of 25', async () => {
      const messages = Array.from({ length: 26 }, (_, i) => messageRow({ Timestamp: i + 1 }));
      mockSend
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ Items: messages, LastEvaluatedKey: undefined })
        .mockResolvedValue({ UnprocessedItems: {} });
      const app = createTestApp({});

      const res = await app.request(
        new Request('http://localhost/thread/thread-123', { method: 'DELETE' }),
      );

      expect(res.status).toBe(200);
      expect(mockBatchWriteCommand).toHaveBeenCalledTimes(2);
      expect(mockBatchWriteCommand.mock.calls[0][0].RequestItems['vela-chat-history']).toHaveLength(
        25,
      );
      expect(mockBatchWriteCommand.mock.calls[1][0].RequestItems['vela-chat-history']).toHaveLength(
        1,
      );
    });

    test('should retry batch delete when there are unprocessed items', async () => {
      // Stub setTimeout so exponential backoff in the retry loop does not add real delay
      const setTimeoutSpy = stubTimeout();
      try {
        const message = messageRow();
        mockSend
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({ Items: [message], LastEvaluatedKey: undefined })
          .mockResolvedValueOnce({
            UnprocessedItems: {
              'vela-chat-history': [
                { DeleteRequest: { Key: { ThreadId: PARTITION, Timestamp: message.Timestamp } } },
              ],
            },
          })
          .mockResolvedValueOnce({ UnprocessedItems: {} });

        const app = createTestApp({});
        const res = await app.request(
          new Request('http://localhost/thread/thread-123', { method: 'DELETE' }),
        );
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.ok).toBe(true);
        expect(sentCommandTypes()).toEqual([
          'UpdateCommand',
          'QueryCommand',
          'BatchWriteCommand',
          'BatchWriteCommand',
          'DeleteCommand',
        ]);
      } finally {
        setTimeoutSpy.mockRestore();
      }
    });

    test('should clear the tombstone when batch delete retries are exhausted', async () => {
      const setTimeoutSpy = stubTimeout();
      try {
        const message = messageRow();
        mockSend
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({ Items: [message], LastEvaluatedKey: undefined })
          .mockResolvedValue({
            UnprocessedItems: {
              'vela-chat-history': [
                { DeleteRequest: { Key: { ThreadId: PARTITION, Timestamp: message.Timestamp } } },
              ],
            },
          });

        const app = createTestApp({});
        const res = await app.request(
          new Request('http://localhost/thread/thread-123', { method: 'DELETE' }),
        );
        const json = await res.json();

        expect(res.status).toBe(500);
        expect(json.error).toContain('Failed to delete all messages');
        // Mark, then best-effort clear so the thread stays usable.
        expect(mockUpdateCommand).toHaveBeenCalledTimes(2);
        expect(mockUpdateCommand.mock.calls[1][0].UpdateExpression).toContain('REMOVE #deleting');
        expect(mockUpdateCommand.mock.calls[1][0].ConditionExpression).toContain(
          '#deleteToken = :deleteToken',
        );
      } finally {
        setTimeoutSpy.mockRestore();
      }
    });

    test('should return 500 when the tombstone write fails', async () => {
      mockSend.mockRejectedValueOnce(new Error('DynamoDB error'));
      const app = createTestApp({});

      const res = await app.request(
        new Request('http://localhost/thread/thread-123', { method: 'DELETE' }),
      );
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toContain('DynamoDB error');
    });

    test('should not expose a legacy query-string DELETE /thread alias', async () => {
      const app = createTestApp({});
      const res = await app.request(
        new Request('http://localhost/thread?thread_id=thread-123', { method: 'DELETE' }),
      );

      expect(res.status).toBe(404);
      expect(mockSend).not.toHaveBeenCalled();
    });

    test('should delete without static AWS credentials in Hono bindings', async () => {
      mockSend
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ Items: [] })
        .mockResolvedValueOnce({});
      const app = createTestApp({});

      const res = await app.request(
        new Request('http://localhost/thread/thread-123', { method: 'DELETE' }),
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      expect(mockSend).toHaveBeenCalledTimes(3);
    });
  });

  describe('cross-user thread isolation', () => {
    test('should scope the same public ThreadId to each caller on user saves', async () => {
      mockSend.mockResolvedValue({});
      const app = createTestApp({});

      globalMock.__authUserId = 'user-123';
      const first = await app.request(saveRequest(validSaveBody({ ThreadId: 'shared-thread' })));
      globalMock.__authUserId = 'user-456';
      const second = await app.request(saveRequest(validSaveBody({ ThreadId: 'shared-thread' })));

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);

      const [firstUpdate, secondUpdate] = sentTxnItems().map((items: any[]) => items[0].Update);
      expect(firstUpdate.Key).toEqual({ UserId: 'user-123', ThreadId: 'shared-thread' });
      expect(secondUpdate.Key).toEqual({ UserId: 'user-456', ThreadId: 'shared-thread' });

      const [firstPut, secondPut] = sentTxnItems().map((items: any[]) => items[1].Put);
      expect(firstPut.Item.ThreadId).toBe(partitionKey('user-123', 'shared-thread'));
      expect(firstPut.Item.UserId).toBe('user-123');
      expect(secondPut.Item.ThreadId).toBe(partitionKey('user-456', 'shared-thread'));
      expect(secondPut.Item.UserId).toBe('user-456');
      expect(firstPut.Item.ThreadId).not.toBe(secondPut.Item.ThreadId);
      expect(firstPut.Item.ThreadId).not.toBe('shared-thread');
    });

    test('should scope an assistant save to the caller partition without touching metadata', async () => {
      mockSend.mockResolvedValue({});
      const app = createTestApp({});

      globalMock.__authUserId = 'user-456';
      const res = await app.request(
        saveRequest(validSaveBody({ ThreadId: 'shared-thread', is_user: false })),
      );

      expect(res.status).toBe(200);
      expect(mockUpdateCommand).not.toHaveBeenCalled();
      const putInput = sentTxnItems()[0][1].Put;
      expect(putInput.Item.ThreadId).toBe(partitionKey('user-456', 'shared-thread'));
      expect(putInput.Item.UserId).toBe('user-456');
    });

    test('should query the caller-scoped partition when reading messages', async () => {
      globalMock.__authUserId = 'user-456';
      mockSend
        .mockResolvedValueOnce({
          Item: threadRow({ UserId: 'user-456', ThreadId: 'shared-thread' }),
        })
        .mockResolvedValueOnce({ Items: [] });

      const app = createTestApp({});
      const res = await app.request(
        new Request('http://localhost/messages?thread_id=shared-thread'),
      );

      expect(res.status).toBe(200);
      expect(mockQueryCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ExpressionAttributeValues: {
            ':threadId': partitionKey('user-456', 'shared-thread'),
          },
        }),
      );
    });

    test('should delete only the caller partition for a shared public ThreadId', async () => {
      globalMock.__authUserId = 'user-456';
      mockSend
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({
          Items: [
            messageRow({
              ThreadId: partitionKey('user-456', 'shared-thread'),
              UserId: 'user-456',
            }),
          ],
          LastEvaluatedKey: undefined,
        })
        .mockResolvedValueOnce({ UnprocessedItems: {} });

      const app = createTestApp({});
      const res = await app.request(
        new Request('http://localhost/thread/shared-thread', { method: 'DELETE' }),
      );

      expect(res.status).toBe(200);
      expect(mockUpdateCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: { UserId: 'user-456', ThreadId: 'shared-thread' },
        }),
      );
      expect(mockQueryCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ExpressionAttributeValues: {
            ':threadId': partitionKey('user-456', 'shared-thread'),
          },
        }),
      );
    });
  });
});

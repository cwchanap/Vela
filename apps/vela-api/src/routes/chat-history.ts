import { createHash } from 'crypto';
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env } from '../types';
import { requireAuth, type AuthContext } from '../middleware/auth';
import {
  ChatHistoryItemSchema,
  ThreadIdQuerySchema,
  PatchChatThreadSchema,
  type ChatHistoryItem,
  type ChatThreadModel,
  type ChatThreadSummary,
  type ThreadIdQuery,
  type PatchChatThread,
} from '../validation';
import { docClient, TABLE_NAMES } from '../dynamodb';
import * as DynamoDbLib from '@aws-sdk/lib-dynamodb';
import type { QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import type { ZodIssue, ZodTypeAny } from 'zod';

const { PutCommand, GetCommand, QueryCommand, UpdateCommand, DeleteCommand, BatchWriteCommand } =
  DynamoDbLib;

const chatHistory = new Hono<{ Bindings: Env } & AuthContext>();

const formatIssueMessage = (issue: ZodIssue) => {
  if (issue.code === 'invalid_type') {
    const received = 'received' in issue ? issue.received : undefined;
    if (received === 'undefined' || received === undefined) {
      const field = issue.path.join('.') || 'value';
      return `${field} is required`;
    }
  }

  if (issue.code === 'too_small' && 'minimum' in issue && issue.minimum === 1) {
    const field = issue.path.join('.') || 'value';
    return `${field} is required`;
  }

  return issue.message;
};

const createValidator = <T extends ZodTypeAny>(target: 'query' | 'json', schema: T) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) {
      const message = result.error.issues.map(formatIssueMessage).join(', ');
      return c.json({ error: message }, 400);
    }
  });

const isConditionalCheckFailedError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'name' in error &&
  error.name === 'ConditionalCheckFailedException';

// Apply auth middleware to all chat history routes.
chatHistory.use('*', requireAuth);

/* ========================
 * DynamoDB implementation
 * ======================== */

async function queryAllPages(input: QueryCommandInput): Promise<Record<string, any>[]> {
  const items: Record<string, any>[] = [];
  let lastEvaluatedKey: Record<string, any> | undefined;

  do {
    const command = new QueryCommand({ ...input, ExclusiveStartKey: lastEvaluatedKey });
    const response = await docClient.send(command);
    items.push(...(response.Items || []));
    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return items;
}

const messagePartitionKey = (userId: string, threadId: string): string =>
  createHash('sha256')
    .update(JSON.stringify([userId, threadId]))
    .digest('hex');

async function dynamodb_saveMessage(item: ChatHistoryItem): Promise<void> {
  try {
    const command = new PutCommand({
      TableName: TABLE_NAMES.CHAT_HISTORY,
      Item: {
        ThreadId: messagePartitionKey(item.UserId, item.ThreadId),
        Timestamp: item.Timestamp,
        UserId: item.UserId,
        message: item.message,
        is_user: item.is_user,
        context: {},
      },
    });
    await docClient.send(command);
  } catch (error) {
    console.error('DynamoDB save message error:', error);
    throw new Error(
      `Failed to save message: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

async function dynamodb_getThread(
  userId: string,
  threadId: string,
): Promise<ChatThreadSummary | undefined> {
  try {
    const command = new GetCommand({
      TableName: TABLE_NAMES.CHAT_THREADS,
      Key: { UserId: userId, ThreadId: threadId },
      ConsistentRead: true,
    });
    const response = await docClient.send(command);
    return response.Item as ChatThreadSummary | undefined;
  } catch (error) {
    console.error('DynamoDB get thread error:', error);
    throw new Error(
      `Failed to fetch thread: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

async function dynamodb_upsertThread(
  userId: string,
  threadId: string,
  initialTitle: string,
  now: number,
): Promise<void> {
  try {
    const command = new UpdateCommand({
      TableName: TABLE_NAMES.CHAT_THREADS,
      Key: { UserId: userId, ThreadId: threadId },
      UpdateExpression:
        'SET #updatedAt = :now, #title = if_not_exists(#title, :title), #createdAt = if_not_exists(#createdAt, :now)',
      ExpressionAttributeNames: {
        '#updatedAt': 'updatedAt',
        '#title': 'title',
        '#createdAt': 'createdAt',
      },
      ExpressionAttributeValues: {
        ':now': now,
        ':title': initialTitle,
      },
    });
    await docClient.send(command);
  } catch (error) {
    console.error('DynamoDB upsert thread error:', error);
    throw new Error(
      `Failed to save thread: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

async function dynamodb_updateThread(
  userId: string,
  threadId: string,
  patch: PatchChatThread,
  now: number,
): Promise<ChatThreadSummary> {
  const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
  const values: Record<string, unknown> = { ':updatedAt': now };
  const setClauses = ['#updatedAt = :updatedAt'];

  if (patch.title !== undefined) {
    names['#title'] = 'title';
    values[':title'] = patch.title;
    setClauses.push('#title = :title');
  }
  if (patch.model !== undefined) {
    names['#model'] = 'model';
    values[':model'] = patch.model;
    setClauses.push('#model = :model');
  }

  try {
    const command = new UpdateCommand({
      TableName: TABLE_NAMES.CHAT_THREADS,
      Key: { UserId: userId, ThreadId: threadId },
      UpdateExpression: `SET ${setClauses.join(', ')}`,
      ConditionExpression: 'attribute_exists(ThreadId)',
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    });
    const response = await docClient.send(command);
    return response.Attributes as ChatThreadSummary;
  } catch (error) {
    if (isConditionalCheckFailedError(error)) {
      throw error;
    }
    console.error('DynamoDB update thread error:', error);
    throw new Error(
      `Failed to update thread: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

async function dynamodb_listThreads(userId: string): Promise<ChatThreadSummary[]> {
  try {
    const rows = await queryAllPages({
      TableName: TABLE_NAMES.CHAT_THREADS,
      KeyConditionExpression: 'UserId = :userId',
      ExpressionAttributeValues: {
        ':userId': userId,
      },
    });

    const threads = rows.map((row) => ({
      ThreadId: row.ThreadId as string,
      title: row.title as string,
      createdAt: row.createdAt as number,
      updatedAt: row.updatedAt as number,
      ...(row.model !== undefined ? { model: row.model as ChatThreadModel } : {}),
    }));

    return threads.sort(
      (a, b) => b.updatedAt - a.updatedAt || a.ThreadId.localeCompare(b.ThreadId),
    );
  } catch (error) {
    console.error('DynamoDB list threads error:', error);
    throw new Error(
      `Failed to fetch threads: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

async function dynamodb_getMessages(userId: string, thread_id: string): Promise<ChatHistoryItem[]> {
  try {
    // Query by ThreadId partition key for efficient lookup
    const messages = await queryAllPages({
      TableName: TABLE_NAMES.CHAT_HISTORY,
      KeyConditionExpression: 'ThreadId = :threadId',
      ExpressionAttributeValues: {
        ':threadId': messagePartitionKey(userId, thread_id),
      },
    });

    return messages.map((message) => ({
      ThreadId: thread_id,
      Timestamp: message.Timestamp,
      UserId: message.UserId,
      message: message.message,
      is_user: message.is_user,
    }));
  } catch (error) {
    console.error('DynamoDB get messages error:', error);
    throw new Error(
      `Failed to fetch messages: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

async function dynamodb_deleteThreadMessages(allMessages: Record<string, any>[]): Promise<void> {
  if (allMessages.length === 0) {
    return; // Nothing to delete
  }

  // DynamoDB BatchWrite can handle up to 25 items at a time
  const batchSize = 25;
  for (let i = 0; i < allMessages.length; i += batchSize) {
    const batch = allMessages.slice(i, i + batchSize);
    let deleteRequests = batch.map((msg) => ({
      DeleteRequest: {
        Key: {
          ThreadId: msg.ThreadId,
          Timestamp: msg.Timestamp,
        },
      },
    }));

    // Retry unprocessed items until all are deleted (with max retries to prevent infinite loops)
    let retries = 0;
    const maxRetries = 5;

    while (deleteRequests.length > 0 && retries < maxRetries) {
      const batchCommand = new BatchWriteCommand({
        RequestItems: {
          [TABLE_NAMES.CHAT_HISTORY]: deleteRequests,
        },
      });

      const response = await docClient.send(batchCommand);

      // Check for unprocessed items and retry them
      const unprocessedItems = response.UnprocessedItems?.[TABLE_NAMES.CHAT_HISTORY];
      if (unprocessedItems && unprocessedItems.length > 0) {
        deleteRequests = unprocessedItems as any; // DynamoDB SDK returns the same format we need
        retries++;
        // Exponential backoff: wait before retrying
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, retries) * 100));
      } else {
        // All items processed successfully
        break;
      }
    }

    // If we exhausted retries and still have unprocessed items, throw an error
    if (deleteRequests.length > 0 && retries >= maxRetries) {
      throw new Error(
        `Failed to delete all messages after ${maxRetries} retries. ${deleteRequests.length} items remain unprocessed.`,
      );
    }
  }
}

async function dynamodb_deleteThread(
  userId: string,
  threadId: string,
): Promise<'ok' | 'forbidden'> {
  try {
    // Paginate through all query results to get ALL messages in the thread
    const allMessages = await queryAllPages({
      TableName: TABLE_NAMES.CHAT_HISTORY,
      KeyConditionExpression: 'ThreadId = :threadId',
      ExpressionAttributeValues: {
        ':threadId': messagePartitionKey(userId, threadId),
      },
    });

    // SECURITY: Verify the user owns this thread before deleting
    // Ensure all thread messages belong to the authenticated user.
    // This prevents deleting mixed-owner/corrupted threads.
    if (!allMessages.every((message) => message.UserId === userId)) {
      return 'forbidden';
    }

    await dynamodb_deleteThreadMessages(allMessages);

    const command = new DeleteCommand({
      TableName: TABLE_NAMES.CHAT_THREADS,
      Key: { UserId: userId, ThreadId: threadId },
    });
    await docClient.send(command);
    return 'ok';
  } catch (error) {
    console.error('DynamoDB delete thread error:', error);
    throw new Error(
      `Failed to delete thread: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

/* ============
 * Routes
 * ============ */

chatHistory.post('/save', createValidator('json', ChatHistoryItemSchema), async (c) => {
  try {
    const authenticatedUserId = c.get('userId');
    const body = c.req.valid('json');
    const now = Date.now();

    if (body.is_user) {
      const initialTitle = body.message.trim().slice(0, 60) || 'New conversation';
      await dynamodb_upsertThread(authenticatedUserId, body.ThreadId, initialTitle, now);
    }

    // Always trust server-side identity/timestamp over client payload.
    await dynamodb_saveMessage({
      ...body,
      UserId: authenticatedUserId,
      Timestamp: now,
    });
    return c.json({ ok: true });
  } catch (e) {
    console.error('chat-history save error', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return c.json({ error: msg }, 500);
  }
});

chatHistory.get('/threads', async (c) => {
  try {
    const authenticatedUserId = c.get('userId');
    const threads = await dynamodb_listThreads(authenticatedUserId);
    return c.json({ threads });
  } catch (e) {
    console.error('chat-history threads error', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return c.json({ error: msg }, 500);
  }
});

chatHistory.get('/messages', createValidator('query', ThreadIdQuerySchema), async (c) => {
  try {
    const authenticatedUserId = c.get('userId');
    const { thread_id } = c.req.valid('query') as ThreadIdQuery;

    const thread = await dynamodb_getThread(authenticatedUserId, thread_id);
    if (!thread) {
      return c.json({ error: 'Thread not found' }, 404);
    }

    const items = await dynamodb_getMessages(authenticatedUserId, thread_id);

    // Verify ownership before returning messages - check all items belong to the authenticated user
    if (items.length > 0 && !items.every((msg) => msg.UserId === authenticatedUserId)) {
      return c.json({ error: 'Forbidden: You do not own this thread' }, 403);
    }

    return c.json({ items });
  } catch (e) {
    console.error('chat-history messages error', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return c.json({ error: msg }, 500);
  }
});

chatHistory.patch('/thread/:id', createValidator('json', PatchChatThreadSchema), async (c) => {
  try {
    const authenticatedUserId = c.get('userId');
    const threadId = c.req.param('id');
    const patch = c.req.valid('json') as PatchChatThread;

    const thread = await dynamodb_updateThread(authenticatedUserId, threadId, patch, Date.now());
    return c.json({ thread });
  } catch (e) {
    if (isConditionalCheckFailedError(e)) {
      return c.json({ error: 'Thread not found' }, 404);
    }
    console.error('chat-history patch thread error', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return c.json({ error: msg }, 500);
  }
});

chatHistory.delete('/thread/:id', async (c) => {
  try {
    const authenticatedUserId = c.get('userId');
    const threadId = c.req.param('id');

    const thread = await dynamodb_getThread(authenticatedUserId, threadId);
    if (!thread) {
      return c.json({ error: 'Thread not found' }, 404);
    }

    const result = await dynamodb_deleteThread(authenticatedUserId, threadId);
    if (result === 'forbidden') {
      return c.json({ error: 'Forbidden: You do not own this thread' }, 403);
    }
    return c.json({ ok: true });
  } catch (e) {
    console.error('chat-history delete thread error', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return c.json({ error: msg }, 500);
  }
});

export { chatHistory };

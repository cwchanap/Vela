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

const { GetCommand, QueryCommand, UpdateCommand, TransactWriteCommand } = DynamoDbLib;

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

const isTransactionConditionFailed = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'name' in error &&
  error.name === 'TransactionCanceledException' &&
  'CancellationReasons' in error &&
  Array.isArray((error as { CancellationReasons?: unknown }).CancellationReasons) &&
  ((error as { CancellationReasons?: { Code?: string }[] }).CancellationReasons ?? []).some(
    (reason) => reason?.Code === 'ConditionalCheckFailed',
  );

const isTransactionConflict = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null || !('name' in error)) {
    return false;
  }
  if (error.name === 'TransactionConflictException') {
    return true;
  }
  if (error.name === 'TransactionCanceledException' && 'CancellationReasons' in error) {
    const reasons = (error as { CancellationReasons?: { Code?: string }[] }).CancellationReasons;
    if (Array.isArray(reasons)) {
      return reasons.some((reason) => reason?.Code === 'TransactionConflict');
    }
  }
  return false;
};

async function retryOnTransactionConflict<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (attempt < maxRetries && isTransactionConflict(error)) {
        attempt++;
        const jitter = Math.random() * 20;
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 20 + jitter));
        continue;
      }
      throw error;
    }
  }
}

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

const messageItem = (item: ChatHistoryItem) => ({
  ThreadId: messagePartitionKey(item.UserId, item.ThreadId),
  Timestamp: item.Timestamp,
  UserId: item.UserId,
  message: item.message,
  is_user: item.is_user,
  context: {},
});

// Threads being deleted carry a `deleting` flag. Message saves run inside
// transactions conditioned on that flag so a write cannot land after deletion
// has begun. A finished delete keeps `deleting` and drops `deleteToken`/
// `deleteLease`, leaving a permanent tombstone row: a later save with the
// same client-chosen thread id is rejected instead of silently resurrecting
// the thread, and a repeat DELETE sees the tokenless tombstone and gets 404.
// While the barrier is in flight, `deleteToken`/`deleteLease` fence it so
// only its owner can clear it and a dead owner's barrier can be taken over
// once its lease expires. Message deletes commit in transactions conditioned
// on the token, so a stale owner that lost the barrier cannot keep deleting
// rows from a thread that has been restored to normal.
type StoredChatThread = ChatThreadSummary & {
  deleting?: boolean;
  deleteToken?: string;
  deleteLease?: number;
};

const THREAD_ALIVE_CONDITION = 'attribute_exists(ThreadId) AND attribute_not_exists(#deleting)';

async function dynamodb_saveUserMessage(
  userId: string,
  item: ChatHistoryItem,
  initialTitle: string,
  now: number,
): Promise<'ok' | 'rejected'> {
  const put = { TableName: TABLE_NAMES.CHAT_HISTORY, Item: messageItem(item) };
  const key = { UserId: userId, ThreadId: item.ThreadId };
  try {
    await retryOnTransactionConflict(() =>
      docClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: TABLE_NAMES.CHAT_THREADS,
                Key: key,
                // Never rewind updatedAt: a delayed save must not overwrite a
                // newer timestamp committed by another client.
                UpdateExpression:
                  'SET #updatedAt = :now, #title = if_not_exists(#title, :title), #createdAt = if_not_exists(#createdAt, :now)',
                ConditionExpression:
                  'attribute_not_exists(#deleting) AND (attribute_not_exists(#updatedAt) OR #updatedAt <= :now)',
                ExpressionAttributeNames: {
                  '#updatedAt': 'updatedAt',
                  '#title': 'title',
                  '#createdAt': 'createdAt',
                  '#deleting': 'deleting',
                },
                ExpressionAttributeValues: {
                  ':now': now,
                  ':title': initialTitle,
                },
              },
            },
            { Put: put },
          ],
        }),
      ),
    );
    return 'ok';
  } catch (error) {
    if (!isTransactionConditionFailed(error)) {
      console.error('DynamoDB save user message error:', error);
      throw new Error(
        `Failed to save message: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  // The metadata update was skipped either because the thread is being
  // deleted or because it already carries a newer updatedAt. Write the
  // message only when the thread is still alive.
  try {
    await retryOnTransactionConflict(() =>
      docClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              ConditionCheck: {
                TableName: TABLE_NAMES.CHAT_THREADS,
                Key: key,
                ConditionExpression: THREAD_ALIVE_CONDITION,
                ExpressionAttributeNames: { '#deleting': 'deleting' },
              },
            },
            { Put: put },
          ],
        }),
      ),
    );
    return 'ok';
  } catch (error) {
    if (isTransactionConditionFailed(error)) {
      return 'rejected';
    }
    console.error('DynamoDB save user message error:', error);
    throw new Error(
      `Failed to save message: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

async function dynamodb_saveAssistantMessage(
  userId: string,
  item: ChatHistoryItem,
): Promise<'ok' | 'rejected'> {
  try {
    await retryOnTransactionConflict(() =>
      docClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              ConditionCheck: {
                TableName: TABLE_NAMES.CHAT_THREADS,
                Key: { UserId: userId, ThreadId: item.ThreadId },
                ConditionExpression: THREAD_ALIVE_CONDITION,
                ExpressionAttributeNames: { '#deleting': 'deleting' },
              },
            },
            { Put: { TableName: TABLE_NAMES.CHAT_HISTORY, Item: messageItem(item) } },
          ],
        }),
      ),
    );
    return 'ok';
  } catch (error) {
    if (isTransactionConditionFailed(error)) {
      return 'rejected';
    }
    console.error('DynamoDB save assistant message error:', error);
    throw new Error(
      `Failed to save message: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

async function dynamodb_getThread(
  userId: string,
  threadId: string,
): Promise<StoredChatThread | undefined> {
  try {
    const command = new GetCommand({
      TableName: TABLE_NAMES.CHAT_THREADS,
      Key: { UserId: userId, ThreadId: threadId },
      ConsistentRead: true,
    });
    const response = await docClient.send(command);
    return response.Item as StoredChatThread | undefined;
  } catch (error) {
    console.error('DynamoDB get thread error:', error);
    throw new Error(
      `Failed to fetch thread: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

async function dynamodb_updateThread(
  userId: string,
  threadId: string,
  patch: PatchChatThread,
  now: number,
): Promise<ChatThreadSummary> {
  const sendUpdate = async (bumpUpdatedAt: boolean): Promise<ChatThreadSummary> => {
    const names: Record<string, string> = { '#deleting': 'deleting' };
    const values: Record<string, unknown> = {};
    const setClauses: string[] = [];
    let condition = THREAD_ALIVE_CONDITION;

    if (bumpUpdatedAt) {
      names['#updatedAt'] = 'updatedAt';
      values[':updatedAt'] = now;
      setClauses.push('#updatedAt = :updatedAt');
      // Never rewind updatedAt: a delayed patch must not overwrite a newer
      // timestamp committed by another client.
      condition += ' AND (attribute_not_exists(#updatedAt) OR #updatedAt <= :updatedAt)';
    }
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

    const command = new UpdateCommand({
      TableName: TABLE_NAMES.CHAT_THREADS,
      Key: { UserId: userId, ThreadId: threadId },
      UpdateExpression: `SET ${setClauses.join(', ')}`,
      ConditionExpression: condition,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    });
    const response = await docClient.send(command);
    return response.Attributes as ChatThreadSummary;
  };

  try {
    try {
      return await sendUpdate(true);
    } catch (error) {
      if (!isConditionalCheckFailedError(error)) {
        throw error;
      }
    }
    // The stored updatedAt is newer — apply the patch fields without
    // rewinding the timestamp. Fails again when the thread is gone/deleting.
    return await sendUpdate(false);
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
      ConsistentRead: true,
    });

    const threads = rows
      .filter((row) => row.deleting !== true)
      .map((row) => ({
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
      ConsistentRead: true,
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

// Each batch of message deletes commits in a transaction conditioned on our
// `deleteToken`. Once the barrier is stolen, cleared, or finalized the check
// fails, so a stale owner cannot keep deleting rows from a restored thread —
// on runtimes without Lambda's hard timeout a slow delete could otherwise
// outlive its lease and overlap the takeover.
async function dynamodb_deleteThreadMessages(
  userId: string,
  threadId: string,
  allMessages: Record<string, any>[],
  deleteToken: string,
): Promise<void> {
  const batchSize = 25;
  for (let i = 0; i < allMessages.length; i += batchSize) {
    const batch = allMessages.slice(i, i + batchSize);
    await retryOnTransactionConflict(() =>
      docClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              ConditionCheck: {
                TableName: TABLE_NAMES.CHAT_THREADS,
                Key: { UserId: userId, ThreadId: threadId },
                ConditionExpression: '#deleteToken = :deleteToken',
                ExpressionAttributeNames: { '#deleteToken': 'deleteToken' },
                ExpressionAttributeValues: { ':deleteToken': deleteToken },
              },
            },
            ...batch.map((msg) => ({
              Delete: {
                TableName: TABLE_NAMES.CHAT_HISTORY,
                Key: { ThreadId: msg.ThreadId, Timestamp: msg.Timestamp },
              },
            })),
          ],
        }),
      ),
    );
  }
}

// How long an in-flight delete owns the barrier before another request may
// take it over. Generous versus the seconds enumeration normally takes, so a
// steal means the previous owner is genuinely gone rather than merely slow.
const DELETE_BARRIER_LEASE_MS = 5 * 60 * 1000;

async function dynamodb_clearThreadDeleting(
  userId: string,
  threadId: string,
  deleteToken: string,
): Promise<void> {
  try {
    const command = new UpdateCommand({
      TableName: TABLE_NAMES.CHAT_THREADS,
      Key: { UserId: userId, ThreadId: threadId },
      // Fenced on our token: cleanup can never remove another in-flight
      // delete's barrier or a completed tombstone.
      UpdateExpression: 'REMOVE #deleting, #deleteToken, #deleteLease',
      ConditionExpression: '#deleteToken = :deleteToken',
      ExpressionAttributeNames: {
        '#deleting': 'deleting',
        '#deleteToken': 'deleteToken',
        '#deleteLease': 'deleteLease',
      },
      ExpressionAttributeValues: { ':deleteToken': deleteToken },
    });
    await docClient.send(command);
  } catch (error) {
    // Best effort: a retained barrier still lets a retried delete finish
    // once its lease expires.
    console.error('DynamoDB clear deleting flag error:', error);
  }
}

async function dynamodb_finalizeThreadDelete(
  userId: string,
  threadId: string,
  deleteToken: string,
): Promise<void> {
  // Convert the barrier into a permanent tombstone once all messages have
  // been deleted: keep `deleting` so saves and patches keep returning 404,
  // and drop our token/lease so the row can never be cleared or reacquired.
  // Fencing on deleteToken ensures we only finalize if our token still holds
  // the barrier. Failures must propagate: swallowing them would acknowledge
  // a delete while the row stays hidden mid-barrier with no client retry.
  try {
    const command = new UpdateCommand({
      TableName: TABLE_NAMES.CHAT_THREADS,
      Key: { UserId: userId, ThreadId: threadId },
      UpdateExpression: 'REMOVE #deleteToken, #deleteLease',
      ConditionExpression: '#deleteToken = :deleteToken',
      ExpressionAttributeNames: {
        '#deleteToken': 'deleteToken',
        '#deleteLease': 'deleteLease',
      },
      ExpressionAttributeValues: { ':deleteToken': deleteToken },
    });
    await docClient.send(command);
  } catch (error) {
    console.error('DynamoDB finalize delete error:', error);
    throw error;
  }
}

async function dynamodb_acquireThreadDelete(
  userId: string,
  threadId: string,
  deleteToken: string,
): Promise<'acquired' | 'not_found'> {
  // Acquire the barrier only when none exists or a previous owner let its
  // lease expire. When an active delete is already running, wait for it to
  // finish instead of reporting premature success.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const command = new UpdateCommand({
        TableName: TABLE_NAMES.CHAT_THREADS,
        Key: { UserId: userId, ThreadId: threadId },
        UpdateExpression:
          'SET #deleting = :true, #deleteToken = :deleteToken, #deleteLease = :deleteLease',
        ConditionExpression:
          'attribute_exists(ThreadId) AND (attribute_not_exists(#deleting) OR #deleteLease < :now)',
        ExpressionAttributeNames: {
          '#deleting': 'deleting',
          '#deleteToken': 'deleteToken',
          '#deleteLease': 'deleteLease',
        },
        ExpressionAttributeValues: {
          ':true': true,
          ':deleteToken': deleteToken,
          ':deleteLease': Date.now() + DELETE_BARRIER_LEASE_MS,
          ':now': Date.now(),
        },
      });
      await docClient.send(command);
      return 'acquired';
    } catch (error) {
      if (!isConditionalCheckFailedError(error)) {
        console.error('DynamoDB delete thread error:', error);
        throw new Error(
          `Failed to delete thread: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    }

    // The conditional write lost the race. Read the row to tell apart a
    // missing thread, a finished tombstone, an in-progress delete, and an
    // expired barrier.
    const row = await dynamodb_getThread(userId, threadId);
    if (!row) {
      return 'not_found';
    }
    if (row.deleting === true) {
      if (row.deleteToken === undefined) {
        // A tombstone carries `deleting` with no token/lease: the delete
        // already finished, so report it gone rather than contending.
        return 'not_found';
      }
      const lease = row.deleteLease;
      if (lease !== undefined && lease > Date.now()) {
        // Another active delete owns the barrier. Wait briefly for it to
        // complete so we never report premature success.
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
        continue;
      }
    }
    // Stale barrier (owner died mid-delete) or a flag cleared between our
    // write and the read — loop and retry the conditional acquire.
  }
  throw new Error('Failed to delete thread: delete barrier remained contended');
}

async function dynamodb_deleteThread(
  userId: string,
  threadId: string,
): Promise<'ok' | 'forbidden' | 'not_found'> {
  const deleteToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const acquired = await dynamodb_acquireThreadDelete(userId, threadId, deleteToken);
  if (acquired === 'not_found') {
    return 'not_found';
  }

  try {
    // Paginate through all query results to get ALL messages in the thread
    const allMessages = await queryAllPages({
      TableName: TABLE_NAMES.CHAT_HISTORY,
      KeyConditionExpression: 'ThreadId = :threadId',
      ExpressionAttributeValues: {
        ':threadId': messagePartitionKey(userId, threadId),
      },
      ConsistentRead: true,
    });

    // SECURITY: Verify the user owns this thread before deleting
    // Ensure all thread messages belong to the authenticated user.
    // This prevents deleting mixed-owner/corrupted threads.
    if (!allMessages.every((message) => message.UserId === userId)) {
      await dynamodb_clearThreadDeleting(userId, threadId, deleteToken);
      return 'forbidden';
    }

    await dynamodb_deleteThreadMessages(userId, threadId, allMessages, deleteToken);
    await dynamodb_finalizeThreadDelete(userId, threadId, deleteToken);
    return 'ok';
  } catch (error) {
    await dynamodb_clearThreadDeleting(userId, threadId, deleteToken);
    console.error('DynamoDB delete thread error:', error);
    throw new Error(
      `Failed to delete thread: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

/* ============
 * Routes
 * ============ */

const THREAD_TITLE_MAX_LENGTH = 60;

// The title cap counts UTF-16 units like the rename schema; truncation must
// not split a surrogate pair and leave an unpaired surrogate in the stored
// string.
const deriveInitialTitle = (message: string): string => {
  const trimmed = message.trim();
  if (trimmed.length <= THREAD_TITLE_MAX_LENGTH) {
    return trimmed || 'New conversation';
  }
  let title = trimmed.slice(0, THREAD_TITLE_MAX_LENGTH);
  const last = title.charCodeAt(title.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) {
    title = title.slice(0, -1);
  }
  return title || 'New conversation';
};

chatHistory.post('/save', createValidator('json', ChatHistoryItemSchema), async (c) => {
  try {
    const authenticatedUserId = c.get('userId');
    const body = c.req.valid('json');
    const now = Date.now();

    // Always trust server-side identity/timestamp over client payload.
    const item: ChatHistoryItem = {
      ...body,
      UserId: authenticatedUserId,
      Timestamp: now,
    };

    const result = body.is_user
      ? await dynamodb_saveUserMessage(
          authenticatedUserId,
          item,
          deriveInitialTitle(body.message),
          now,
        )
      : await dynamodb_saveAssistantMessage(authenticatedUserId, item);

    if (result === 'rejected') {
      return c.json({ error: 'Thread not found' }, 404);
    }
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
    if (!thread || thread.deleting === true) {
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

    const result = await dynamodb_deleteThread(authenticatedUserId, threadId);
    if (result === 'not_found') {
      return c.json({ error: 'Thread not found' }, 404);
    }
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

import { Hono } from 'hono';
import type { Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { env } from 'hono/adapter';
import {
  GetUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import type { Env } from '../types';
import {
  ChatHistoryItemSchema,
  ChatThreadSummarySchema,
  UserIdQuerySchema,
  ThreadIdQuerySchema,
  type ChatHistoryItem,
  type ChatThreadSummary,
} from '../validation';
import { docClient, TABLE_NAMES } from '../dynamodb';
import { PutCommand, QueryCommand, ScanCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';

const chatHistory = new Hono<{ Bindings: Env }>();

// Create Cognito client with environment variables from context
const createCognitoClient = (c: Context<{ Bindings: Env }>) => {
  const { AWS_REGION = 'us-east-1' } = env<{ AWS_REGION: string }>(c);
  return new CognitoIdentityProviderClient({
    region: AWS_REGION,
  });
};

// Helper to validate token and extract user ID from Cognito
async function getUserIdFromToken(
  authHeader: string | undefined,
  c: Context<{ Bindings: Env }>,
): Promise<string | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  try {
    const accessToken = authHeader.substring(7);

    // Validate token with Cognito to verify signature and prevent forgery
    const getUserCommand = new GetUserCommand({
      AccessToken: accessToken,
    });

    const cognitoClient = createCognitoClient(c);
    const userResponse = await cognitoClient.send(getUserCommand);

    // IMPORTANT: Return the Cognito sub to match what's stored in chat messages
    // Messages are saved with UserId = auth.user.id which is the Cognito sub
    // Note: Username is the login email, but we need the actual sub attribute
    const userId = userResponse.UserAttributes?.find((attr) => attr.Name === 'sub')?.Value;

    return userId || null;
  } catch (error) {
    console.error('Token validation error:', error);
    return null;
  }
}

// Custom CORS handler
chatHistory.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS,DELETE');
  c.header('Access-Control-Allow-Headers', 'content-type,authorization');

  if (c.req.method === 'OPTIONS') {
    return c.text('', 200);
  }

  await next();
});

/* ========================
 * DynamoDB implementation
 * ======================== */

async function dynamodb_saveMessage(env: Env, item: ChatHistoryItem): Promise<void> {
  try {
    const command = new PutCommand({
      TableName: TABLE_NAMES.CHAT_HISTORY,
      Item: {
        ThreadId: item.ThreadId || 'default',
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

async function dynamodb_listThreads(env: Env, user_id: string): Promise<ChatThreadSummary[]> {
  try {
    // Query all messages for the user using the GSI
    const command = new QueryCommand({
      TableName: TABLE_NAMES.CHAT_HISTORY,
      IndexName: 'UserIdIndex',
      KeyConditionExpression: 'UserId = :userId',
      ExpressionAttributeValues: {
        ':userId': user_id,
      },
      ScanIndexForward: false, // Sort by timestamp descending
    });

    let response;
    try {
      response = await docClient.send(command);
    } catch (err: any) {
      // Fallback: if the index doesn't exist (local dev), scan and filter by UserId
      const errMsg = err?.message || '';
      const missingIndex =
        err?.name === 'ResourceNotFoundException' ||
        err?.name === 'ValidationException' ||
        errMsg.includes('Requested resource not found') ||
        errMsg.includes('Invalid IndexName');
      if (missingIndex) {
        const scan = new ScanCommand({
          TableName: TABLE_NAMES.CHAT_HISTORY,
          FilterExpression: 'UserId = :userId',
          ExpressionAttributeValues: {
            ':userId': user_id,
          },
        });
        response = await docClient.send(scan);
      } else {
        throw err;
      }
    }

    const messages = response.Items || [];

    if (!messages.length) {
      return [];
    }

    // Group messages by ThreadId
    const threadMap = new Map<string, any[]>();

    for (const message of messages) {
      const threadId = message.ThreadId;
      if (!threadMap.has(threadId)) {
        threadMap.set(threadId, []);
      }
      threadMap.get(threadId)!.push(message);
    }

    const summaries: ChatThreadSummary[] = [];
    for (const [threadId, threadMessages] of threadMap.entries()) {
      const sorted = threadMessages.sort((a, b) => a.Timestamp - b.Timestamp);
      const last = sorted[sorted.length - 1];
      const firstUser = sorted.find((m) => m.is_user) || sorted[0];
      const title = (firstUser?.message || 'Conversation').slice(0, 60);

      summaries.push({
        ThreadId: threadId,
        lastTimestamp: last.Timestamp,
        title,
        messageCount: threadMessages.length,
      });
    }

    return summaries.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
  } catch (error) {
    console.error('DynamoDB list threads error:', error);
    throw new Error(
      `Failed to fetch threads: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

async function dynamodb_getMessages(env: Env, thread_id: string): Promise<ChatHistoryItem[]> {
  try {
    // Scan messages by ThreadId (since we don't have a primary key on ThreadId)
    const command = new ScanCommand({
      TableName: TABLE_NAMES.CHAT_HISTORY,
      FilterExpression: 'ThreadId = :threadId',
      ExpressionAttributeValues: {
        ':threadId': thread_id,
      },
    });

    const response = await docClient.send(command);
    const messages = response.Items || [];

    return messages.map((message) => ({
      ThreadId: message.ThreadId,
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

async function dynamodb_deleteThread(env: Env, thread_id: string): Promise<void> {
  try {
    const allMessages: any[] = [];
    let lastEvaluatedKey: Record<string, any> | undefined;

    // Paginate through all scan results to get ALL messages in the thread
    do {
      const scanCommand: ScanCommand = new ScanCommand({
        TableName: TABLE_NAMES.CHAT_HISTORY,
        FilterExpression: 'ThreadId = :threadId',
        ExpressionAttributeValues: {
          ':threadId': thread_id,
        },
        ExclusiveStartKey: lastEvaluatedKey,
      });

      const response = await docClient.send(scanCommand);
      const messages = response.Items || [];
      allMessages.push(...messages);
      lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey);

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

chatHistory.post('/save', zValidator('json', ChatHistoryItemSchema), async (c) => {
  try {
    const hasAwsCredentials = c.env.AWS_ACCESS_KEY_ID && c.env.AWS_SECRET_ACCESS_KEY;
    if (!hasAwsCredentials) {
      return c.json({ error: 'Missing AWS credentials' }, 500);
    }
    const body = c.req.valid('json');
    await dynamodb_saveMessage(c.env, body);
    return c.json({ ok: true });
  } catch (e) {
    console.error('chat-history save error', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return c.json({ error: msg }, 500);
  }
});

chatHistory.get('/threads', async (c) => {
  try {
    const hasAwsCredentials = c.env.AWS_ACCESS_KEY_ID && c.env.AWS_SECRET_ACCESS_KEY;
    if (!hasAwsCredentials) {
      return c.json({ error: 'Missing AWS credentials' }, 500);
    }
    const { user_id } = c.req.query();
    if (!user_id) {
      return c.json({ error: 'user_id is required' }, 400);
    }
    const threads = await dynamodb_listThreads(c.env, user_id);
    return c.json({ threads });
  } catch (e) {
    console.error('chat-history threads error', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return c.json({ error: msg }, 500);
  }
});

chatHistory.get('/messages', async (c) => {
  try {
    const hasAwsCredentials = c.env.AWS_ACCESS_KEY_ID && c.env.AWS_SECRET_ACCESS_KEY;
    if (!hasAwsCredentials) {
      return c.json({ error: 'Missing AWS credentials' }, 500);
    }
    const { thread_id } = c.req.query();
    if (!thread_id) {
      return c.json({ error: 'thread_id is required' }, 400);
    }
    const items = await dynamodb_getMessages(c.env, thread_id);
    return c.json({ items });
  } catch (e) {
    console.error('chat-history messages error', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return c.json({ error: msg }, 500);
  }
});

chatHistory.delete('/thread', async (c) => {
  try {
    const hasAwsCredentials = c.env.AWS_ACCESS_KEY_ID && c.env.AWS_SECRET_ACCESS_KEY;
    if (!hasAwsCredentials) {
      return c.json({ error: 'Missing AWS credentials' }, 500);
    }
    // SECURITY: Authenticate the user
    const userId = await getUserIdFromToken(c.req.header('Authorization'), c);
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const { thread_id } = c.req.query();
    if (!thread_id) {
      return c.json({ error: 'thread_id is required' }, 400);
    }

    // SECURITY: Verify the user owns this thread before deleting
    // Get at least one message from the thread to check ownership
    const messages = await dynamodb_getMessages(c.env, thread_id);

    if (messages.length === 0) {
      // Thread doesn't exist or is already empty
      return c.json({ ok: true });
    }

    // Check if the first message belongs to the authenticated user
    const threadOwner = messages[0].UserId;
    if (threadOwner !== userId) {
      return c.json({ error: 'Forbidden: You do not own this thread' }, 403);
    }

    // User owns the thread, proceed with deletion
    await dynamodb_deleteThread(c.env, thread_id);
    return c.json({ ok: true });
  } catch (e) {
    console.error('chat-history delete thread error', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return c.json({ error: msg }, 500);
  }
});

export { chatHistory };

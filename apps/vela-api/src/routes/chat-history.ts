import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
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
import { PutCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

const chatHistory = new Hono<{ Bindings: Env }>();

// Custom CORS handler
chatHistory.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  c.header('Access-Control-Allow-Headers', 'content-type');

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

    const response = await docClient.send(command);
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
    // Query messages by ThreadId
    const command = new QueryCommand({
      TableName: TABLE_NAMES.CHAT_HISTORY,
      KeyConditionExpression: 'ThreadId = :threadId',
      ExpressionAttributeValues: {
        ':threadId': thread_id,
      },
      ScanIndexForward: true, // Sort by timestamp ascending
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

/* ============
 * Routes
 * ============ */

chatHistory.post('/save', zValidator('json', ChatHistoryItemSchema), async (c) => {
  try {
    const body = c.req.valid('json');
    await dynamodb_saveMessage(c.env, body);
    return c.json({ ok: true });
  } catch (e) {
    console.error('chat-history save error', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return c.json({ error: msg }, 500);
  }
});

chatHistory.get('/threads', zValidator('query', UserIdQuerySchema), async (c) => {
  try {
    const { user_id } = c.req.valid('query');
    const threads = await dynamodb_listThreads(c.env, user_id);
    return c.json({ threads });
  } catch (e) {
    console.error('chat-history threads error', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return c.json({ error: msg }, 500);
  }
});

chatHistory.get('/messages', zValidator('query', ThreadIdQuerySchema), async (c) => {
  try {
    const { thread_id } = c.req.valid('query');
    const items = await dynamodb_getMessages(c.env, thread_id);
    return c.json({ items });
  } catch (e) {
    console.error('chat-history messages error', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return c.json({ error: msg }, 500);
  }
});

export { chatHistory };

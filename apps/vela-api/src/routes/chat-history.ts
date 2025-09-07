import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { Env } from '../types';
import type { QueryCommandInput as DdbQueryCommandInput } from '@aws-sdk/lib-dynamodb';
import {
  ChatHistoryItemSchema,
  ChatThreadSummarySchema,
  UserIdQuerySchema,
  ThreadIdQuerySchema,
  type ChatHistoryItem,
  type ChatThreadSummary,
} from '../validation';

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

const DEFAULTS = {
  DDB_ENDPOINT: 'https://dynamodb.us-east-1.amazonaws.com',
  DDB_REGION: 'us-east-1',
  DDB_TABLE: 'vela',
  USER_DATE_GSI: 'UserIdIndex',
};

/* ========================
 * DynamoDB implementation
 * ======================== */

async function getDdbDocClient(env: Env) {
  const endpoint = env.DDB_ENDPOINT || DEFAULTS.DDB_ENDPOINT;
  const region = env.DDB_REGION || DEFAULTS.DDB_REGION;
  const accessKeyId = env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error('Missing AWS credentials');
  }

  // Dynamic imports to avoid bundling AWS SDK unless needed
  const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb');

  const base = new DynamoDBClient({
    region,
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  return DynamoDBDocumentClient.from(base, {
    marshallOptions: { removeUndefinedValues: true },
  });
}

function getTable(env: Env) {
  return env.DDB_TABLE || DEFAULTS.DDB_TABLE;
}

async function ddb_saveMessage(env: Env, item: ChatHistoryItem): Promise<void> {
  const doc = await getDdbDocClient(env);
  const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
  const input = { TableName: getTable(env), Item: item };
  await doc.send(new PutCommand(input));
}

async function ddb_listThreads(env: Env, user_id: string): Promise<ChatThreadSummary[]> {
  const doc = await getDdbDocClient(env);
  const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');

  const items: ChatHistoryItem[] = [];
  const input = {
    TableName: getTable(env),
    IndexName: DEFAULTS.USER_DATE_GSI,
    KeyConditionExpression: '#uid = :u',
    ExpressionAttributeNames: { '#uid': 'UserId' },
    ExpressionAttributeValues: { ':u': user_id },
    ScanIndexForward: false,
  };

  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const cmd: DdbQueryCommandInput = { ...input, ExclusiveStartKey };
    const res = await doc.send(new QueryCommand(cmd));
    const page = (res.Items as ChatHistoryItem[] | undefined) || [];
    items.push(...page);
    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);

  const byChat = new Map<string, ChatHistoryItem[]>();
  for (const it of items) {
    const arr = byChat.get(it.ThreadId) || [];
    arr.push(it);
    byChat.set(it.ThreadId, arr);
  }

  const summaries: ChatThreadSummary[] = [];
  for (const [ThreadId, arr] of byChat.entries()) {
    const sorted = [...arr].sort((a, b) => a.Timestamp - b.Timestamp);
    const last = sorted[sorted.length - 1];
    const firstUser = sorted.find((m) => m.is_user) || sorted[0];
    const title = (firstUser?.message || 'Conversation').slice(0, 60);
    summaries.push({
      ThreadId,
      lastTimestamp: last?.Timestamp || 0,
      title,
      messageCount: arr.length,
    });
  }

  summaries.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
  return summaries;
}

async function ddb_getMessages(env: Env, thread_id: string): Promise<ChatHistoryItem[]> {
  const doc = await getDdbDocClient(env);
  const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');

  const items: ChatHistoryItem[] = [];
  const input = {
    TableName: getTable(env),
    KeyConditionExpression: '#tid = :t',
    ExpressionAttributeNames: { '#tid': 'ThreadId' },
    ExpressionAttributeValues: { ':t': thread_id },
    ScanIndexForward: true,
  };

  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const cmd: DdbQueryCommandInput = { ...input, ExclusiveStartKey };
    const res = await doc.send(new QueryCommand(cmd));
    const page = (res.Items as ChatHistoryItem[] | undefined) || [];
    items.push(...page);
    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);

  return items;
}

/* ============
 * Routes
 * ============ */

chatHistory.post('/save', zValidator('json', ChatHistoryItemSchema), async (c) => {
  try {
    const body = c.req.valid('json');
    await ddb_saveMessage(c.env, body);
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
    const threads = await ddb_listThreads(c.env, user_id);
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
    const items = await ddb_getMessages(c.env, thread_id);
    return c.json({ items });
  } catch (e) {
    console.error('chat-history messages error', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return c.json({ error: msg }, 500);
  }
});

export { chatHistory };

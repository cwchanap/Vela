/**
 * Chat History API for Cloudflare Worker
 * Uses AWS DynamoDB for chat history storage via AWS SDK v3
 *
 * Endpoints:
 *  - POST /api/chat-history/save        { chat_id, user_id, date, message, is_user }
 *  - GET  /api/chat-history/threads?user_id=...
 *  - GET  /api/chat-history/messages?chat_id=...
 */

import type { QueryCommandInput as DdbQueryCommandInput } from '@aws-sdk/lib-dynamodb';

type EnvAny = Record<string, unknown>;

export type ChatHistoryItem = {
  ThreadId: string; // thread id (PK when using DDB)
  Timestamp: number; // Unix timestamp in milliseconds (SK when using DDB)
  UserId: string; // owner id (used by GSI in DDB)
  message: string;
  is_user: boolean;
};

export type ChatThreadSummary = {
  ThreadId: string;
  lastTimestamp: number;
  title: string;
  messageCount: number;
};

const DEFAULTS = {
  DDB_ENDPOINT: 'https://dynamodb.us-east-1.amazonaws.com',
  DDB_REGION: 'us-east-1',
  DDB_TABLE: 'vela',
  USER_DATE_GSI: 'UserIdIndex',
};

/* ========================
 * DynamoDB implementation
 * ======================== */

async function getDdbDocClient(env: EnvAny) {
  const endpoint = (env.DDB_ENDPOINT as string) || DEFAULTS.DDB_ENDPOINT;
  const region = (env.DDB_REGION as string) || DEFAULTS.DDB_REGION;
  const accessKeyId = env.AWS_ACCESS_KEY_ID as string;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY as string;

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

function getTable(env: EnvAny) {
  return (env.DDB_TABLE as string) || DEFAULTS.DDB_TABLE;
}

async function ddb_saveMessage(env: EnvAny, item: ChatHistoryItem): Promise<void> {
  const doc = await getDdbDocClient(env);
  const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
  const input = { TableName: getTable(env), Item: item };
  await doc.send(new PutCommand(input));
}

async function ddb_listThreads(env: EnvAny, user_id: string): Promise<ChatThreadSummary[]> {
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

async function ddb_getMessages(env: EnvAny, thread_id: string): Promise<ChatHistoryItem[]> {
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
 * HTTP helpers
 * ============ */

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
      ...(init?.headers || {}),
    },
  });
}

/* ============
 * Entry point
 * ============ */

export async function handleChatHistory(request: Request, env: EnvAny): Promise<Response> {
  const url = new URL(request.url);

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type',
      },
    });
  }

  try {
    if (url.pathname === '/api/chat-history/save' && request.method === 'POST') {
      const body = (await request.json()) as ChatHistoryItem;
      await ddb_saveMessage(env, body);
      return json({ ok: true });
    }

    if (url.pathname === '/api/chat-history/threads' && request.method === 'GET') {
      const user_id = url.searchParams.get('user_id') || '';
      if (!user_id) return json({ error: 'user_id is required' }, { status: 400 });

      const threads = await ddb_listThreads(env, user_id);
      return json({ threads });
    }

    if (url.pathname === '/api/chat-history/messages' && request.method === 'GET') {
      const thread_id = url.searchParams.get('thread_id') || '';
      if (!thread_id) return json({ error: 'thread_id is required' }, { status: 400 });

      const items = await ddb_getMessages(env, thread_id);
      return json({ items });
    }

    return new Response(null, { status: 404 });
  } catch (e) {
    console.error('chat-history error', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return json({ error: msg }, { status: 500 });
  }
}

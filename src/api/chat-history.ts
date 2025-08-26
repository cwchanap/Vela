/**
 * Chat History API for Cloudflare Worker (dev)
 * Supports two modes controlled by env.CHAT_HISTORY_MODE:
 *  - "memory" (default): in-memory storage (no external deps), ideal for local E2E without Docker
 *  - "ddb": AWS DynamoDB (Local/Remote) via AWS SDK v3 (dynamic import)
 *
 * Endpoints:
 *  - POST /api/chat-history/save        { chat_id, user_id, date, message, is_user }
 *  - GET  /api/chat-history/threads?user_id=...
 *  - GET  /api/chat-history/messages?chat_id=...
 */

import type { QueryCommandInput as DdbQueryCommandInput } from '@aws-sdk/lib-dynamodb';

type EnvAny = Record<string, unknown>;

export type ChatHistoryItem = {
  chat_id: string; // thread id (PK when using DDB)
  user_id: string; // owner id (used by GSI in DDB)
  date: string; // ISO timestamp (SK when using DDB)
  message: string;
  is_user: boolean;
};

export type ChatThreadSummary = {
  chat_id: string;
  lastDate: string;
  title: string;
  messageCount: number;
};

const DEFAULTS = {
  MODE: 'memory' as 'memory' | 'ddb',
  DDB_ENDPOINT: 'http://127.0.0.1:8000',
  DDB_REGION: 'local',
  DDB_TABLE: 'VelaChatMessages',
  USER_DATE_GSI: 'user_id-date-index',
};

/* =========================
 * Memory mode implementation
 * ========================= */

const MEMORY_THREADS = new Map<string, ChatHistoryItem[]>(); // chat_id -> items[]

function memory_saveMessage(_env: EnvAny, item: ChatHistoryItem): void {
  const arr = MEMORY_THREADS.get(item.chat_id) || [];
  arr.push(item);
  MEMORY_THREADS.set(item.chat_id, arr);
}

function memory_listThreads(_env: EnvAny, user_id: string): ChatThreadSummary[] {
  const summaries: ChatThreadSummary[] = [];
  for (const [chat_id, arr] of MEMORY_THREADS.entries()) {
    const userItems = arr.filter((m) => m.user_id === user_id);
    if (userItems.length === 0) continue;

    const sorted = [...arr].sort((a, b) => a.date.localeCompare(b.date));
    const last = sorted[sorted.length - 1];
    const firstUser = sorted.find((m) => m.is_user) || sorted[0];
    const title = (firstUser?.message || 'Conversation').slice(0, 60);

    summaries.push({
      chat_id,
      lastDate: last?.date || new Date(0).toISOString(),
      title,
      messageCount: arr.length,
    });
  }
  summaries.sort((a, b) => b.lastDate.localeCompare(a.lastDate));
  return summaries;
}

function memory_getMessages(_env: EnvAny, chat_id: string): ChatHistoryItem[] {
  const arr = MEMORY_THREADS.get(chat_id) || [];
  return [...arr].sort((a, b) => a.date.localeCompare(b.date));
}

/* =========================
 * DynamoDB mode (dynamic)
 * ========================= */

async function getDdbDocClient(env: EnvAny) {
  const endpoint = (env.DDB_ENDPOINT as string) || DEFAULTS.DDB_ENDPOINT;
  const region = (env.DDB_REGION as string) || DEFAULTS.DDB_REGION;

  // Dynamic imports to avoid bundling AWS SDK unless needed
  const { DynamoDBClient } = await import('@aws-sdk/client-dynamodb');
  const { DynamoDBDocumentClient } = await import('@aws-sdk/lib-dynamodb');

  const base = new DynamoDBClient({
    region,
    endpoint,
    // Provide explicit dummy credentials for local use to avoid Node config resolution
    credentials: {
      accessKeyId: 'dummy',
      secretAccessKey: 'dummy',
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
    ExpressionAttributeNames: { '#uid': 'user_id' },
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
    const arr = byChat.get(it.chat_id) || [];
    arr.push(it);
    byChat.set(it.chat_id, arr);
  }

  const summaries: ChatThreadSummary[] = [];
  for (const [chat_id, arr] of byChat.entries()) {
    const sorted = [...arr].sort((a, b) => a.date.localeCompare(b.date));
    const last = sorted[sorted.length - 1];
    const firstUser = sorted.find((m) => m.is_user) || sorted[0];
    const title = (firstUser?.message || 'Conversation').slice(0, 60);
    summaries.push({
      chat_id,
      lastDate: last?.date || new Date(0).toISOString(),
      title,
      messageCount: arr.length,
    });
  }

  summaries.sort((a, b) => b.lastDate.localeCompare(a.lastDate));
  return summaries;
}

async function ddb_getMessages(env: EnvAny, chat_id: string): Promise<ChatHistoryItem[]> {
  const doc = await getDdbDocClient(env);
  const { QueryCommand } = await import('@aws-sdk/lib-dynamodb');

  const items: ChatHistoryItem[] = [];
  const input = {
    TableName: getTable(env),
    KeyConditionExpression: '#cid = :c',
    ExpressionAttributeNames: { '#cid': 'chat_id' },
    ExpressionAttributeValues: { ':c': chat_id },
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

  const modeRaw = ((env.CHAT_HISTORY_MODE as string) || DEFAULTS.MODE).toLowerCase();
  const mode: 'memory' | 'ddb' = modeRaw === 'ddb' ? 'ddb' : 'memory';

  try {
    if (url.pathname === '/api/chat-history/save' && request.method === 'POST') {
      const body = (await request.json()) as ChatHistoryItem;
      if (mode === 'memory') {
        memory_saveMessage(env, body);
      } else {
        await ddb_saveMessage(env, body);
      }
      return json({ ok: true });
    }

    if (url.pathname === '/api/chat-history/threads' && request.method === 'GET') {
      const user_id = url.searchParams.get('user_id') || '';
      if (!user_id) return json({ error: 'user_id is required' }, { status: 400 });

      const threads =
        mode === 'memory' ? memory_listThreads(env, user_id) : await ddb_listThreads(env, user_id);
      return json({ threads });
    }

    if (url.pathname === '/api/chat-history/messages' && request.method === 'GET') {
      const chat_id = url.searchParams.get('chat_id') || '';
      if (!chat_id) return json({ error: 'chat_id is required' }, { status: 400 });

      const items =
        mode === 'memory' ? memory_getMessages(env, chat_id) : await ddb_getMessages(env, chat_id);
      return json({ items });
    }

    return new Response(null, { status: 404 });
  } catch (e) {
    console.error('chat-history error', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return json({ error: msg }, { status: 500 });
  }
}

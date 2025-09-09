import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { createClient } from '@supabase/supabase-js';
import type { Env } from '../types';
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

/* ========================
 * Supabase implementation
 * ======================== */

async function getSupabaseClient(env: Env) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseAnonKey = env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase configuration');
  }

  return createClient(supabaseUrl, supabaseAnonKey);
}

async function supabase_saveMessage(env: Env, item: ChatHistoryItem): Promise<void> {
  const supabase = await getSupabaseClient(env);

  const { error } = await supabase.from('chat_history').insert({
    id: crypto.randomUUID(),
    user_id: item.UserId,
    message_type: item.is_user ? 'user' : 'ai',
    content: item.message,
    context: {},
    created_at: new Date(item.Timestamp).toISOString(),
  });

  if (error) {
    throw new Error(`Failed to save message: ${error.message}`);
  }
}

async function supabase_listThreads(env: Env, user_id: string): Promise<ChatThreadSummary[]> {
  const supabase = await getSupabaseClient(env);

  // Get all messages for the user
  const { data: messages, error } = await supabase
    .from('chat_history')
    .select('*')
    .eq('user_id', user_id)
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch threads: ${error.message}`);
  }

  if (!messages) {
    return [];
  }

  // Group messages by thread (we'll use a simple approach - group by date for now)
  const threadMap = new Map<string, typeof messages>();

  for (const message of messages) {
    const date = new Date(message.created_at).toDateString();
    if (!threadMap.has(date)) {
      threadMap.set(date, []);
    }
    threadMap.get(date)!.push(message);
  }

  const summaries: ChatThreadSummary[] = [];
  for (const [date, threadMessages] of threadMap.entries()) {
    const sorted = threadMessages.sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    const last = sorted[sorted.length - 1];
    const firstUser = sorted.find((m) => m.message_type === 'user') || sorted[0];
    const title = (firstUser?.content || 'Conversation').slice(0, 60);

    summaries.push({
      ThreadId: date,
      lastTimestamp: new Date(last.created_at).getTime(),
      title,
      messageCount: threadMessages.length,
    });
  }

  return summaries.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
}

async function supabase_getMessages(env: Env, thread_id: string): Promise<ChatHistoryItem[]> {
  const supabase = await getSupabaseClient(env);

  // For now, we'll fetch messages by date (thread_id is the date string)
  const { data: messages, error } = await supabase
    .from('chat_history')
    .select('*')
    .eq('user_id', 'current_user_id') // This should be passed from the request
    .gte('created_at', `${thread_id} 00:00:00`)
    .lt('created_at', `${thread_id} 23:59:59`)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch messages: ${error.message}`);
  }

  if (!messages) {
    return [];
  }

  return messages.map((message) => ({
    ThreadId: thread_id,
    Timestamp: new Date(message.created_at).getTime(),
    UserId: message.user_id,
    message: message.content,
    is_user: message.message_type === 'user',
  }));
}

/* ============
 * Routes
 * ============ */

chatHistory.post('/save', zValidator('json', ChatHistoryItemSchema), async (c) => {
  try {
    const body = c.req.valid('json');
    await supabase_saveMessage(c.env, body);
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
    const threads = await supabase_listThreads(c.env, user_id);
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
    const items = await supabase_getMessages(c.env, thread_id);
    return c.json({ items });
  } catch (e) {
    console.error('chat-history messages error', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return c.json({ error: msg }, 500);
  }
});

export { chatHistory };

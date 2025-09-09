import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Env } from '../types';

// Validation schemas
const VocabularyQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val) : 10)),
});

const SentencesQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val) : 5)),
});

const games = new Hono<{ Bindings: Env }>();

// Custom CORS handler
games.use('*', async (c, next) => {
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

/* ============
 * Routes
 * ============ */

games.get('/vocabulary', zValidator('query', VocabularyQuerySchema), async (c) => {
  try {
    const { limit } = c.req.valid('query');
    const supabase = await getSupabaseClient(c.env);

    const { data: vocabulary, error } = await supabase.from('vocabulary').select('*').limit(limit);

    if (error) {
      throw new Error(`Failed to fetch vocabulary: ${error.message}`);
    }

    return c.json({ vocabulary: vocabulary || [] });
  } catch (e) {
    console.error('games vocabulary error', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return c.json({ error: msg }, 500);
  }
});

games.get('/sentences', zValidator('query', SentencesQuerySchema), async (c) => {
  try {
    const { limit } = c.req.valid('query');
    const supabase = await getSupabaseClient(c.env);

    const { data: sentences, error } = await supabase.from('sentences').select('*').limit(limit);

    if (error) {
      throw new Error(`Failed to fetch sentences: ${error.message}`);
    }

    return c.json({ sentences: sentences || [] });
  } catch (e) {
    console.error('games sentences error', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return c.json({ error: msg }, 500);
  }
});

export { games };

import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

export interface JishoResult {
  word: string;
  reading: string;
  meanings: string[];
  jlpt?: string;
  common: boolean;
}

const app = new Hono<{ Bindings: Env } & AuthContext>();

app.use('*', requireAuth);

const lookupQuerySchema = z.object({
  word: z.string().trim().min(1),
});

const jishoWordSchema = z.object({
  word: z.string().optional(),
  reading: z.string().optional(),
});

const jishoSenseSchema = z.object({
  english_definitions: z.array(z.string()).default([]),
});

const jishoEntrySchema = z.object({
  japanese: z.array(jishoWordSchema).default([]),
  senses: z.array(jishoSenseSchema).default([]),
  jlpt: z.array(z.string()).default([]),
  is_common: z.boolean().optional().default(false),
});

const jishoResponseSchema = z.object({
  data: z.array(jishoEntrySchema),
});

app.get('/lookup', zValidator('query', lookupQuerySchema), async (c) => {
  const { word } = c.req.valid('query');
  const encoded = encodeURIComponent(word);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5_000);

  let payload: unknown;
  try {
    const res = await fetch(`https://jisho.org/api/v1/search/words?keyword=${encoded}`, {
      signal: controller.signal,
    });

    if (!res.ok) {
      return c.json({ error: 'Jisho API request failed' }, 502);
    }

    payload = await res.json();
  } catch (err) {
    console.error('[Vela] Jisho API fetch failed for word:', word, err);
    return c.json({ error: 'Jisho API request failed' }, 502);
  } finally {
    clearTimeout(timeoutId);
  }

  const parsed = jishoResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return c.json({ error: 'Invalid Jisho API response' }, 502);
  }

  const items = parsed.data.data;

  if (items.length === 0) {
    return c.json({ error: 'No results found' }, 404);
  }

  const first = items[0];
  const japanese = first.japanese[0];
  const senses = first.senses[0];

  const result: JishoResult = {
    word: japanese?.word ?? word,
    reading: japanese?.reading ?? '',
    meanings: (senses?.english_definitions ?? []).slice(0, 3),
    jlpt: first.jlpt[0],
    common: first.is_common,
  };

  c.header('Cache-Control', 'public, max-age=86400');
  return c.json(result);
});

export default app;

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

/** Convert katakana to hiragana for normalising readings during comparison. */
const katakanaToHiragana = (str: string): string =>
  str.replace(/[\u30A1-\u30F6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));

const app = new Hono<{ Bindings: Env } & AuthContext>();

app.use('*', requireAuth);

const lookupQuerySchema = z.object({
  word: z.string().trim().min(1),
  reading: z.string().trim().optional(),
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
  const { word, reading } = c.req.valid('query');
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

  // When a reading hint is provided, try to find the Jisho entry whose
  // reading matches the contextual reading. This disambiguates homographs
  // (e.g. 今日 → きょう / today vs こんにち / hello). Normalize both
  // sides to hiragana for comparison since Jisho and kuromoji may use
  // different kana scripts.
  let bestEntry = items[0];
  if (reading) {
    const normalised = katakanaToHiragana(reading);
    for (const entry of items) {
      for (const jp of entry.japanese) {
        if (jp.reading && katakanaToHiragana(jp.reading) === normalised) {
          bestEntry = entry;
          break;
        }
      }
      if (
        bestEntry !== items[0] ||
        (bestEntry === items[0] &&
          bestEntry.japanese.some(
            (jp) => jp.reading && katakanaToHiragana(jp.reading) === normalised,
          ))
      ) {
        break;
      }
    }
  }

  const japanese = bestEntry.japanese[0];
  const senses = bestEntry.senses[0];

  const result: JishoResult = {
    word: japanese?.word ?? word,
    reading: japanese?.reading ?? '',
    meanings: (senses?.english_definitions ?? []).slice(0, 3),
    jlpt: bestEntry.jlpt[0],
    common: bestEntry.is_common,
  };

  c.header('Cache-Control', 'private, max-age=86400');
  return c.json(result);
});

export default app;

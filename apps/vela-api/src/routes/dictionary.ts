import { Hono } from 'hono';
import type { Env } from '../types';

export interface JishoResult {
  word: string;
  reading: string;
  meanings: string[];
  jlpt?: string;
  common: boolean;
}

const app = new Hono<{ Bindings: Env }>();

app.get('/lookup', async (c) => {
  const word = c.req.query('word');

  if (!word || !word.trim()) {
    return c.json({ error: 'word query parameter is required' }, 400);
  }

  const encoded = encodeURIComponent(word.trim());
  const res = await fetch(`https://jisho.org/api/v1/search/words?keyword=${encoded}`);

  if (!res.ok) {
    return c.json({ error: 'Jisho API request failed' }, 502);
  }

  const data = (await res.json()) as any;
  const items: any[] = data?.data ?? [];

  if (items.length === 0) {
    return c.json({ error: 'No results found' }, 404);
  }

  const first = items[0];
  const japanese = first.japanese?.[0] ?? {};
  const senses = first.senses?.[0] ?? {};

  const result: JishoResult = {
    word: japanese.word ?? word.trim(),
    reading: japanese.reading ?? '',
    meanings: ((senses.english_definitions as string[]) ?? []).slice(0, 3),
    jlpt: Array.isArray(first.jlpt) && first.jlpt.length > 0 ? first.jlpt[0] : undefined,
    common: first.is_common ?? false,
  };

  c.header('Cache-Control', 'public, max-age=86400');
  return c.json(result);
});

export default app;

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env } from '../types';
import { vocabulary as vocabularyDB, sentences as sentencesDB } from '../dynamodb';

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

/* ============
 * Routes
 * ============ */

games.get('/vocabulary', zValidator('query', VocabularyQuerySchema), async (c) => {
  try {
    const { limit } = c.req.valid('query');

    const vocabulary = await vocabularyDB.getAll(limit);

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

    const sentences = await sentencesDB.getAll(limit);

    return c.json({ sentences: sentences || [] });
  } catch (e) {
    console.error('games sentences error', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return c.json({ error: msg }, 500);
  }
});

export { games };

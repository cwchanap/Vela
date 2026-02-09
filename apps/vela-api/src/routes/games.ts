import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env } from '../types';
import { vocabulary as vocabularyDB, sentences as sentencesDB } from '../dynamodb';
import { jlptField } from '../validation';

// Validation schemas
const VocabularyQuerySchema = z.object({
  limit: z.coerce.number().int().positive().default(10),
  jlpt: jlptField,
});

const SentencesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().default(5),
  jlpt: jlptField,
});

const games = new Hono<{ Bindings: Env }>();

/* ============
 * Routes
 * ============ */

/**
 * GET /api/games/vocabulary
 * Get vocabulary items for games
 * @query limit - Number of items to return (default: 10)
 * @query jlpt - Comma-separated JLPT levels to filter (e.g., "5,4" for N5 and N4)
 */
games.get('/vocabulary', zValidator('query', VocabularyQuerySchema), async (c) => {
  try {
    const { limit, jlpt } = c.req.valid('query');

    // Use getRandom to get shuffled results, with optional JLPT filter
    const vocabulary = await vocabularyDB.getRandom(limit, jlpt);

    return c.json({
      vocabulary: vocabulary || [],
      filters: {
        jlpt_levels: jlpt || 'all',
        limit,
      },
    });
  } catch (e) {
    console.error('games vocabulary error', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return c.json({ error: msg }, 500);
  }
});

/**
 * GET /api/games/sentences
 * Get sentences for anagram game
 * @query limit - Number of items to return (default: 5)
 * @query jlpt - Comma-separated JLPT levels to filter (e.g., "5,4" for N5 and N4)
 */
games.get('/sentences', zValidator('query', SentencesQuerySchema), async (c) => {
  try {
    const { limit, jlpt } = c.req.valid('query');

    // Use getRandom to get shuffled results, with optional JLPT filter
    const sentences = await sentencesDB.getRandom(limit, jlpt);

    return c.json({
      sentences: sentences || [],
      filters: {
        jlpt_levels: jlpt || 'all',
        limit,
      },
    });
  } catch (e) {
    console.error('games sentences error', e);
    const msg = e instanceof Error ? e.message : 'Unknown error';
    return c.json({ error: msg }, 500);
  }
});

export { games };

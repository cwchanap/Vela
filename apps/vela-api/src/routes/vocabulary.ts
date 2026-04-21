import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { vocabulary, userVocabularyProgress } from '../dynamodb';
import { requireAuth, type AuthContext } from '../middleware/auth';
import type { Env } from '../types';

const app = new Hono<{ Bindings: Env } & AuthContext>();

app.use('*', requireAuth);

const safeSourceUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  }, 'source_url must use http or https');

const fromWordSchema = z.object({
  japanese_word: z.string().trim().min(1),
  reading: z.string(),
  english_translation: z.string().trim().min(1),
  example_sentence_jp: z.string().optional(),
  source_url: safeSourceUrlSchema.optional(),
  jlpt_level: z
    .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
    .optional(),
});

app.post('/from-word', zValidator('json', fromWordSchema), async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const body = c.req.valid('json');

  try {
    const { item, created } = await vocabulary.create({
      japanese_word: body.japanese_word,
      hiragana: body.reading,
      english_translation: body.english_translation,
      example_sentence_jp: body.example_sentence_jp,
      source_url: body.source_url,
      jlpt_level: body.jlpt_level,
      created_at: new Date().toISOString(),
    });

    const vocabularyId = item.id as string;

    // Check if this user already has SRS progress for this word
    const existingProgress = await userVocabularyProgress.get(userId, vocabularyId);
    const alreadyInSRS = !!existingProgress;

    if (!alreadyInSRS) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      await userVocabularyProgress.initializeProgress(userId, vocabularyId, tomorrow.toISOString());
    }

    return c.json({ vocabulary_id: vocabularyId, created, alreadyInSRS });
  } catch (err) {
    console.error('[Vela] /vocabulary/from-word failed', {
      userId,
      word: body.japanese_word,
      err,
    });
    return c.json({ error: 'Failed to save vocabulary entry' }, 500);
  }
});

export default app;

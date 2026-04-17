import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { vocabulary, userVocabularyProgress } from '../dynamodb';
import { requireAuth, type AuthContext } from '../middleware/auth';
import type { Env } from '../types';

const app = new Hono<{ Bindings: Env } & AuthContext>();

app.use('*', requireAuth);

const fromWordSchema = z.object({
  japanese_word: z.string().min(1),
  reading: z.string(),
  english_translation: z.string().min(1),
  example_sentence_jp: z.string().optional(),
  source_url: z.string().optional(),
  jlpt_level: z
    .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)])
    .optional(),
});

app.post('/from-word', zValidator('json', fromWordSchema), async (c) => {
  const userId = c.get('userId');
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const body = c.req.valid('json');

  // Check if word already exists in the shared vocabulary table
  const existing = await vocabulary.findByWord(body.japanese_word);

  let vocabularyId: string;
  let created: boolean;

  if (existing) {
    vocabularyId = existing.id as string;
    created = false;
  } else {
    vocabularyId = crypto.randomUUID();
    await vocabulary.create({
      id: vocabularyId,
      japanese_word: body.japanese_word,
      hiragana: body.reading,
      english_translation: body.english_translation,
      example_sentence_jp: body.example_sentence_jp,
      source_url: body.source_url,
      jlpt_level: body.jlpt_level,
      created_at: new Date().toISOString(),
    });
    created = true;
  }

  // Check if this user already has SRS progress for this word
  const existingProgress = await userVocabularyProgress.get(userId, vocabularyId);
  const alreadyInSRS = !!existingProgress;

  if (!alreadyInSRS) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    await userVocabularyProgress.initializeProgress(userId, vocabularyId, tomorrow.toISOString());
  }

  return c.json({ vocabulary_id: vocabularyId, created, alreadyInSRS });
});

export default app;

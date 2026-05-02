import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { vocabulary, userVocabularyProgress } from '../dynamodb';
import { requireAuth, type AuthContext } from '../middleware/auth';
import type { Env } from '../types';

const app = new Hono<{ Bindings: Env } & AuthContext>();

app.use('*', requireAuth);

const fromWordSchema = z.object({
  japanese_word: z.string().trim().min(1),
  reading: z.string().trim().min(1).optional(),
  english_translation: z.string().trim().min(1),
  jlpt_level: z.number().int().min(1).max(5).optional(),
});

function isConditionalCheckFailedError(error: unknown): error is { name: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'ConditionalCheckFailedException'
  );
}

function sanitizeError(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    return {
      code: error.name || 'Error',
      message: error.message,
    };
  }

  return {
    code: 'UnknownError',
    message: String(error),
  };
}

app.post('/from-word', zValidator('json', fromWordSchema), async (c) => {
  const userId = c.get('userId');
  const body = c.req.valid('json');
  const requestId = c.req.header('x-request-id') ?? globalThis.crypto.randomUUID();

  try {
    const { item, created } = await vocabulary.create({
      japanese_word: body.japanese_word,
      hiragana: body.reading,
      english_translation: body.english_translation,
      jlpt_level: body.jlpt_level,
      created_at: new Date().toISOString(),
    });

    const vocabularyId = item.id;
    let alreadyInSRS = false;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    try {
      await userVocabularyProgress.initializeProgressIfNotExists(
        userId,
        vocabularyId,
        tomorrow.toISOString(),
      );
    } catch (error) {
      if (isConditionalCheckFailedError(error)) {
        alreadyInSRS = true;
      } else {
        console.error('[Vela] SRS progress init failed', {
          requestId,
          vocabularyId,
          err: sanitizeError(error),
        });
        return c.json({ error: 'Failed to initialize SRS progress' }, 500);
      }
    }

    return c.json({ vocabulary_id: vocabularyId, created, alreadyInSRS });
  } catch (err) {
    console.error('[Vela] /vocabulary/from-word failed', {
      requestId,
      err: sanitizeError(err),
    });
    return c.json({ error: 'Failed to save vocabulary entry' }, 500);
  }
});

export default app;

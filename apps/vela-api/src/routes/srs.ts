import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { userVocabularyProgress, vocabulary } from '../dynamodb';
import { calculateNextReview } from '../utils/srs';
import { requireAuth, type AuthContext } from '../middleware/auth';

const srsRouter = new Hono<AuthContext>();

// Apply auth middleware to all routes
srsRouter.use('*', requireAuth);

// Validation schemas
const reviewSchema = z.object({
  vocabulary_id: z.string().min(1),
  quality: z.number().int().min(0).max(5),
});

const limitSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/**
 * GET /api/srs/due
 * Get vocabulary items due for review
 */
srsRouter.get('/due', zValidator('query', limitSchema), async (c) => {
  const userId = c.get('userId') as string;
  const { limit } = c.req.valid('query');

  try {
    const dueItems = await userVocabularyProgress.getDueItems(userId);
    const limitedItems = dueItems.slice(0, limit);

    // Optionally fetch vocabulary details for each due item
    const itemsWithDetails = await Promise.all(
      limitedItems.map(async (progress) => {
        const vocabDetails = await vocabulary.getById(progress.vocabulary_id);
        return {
          ...progress,
          vocabulary: vocabDetails || null,
        };
      }),
    );

    return c.json({
      items: itemsWithDetails,
      total_due: dueItems.length,
    });
  } catch (error) {
    console.error('Error fetching due items:', error);
    return c.json({ error: 'Failed to fetch due items' }, 500);
  }
});

/**
 * GET /api/srs/stats
 * Get SRS statistics for the authenticated user
 */
srsRouter.get('/stats', async (c) => {
  const userId = c.get('userId') as string;

  try {
    const stats = await userVocabularyProgress.getStats(userId);
    return c.json(stats);
  } catch (error) {
    console.error('Error fetching SRS stats:', error);
    return c.json({ error: 'Failed to fetch statistics' }, 500);
  }
});

/**
 * POST /api/srs/review
 * Record a review and update SRS progress
 */
srsRouter.post('/review', zValidator('json', reviewSchema), async (c) => {
  const userId = c.get('userId') as string;
  const { vocabulary_id, quality } = c.req.valid('json');

  try {
    // Get existing progress or create new
    let progress = await userVocabularyProgress.get(userId, vocabulary_id);

    if (!progress) {
      // Initialize progress for new vocabulary item
      const initialDate = new Date().toISOString();
      progress = await userVocabularyProgress.initializeProgress(
        userId,
        vocabulary_id,
        initialDate,
      );
    }

    // Calculate next review using SM-2 algorithm
    const srsResult = calculateNextReview({
      quality,
      easeFactor: progress.ease_factor,
      interval: progress.interval,
      repetitions: progress.repetitions,
    });

    // Update progress in database
    const updatedProgress = await userVocabularyProgress.updateAfterReview(userId, vocabulary_id, {
      next_review_date: srsResult.nextReviewDate,
      ease_factor: srsResult.easeFactor,
      interval: srsResult.interval,
      repetitions: srsResult.repetitions,
      last_quality: quality,
    });

    return c.json(updatedProgress);
  } catch (error) {
    console.error('Error recording review:', error);
    return c.json({ error: 'Failed to record review' }, 500);
  }
});

/**
 * GET /api/srs/progress/:vocabularyId
 * Get progress for a specific vocabulary item
 */
srsRouter.get('/progress/:vocabularyId', async (c) => {
  const userId = c.get('userId') as string;
  const vocabularyId = c.req.param('vocabularyId');

  try {
    const progress = await userVocabularyProgress.get(userId, vocabularyId);

    if (!progress) {
      return c.json({ error: 'Progress not found' }, 404);
    }

    return c.json(progress);
  } catch (error) {
    console.error('Error fetching progress:', error);
    return c.json({ error: 'Failed to fetch progress' }, 500);
  }
});

/**
 * GET /api/srs/all
 * Get all progress records for the authenticated user
 */
srsRouter.get('/all', async (c) => {
  const userId = c.get('userId') as string;

  try {
    const allProgress = await userVocabularyProgress.getByUser(userId);
    return c.json({
      items: allProgress,
      total: allProgress.length,
    });
  } catch (error) {
    console.error('Error fetching all progress:', error);
    return c.json({ error: 'Failed to fetch progress' }, 500);
  }
});

/**
 * DELETE /api/srs/progress/:vocabularyId
 * Delete progress for a vocabulary item (reset learning)
 */
srsRouter.delete('/progress/:vocabularyId', async (c) => {
  const userId = c.get('userId') as string;
  const vocabularyId = c.req.param('vocabularyId');

  try {
    await userVocabularyProgress.delete(userId, vocabularyId);
    return c.json({ success: true, message: 'Progress deleted' });
  } catch (error) {
    console.error('Error deleting progress:', error);
    return c.json({ error: 'Failed to delete progress' }, 500);
  }
});

/**
 * POST /api/srs/batch-review
 * Record multiple reviews at once
 */
const batchReviewSchema = z.object({
  reviews: z.array(
    z.object({
      vocabulary_id: z.string().min(1),
      quality: z.number().int().min(0).max(5),
    }),
  ),
});

srsRouter.post('/batch-review', zValidator('json', batchReviewSchema), async (c) => {
  const userId = c.get('userId') as string;
  const { reviews } = c.req.valid('json');

  try {
    const results = await Promise.all(
      reviews.map(async ({ vocabulary_id, quality }) => {
        let progress = await userVocabularyProgress.get(userId, vocabulary_id);

        if (!progress) {
          const initialDate = new Date().toISOString();
          progress = await userVocabularyProgress.initializeProgress(
            userId,
            vocabulary_id,
            initialDate,
          );
        }

        const srsResult = calculateNextReview({
          quality,
          easeFactor: progress.ease_factor,
          interval: progress.interval,
          repetitions: progress.repetitions,
        });

        return userVocabularyProgress.updateAfterReview(userId, vocabulary_id, {
          next_review_date: srsResult.nextReviewDate,
          ease_factor: srsResult.easeFactor,
          interval: srsResult.interval,
          repetitions: srsResult.repetitions,
          last_quality: quality,
        });
      }),
    );

    return c.json({
      success: true,
      updated: results.length,
      results,
    });
  } catch (error) {
    console.error('Error batch recording reviews:', error);
    return c.json({ error: 'Failed to record batch reviews' }, 500);
  }
});

export default srsRouter;

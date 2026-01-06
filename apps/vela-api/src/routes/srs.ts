import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { userVocabularyProgress, vocabulary } from '../dynamodb';
import { calculateNextReview } from '../utils/srs';
import { requireAuth, type AuthContext } from '../middleware/auth';

const srsRouter = new Hono<AuthContext>();

// Apply auth middleware to all routes
srsRouter.use('*', requireAuth);

// Constants
const BATCH_REVIEW_MAX = 100;

// Validation schemas
const reviewSchema = z.object({
  vocabulary_id: z.string().min(1),
  quality: z.number().int().min(0).max(5),
});

// Shared JLPT field definition with validation (same as games routes)
const jlptField = z
  .string()
  .optional()
  .transform((val) => {
    if (!val) return undefined;

    // Parse comma-separated JLPT levels
    const levels = val.split(',').map((level) => level.trim());

    // Convert to integers and validate each value
    const parsedLevels: number[] = [];
    for (const level of levels) {
      const parsed = parseInt(level, 10);

      // Validate: must be a finite integer between 1-5
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 5) {
        throw new Error(`Invalid JLPT level "${level}". Must be an integer between 1 and 5.`);
      }

      parsedLevels.push(parsed);
    }

    // Remove duplicates while preserving order
    const uniqueLevels = [...new Set(parsedLevels)];

    return uniqueLevels.length > 0 ? uniqueLevels : undefined;
  });

const limitSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  jlpt: jlptField,
});

const statsSchema = z.object({
  jlpt: jlptField,
});

/**
 * GET /api/srs/due
 * Get vocabulary items due for review
 */
srsRouter.get('/due', zValidator('query', limitSchema), async (c) => {
  const userId = c.get('userId') as string;
  const { limit, jlpt } = c.req.valid('query');

  try {
    const dueItems = await userVocabularyProgress.getDueItems(userId);

    // Fetch vocabulary details for all due items to enable JLPT filtering
    const itemsWithDetails = await Promise.all(
      dueItems.map(async (progress) => {
        const vocabDetails = await vocabulary.getById(progress.vocabulary_id);
        return {
          progress: {
            user_id: progress.user_id,
            vocabulary_id: progress.vocabulary_id,
            next_review_date: progress.next_review_date,
            ease_factor: progress.ease_factor,
            interval: progress.interval,
            repetitions: progress.repetitions,
            last_quality: progress.last_quality,
            last_reviewed_at: progress.last_reviewed_at,
            first_learned_at: progress.first_learned_at,
            total_reviews: progress.total_reviews,
            correct_count: progress.correct_count,
          },
          vocabulary: vocabDetails || null,
        };
      }),
    );

    // Filter by JLPT level if specified
    let filteredItems = itemsWithDetails;
    if (jlpt) {
      filteredItems = itemsWithDetails.filter((item) => {
        return item.vocabulary && jlpt.includes(item.vocabulary.jlpt_level);
      });
    }

    // Apply limit after filtering
    const limitedItems = filteredItems.slice(0, limit);

    return c.json({
      items: limitedItems,
      total: filteredItems.length,
    });
  } catch (error) {
    console.error('Error fetching due items:', error);
    return c.json({ error: 'Failed to fetch due items' }, 500);
  }
});

/**
 * GET /api/srs/stats
 * Get SRS statistics for the authenticated user
 * Optional query parameter: jlpt (1-5) to filter by JLPT level(s)
 * Multiple levels can be specified as comma-separated values (e.g., "1,2,3")
 */
srsRouter.get('/stats', zValidator('query', statsSchema), async (c) => {
  const userId = c.get('userId') as string;
  const { jlpt } = c.req.valid('query');

  try {
    // Get all progress items for the user
    const allItems = await userVocabularyProgress.getByUser(userId);

    let filteredItems = allItems;

    // If JLPT filter is specified, fetch vocabulary details and filter
    if (jlpt && jlpt.length > 0) {
      const itemsWithVocab = await Promise.all(
        allItems.map(async (progress) => {
          const vocabDetails = await vocabulary.getById(progress.vocabulary_id);
          return { progress, vocabulary: vocabDetails };
        }),
      );

      filteredItems = itemsWithVocab
        .filter((item) => item.vocabulary && jlpt.includes(item.vocabulary.jlpt_level))
        .map((item) => item.progress);
    }

    // Calculate stats on filtered items
    const now = new Date();
    const dueItems = filteredItems.filter((item) => new Date(item.next_review_date) <= now);

    // Calculate mastery breakdown
    const newItems = filteredItems.filter((item) => item.interval === 0);
    const learningItems = filteredItems.filter((item) => item.interval > 0 && item.interval < 21);
    const reviewingItems = filteredItems.filter(
      (item) => item.interval >= 21 && item.interval < 60,
    );
    const masteredItems = filteredItems.filter((item) => item.interval >= 60);

    const avgEaseFactor =
      filteredItems.length > 0
        ? filteredItems.reduce((sum, item) => sum + item.ease_factor, 0) / filteredItems.length
        : 0;

    const totalReviews = filteredItems.reduce((sum, item) => sum + item.total_reviews, 0);
    const correctCount = filteredItems.reduce((sum, item) => sum + item.correct_count, 0);
    const accuracyRate = totalReviews > 0 ? Math.round((correctCount / totalReviews) * 100) : 0;

    const stats = {
      total_items: filteredItems.length,
      due_today: dueItems.length,
      mastery_breakdown: {
        new: newItems.length,
        learning: learningItems.length,
        reviewing: reviewingItems.length,
        mastered: masteredItems.length,
      },
      average_ease_factor: Math.round(avgEaseFactor * 100) / 100,
      total_reviews: totalReviews,
      accuracy_rate: accuracyRate,
    };

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

    return c.json({ progress: updatedProgress });
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
      return c.json({ progress: null }, 404);
    }

    return c.json({ progress });
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
  reviews: z
    .array(
      z.object({
        vocabulary_id: z.string().min(1),
        quality: z.number().int().min(0).max(5),
      }),
    )
    .max(BATCH_REVIEW_MAX),
});

srsRouter.post('/batch-review', zValidator('json', batchReviewSchema), async (c) => {
  const userId = c.get('userId') as string;
  const { reviews } = c.req.valid('json');

  try {
    // Deduplicate reviews: keep only the last review for each vocabulary_id
    // to avoid race conditions from concurrent updates on the same item
    const deduplicatedReviews = Array.from(
      new Map(reviews.map((review) => [review.vocabulary_id, review])).values(),
    );

    const results = await Promise.all(
      deduplicatedReviews.map(async ({ vocabulary_id, quality }) => {
        try {
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

          await userVocabularyProgress.updateAfterReview(userId, vocabulary_id, {
            next_review_date: srsResult.nextReviewDate,
            ease_factor: srsResult.easeFactor,
            interval: srsResult.interval,
            repetitions: srsResult.repetitions,
            last_quality: quality,
          });

          return {
            vocabulary_id,
            success: true,
          };
        } catch (error) {
          console.error(`Error reviewing vocabulary ${vocabulary_id}:`, error);
          return {
            vocabulary_id,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
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

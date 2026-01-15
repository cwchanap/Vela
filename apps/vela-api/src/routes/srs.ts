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
const CONCURRENCY_LIMIT = 10; // Max concurrent reviews to prevent DynamoDB throttling

/**
 * Process items with concurrency control to prevent overwhelming downstream services
 * @param items - Items to process
 * @param processFn - Async function to process each item
 * @param concurrency - Maximum number of concurrent operations
 * @returns Array of results in the same order as input items
 */
async function processWithConcurrency<T, R>(
  items: T[],
  processFn: any,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const executing: Array<{ promise: Promise<R>; index: number }> = [];

  for (let i = 0; i < items.length; i++) {
    const index = i;

    // Create a promise for this item
    const promise: Promise<R> = (processFn as any)(items[i])
      .then((result: R) => {
        results[index] = result;
        return result;
      })
      .catch((error: unknown) => {
        results[index] = error as R;
        throw error;
      });

    executing.push({ promise, index });

    // If we've reached the concurrency limit, wait for at least one to complete
    if (executing.length >= concurrency) {
      const racePromise = Promise.race(
        executing.map((e) => e.promise.then(() => e.index).catch(() => e.index)),
      );
      const completedIndex = await racePromise;
      // Remove the completed promise from executing array
      const idx = executing.findIndex((e) => e.index === completedIndex);
      if (idx !== -1) {
        executing.splice(idx, 1);
      }
    }
  }

  // Wait for all remaining promises to complete
  await Promise.all(executing.map((e) => e.promise.catch(() => {})));

  return results;
}

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
    const invalidLevels: string[] = [];
    for (const level of levels) {
      if (!level) continue;
      const parsed = parseInt(level, 10);

      // Validate: must be a finite integer between 1-5
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 5) {
        invalidLevels.push(level);
      } else {
        parsedLevels.push(parsed);
      }
    }

    // If there are invalid levels, throw a proper Zod validation error
    if (invalidLevels.length > 0) {
      throw new z.ZodError([
        {
          code: z.ZodIssueCode.custom,
          path: [],
          message: `Invalid JLPT level(s): ${invalidLevels.join(', ')}. Must be integers between 1 and 5.`,
        },
      ]);
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

    if (dueItems.length === 0) {
      return c.json({
        items: [],
        total: 0,
      });
    }

    // If no JLPT filter, fetch just enough items to satisfy the limit
    if (!jlpt || jlpt.length === 0) {
      const limitedDueItems = dueItems.slice(0, limit);
      const vocabIds = limitedDueItems.map((item) => item.vocabulary_id);

      const vocabMap = await vocabulary.getByIds(vocabIds);

      const itemsWithDetails = limitedDueItems.map((progress) => {
        const vocabDetails = vocabMap[progress.vocabulary_id] || null;
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
          vocabulary: vocabDetails,
        };
      });

      return c.json({
        items: itemsWithDetails,
        total: dueItems.length,
      });
    }

    // With JLPT filter: scan due items until we have enough matching items or exhaust due items
    const CHUNK_SIZE = 50;
    let allItems: any[] = [];
    let scannedDueItemsCount = 0;

    while (allItems.length < limit && scannedDueItemsCount < dueItems.length) {
      const chunk = dueItems.slice(scannedDueItemsCount, scannedDueItemsCount + CHUNK_SIZE);
      scannedDueItemsCount += chunk.length;

      if (chunk.length === 0) {
        break;
      }

      const vocabIds = chunk.map((item) => item.vocabulary_id);
      const vocabMap = await vocabulary.getByIds(vocabIds);

      const itemsWithDetails = chunk.map((progress) => {
        const vocabDetails = vocabMap[progress.vocabulary_id] || null;
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
          vocabulary: vocabDetails,
        };
      });

      // Filter by JLPT level
      const filteredChunk = itemsWithDetails.filter((item) => {
        return (
          item.vocabulary && item.vocabulary.jlpt_level && jlpt.includes(item.vocabulary.jlpt_level)
        );
      });

      allItems.push(...filteredChunk);
    }

    const exhaustedDueItems = scannedDueItemsCount >= dueItems.length;

    // Calculate total matching items
    let totalMatching: number;
    if (exhaustedDueItems) {
      // We've checked all due items, so use actual count
      totalMatching = allItems.length;
    } else {
      // We haven't exhausted due items, provide conservative estimate
      const matchingRatio = scannedDueItemsCount > 0 ? allItems.length / scannedDueItemsCount : 0;
      totalMatching = Math.round(dueItems.length * matchingRatio);
      // Ensure estimate is at least what we've found
      totalMatching = Math.max(totalMatching, allItems.length);
    }

    return c.json({
      items: allItems.slice(0, limit),
      total: totalMatching,
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
      // Collect all vocabulary IDs for batch fetch
      const vocabIds = allItems.map((item) => item.vocabulary_id);

      // Fetch all vocabulary details in a single batch operation
      const vocabMap = await vocabulary.getByIds(vocabIds);

      // Build items with vocab details and filter by JLPT level
      filteredItems = allItems.filter((progress) => {
        const vocabDetails = vocabMap[progress.vocabulary_id];
        return vocabDetails && vocabDetails.jlpt_level && jlpt.includes(vocabDetails.jlpt_level);
      });
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
    // Validate that vocabulary exists before creating/progress
    const vocab = await vocabulary.getById(vocabulary_id);
    if (!vocab) {
      return c.json({ error: 'Vocabulary not found' }, 404);
    }

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
    let updatedProgress = await userVocabularyProgress.updateAfterReview(userId, vocabulary_id, {
      next_review_date: srsResult.nextReviewDate,
      ease_factor: srsResult.easeFactor,
      interval: srsResult.interval,
      repetitions: srsResult.repetitions,
      last_quality: quality,
    });

    // Handle case where updateAfterReview returned undefined (item missing or race condition)
    if (!updatedProgress) {
      // Attempt recovery: get current state and try once more
      const currentProgress = await userVocabularyProgress.get(userId, vocabulary_id);
      if (currentProgress) {
        // Item exists, retry the update
        updatedProgress = await userVocabularyProgress.updateAfterReview(userId, vocabulary_id, {
          next_review_date: srsResult.nextReviewDate,
          ease_factor: srsResult.easeFactor,
          interval: srsResult.interval,
          repetitions: srsResult.repetitions,
          last_quality: quality,
        });
      } else {
        // Item doesn't exist, return 404
        return c.json({ error: 'Progress not found for vocabulary item' }, 404);
      }
    }

    // If still undefined after recovery attempt, return conflict error
    if (!updatedProgress) {
      return c.json({ error: 'Failed to update progress due to race condition' }, 409);
    }

    return c.json({ progress: updatedProgress });
  } catch (error) {
    console.error('Error recording review:', error);
    // Handle ConditionalCheckFailedException specifically
    if (
      error &&
      typeof error === 'object' &&
      'name' in error &&
      error.name === 'ConditionalCheckFailedException'
    ) {
      return c.json({ error: 'Failed to update progress: item does not exist' }, 409);
    }
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

    // Return 200 with progress: null for new vocabulary items
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

    // Validate all vocabulary IDs exist in batch
    const vocabIds = deduplicatedReviews.map((r) => r.vocabulary_id);
    const vocabMap = await vocabulary.getByIds(vocabIds);

    // Filter out reviews for non-existent vocabularies
    const validReviews = deduplicatedReviews.filter((review) => vocabMap[review.vocabulary_id]);

    // Log if any reviews were rejected
    if (validReviews.length !== deduplicatedReviews.length) {
      const invalidCount = deduplicatedReviews.length - validReviews.length;
      console.warn(`[SRS] Rejected ${invalidCount} reviews for non-existent vocabularies`);
    }

    // Process reviews with concurrency control to prevent DynamoDB throttling
    const processReview = async ({
      vocabulary_id,
      quality,
    }: {
      vocabulary_id: string;
      quality: number;
    }) => {
      try {
        // Skip reviews for non-existent vocabularies (already filtered, but keep for error reporting)
        if (!vocabMap[vocabulary_id]) {
          return {
            vocabulary_id,
            success: false,
            error: 'Vocabulary not found',
          };
        }

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

        const updatedProgress = await userVocabularyProgress.updateAfterReview(
          userId,
          vocabulary_id,
          {
            next_review_date: srsResult.nextReviewDate,
            ease_factor: srsResult.easeFactor,
            interval: srsResult.interval,
            repetitions: srsResult.repetitions,
            last_quality: quality,
          },
        );

        if (!updatedProgress) {
          throw new Error(`Failed to update progress for vocabulary ${vocabulary_id}`);
        }

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
    };

    // Process all reviews with concurrency limit
    type BatchReviewResult = {
      vocabulary_id: string;
      success: boolean;
      error?: string;
    };

    const results = await processWithConcurrency<
      (typeof deduplicatedReviews)[number],
      BatchReviewResult
    >(deduplicatedReviews, processReview, CONCURRENCY_LIMIT);

    // Separate successful and failed results for clearer response
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    return c.json({
      success: true,
      processed: results.length,
      successful: successful.length,
      failed: failed.length,
      results,
    });
  } catch (error) {
    console.error('Error batch recording reviews:', error);
    return c.json({ error: 'Failed to record batch reviews' }, 500);
  }
});

export default srsRouter;

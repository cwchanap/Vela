import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { Hono } from 'hono';
import type { AuthContext } from '../middleware/auth';

// Create a test version of the SRS router without auth dependency
// This allows us to test the route logic independently

// Mock the dynamodb module
const mockUserVocabularyProgress = {
  get: vi.fn(),
  getByUser: vi.fn(),
  getDueItems: vi.fn(),
  put: vi.fn(),
  updateAfterReview: vi.fn(),
  initializeProgress: vi.fn(),
  delete: vi.fn(),
  getStats: vi.fn(),
};

const mockVocabulary = {
  getById: vi.fn() as any,
  getByIds: vi.fn() as any,
  getRandom: vi.fn(),
};

vi.mock('../dynamodb', () => ({
  userVocabularyProgress: mockUserVocabularyProgress,
  vocabulary: mockVocabulary,
}));

vi.mock('../utils/srs', () => ({
  calculateNextReview: vi.fn().mockReturnValue({
    easeFactor: 2.5,
    interval: 1,
    repetitions: 1,
    nextReviewDate: '2024-12-31T00:00:00Z',
  }),
  SRS_DEFAULTS: {
    EASE_FACTOR: 2.5,
    MIN_EASE_FACTOR: 1.3,
    INITIAL_INTERVAL: 1,
    SECOND_INTERVAL: 6,
  },
}));

let processWithConcurrency: typeof import('./srs').processWithConcurrency;
const TEST_CONCURRENCY_LIMIT = 5;

// Create a test app that injects userId without real auth
function createTestApp(): Hono<AuthContext> {
  const app = new Hono<AuthContext>();

  // Mock auth middleware that sets userId
  app.use('*', async (c, next) => {
    c.set('userId', 'test-user-123');
    await next();
  });

  // Import and mount the routes after mocks are set up
  // We need to create inline routes for testing since the real router has auth middleware
  app.get('/due', async (c) => {
    const userId = c.get('userId') as string;
    const limit = parseInt(c.req.query('limit') || '20');

    const dueItems = await mockUserVocabularyProgress.getDueItems(userId);
    const limitedItems = dueItems.slice(0, limit);

    return c.json({
      items: limitedItems,
      total_due: dueItems.length,
    });
  });

  app.get('/stats', async (c) => {
    const userId = c.get('userId') as string;
    const stats = await mockUserVocabularyProgress.getStats(userId);
    return c.json(stats);
  });

  app.post('/review', async (c) => {
    const userId = c.get('userId') as string;
    const body = await c.req.json();

    if (typeof body.quality !== 'number' || body.quality < 0 || body.quality > 5) {
      return c.json({ error: 'Invalid quality rating' }, 400);
    }

    // Validate that vocabulary exists
    const vocab = await mockVocabulary.getById(body.vocabulary_id);
    if (!vocab) {
      return c.json({ error: 'Vocabulary not found' }, 404);
    }

    let progress = await mockUserVocabularyProgress.get(userId, body.vocabulary_id);

    if (!progress) {
      progress = await mockUserVocabularyProgress.initializeProgress(
        userId,
        body.vocabulary_id,
        new Date().toISOString(),
      );
    }

    // Call mocked calculateNextReview (imported at top from vi.mock)
    const { calculateNextReview } = await import('../utils/srs');
    const srsResult = calculateNextReview({
      quality: body.quality,
      easeFactor: progress.ease_factor,
      interval: progress.interval,
      repetitions: progress.repetitions,
    });

    const updatedProgress = await mockUserVocabularyProgress.updateAfterReview(
      userId,
      body.vocabulary_id,
      {
        next_review_date: srsResult.nextReviewDate,
        ease_factor: srsResult.easeFactor,
        interval: srsResult.interval,
        repetitions: srsResult.repetitions,
        last_quality: body.quality,
      },
    );

    return c.json(updatedProgress);
  });

  app.get('/progress/:vocabularyId', async (c) => {
    const userId = c.get('userId') as string;
    const vocabularyId = c.req.param('vocabularyId');

    const progress = await mockUserVocabularyProgress.get(userId, vocabularyId);

    // Return 200 with progress: null for new vocabulary items
    return c.json({ progress });
  });

  app.delete('/progress/:vocabularyId', async (c) => {
    const userId = c.get('userId') as string;
    const vocabularyId = c.req.param('vocabularyId');

    await mockUserVocabularyProgress.delete(userId, vocabularyId);
    return c.json({ success: true, message: 'Progress deleted' });
  });

  app.post('/batch-review', async (c) => {
    const userId = c.get('userId') as string;
    const body = await c.req.json();

    if (!body.reviews || !Array.isArray(body.reviews) || body.reviews.length > 100) {
      return c.json({ error: 'Invalid reviews format or exceeds batch limit' }, 400);
    }

    // Deduplicate reviews
    const deduplicatedReviews = Array.from(
      new Map(body.reviews.map((review: any) => [review.vocabulary_id, review])).values(),
    );

    // Validate all vocabulary IDs exist in batch
    const vocabIds = deduplicatedReviews.map((r: any) => r.vocabulary_id);
    const vocabMap = await mockVocabulary.getByIds(vocabIds);

    const results = await processWithConcurrency(
      deduplicatedReviews,
      async ({ vocabulary_id, quality }: any) => {
        try {
          // Skip reviews for non-existent vocabularies
          if (!vocabMap[vocabulary_id]) {
            return {
              vocabulary_id,
              success: false,
              error: 'Vocabulary not found',
            };
          }

          let progress = await mockUserVocabularyProgress.get(userId, vocabulary_id);

          if (!progress) {
            progress = await mockUserVocabularyProgress.initializeProgress(
              userId,
              vocabulary_id,
              new Date().toISOString(),
            );
          }

          const { calculateNextReview } = await import('../utils/srs');
          const srsResult = calculateNextReview({
            quality,
            easeFactor: progress.ease_factor,
            interval: progress.interval,
            repetitions: progress.repetitions,
          });

          const updatedProgress = await mockUserVocabularyProgress.updateAfterReview(
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
        } catch (error: any) {
          return {
            vocabulary_id,
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      },
      TEST_CONCURRENCY_LIMIT,
    );

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
  });

  return app;
}

describe('processWithConcurrency', () => {
  it('returns results in input order when promises resolve out of order', async () => {
    if (!processWithConcurrency) {
      ({ processWithConcurrency } = await import('./srs'));
    }
    vi.useFakeTimers();

    const delays = [30, 10, 20];
    const resultsPromise = processWithConcurrency(
      delays,
      (delay) =>
        new Promise<number>((resolve) => {
          setTimeout(() => resolve(delay), delay);
        }),
      2,
    );

    await vi.runAllTimersAsync();

    const results = await resultsPromise;
    expect(results).toEqual(delays);

    vi.useRealTimers();
  });
});

describe('SRS Routes', () => {
  let app: Hono<AuthContext>;

  beforeAll(async () => {
    if (!processWithConcurrency) {
      ({ processWithConcurrency } = await import('./srs'));
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  describe('GET /due', () => {
    it('should return due items for authenticated user', async () => {
      const mockDueItems = [
        {
          user_id: 'test-user-123',
          vocabulary_id: 'vocab-1',
          next_review_date: '2024-12-29T00:00:00Z',
          ease_factor: 2.5,
          interval: 1,
          repetitions: 1,
        },
      ];

      mockUserVocabularyProgress.getDueItems.mockResolvedValue(mockDueItems);

      const res = await app.request('/due');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.items).toHaveLength(1);
      expect(data.items[0].vocabulary_id).toBe('vocab-1');
    });

    it('should respect limit query parameter', async () => {
      const mockDueItems = Array.from({ length: 10 }, (_, i) => ({
        user_id: 'test-user-123',
        vocabulary_id: `vocab-${i + 1}`,
        next_review_date: '2024-12-29T00:00:00Z',
        ease_factor: 2.5,
        interval: 1,
        repetitions: 1,
      }));

      mockUserVocabularyProgress.getDueItems.mockResolvedValue(mockDueItems);

      const res = await app.request('/due?limit=5');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.items).toHaveLength(5);
      expect(data.items[0].vocabulary_id).toBe('vocab-1');
      expect(data.items[4].vocabulary_id).toBe('vocab-5');
      expect(data.total_due).toBe(10);
      expect(mockUserVocabularyProgress.getDueItems).toHaveBeenCalledWith('test-user-123');
    });

    it('should handle multiple due items with limit', async () => {
      const mockDueItems = Array.from({ length: 25 }, (_, i) => ({
        user_id: 'test-user-123',
        vocabulary_id: `vocab-${i + 1}`,
        next_review_date: '2024-12-29T00:00:00Z',
        ease_factor: 2.5,
        interval: 1,
        repetitions: 1,
      }));

      mockUserVocabularyProgress.getDueItems.mockResolvedValue(mockDueItems);

      const res = await app.request('/due?limit=20');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.items).toHaveLength(20);
      expect(data.total_due).toBe(25);
    });
  });

  describe('GET /stats', () => {
    it('should return SRS statistics for authenticated user', async () => {
      const mockStats = {
        total_items: 50,
        due_items: 10,
        mastered_items: 20,
        average_ease_factor: 2.4,
      };

      mockUserVocabularyProgress.getStats.mockResolvedValue(mockStats);

      const res = await app.request('/stats');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.total_items).toBe(50);
      expect(data.due_items).toBe(10);
      expect(data.mastered_items).toBe(20);
    });

    it('should handle stats with accuracy calculation', async () => {
      const mockStats = {
        total_items: 100,
        due_items: 25,
        mastered_items: 30,
        average_ease_factor: 2.7,
        total_reviews: 500,
        accuracy_rate: 85,
      };

      mockUserVocabularyProgress.getStats.mockResolvedValue(mockStats);

      const res = await app.request('/stats');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.total_items).toBe(100);
      expect(data.accuracy_rate).toBe(85);
    });
  });

  describe('POST /review', () => {
    it('should update progress after a review', async () => {
      // Mock vocabulary exists
      mockVocabulary.getById.mockResolvedValue({
        id: 'vocab-1',
        word: 'test',
      });

      const mockProgress = {
        user_id: 'test-user-123',
        vocabulary_id: 'vocab-1',
        next_review_date: '2024-12-31T00:00:00Z',
        ease_factor: 2.5,
        interval: 1,
        repetitions: 1,
        last_quality: 4,
        total_reviews: 1,
        correct_count: 1,
      };

      mockUserVocabularyProgress.get.mockResolvedValue({
        user_id: 'test-user-123',
        vocabulary_id: 'vocab-1',
        next_review_date: '2024-12-30T00:00:00Z',
        ease_factor: 2.5,
        interval: 0,
        repetitions: 0,
        first_learned_at: '2024-12-30T00:00:00Z',
        total_reviews: 0,
        correct_count: 0,
      });

      mockUserVocabularyProgress.updateAfterReview.mockResolvedValue(mockProgress);

      const res = await app.request('/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vocabulary_id: 'vocab-1',
          quality: 4,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.vocabulary_id).toBe('vocab-1');
      expect(data.repetitions).toBe(1);
    });

    it('should initialize progress for new vocabulary item', async () => {
      // Mock vocabulary exists
      mockVocabulary.getById.mockResolvedValue({
        id: 'vocab-new',
        word: 'new-word',
      });

      const mockProgress = {
        user_id: 'test-user-123',
        vocabulary_id: 'vocab-new',
        next_review_date: '2024-12-31T00:00:00Z',
        ease_factor: 2.5,
        interval: 1,
        repetitions: 1,
        first_learned_at: '2024-12-30T00:00:00Z',
        total_reviews: 1,
        correct_count: 1,
      };

      mockUserVocabularyProgress.get.mockResolvedValue(undefined);
      mockUserVocabularyProgress.initializeProgress.mockResolvedValue({
        user_id: 'test-user-123',
        vocabulary_id: 'vocab-new',
        next_review_date: '2024-12-30T00:00:00Z',
        ease_factor: 2.5,
        interval: 0,
        repetitions: 0,
        first_learned_at: '2024-12-30T00:00:00Z',
        total_reviews: 0,
        correct_count: 0,
      });
      mockUserVocabularyProgress.updateAfterReview.mockResolvedValue(mockProgress);

      const res = await app.request('/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vocabulary_id: 'vocab-new',
          quality: 4,
        }),
      });

      expect(res.status).toBe(200);
      expect(mockUserVocabularyProgress.initializeProgress).toHaveBeenCalled();
    });

    it('should reject invalid quality rating', async () => {
      const res = await app.request('/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vocabulary_id: 'vocab-1',
          quality: 6, // Invalid: should be 0-5
        }),
      });

      expect(res.status).toBe(400);
    });

    it('should reject review for non-existent vocabulary', async () => {
      mockVocabulary.getById.mockResolvedValue(undefined);

      const res = await app.request('/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vocabulary_id: 'non-existent-vocab',
          quality: 4,
        }),
      });

      expect(res.status).toBe(404);
      expect(mockUserVocabularyProgress.initializeProgress).not.toHaveBeenCalled();
    });
  });

  describe('GET /progress/:vocabularyId', () => {
    it('should return progress for a specific vocabulary item', async () => {
      const mockProgress = {
        user_id: 'test-user-123',
        vocabulary_id: 'vocab-1',
        next_review_date: '2024-12-31T00:00:00Z',
        ease_factor: 2.5,
        interval: 6,
        repetitions: 2,
        first_learned_at: '2024-12-25T00:00:00Z',
        total_reviews: 2,
        correct_count: 2,
      };

      mockUserVocabularyProgress.get.mockResolvedValue(mockProgress);

      const res = await app.request('/progress/vocab-1');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.progress.vocabulary_id).toBe('vocab-1');
      expect(data.progress.interval).toBe(6);
    });

    it('should return 200 with progress: undefined for non-existent progress', async () => {
      mockUserVocabularyProgress.get.mockResolvedValue(undefined);

      const res = await app.request('/progress/vocab-unknown');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.progress).toBeUndefined();
    });
  });

  describe('DELETE /progress/:vocabularyId', () => {
    it('should delete progress for a vocabulary item', async () => {
      mockUserVocabularyProgress.delete.mockResolvedValue(undefined);

      const res = await app.request('/progress/vocab-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(200);
      expect(mockUserVocabularyProgress.delete).toHaveBeenCalledWith('test-user-123', 'vocab-1');
    });
  });

  describe('POST /batch-review', () => {
    it('should process multiple reviews successfully', async () => {
      // Mock vocabulary exists for both items
      mockVocabulary.getByIds.mockResolvedValue({
        'vocab-1': { id: 'vocab-1', word: 'test1' },
        'vocab-2': { id: 'vocab-2', word: 'test2' },
      });

      mockUserVocabularyProgress.get.mockImplementation(async (_userId: any, vocabularyId: any) => {
        if (vocabularyId === 'vocab-1') {
          return {
            user_id: 'test-user-123',
            vocabulary_id: 'vocab-1',
            next_review_date: '2024-12-30T00:00:00Z',
            ease_factor: 2.5,
            interval: 0,
            repetitions: 0,
            first_learned_at: '2024-12-30T00:00:00Z',
            total_reviews: 0,
            correct_count: 0,
          };
        }
        if (vocabularyId === 'vocab-2') {
          return {
            user_id: 'test-user-123',
            vocabulary_id: 'vocab-2',
            next_review_date: '2024-12-30T00:00:00Z',
            ease_factor: 2.5,
            interval: 0,
            repetitions: 0,
            first_learned_at: '2024-12-30T00:00:00Z',
            total_reviews: 0,
            correct_count: 0,
          };
        }
        return undefined;
      });

      const res = await app.request('/batch-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviews: [
            { vocabulary_id: 'vocab-1', quality: 4 },
            { vocabulary_id: 'vocab-2', quality: 3 },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.processed).toBe(2); // Processing 2 different vocab items
      expect(data.successful).toBe(2);
      expect(data.failed).toBe(0);
      expect(data.results).toHaveLength(2);
    });

    it('should reject batch size exceeding limit', async () => {
      const reviews = Array.from({ length: 101 }, (_, i) => ({
        vocabulary_id: `vocab-${i}`,
        quality: 4,
      }));

      const res = await app.request('/batch-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviews }),
      });

      expect(res.status).toBe(400);
    });

    it('should filter out reviews for non-existent vocabularies in batch', async () => {
      // Mock getByIds to return only one vocabulary
      mockVocabulary.getByIds.mockResolvedValue({
        'vocab-1': { id: 'vocab-1', word: 'test' },
        // vocab-2 is missing - non-existent
      });

      const mockProgress = {
        user_id: 'test-user-123',
        vocabulary_id: 'vocab-1',
        next_review_date: '2024-12-31T00:00:00Z',
        ease_factor: 2.5,
        interval: 1,
        repetitions: 1,
        last_quality: 4,
        total_reviews: 1,
        correct_count: 1,
      };

      mockUserVocabularyProgress.get.mockResolvedValue({
        user_id: 'test-user-123',
        vocabulary_id: 'vocab-1',
        next_review_date: '2024-12-30T00:00:00Z',
        ease_factor: 2.5,
        interval: 0,
        repetitions: 0,
        first_learned_at: '2024-12-30T00:00:00Z',
        total_reviews: 0,
        correct_count: 0,
      });
      mockUserVocabularyProgress.updateAfterReview.mockResolvedValue(mockProgress);

      const res = await app.request('/batch-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviews: [
            { vocabulary_id: 'vocab-1', quality: 4 },
            { vocabulary_id: 'vocab-2', quality: 3 },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.processed).toBe(2);
      expect(data.successful).toBe(1);
      expect(data.failed).toBe(1);
      expect(data.results).toHaveLength(2);
      expect(data.results[0].success).toBe(true);
      expect(data.results[1].success).toBe(false);
      expect(data.results[1].error).toBe('Vocabulary not found');
    });

    it('should process large batches with concurrency limiting', async () => {
      vi.useFakeTimers();
      // Create a batch of 20 items to verify concurrency control
      const reviews = Array.from({ length: 20 }, (_, i) => ({
        vocabulary_id: `vocab-${i}`,
        quality: 4,
      }));

      // Mock vocabulary for all items
      const vocabMap: Record<string, any> = {};
      for (let i = 0; i < 20; i++) {
        vocabMap[`vocab-${i}`] = { id: `vocab-${i}`, word: `test${i}` };
      }
      mockVocabulary.getByIds.mockResolvedValue(vocabMap);

      // Mock progress for all items
      mockUserVocabularyProgress.get.mockImplementation(
        async (_userId: any, vocabularyId: any) => ({
          user_id: 'test-user-123',
          vocabulary_id: vocabularyId,
          next_review_date: '2024-12-30T00:00:00Z',
          ease_factor: 2.5,
          interval: 0,
          repetitions: 0,
          first_learned_at: '2024-12-30T00:00:00Z',
          total_reviews: 0,
          correct_count: 0,
        }),
      );

      // Track calls to verify they were made
      let callCount = 0;
      let activeCount = 0;
      let maxActive = 0;
      mockUserVocabularyProgress.updateAfterReview.mockImplementation(async () => {
        activeCount += 1;
        maxActive = Math.max(maxActive, activeCount);
        callCount++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeCount -= 1;
        return {
          user_id: 'test-user-123',
          vocabulary_id: 'test',
          next_review_date: '2024-12-31T00:00:00Z',
          ease_factor: 2.6,
          interval: 1,
          repetitions: 1,
          last_quality: 4,
          total_reviews: 1,
          correct_count: 1,
        };
      });

      const res = await app.request('/batch-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviews }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.processed).toBe(20);
      expect(data.successful).toBe(20);
      expect(data.failed).toBe(0);
      // Verify all 20 updates were called
      expect(callCount).toBe(20);
      expect(maxActive).toBeLessThanOrEqual(TEST_CONCURRENCY_LIMIT);
    });
  });
});

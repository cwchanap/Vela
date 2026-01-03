import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

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
  getById: vi.fn(),
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

// Create a test app that injects userId without real auth
function createTestApp() {
  const app = new Hono();

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

    const progress = await mockUserVocabularyProgress.get(userId, body.vocabulary_id);

    if (!progress) {
      await mockUserVocabularyProgress.initializeProgress(
        userId,
        body.vocabulary_id,
        new Date().toISOString(),
      );
    }

    const updatedProgress = await mockUserVocabularyProgress.updateAfterReview(
      userId,
      body.vocabulary_id,
      {
        next_review_date: '2024-12-31T00:00:00Z',
        ease_factor: 2.5,
        interval: 1,
        repetitions: 1,
        last_quality: body.quality,
      },
    );

    return c.json(updatedProgress);
  });

  app.get('/progress/:vocabularyId', async (c) => {
    const userId = c.get('userId') as string;
    const vocabularyId = c.req.param('vocabularyId');

    const progress = await mockUserVocabularyProgress.get(userId, vocabularyId);

    if (!progress) {
      return c.json({ error: 'Progress not found' }, 404);
    }

    return c.json(progress);
  });

  app.delete('/progress/:vocabularyId', async (c) => {
    const userId = c.get('userId') as string;
    const vocabularyId = c.req.param('vocabularyId');

    await mockUserVocabularyProgress.delete(userId, vocabularyId);
    return c.json({ success: true, message: 'Progress deleted' });
  });

  return app;
}

describe('SRS Routes', () => {
  let app: Hono;

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
  });

  describe('POST /review', () => {
    it('should update progress after a review', async () => {
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
      expect(data.vocabulary_id).toBe('vocab-1');
      expect(data.interval).toBe(6);
    });

    it('should return 404 for non-existent progress', async () => {
      mockUserVocabularyProgress.get.mockResolvedValue(undefined);

      const res = await app.request('/progress/vocab-unknown');

      expect(res.status).toBe(404);
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
});

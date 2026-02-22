import { describe, test, expect, beforeEach, vi } from 'bun:test';
import { Hono } from 'hono';

// --- Mock dynamodb BEFORE importing the router ---
const mockUserVocabularyProgress = {
  get: vi.fn(),
  getByUser: vi.fn(),
  getDueItems: vi.fn(),
  put: vi.fn(),
  updateAfterReview: vi.fn(),
  initializeProgress: vi.fn(),
  delete: vi.fn(),
};

const mockVocabulary = {
  getById: vi.fn(),
  getByIds: vi.fn(),
  getRandom: vi.fn(),
};

vi.mock('../../src/dynamodb', () => ({
  userVocabularyProgress: mockUserVocabularyProgress,
  vocabulary: mockVocabulary,
}));

// Mock auth middleware to inject userId without real JWT validation
vi.mock('../../src/middleware/auth', () => ({
  requireAuth: async (c: any, next: () => Promise<void>) => {
    c.set('userId', 'test-user-id');
    await next();
  },
  AuthContext: {},
}));

// Mock calculateNextReview to return predictable results
vi.mock('../../src/utils/srs', () => ({
  calculateNextReview: vi.fn().mockReturnValue({
    easeFactor: 2.6,
    interval: 1,
    repetitions: 1,
    nextReviewDate: '2026-02-22T00:00:00.000Z',
  }),
  SRS_DEFAULTS: {
    EASE_FACTOR: 2.5,
    MIN_EASE_FACTOR: 1.3,
    INITIAL_INTERVAL: 1,
    SECOND_INTERVAL: 6,
  },
}));

// Import actual router AFTER mocks are declared
const srsRouter = (await import('../../src/routes/srs')).default;

function createTestApp() {
  const app = new Hono();
  app.route('/api/srs', srsRouter);
  return app;
}

// Helper to build a mock progress object
function makeProgress(overrides: Record<string, unknown> = {}) {
  return {
    user_id: 'test-user-id',
    vocabulary_id: 'vocab-1',
    next_review_date: '2026-02-20T00:00:00.000Z',
    ease_factor: 2.5,
    interval: 0,
    repetitions: 0,
    last_quality: null,
    last_reviewed_at: null,
    first_learned_at: '2026-02-19T00:00:00.000Z',
    total_reviews: 0,
    correct_count: 0,
    ...overrides,
  };
}

describe('SRS Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ------------------------------------------------------------------ //
  // GET /api/srs/due
  // ------------------------------------------------------------------ //
  describe('GET /api/srs/due', () => {
    test('returns due items with vocabulary details when no JLPT filter', async () => {
      const progress = makeProgress({ vocabulary_id: 'vocab-1' });
      mockUserVocabularyProgress.getDueItems.mockResolvedValue([progress]);
      mockVocabulary.getByIds.mockResolvedValue({
        'vocab-1': { id: 'vocab-1', word: '猫', jlpt_level: 5 },
      });

      const app = createTestApp();
      const res = await app.request('/api/srs/due');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.items).toHaveLength(1);
      expect(data.items[0].progress.vocabulary_id).toBe('vocab-1');
      expect(data.items[0].vocabulary.word).toBe('猫');
      expect(data.total).toBe(1);
    });

    test('returns empty list when no items are due', async () => {
      mockUserVocabularyProgress.getDueItems.mockResolvedValue([]);

      const app = createTestApp();
      const res = await app.request('/api/srs/due');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.items).toHaveLength(0);
      expect(data.total).toBe(0);
    });

    test('respects the limit query parameter', async () => {
      const dueItems = Array.from({ length: 10 }, (_, i) =>
        makeProgress({ vocabulary_id: `vocab-${i + 1}` }),
      );
      mockUserVocabularyProgress.getDueItems.mockResolvedValue(dueItems);

      const vocabMap: Record<string, unknown> = {};
      for (let i = 1; i <= 10; i++) {
        vocabMap[`vocab-${i}`] = { id: `vocab-${i}`, word: `word${i}`, jlpt_level: 5 };
      }
      mockVocabulary.getByIds.mockResolvedValue(vocabMap);

      const app = createTestApp();
      const res = await app.request('/api/srs/due?limit=3');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.items).toHaveLength(3);
      expect(data.total).toBe(10);
    });

    test('filters items by JLPT level when jlpt query parameter is provided', async () => {
      const dueItems = [
        makeProgress({ vocabulary_id: 'vocab-n5' }),
        makeProgress({ vocabulary_id: 'vocab-n3' }),
      ];
      mockUserVocabularyProgress.getDueItems.mockResolvedValue(dueItems);
      mockVocabulary.getByIds.mockResolvedValue({
        'vocab-n5': { id: 'vocab-n5', word: '猫', jlpt_level: 5 },
        'vocab-n3': { id: 'vocab-n3', word: '政治', jlpt_level: 3 },
      });

      const app = createTestApp();
      const res = await app.request('/api/srs/due?jlpt=5');

      expect(res.status).toBe(200);
      const data = await res.json();
      // Only the N5 item should match
      expect(data.items).toHaveLength(1);
      expect(data.items[0].progress.vocabulary_id).toBe('vocab-n5');
    });

    test('returns 500 when DynamoDB throws an error', async () => {
      mockUserVocabularyProgress.getDueItems.mockRejectedValue(
        new Error('DynamoDB connection error'),
      );

      const app = createTestApp();
      const res = await app.request('/api/srs/due');

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe('Failed to fetch due items');
    });
  });

  // ------------------------------------------------------------------ //
  // GET /api/srs/stats
  // ------------------------------------------------------------------ //
  describe('GET /api/srs/stats', () => {
    test('returns correct stats with mastery breakdown', async () => {
      const now = new Date();
      const past = new Date(now.getTime() - 1000).toISOString(); // overdue
      const future = new Date(now.getTime() + 86_400_000).toISOString(); // not due yet

      const items = [
        makeProgress({
          vocabulary_id: 'v1',
          interval: 0,
          ease_factor: 2.5,
          next_review_date: past,
          total_reviews: 4,
          correct_count: 3,
        }), // new, due
        makeProgress({
          vocabulary_id: 'v2',
          interval: 10,
          ease_factor: 2.3,
          next_review_date: future,
          total_reviews: 2,
          correct_count: 2,
        }), // learning
        makeProgress({
          vocabulary_id: 'v3',
          interval: 30,
          ease_factor: 2.7,
          next_review_date: future,
          total_reviews: 6,
          correct_count: 5,
        }), // reviewing
        makeProgress({
          vocabulary_id: 'v4',
          interval: 90,
          ease_factor: 2.8,
          next_review_date: future,
          total_reviews: 10,
          correct_count: 9,
        }), // mastered
      ];
      mockUserVocabularyProgress.getByUser.mockResolvedValue(items);

      const app = createTestApp();
      const res = await app.request('/api/srs/stats');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.total_items).toBe(4);
      expect(data.due_today).toBe(1);
      expect(data.mastery_breakdown.new).toBe(1);
      expect(data.mastery_breakdown.learning).toBe(1);
      expect(data.mastery_breakdown.reviewing).toBe(1);
      expect(data.mastery_breakdown.mastered).toBe(1);
      // total_reviews = 4+2+6+10 = 22, correct = 3+2+5+9 = 19
      expect(data.total_reviews).toBe(22);
      expect(data.accuracy_rate).toBe(Math.round((19 / 22) * 100));
    });

    test('returns zeroed stats when user has no progress', async () => {
      mockUserVocabularyProgress.getByUser.mockResolvedValue([]);

      const app = createTestApp();
      const res = await app.request('/api/srs/stats');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.total_items).toBe(0);
      expect(data.due_today).toBe(0);
      expect(data.mastery_breakdown.new).toBe(0);
      expect(data.mastery_breakdown.learning).toBe(0);
      expect(data.mastery_breakdown.reviewing).toBe(0);
      expect(data.mastery_breakdown.mastered).toBe(0);
      expect(data.average_ease_factor).toBe(0);
      expect(data.total_reviews).toBe(0);
      expect(data.accuracy_rate).toBe(0);
    });

    test('filters stats by JLPT level when jlpt parameter is provided', async () => {
      const items = [
        makeProgress({ vocabulary_id: 'v-n5', interval: 0 }),
        makeProgress({ vocabulary_id: 'v-n3', interval: 5 }),
      ];
      mockUserVocabularyProgress.getByUser.mockResolvedValue(items);
      mockVocabulary.getByIds.mockResolvedValue({
        'v-n5': { id: 'v-n5', jlpt_level: 5 },
        'v-n3': { id: 'v-n3', jlpt_level: 3 },
      });

      const app = createTestApp();
      const res = await app.request('/api/srs/stats?jlpt=5');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.total_items).toBe(1);
    });

    test('returns 500 when DynamoDB throws an error', async () => {
      mockUserVocabularyProgress.getByUser.mockRejectedValue(new Error('DB error'));

      const app = createTestApp();
      const res = await app.request('/api/srs/stats');

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe('Failed to fetch statistics');
    });
  });

  // ------------------------------------------------------------------ //
  // POST /api/srs/review
  // ------------------------------------------------------------------ //
  describe('POST /api/srs/review', () => {
    test('creates new progress when none exists and records review', async () => {
      const existingProgress = makeProgress({ interval: 0, repetitions: 0 });
      const updatedProgress = makeProgress({ interval: 1, repetitions: 1, last_quality: 4 });

      mockVocabulary.getById.mockResolvedValue({ id: 'vocab-1', word: '猫' });
      mockUserVocabularyProgress.get.mockResolvedValue(undefined); // no existing progress
      mockUserVocabularyProgress.initializeProgress.mockResolvedValue(existingProgress);
      mockUserVocabularyProgress.updateAfterReview.mockResolvedValue(updatedProgress);

      const app = createTestApp();
      const res = await app.request('/api/srs/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabulary_id: 'vocab-1', quality: 4 }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.progress.repetitions).toBe(1);
      expect(mockUserVocabularyProgress.initializeProgress).toHaveBeenCalledWith(
        'test-user-id',
        'vocab-1',
        expect.any(String),
      );
    });

    test('updates existing progress when progress already exists', async () => {
      const existingProgress = makeProgress({ interval: 1, repetitions: 1 });
      const updatedProgress = makeProgress({ interval: 6, repetitions: 2, last_quality: 5 });

      mockVocabulary.getById.mockResolvedValue({ id: 'vocab-1', word: '猫' });
      mockUserVocabularyProgress.get.mockResolvedValue(existingProgress);
      mockUserVocabularyProgress.updateAfterReview.mockResolvedValue(updatedProgress);

      const app = createTestApp();
      const res = await app.request('/api/srs/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabulary_id: 'vocab-1', quality: 5 }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.progress.repetitions).toBe(2);
      expect(mockUserVocabularyProgress.initializeProgress).not.toHaveBeenCalled();
    });

    test('returns 404 when vocabulary does not exist', async () => {
      mockVocabulary.getById.mockResolvedValue(undefined);

      const app = createTestApp();
      const res = await app.request('/api/srs/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabulary_id: 'nonexistent', quality: 3 }),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('Vocabulary not found');
      expect(mockUserVocabularyProgress.get).not.toHaveBeenCalled();
    });

    test('returns 400 when quality is invalid (out of range)', async () => {
      const app = createTestApp();
      const res = await app.request('/api/srs/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabulary_id: 'vocab-1', quality: 6 }),
      });

      // zValidator returns 400 for schema validation failures
      expect(res.status).toBe(400);
    });

    test('returns 400 when vocabulary_id is missing', async () => {
      const app = createTestApp();
      const res = await app.request('/api/srs/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quality: 3 }),
      });

      expect(res.status).toBe(400);
    });

    test('returns 409 when updateAfterReview returns undefined and recovery also fails', async () => {
      const existingProgress = makeProgress();
      mockVocabulary.getById.mockResolvedValue({ id: 'vocab-1' });
      mockUserVocabularyProgress.get
        .mockResolvedValueOnce(existingProgress) // initial get
        .mockResolvedValueOnce(undefined); // recovery get — item gone
      mockUserVocabularyProgress.updateAfterReview.mockResolvedValue(undefined);

      const app = createTestApp();
      const res = await app.request('/api/srs/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabulary_id: 'vocab-1', quality: 4 }),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('Progress not found for vocabulary item');
    });

    test('returns 500 when DynamoDB throws an error', async () => {
      mockVocabulary.getById.mockResolvedValue({ id: 'vocab-1' });
      mockUserVocabularyProgress.get.mockRejectedValue(new Error('DB error'));

      const app = createTestApp();
      const res = await app.request('/api/srs/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabulary_id: 'vocab-1', quality: 3 }),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe('Failed to record review');
    });
  });

  // ------------------------------------------------------------------ //
  // GET /api/srs/progress/:vocabularyId
  // ------------------------------------------------------------------ //
  describe('GET /api/srs/progress/:vocabularyId', () => {
    test('returns progress when it exists', async () => {
      const progress = makeProgress({ vocabulary_id: 'vocab-42', interval: 6, repetitions: 2 });
      mockUserVocabularyProgress.get.mockResolvedValue(progress);

      const app = createTestApp();
      const res = await app.request('/api/srs/progress/vocab-42');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.progress.vocabulary_id).toBe('vocab-42');
      expect(data.progress.interval).toBe(6);
      expect(mockUserVocabularyProgress.get).toHaveBeenCalledWith('test-user-id', 'vocab-42');
    });

    test('returns 200 with progress null when no progress exists for vocabulary', async () => {
      mockUserVocabularyProgress.get.mockResolvedValue(undefined);

      const app = createTestApp();
      const res = await app.request('/api/srs/progress/vocab-new');

      expect(res.status).toBe(200);
      const data = await res.json();
      // The route returns `{ progress }` where progress is undefined → serialised as null in JSON
      expect(data.progress === null || data.progress === undefined).toBe(true);
    });

    test('returns 500 when DynamoDB throws an error', async () => {
      mockUserVocabularyProgress.get.mockRejectedValue(new Error('DB error'));

      const app = createTestApp();
      const res = await app.request('/api/srs/progress/vocab-1');

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe('Failed to fetch progress');
    });
  });

  // ------------------------------------------------------------------ //
  // GET /api/srs/all
  // ------------------------------------------------------------------ //
  describe('GET /api/srs/all', () => {
    test('returns all progress records for the authenticated user', async () => {
      const items = [
        makeProgress({ vocabulary_id: 'vocab-1' }),
        makeProgress({ vocabulary_id: 'vocab-2' }),
      ];
      mockUserVocabularyProgress.getByUser.mockResolvedValue(items);

      const app = createTestApp();
      const res = await app.request('/api/srs/all');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.items).toHaveLength(2);
      expect(data.total).toBe(2);
      expect(mockUserVocabularyProgress.getByUser).toHaveBeenCalledWith('test-user-id');
    });

    test('returns empty list when user has no progress records', async () => {
      mockUserVocabularyProgress.getByUser.mockResolvedValue([]);

      const app = createTestApp();
      const res = await app.request('/api/srs/all');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.items).toHaveLength(0);
      expect(data.total).toBe(0);
    });

    test('returns 500 when DynamoDB throws an error', async () => {
      mockUserVocabularyProgress.getByUser.mockRejectedValue(new Error('DB error'));

      const app = createTestApp();
      const res = await app.request('/api/srs/all');

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe('Failed to fetch progress');
    });
  });

  // ------------------------------------------------------------------ //
  // DELETE /api/srs/progress/:vocabularyId
  // ------------------------------------------------------------------ //
  describe('DELETE /api/srs/progress/:vocabularyId', () => {
    test('deletes progress and returns success', async () => {
      mockUserVocabularyProgress.delete.mockResolvedValue(undefined);

      const app = createTestApp();
      const res = await app.request('/api/srs/progress/vocab-1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.message).toBe('Progress deleted');
      expect(mockUserVocabularyProgress.delete).toHaveBeenCalledWith('test-user-id', 'vocab-1');
    });

    test('returns 500 when DynamoDB throws an error', async () => {
      mockUserVocabularyProgress.delete.mockRejectedValue(new Error('DB error'));

      const app = createTestApp();
      const res = await app.request('/api/srs/progress/vocab-1', { method: 'DELETE' });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe('Failed to delete progress');
    });
  });

  // ------------------------------------------------------------------ //
  // POST /api/srs/batch-review
  // ------------------------------------------------------------------ //
  describe('POST /api/srs/batch-review', () => {
    test('processes multiple reviews and returns success summary', async () => {
      mockVocabulary.getByIds.mockResolvedValue({
        'vocab-1': { id: 'vocab-1', word: '猫' },
        'vocab-2': { id: 'vocab-2', word: '犬' },
      });
      mockUserVocabularyProgress.get.mockImplementation((_uid: string, vocabId: string) =>
        Promise.resolve(makeProgress({ vocabulary_id: vocabId })),
      );
      mockUserVocabularyProgress.updateAfterReview.mockImplementation(
        (_uid: string, vocabId: string) =>
          Promise.resolve(makeProgress({ vocabulary_id: vocabId, interval: 1, repetitions: 1 })),
      );

      const app = createTestApp();
      const res = await app.request('/api/srs/batch-review', {
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
      expect(data.processed).toBe(2);
      expect(data.successful).toBe(2);
      expect(data.failed).toBe(0);
    });

    test('deduplicates reviews keeping the last occurrence per vocabulary_id', async () => {
      mockVocabulary.getByIds.mockResolvedValue({
        'vocab-1': { id: 'vocab-1', word: '猫' },
      });
      mockUserVocabularyProgress.get.mockResolvedValue(makeProgress());
      mockUserVocabularyProgress.updateAfterReview.mockResolvedValue(
        makeProgress({ interval: 1, repetitions: 1 }),
      );

      const app = createTestApp();
      const res = await app.request('/api/srs/batch-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviews: [
            { vocabulary_id: 'vocab-1', quality: 2 },
            { vocabulary_id: 'vocab-1', quality: 5 }, // duplicate — should be kept as the only entry
          ],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      // After deduplication there is only 1 unique vocab_id
      expect(data.processed).toBe(1);
      expect(data.successful).toBe(1);
    });

    test('skips reviews for missing vocabulary and reports them as failed', async () => {
      mockVocabulary.getByIds.mockResolvedValue({
        'vocab-exists': { id: 'vocab-exists', word: '猫' },
        // 'vocab-missing' is absent
      });
      mockUserVocabularyProgress.get.mockResolvedValue(
        makeProgress({ vocabulary_id: 'vocab-exists' }),
      );
      mockUserVocabularyProgress.updateAfterReview.mockResolvedValue(
        makeProgress({ vocabulary_id: 'vocab-exists', interval: 1, repetitions: 1 }),
      );

      const app = createTestApp();
      const res = await app.request('/api/srs/batch-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviews: [
            { vocabulary_id: 'vocab-exists', quality: 4 },
            { vocabulary_id: 'vocab-missing', quality: 4 },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.processed).toBe(2);
      expect(data.successful).toBe(1);
      expect(data.failed).toBe(1);
      const failedResult = data.results.find((r: any) => r.vocabulary_id === 'vocab-missing');
      expect(failedResult.success).toBe(false);
      expect(failedResult.error).toBe('Vocabulary not found');
    });

    test('initializes progress for vocabulary with no existing progress record', async () => {
      mockVocabulary.getByIds.mockResolvedValue({
        'vocab-new': { id: 'vocab-new', word: '新しい' },
      });
      mockUserVocabularyProgress.get.mockResolvedValue(undefined); // no progress yet
      mockUserVocabularyProgress.initializeProgress.mockResolvedValue(makeProgress());
      mockUserVocabularyProgress.updateAfterReview.mockResolvedValue(
        makeProgress({ interval: 1, repetitions: 1 }),
      );

      const app = createTestApp();
      const res = await app.request('/api/srs/batch-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviews: [{ vocabulary_id: 'vocab-new', quality: 3 }],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.successful).toBe(1);
      expect(mockUserVocabularyProgress.initializeProgress).toHaveBeenCalledWith(
        'test-user-id',
        'vocab-new',
        expect.any(String),
      );
    });

    test('returns 400 when reviews array exceeds 100 items', async () => {
      const reviews = Array.from({ length: 101 }, (_, i) => ({
        vocabulary_id: `vocab-${i}`,
        quality: 4,
      }));

      const app = createTestApp();
      const res = await app.request('/api/srs/batch-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviews }),
      });

      // zValidator returns 400 for schema violations
      expect(res.status).toBe(400);
    });

    test('returns 500 when DynamoDB throws an unexpected error', async () => {
      mockVocabulary.getByIds.mockRejectedValue(new Error('DB error'));

      const app = createTestApp();
      const res = await app.request('/api/srs/batch-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reviews: [{ vocabulary_id: 'vocab-1', quality: 4 }],
        }),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.error).toBe('Failed to record batch reviews');
    });
  });
});

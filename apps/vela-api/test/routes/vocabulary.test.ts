import { describe, test, expect, beforeEach, vi } from 'bun:test';
import { Hono } from 'hono';
import type { Env } from '../../src/types';

const mockVocabulary = {
  findByWord: vi.fn(),
  create: vi.fn(),
};

const mockUserVocabularyProgress = {
  get: vi.fn(),
  initializeProgress: vi.fn(),
};

vi.mock('../../src/dynamodb', () => ({
  vocabulary: mockVocabulary,
  userVocabularyProgress: mockUserVocabularyProgress,
}));

vi.mock('../../src/middleware/auth', () => ({
  requireAuth: async (_c: any, next: any) => {
    _c.set('userId', 'user-123');
    _c.set('userEmail', 'test@example.com');
    await next();
  },
  AuthContext: {},
}));

const { default: vocabularyRouter } = await import('../../src/routes/vocabulary');

function createTestApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    c.env = c.env || {};
    await next();
  });
  app.route('/', vocabularyRouter);
  return app;
}

const validBody = {
  japanese_word: '食べる',
  reading: 'たべる',
  english_translation: 'to eat',
  example_sentence_jp: '私は毎日ご飯を食べる。',
  source_url: 'https://example.com',
  jlpt_level: 5,
};

describe('POST /from-word', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserVocabularyProgress.initializeProgress.mockResolvedValue({});
  });

  test('creates a new vocabulary entry and SRS record when word does not exist', async () => {
    mockVocabulary.findByWord.mockResolvedValue(undefined);
    mockVocabulary.create.mockResolvedValue(undefined);
    mockUserVocabularyProgress.get.mockResolvedValue(undefined);

    const app = createTestApp();
    const res = await app.request('/from-word', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.created).toBe(true);
    expect(body.alreadyInSRS).toBe(false);
    expect(typeof body.vocabulary_id).toBe('string');
    expect(mockVocabulary.create).toHaveBeenCalledTimes(1);
    expect(mockUserVocabularyProgress.initializeProgress).toHaveBeenCalledTimes(1);
    expect(mockVocabulary.create).toHaveBeenCalledWith(
      expect.objectContaining({
        japanese_word: '食べる',
        source_url: 'https://example.com',
      }),
    );
  });

  test('reuses existing vocabulary entry when word already exists', async () => {
    mockVocabulary.findByWord.mockResolvedValue({
      id: 'existing-vocab-id',
      japanese_word: '食べる',
    });
    mockUserVocabularyProgress.get.mockResolvedValue(undefined);

    const app = createTestApp();
    const res = await app.request('/from-word', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.created).toBe(false);
    expect(body.vocabulary_id).toBe('existing-vocab-id');
    expect(mockVocabulary.create).not.toHaveBeenCalled();
    expect(mockUserVocabularyProgress.initializeProgress).toHaveBeenCalledTimes(1);
  });

  test('returns alreadyInSRS: true when SRS progress already exists', async () => {
    mockVocabulary.findByWord.mockResolvedValue({ id: 'vocab-id' });
    mockUserVocabularyProgress.get.mockResolvedValue({
      user_id: 'user-123',
      vocabulary_id: 'vocab-id',
      next_review_date: '2026-04-20T00:00:00.000Z',
      ease_factor: 2.5,
      interval: 3,
      repetitions: 2,
      first_learned_at: '2026-04-17T00:00:00.000Z',
      total_reviews: 2,
      correct_count: 2,
    });

    const app = createTestApp();
    const res = await app.request('/from-word', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.alreadyInSRS).toBe(true);
    expect(mockUserVocabularyProgress.initializeProgress).not.toHaveBeenCalled();
  });

  test('returns 400 when request body is invalid', async () => {
    const app = createTestApp();
    const res = await app.request('/from-word', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ japanese_word: '食べる' }), // missing english_translation
    });

    expect(res.status).toBe(400);
  });
});

import { describe, test, expect, beforeEach, vi } from 'bun:test';
import { Hono } from 'hono';
import type { Env } from '../../src/types';

const mockVocabulary = {
  create: vi.fn(),
};

const mockUserVocabularyProgress = {
  get: vi.fn(),
  initializeProgress: vi.fn(),
  initializeProgressIfNotExists: vi.fn(),
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
    mockUserVocabularyProgress.initializeProgressIfNotExists.mockResolvedValue({});
  });

  test('creates a new vocabulary entry and SRS record when word does not exist', async () => {
    mockVocabulary.create.mockResolvedValue({
      item: { id: '食べる', japanese_word: '食べる' },
      created: true,
    });

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
    expect(body.vocabulary_id).toBe('食べる');
    expect(mockVocabulary.create).toHaveBeenCalledTimes(1);
    expect(mockUserVocabularyProgress.initializeProgressIfNotExists).toHaveBeenCalledTimes(1);
    expect(mockVocabulary.create).toHaveBeenCalledWith(
      expect.objectContaining({
        japanese_word: '食べる',
        source_url: 'https://example.com',
      }),
    );
  });

  test('reuses existing vocabulary entry when word already exists', async () => {
    mockVocabulary.create.mockResolvedValue({
      item: {
        id: 'existing-vocab-id',
        japanese_word: '食べる',
      },
      created: false,
    });

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
    expect(mockVocabulary.create).toHaveBeenCalledTimes(1);
    expect(mockUserVocabularyProgress.initializeProgressIfNotExists).toHaveBeenCalledTimes(1);
  });

  test('returns alreadyInSRS: true when conditional put detects existing progress', async () => {
    mockVocabulary.create.mockResolvedValue({
      item: { id: 'vocab-id', japanese_word: '食べる' },
      created: false,
    });
    mockUserVocabularyProgress.initializeProgressIfNotExists.mockRejectedValue(
      Object.assign(new Error('Condition failed'), {
        name: 'ConditionalCheckFailedException',
      }),
    );

    const app = createTestApp();
    const res = await app.request('/from-word', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.alreadyInSRS).toBe(true);
    expect(mockUserVocabularyProgress.initializeProgressIfNotExists).toHaveBeenCalledTimes(1);
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

  test('returns 400 when source_url uses a non-http scheme', async () => {
    const app = createTestApp();
    const res = await app.request('/from-word', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validBody, source_url: 'ftp://example.com' }),
    });

    expect(res.status).toBe(400);
  });

  test('returns 500 with structured error when vocabulary.create throws', async () => {
    mockVocabulary.create.mockRejectedValue(new Error('DynamoDB connection error'));

    const app = createTestApp();
    const res = await app.request('/from-word', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    expect(res.status).toBe(500);
    const body = (await res.json()) as any;
    expect(body).toEqual({ error: 'Failed to save vocabulary entry' });
  });

  test('logs only sanitized error metadata for failures', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockVocabulary.create.mockRejectedValue(new Error('DynamoDB connection error'));

    const app = createTestApp();
    const res = await app.request('/from-word', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-request-id': 'req-123',
      },
      body: JSON.stringify(validBody),
    });

    expect(res.status).toBe(500);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[Vela] /vocabulary/from-word failed',
      expect.objectContaining({
        requestId: 'req-123',
        err: expect.objectContaining({
          code: 'Error',
          message: 'DynamoDB connection error',
        }),
      }),
    );
    expect(consoleErrorSpy.mock.calls[0]?.[1]).not.toHaveProperty('userId');
    expect(consoleErrorSpy.mock.calls[0]?.[1]).not.toHaveProperty('word');

    consoleErrorSpy.mockRestore();
  });
});

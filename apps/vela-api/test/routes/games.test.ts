import { describe, test, expect, beforeEach, vi } from 'bun:test';
import { Hono } from 'hono';
import type { Env } from '../../src/types';
import { games } from '../../src/routes/games';

const mockVocabularyDB = {
  getRandom: vi.fn(),
};

const mockSentencesDB = {
  getRandom: vi.fn(),
};

vi.mock('../../src/dynamodb', () => ({
  vocabulary: mockVocabularyDB,
  sentences: mockSentencesDB,
}));

function createTestApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/', games);
  return app;
}

describe('Games Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /vocabulary', () => {
    test('returns vocabulary with default limit', async () => {
      const mockVocab = [
        { vocabulary_id: '1', japanese: '犬', english: 'dog', jlpt_level: 5 },
        { vocabulary_id: '2', japanese: '猫', english: 'cat', jlpt_level: 5 },
      ];
      mockVocabularyDB.getRandom.mockResolvedValueOnce(mockVocab);

      const app = createTestApp();
      const res = await app.request('/vocabulary');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { vocabulary: typeof mockVocab; filters: object };
      expect(body.vocabulary).toHaveLength(2);
      expect(body.filters).toBeDefined();
    });

    test('returns vocabulary filtered by jlpt level', async () => {
      const mockVocab = [{ vocabulary_id: '1', japanese: '犬', english: 'dog', jlpt_level: 5 }];
      mockVocabularyDB.getRandom.mockResolvedValueOnce(mockVocab);

      const app = createTestApp();
      const res = await app.request('/vocabulary?jlpt=5&limit=5');
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        vocabulary: typeof mockVocab;
        filters: { jlpt_levels: string };
      };
      expect(body.vocabulary).toHaveLength(1);
      expect(mockVocabularyDB.getRandom).toHaveBeenCalledWith(5, [5]);
    });

    test('passes limit query param to database', async () => {
      mockVocabularyDB.getRandom.mockResolvedValueOnce([]);

      const app = createTestApp();
      const res = await app.request('/vocabulary?limit=20');
      expect(res.status).toBe(200);
      expect(mockVocabularyDB.getRandom).toHaveBeenCalledWith(20, undefined);
    });

    test('returns empty array when no vocabulary found', async () => {
      mockVocabularyDB.getRandom.mockResolvedValueOnce(null);

      const app = createTestApp();
      const res = await app.request('/vocabulary');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { vocabulary: unknown[] };
      expect(body.vocabulary).toEqual([]);
    });

    test('returns 500 on database error', async () => {
      mockVocabularyDB.getRandom.mockRejectedValueOnce(new Error('DDB error'));

      const app = createTestApp();
      const res = await app.request('/vocabulary');
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('DDB error');
    });

    test('returns 400 for invalid limit query param', async () => {
      const app = createTestApp();
      const res = await app.request('/vocabulary?limit=abc');
      expect(res.status).toBe(400);
    });

    test('returns filters with jlpt_levels set to all when no jlpt provided', async () => {
      mockVocabularyDB.getRandom.mockResolvedValueOnce([]);
      const app = createTestApp();
      const res = await app.request('/vocabulary');
      const body = (await res.json()) as { filters: { jlpt_levels: string } };
      expect(body.filters.jlpt_levels).toBe('all');
    });
  });

  describe('GET /sentences', () => {
    test('returns sentences with default limit', async () => {
      const mockSentences = [
        { sentence_id: '1', japanese: '犬が走る', english: 'The dog runs', jlpt_level: 5 },
      ];
      mockSentencesDB.getRandom.mockResolvedValueOnce(mockSentences);

      const app = createTestApp();
      const res = await app.request('/sentences');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { sentences: typeof mockSentences; filters: object };
      expect(body.sentences).toHaveLength(1);
      expect(body.filters).toBeDefined();
    });

    test('passes limit and jlpt to database', async () => {
      mockSentencesDB.getRandom.mockResolvedValueOnce([]);

      const app = createTestApp();
      const res = await app.request('/sentences?limit=3&jlpt=4');
      expect(res.status).toBe(200);
      expect(mockSentencesDB.getRandom).toHaveBeenCalledWith(3, [4]);
    });

    test('returns empty array when no sentences found', async () => {
      mockSentencesDB.getRandom.mockResolvedValueOnce(null);

      const app = createTestApp();
      const res = await app.request('/sentences');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { sentences: unknown[] };
      expect(body.sentences).toEqual([]);
    });

    test('returns 500 on database error', async () => {
      mockSentencesDB.getRandom.mockRejectedValueOnce(new Error('DB unavailable'));

      const app = createTestApp();
      const res = await app.request('/sentences');
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('DB unavailable');
    });

    test('returns 400 for invalid limit query param', async () => {
      const app = createTestApp();
      const res = await app.request('/sentences?limit=-1');
      expect(res.status).toBe(400);
    });

    test('returns filters with jlpt_levels set to all when no jlpt provided', async () => {
      mockSentencesDB.getRandom.mockResolvedValueOnce([]);
      const app = createTestApp();
      const res = await app.request('/sentences');
      const body = (await res.json()) as { filters: { jlpt_levels: string } };
      expect(body.filters.jlpt_levels).toBe('all');
    });
  });
});

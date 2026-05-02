import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { Hono } from 'hono';
import type { Env } from '../../src/types';

const originalFetch = globalThis.fetch;

// Mock auth middleware before importing the router so the dynamic import sees it.
mock.module('../../src/middleware/auth', () => ({
  requireAuth: async (c: any, next: any) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized: Missing or invalid Authorization header' }, 401);
    }
    c.set('userId', 'test-user');
    c.set('userEmail', 'user@example.com');
    await next();
  },
  AuthContext: {},
}));

const { default: dictionaryRouter } = await import('../../src/routes/dictionary');

function createTestApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/', dictionaryRouter);
  return app;
}

const AUTH_HEADER = { Authorization: 'Bearer test-token' };

describe('GET /lookup', () => {
  let mockFetch: ReturnType<typeof mock>;

  beforeEach(() => {
    mockFetch = mock(async () => ({ ok: true, json: async () => ({ data: [] }) }));
    globalThis.fetch = mockFetch as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('returns simplified JishoResult with Cache-Control header', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            japanese: [{ word: '食べる', reading: 'たべる' }],
            senses: [
              { english_definitions: ['to eat', 'to consume', 'to bite into', 'extra meaning'] },
            ],
            jlpt: ['jlpt-n5'],
            is_common: true,
          },
        ],
      }),
    });

    const app = createTestApp();
    const res = await app.request('/lookup?word=食べる', { headers: AUTH_HEADER });

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=86400');
    const body = (await res.json()) as any;
    expect(body).toEqual({
      word: '食べる',
      reading: 'たべる',
      meanings: ['to eat', 'to consume', 'to bite into'],
      jlpt: 'jlpt-n5',
      common: true,
    });
  });

  test('caps meanings at 3 even when Jisho returns more', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            japanese: [{ word: '見る', reading: 'みる' }],
            senses: [
              { english_definitions: ['to see', 'to look', 'to watch', 'to observe', 'to check'] },
            ],
            jlpt: [],
            is_common: true,
          },
        ],
      }),
    });

    const app = createTestApp();
    const res = await app.request('/lookup?word=見る', { headers: AUTH_HEADER });
    const body = (await res.json()) as any;
    expect(body.meanings).toHaveLength(3);
    expect(body.jlpt).toBeUndefined();
  });

  test('collects definitions from all senses and dedupes', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            japanese: [{ word: '上', reading: 'うえ' }],
            senses: [
              { english_definitions: ['above', 'up'] },
              { english_definitions: ['top', 'above'] },
              { english_definitions: ['over'] },
            ],
            jlpt: [],
            is_common: true,
          },
        ],
      }),
    });

    const app = createTestApp();
    const res = await app.request('/lookup?word=上', { headers: AUTH_HEADER });
    const body = (await res.json()) as any;
    // 'above' should be deduped, result should be: ['above', 'up', 'top']
    expect(body.meanings).toEqual(['above', 'up', 'top']);
  });

  test('returns 404 when Jisho returns empty data', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    const app = createTestApp();
    const res = await app.request('/lookup?word=xyzabc', { headers: AUTH_HEADER });
    expect(res.status).toBe(404);
  });

  test('returns 400 when word query param is missing', async () => {
    const app = createTestApp();
    const res = await app.request('/lookup', { headers: AUTH_HEADER });
    expect(res.status).toBe(400);
  });

  test('returns 400 when word is empty string', async () => {
    const app = createTestApp();
    const res = await app.request('/lookup?word=', { headers: AUTH_HEADER });
    expect(res.status).toBe(400);
  });

  test('returns 502 when Jisho API request fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const app = createTestApp();
    const res = await app.request('/lookup?word=test', { headers: AUTH_HEADER });
    expect(res.status).toBe(502);
  });

  test('returns 502 when the Jisho fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('network down'));

    const app = createTestApp();
    const res = await app.request('/lookup?word=test', { headers: AUTH_HEADER });

    expect(res.status).toBe(502);
  });

  test('returns 502 when the Jisho response payload is invalid', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        invalid: true,
      }),
    });

    const app = createTestApp();
    const res = await app.request('/lookup?word=食べる', { headers: AUTH_HEADER });

    expect(res.status).toBe(502);
  });

  test('URL-encodes the word when calling Jisho', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            japanese: [{ word: '東京', reading: 'とうきょう' }],
            senses: [{ english_definitions: ['Tokyo'] }],
            jlpt: [],
            is_common: true,
          },
        ],
      }),
    });

    const app = createTestApp();
    await app.request('/lookup?word=東京', { headers: AUTH_HEADER });

    const calledUrl = mockFetch.mock.calls[0]?.[0] as string;
    expect(calledUrl).toBe('https://jisho.org/api/v1/search/words?keyword=%E6%9D%B1%E4%BA%AC');
  });

  test('passes an AbortSignal to the Jisho fetch request', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            japanese: [{ word: '東京', reading: 'とうきょう' }],
            senses: [{ english_definitions: ['Tokyo'] }],
            jlpt: [],
            is_common: true,
          },
        ],
      }),
    });

    const app = createTestApp();
    await app.request('/lookup?word=東京', { headers: AUTH_HEADER });

    const fetchInit = mockFetch.mock.calls[0]?.[1] as Parameters<typeof fetch>[1] | undefined;
    expect(fetchInit?.signal).toBeInstanceOf(AbortSignal);
  });

  test('returns 502 when the Jisho fetch aborts', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    mockFetch.mockImplementation(() => {
      throw abortError;
    });

    const app = createTestApp();
    const res = await app.request('/lookup?word=test', { headers: AUTH_HEADER });

    expect(res.status).toBe(502);
  });

  test('returns 401 when Authorization header is missing', async () => {
    const app = createTestApp();
    const res = await app.request('/lookup?word=食べる');
    expect(res.status).toBe(401);
  });

  test('picks Jisho entry matching the reading hint for homographs', async () => {
    // Simulate Jisho returning multiple entries for 今日 — first one is
    // こんにち (hello), second is きょう (today). When the client sends
    // reading=きょう, the API should pick the second entry.
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            japanese: [{ word: '今日', reading: 'こんにち' }],
            senses: [{ english_definitions: ['hello', 'good day'] }],
            jlpt: [],
            is_common: true,
          },
          {
            japanese: [{ word: '今日', reading: 'きょう' }],
            senses: [{ english_definitions: ['today', 'this day'] }],
            jlpt: ['jlpt-n5'],
            is_common: true,
          },
        ],
      }),
    });

    const app = createTestApp();
    const res = await app.request('/lookup?word=今日&reading=きょう', { headers: AUTH_HEADER });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.reading).toBe('きょう');
    expect(body.meanings).toEqual(['today', 'this day']);
    expect(body.jlpt).toBe('jlpt-n5');
  });

  test('picks Jisho entry matching katakana reading hint (normalised)', async () => {
    // Client sends reading in katakana (from kuromoji), API normalises to hiragana
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            japanese: [{ word: '今日', reading: 'こんにち' }],
            senses: [{ english_definitions: ['hello'] }],
            jlpt: [],
            is_common: true,
          },
          {
            japanese: [{ word: '今日', reading: 'きょう' }],
            senses: [{ english_definitions: ['today'] }],
            jlpt: [],
            is_common: true,
          },
        ],
      }),
    });

    const app = createTestApp();
    const res = await app.request('/lookup?word=今日&reading=キョウ', { headers: AUTH_HEADER });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.reading).toBe('きょう');
    expect(body.meanings).toEqual(['today']);
  });

  test('falls back to first Jisho entry when reading hint does not match', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            japanese: [{ word: '今日', reading: 'こんにち' }],
            senses: [{ english_definitions: ['hello'] }],
            jlpt: [],
            is_common: true,
          },
        ],
      }),
    });

    const app = createTestApp();
    const res = await app.request('/lookup?word=今日&reading=きょう', { headers: AUTH_HEADER });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    // Falls back to first entry since no reading matches
    expect(body.reading).toBe('こんにち');
  });

  test('returns the matched japanese variant, not always japanese[0]', async () => {
    // Single entry with multiple japanese variants — the second variant
    // matches the reading hint but japanese[0] has a different reading.
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            japanese: [
              { word: '大人', reading: 'おとな' },
              { word: '大人', reading: 'だいにん' },
            ],
            senses: [{ english_definitions: ['adult'] }],
            jlpt: ['jlpt-n3'],
            is_common: true,
          },
        ],
      }),
    });

    const app = createTestApp();
    const res = await app.request('/lookup?word=大人&reading=だいにん', { headers: AUTH_HEADER });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.reading).toBe('だいにん');
    expect(body.word).toBe('大人');
  });
});

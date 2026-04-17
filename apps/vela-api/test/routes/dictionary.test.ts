import { describe, test, expect, beforeEach, afterEach, vi } from 'bun:test';
import { Hono } from 'hono';
import type { Env } from '../../src/types';

const originalFetch = globalThis.fetch;

const { default: dictionaryRouter } = await import('../../src/routes/dictionary');

function createTestApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route('/', dictionaryRouter);
  return app;
}

describe('GET /lookup', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
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
    const res = await app.request('/lookup?word=食べる');

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=86400');
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
    const res = await app.request('/lookup?word=見る');
    const body = (await res.json()) as any;
    expect(body.meanings).toHaveLength(3);
    expect(body.jlpt).toBeUndefined();
  });

  test('returns 404 when Jisho returns empty data', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });

    const app = createTestApp();
    const res = await app.request('/lookup?word=xyzabc');
    expect(res.status).toBe(404);
  });

  test('returns 400 when word query param is missing', async () => {
    const app = createTestApp();
    const res = await app.request('/lookup');
    expect(res.status).toBe(400);
  });

  test('returns 400 when word is empty string', async () => {
    const app = createTestApp();
    const res = await app.request('/lookup?word=');
    expect(res.status).toBe(400);
  });

  test('returns 502 when Jisho API request fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const app = createTestApp();
    const res = await app.request('/lookup?word=test');
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
    await app.request('/lookup?word=東京');

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toBe('https://jisho.org/api/v1/search/words?keyword=%E6%9D%B1%E4%BA%AC');
  });
});

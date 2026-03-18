import { describe, test, expect, beforeEach, afterEach, vi } from 'bun:test';
import { Hono } from 'hono';
import type { Env } from '../../src/types';

const originalFetch = globalThis.fetch;

const mockMyDictionaries = {
  create: vi.fn(),
  getByUser: vi.fn(),
  delete: vi.fn(),
};

vi.mock('../../src/dynamodb', () => ({
  myDictionaries: mockMyDictionaries,
}));

vi.mock('../../src/middleware/auth', () => ({
  requireAuth: async (_c: any, next: any) => {
    _c.set('userId', 'test-user-id');
    _c.set('userEmail', 'test@example.com');
    await next();
  },
  AuthContext: {},
}));

vi.mock('../../src/middleware/cors', () => ({
  isAllowedOrigin: vi.fn(() => ({
    isAllowed: true,
    hasConfiguredOrigins: false,
    allowedOrigin: null,
    isWebOrigin: false,
  })),
}));

// Import AFTER mocks are declared
const { default: myDictionariesRouter } = await import('../../src/routes/my-dictionaries');

function createTestApp(env: Env = {}) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    c.env = c.env || {};
    Object.assign(c.env, env);
    await next();
  });
  app.route('/', myDictionariesRouter);
  return app;
}

// Helper to create a fake SSE ReadableStream
function makeSseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const data = lines.join('\n') + '\n';
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(data));
      controller.close();
    },
  });
}

describe('My Dictionaries Route', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('POST / - Save a sentence', () => {
    test('saves sentence successfully', async () => {
      const savedItem = {
        user_id: 'test@example.com',
        sentence_id: '123-abc',
        sentence: '日本語を勉強しています',
        source_url: 'https://example.com',
        context: 'test context',
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      mockMyDictionaries.create.mockResolvedValueOnce(savedItem);

      const app = createTestApp();
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sentence: '日本語を勉強しています',
          sourceUrl: 'https://example.com',
          context: 'test context',
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: typeof savedItem };
      expect(body.success).toBe(true);
      expect(body.data).toEqual(savedItem);
      expect(mockMyDictionaries.create).toHaveBeenCalledWith(
        'test@example.com',
        '日本語を勉強しています',
        'https://example.com',
        'test context',
      );
    });

    test('returns 400 when sentence is missing', async () => {
      const app = createTestApp();
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceUrl: 'https://example.com' }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Sentence is required');
    });

    test('returns 400 when sentence is empty string', async () => {
      const app = createTestApp();
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentence: '   ' }),
      });

      expect(res.status).toBe(400);
    });

    test('returns 400 when sentence is not a string', async () => {
      const app = createTestApp();
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentence: 123 }),
      });

      expect(res.status).toBe(400);
    });

    test('returns 500 on DynamoDB error', async () => {
      mockMyDictionaries.create.mockRejectedValueOnce(new Error('DDB error'));

      const app = createTestApp();
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentence: '日本語' }),
      });

      expect(res.status).toBe(500);
    });

    test('trims whitespace from sentence', async () => {
      mockMyDictionaries.create.mockResolvedValueOnce({});

      const app = createTestApp();
      await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentence: '  日本語  ' }),
      });

      expect(mockMyDictionaries.create).toHaveBeenCalledWith(
        expect.any(String),
        '日本語',
        undefined,
        undefined,
      );
    });
  });

  describe('GET / - Get saved sentences', () => {
    test('returns sentences for authenticated user', async () => {
      const sentences = [
        { user_id: 'test@example.com', sentence_id: '1', sentence: '日本語' },
        { user_id: 'test@example.com', sentence_id: '2', sentence: 'ありがとう' },
      ];
      mockMyDictionaries.getByUser.mockResolvedValueOnce(sentences);

      const app = createTestApp();
      const res = await app.request('/');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; data: typeof sentences };
      expect(body.success).toBe(true);
      expect(body.data).toEqual(sentences);
      expect(mockMyDictionaries.getByUser).toHaveBeenCalledWith('test@example.com', 50);
    });

    test('uses default limit of 50', async () => {
      mockMyDictionaries.getByUser.mockResolvedValueOnce([]);

      const app = createTestApp();
      await app.request('/');

      expect(mockMyDictionaries.getByUser).toHaveBeenCalledWith('test@example.com', 50);
    });

    test('accepts custom limit parameter', async () => {
      mockMyDictionaries.getByUser.mockResolvedValueOnce([]);

      const app = createTestApp();
      await app.request('/?limit=20');

      expect(mockMyDictionaries.getByUser).toHaveBeenCalledWith('test@example.com', 20);
    });

    test('caps limit at 100', async () => {
      mockMyDictionaries.getByUser.mockResolvedValueOnce([]);

      const app = createTestApp();
      await app.request('/?limit=200');

      expect(mockMyDictionaries.getByUser).toHaveBeenCalledWith('test@example.com', 100);
    });

    test('uses default limit for invalid limit param', async () => {
      mockMyDictionaries.getByUser.mockResolvedValueOnce([]);

      const app = createTestApp();
      await app.request('/?limit=invalid');

      expect(mockMyDictionaries.getByUser).toHaveBeenCalledWith('test@example.com', 50);
    });

    test('uses default limit for zero limit param', async () => {
      mockMyDictionaries.getByUser.mockResolvedValueOnce([]);

      const app = createTestApp();
      await app.request('/?limit=0');

      expect(mockMyDictionaries.getByUser).toHaveBeenCalledWith('test@example.com', 50);
    });

    test('returns 500 on DynamoDB error', async () => {
      mockMyDictionaries.getByUser.mockRejectedValueOnce(new Error('DDB error'));

      const app = createTestApp();
      const res = await app.request('/');

      expect(res.status).toBe(500);
    });
  });

  describe('DELETE /:sentenceId - Delete a sentence', () => {
    test('deletes sentence successfully', async () => {
      mockMyDictionaries.delete.mockResolvedValueOnce({ success: true });

      const app = createTestApp();
      const res = await app.request('/sentence-123', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; message: string };
      expect(body.success).toBe(true);
      expect(body.message).toContain('deleted');
      expect(mockMyDictionaries.delete).toHaveBeenCalledWith('test@example.com', 'sentence-123');
    });

    test('returns 500 on DynamoDB error', async () => {
      mockMyDictionaries.delete.mockRejectedValueOnce(new Error('DDB error'));

      const app = createTestApp();
      const res = await app.request('/sentence-123', { method: 'DELETE' });

      expect(res.status).toBe(500);
    });
  });

  describe('POST /analyze - Analyze sentence with LLM (error cases)', () => {
    test('returns 400 when sentence is missing', async () => {
      const app = createTestApp();
      const res = await app.request('/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'google', apiKey: 'test-key' }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Sentence is required');
    });

    test('returns 400 when provider is missing', async () => {
      const app = createTestApp();
      const res = await app.request('/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentence: '日本語', apiKey: 'test-key' }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('provider is required');
    });

    test('returns 400 when google provider has no api key', async () => {
      const app = createTestApp();
      const res = await app.request('/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentence: '日本語', provider: 'google' }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Missing API key');
    });

    test('returns 400 when openrouter provider has no api key', async () => {
      const app = createTestApp();
      const res = await app.request('/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentence: '日本語', provider: 'openrouter' }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Missing API key');
    });

    test('returns 400 for unsupported provider', async () => {
      const app = createTestApp();
      const res = await app.request('/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentence: '日本語', provider: 'unsupported', apiKey: 'key' }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Unsupported provider');
    });

    test('google provider: returns SSE stream on success', async () => {
      const sseLines = [
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '日' }] } }] })}`,
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '本' }] } }] })}`,
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: makeSseStream(sseLines),
      });

      const app = createTestApp();
      const res = await app.request('/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentence: '日本語', provider: 'google', apiKey: 'test-key' }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
    });

    test('google provider: returns 500 when API returns error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      const app = createTestApp();
      const res = await app.request('/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sentence: '日本語',
          provider: 'google',
          apiKey: 'test-key',
          model: 'gemini-2.0-flash',
        }),
      });

      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Google API error 500');
    });

    test('openrouter provider: returns SSE stream on success', async () => {
      const sseLines = [
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'Translation: Hello' } }] })}`,
        'data: [DONE]',
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: makeSseStream(sseLines),
      });

      const app = createTestApp();
      const res = await app.request('/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sentence: '日本語',
          provider: 'openrouter',
          apiKey: 'test-key',
          model: 'openai/gpt-4o',
        }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
    });

    test('openrouter provider: returns 500 when API returns error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'Too Many Requests',
      });

      const app = createTestApp();
      const res = await app.request('/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentence: '日本語', provider: 'openrouter', apiKey: 'test-key' }),
      });

      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('OpenRouter API error 429');
    });

    test('google provider: SSE stream with null body uses error handler', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: null,
      });

      const app = createTestApp();
      const res = await app.request('/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentence: '日本語', provider: 'google', apiKey: 'test-key' }),
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      // Read the stream to verify error event was sent
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (typeof value === 'string') {
            fullText += value;
          } else if (value instanceof Uint8Array) {
            fullText += decoder.decode(value);
          }
        }
      }
      expect(fullText).toContain('error');
    });
  });
});

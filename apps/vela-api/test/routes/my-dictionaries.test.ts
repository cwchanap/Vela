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

const mockAuthConfig = {
  userId: 'test-user-id',
  userEmail: 'test@example.com',
};

vi.mock('../../src/middleware/auth', () => ({
  requireAuth: async (_c: any, next: any) => {
    _c.set('userId', mockAuthConfig.userId);
    _c.set('userEmail', mockAuthConfig.userEmail);
    await next();
  },
  AuthContext: {},
}));

// OpenAI / Anthropic SDK doubles: the dictionary route reaches these
// adapters through the shared factory, so the vendor SDK boundary is mocked
// (not the factory) to keep normalize → adapter → SSE mapping under test.
const mockOpenAiCreate = vi.fn();
const mockOpenAiOptions: Array<Record<string, unknown>> = [];
vi.mock('openai', () => ({
  default: class MockOpenAI {
    constructor(options: Record<string, unknown>) {
      mockOpenAiOptions.push(options);
    }
    responses = { create: (...args: unknown[]) => mockOpenAiCreate(...args) };
  },
}));

const mockAnthropicStream = vi.fn();
const mockAnthropicOptions: Array<Record<string, unknown>> = [];
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    constructor(options: Record<string, unknown>) {
      mockAnthropicOptions.push(options);
    }
    beta = { messages: { stream: (...args: unknown[]) => mockAnthropicStream(...args) } };
  },
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

// Drain a route SSE response into its parsed JSON frames.
async function sseFrames(res: Response): Promise<Array<Record<string, any>>> {
  const text = await res.text();
  return text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)));
}

function analyzeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

// The Japanese analysis prompt, locked verbatim: the route must not change it.
const ANALYSIS_SYSTEM_PROMPT = `You are a Japanese language expert. Analyze the provided Japanese sentence and provide:
1. English translation
2. Grammar breakdown (key grammar points)
3. Vocabulary notes (important words with readings)
4. Usage context (when/how to use this sentence)

Keep it concise and educational.`;

const USER_PROMPT = (sentence: string) => `Analyze this Japanese sentence: "${sentence}"`;

describe('My Dictionaries Route', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthConfig.userId = 'test-user-id';
    mockAuthConfig.userEmail = 'test@example.com';
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch as any;
    mockOpenAiOptions.length = 0;
    mockAnthropicOptions.length = 0;
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
        undefined,
        undefined,
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
        undefined,
        undefined,
      );
    });

    test('passes idempotencyKey to create for stable dedup on retries', async () => {
      mockMyDictionaries.create.mockResolvedValueOnce({
        sentence_id: '1710000000000-stable-key-123',
      });

      const app = createTestApp();
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sentence: 'テスト',
          idempotencyKey: 'stable-key-123',
          timestamp: 1710000000000,
        }),
      });

      expect(res.status).toBe(200);
      expect(mockMyDictionaries.create).toHaveBeenCalledWith(
        'test@example.com',
        'テスト',
        undefined,
        undefined,
        'stable-key-123',
        1710000000000,
      );
    });

    test('ignores non-string idempotencyKey', async () => {
      mockMyDictionaries.create.mockResolvedValueOnce({});

      const app = createTestApp();
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentence: 'テスト', idempotencyKey: 12345 }),
      });

      expect(res.status).toBe(200);
      expect(mockMyDictionaries.create).toHaveBeenCalledWith(
        'test@example.com',
        'テスト',
        undefined,
        undefined,
        undefined,
        undefined,
      );
    });

    test('ignores non-string idempotencyKey and non-number timestamp', async () => {
      mockMyDictionaries.create.mockResolvedValueOnce({});

      const app = createTestApp();
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sentence: 'テスト',
          idempotencyKey: 12345,
          timestamp: 'not-a-number',
        }),
      });

      expect(res.status).toBe(200);
      expect(mockMyDictionaries.create).toHaveBeenCalledWith(
        'test@example.com',
        'テスト',
        undefined,
        undefined,
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

  describe('POST /analyze - Analyze sentence with LLM', () => {
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

    test('google provider: streams metadata, chunks, and done with the registry default model', async () => {
      const sseLines = [
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '日' }] } }] })}`,
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '本' }] } }] })}`,
        `data: ${JSON.stringify({
          candidates: [{ finishReason: 'STOP' }],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 6,
            cachedContentTokenCount: 3,
          },
        })}`,
      ];
      mockFetch.mockResolvedValueOnce({ ok: true, body: makeSseStream(sseLines) });

      const app = createTestApp();
      const res = await app.request(
        analyzeRequest({ sentence: '日本語', provider: 'google', apiKey: 'user-key' }),
      );

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');

      // Exact frame contract: upstream usage events (including cache hits)
      // never add an SSE frame and no raw payload leaks.
      expect(await sseFrames(res)).toEqual([
        { type: 'metadata', provider: 'google', model: 'gemini-3.8-flash', sentence: '日本語' },
        { type: 'chunk', text: '日' },
        { type: 'chunk', text: '本' },
        { type: 'done' },
      ]);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/models/gemini-3.8-flash:streamGenerateContent');
      expect(init.headers['x-goog-api-key']).toBe('user-key');
      expect(JSON.parse(init.body)).toEqual({
        contents: [{ role: 'user', parts: [{ text: USER_PROMPT('日本語') }] }],
        systemInstruction: { parts: [{ text: ANALYSIS_SYSTEM_PROMPT }] },
        // 3072 caller budget + 1024 low-effort reasoning headroom.
        generationConfig: { maxOutputTokens: 4096, thinkingConfig: { thinkingLevel: 'LOW' } },
      });
    });

    test('google provider: initial upstream 401 becomes HTTP 200 with an SSE error frame', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'invalid key sk-SECRET-VALUE',
      });

      const app = createTestApp();
      const res = await app.request(
        analyzeRequest({ sentence: '日本語', provider: 'google', apiKey: 'bad-key' }),
      );

      // Failures after the SSE response begins (including lazy initial
      // upstream 4xx/5xx) are SSE error frames, never a pre-stream JSON 500.
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const frames = await sseFrames(res);
      expect(frames).toEqual([
        { type: 'metadata', provider: 'google', model: 'gemini-3.8-flash', sentence: '日本語' },
        { type: 'error', error: 'Google request failed (401)' },
      ]);
      expect(JSON.stringify(frames)).not.toContain('sk-SECRET-VALUE');
    });

    test('openrouter provider: streams chunks with attribution headers and existing sampling', async () => {
      const sseLines = [
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'Translation: Hello' } }] })}`,
        `data: ${JSON.stringify({
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: {
            prompt_tokens: 7,
            completion_tokens: 3,
            prompt_tokens_details: { cached_tokens: 2 },
          },
        })}`,
        'data: [DONE]',
      ];
      mockFetch.mockResolvedValueOnce({ ok: true, body: makeSseStream(sseLines) });

      const app = createTestApp({ APP_NAME: 'Vela App' });
      const res = await app.request(
        analyzeRequest({
          sentence: '日本語',
          provider: 'openrouter',
          apiKey: 'user-key',
          model: 'openai/gpt-4o',
        }),
      );

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      expect(await sseFrames(res)).toEqual([
        { type: 'metadata', provider: 'openrouter', model: 'openai/gpt-4o', sentence: '日本語' },
        { type: 'chunk', text: 'Translation: Hello' },
        { type: 'done' },
      ]);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
      expect(init.headers).toMatchObject({
        Authorization: 'Bearer user-key',
        'HTTP-Referer': 'http://localhost/analyze',
        'X-Title': 'Vela App',
      });
      expect(JSON.parse(init.body)).toEqual({
        model: 'openai/gpt-4o',
        messages: [
          { role: 'system', content: ANALYSIS_SYSTEM_PROMPT },
          { role: 'user', content: USER_PROMPT('日本語') },
        ],
        temperature: 0.7,
        max_tokens: 3072,
        stream: true,
      });
    });

    test('google provider: initial upstream 500 becomes HTTP 200 with an SSE error frame and no done', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'upstream exploded',
      });

      const app = createTestApp();
      const res = await app.request(
        analyzeRequest({ sentence: '日本語', provider: 'google', apiKey: 'user-key' }),
      );

      // A lazy initial upstream 5xx is an SSE error frame, never done — the
      // browser must not mistake a failed analysis for a successful one.
      expect(res.status).toBe(200);
      const frames = await sseFrames(res);
      expect(frames).toEqual([
        { type: 'metadata', provider: 'google', model: 'gemini-3.8-flash', sentence: '日本語' },
        { type: 'error', error: 'Google request failed (500)' },
      ]);
      expect(frames.some((frame) => frame.type === 'done')).toBe(false);
    });

    test('openrouter provider: initial upstream 429 becomes HTTP 200 with an SSE error frame', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'Too Many Requests',
      });

      const app = createTestApp();
      const res = await app.request(
        analyzeRequest({ sentence: '日本語', provider: 'openrouter', apiKey: 'user-key' }),
      );

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      expect(await sseFrames(res)).toEqual([
        {
          type: 'metadata',
          provider: 'openrouter',
          model: 'openai/gpt-oss-20b:free',
          sentence: '日本語',
        },
        { type: 'error', error: 'OpenRouter request failed (429)' },
      ]);
    });

    test('google provider: null upstream body becomes an SSE error frame, never done', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: null,
      });

      const app = createTestApp();
      const res = await app.request(
        analyzeRequest({ sentence: '日本語', provider: 'google', apiKey: 'user-key' }),
      );

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      expect(await sseFrames(res)).toEqual([
        { type: 'metadata', provider: 'google', model: 'gemini-3.8-flash', sentence: '日本語' },
        { type: 'error', error: 'Google request failed (empty body)' },
      ]);
    });

    test('trailing data: line without newline is flushed; malformed data never yields done', async () => {
      const encoder = new TextEncoder();
      const validChunk = JSON.stringify({ candidates: [{ content: { parts: [{ text: '日' }] } }] });
      const sseData = `data: ${validChunk}\ndata: {invalid-json`;
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(sseData));
          controller.close();
        },
      });
      mockFetch.mockResolvedValueOnce({ ok: true, body: stream });

      const app = createTestApp();
      const res = await app.request(
        analyzeRequest({ sentence: '日本語', provider: 'google', apiKey: 'user-key' }),
      );

      expect(res.status).toBe(200);
      // The trailing data: line is flushed and parsed, but the malformed JSON
      // fails the stream immediately — so no done frame.
      expect(await sseFrames(res)).toEqual([
        { type: 'metadata', provider: 'google', model: 'gemini-3.8-flash', sentence: '日本語' },
        { type: 'chunk', text: '日' },
        { type: 'error', error: 'Google stream failed (malformed data)' },
      ]);
    });

    test('google provider: malformed data followed by a valid STOP terminal never yields done', async () => {
      const sseLines = [
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'partial' }] } }] })}`,
        'data: {not json',
        `data: ${JSON.stringify({ candidates: [{ finishReason: 'STOP' }] })}`,
      ];
      mockFetch.mockResolvedValueOnce({ ok: true, body: makeSseStream(sseLines) });

      const app = createTestApp();
      const res = await app.request(
        analyzeRequest({ sentence: '日本語', provider: 'google', apiKey: 'user-key' }),
      );

      expect(res.status).toBe(200);
      // A malformed data line fails the stream; the later valid terminal must
      // not rehabilitate it into a done frame.
      expect(await sseFrames(res)).toEqual([
        { type: 'metadata', provider: 'google', model: 'gemini-3.8-flash', sentence: '日本語' },
        { type: 'chunk', text: 'partial' },
        { type: 'error', error: 'Google stream failed (malformed data)' },
      ]);
    });

    test('openrouter provider: malformed data followed by a valid stop terminal never yields done', async () => {
      const sseLines = [
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'partial' } }] })}`,
        'data: {not json',
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}`,
      ];
      mockFetch.mockResolvedValueOnce({ ok: true, body: makeSseStream(sseLines) });

      const app = createTestApp();
      const res = await app.request(
        analyzeRequest({ sentence: '日本語', provider: 'openrouter', apiKey: 'user-key' }),
      );

      expect(res.status).toBe(200);
      expect(await sseFrames(res)).toEqual([
        {
          type: 'metadata',
          provider: 'openrouter',
          model: 'openai/gpt-oss-20b:free',
          sentence: '日本語',
        },
        { type: 'chunk', text: 'partial' },
        { type: 'error', error: 'OpenRouter stream failed (malformed data)' },
      ]);
    });

    test('upstream read error becomes a sanitized SSE error frame, never done', async () => {
      const errorStream = new ReadableStream({
        start(controller) {
          controller.error(new Error('Connection lost with secret sk-KEY'));
        },
      });
      mockFetch.mockResolvedValueOnce({ ok: true, body: errorStream });

      const app = createTestApp();
      const res = await app.request(
        analyzeRequest({ sentence: '日本語', provider: 'google', apiKey: 'user-key' }),
      );

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const frames = await sseFrames(res);
      expect(frames).toEqual([
        { type: 'metadata', provider: 'google', model: 'gemini-3.8-flash', sentence: '日本語' },
        { type: 'error', error: 'Google request failed' },
      ]);
      expect(JSON.stringify(frames)).not.toContain('Connection lost');
    });

    test('returns 403 when origin is not allowed with configured origins', async () => {
      const app = createTestApp({
        CORS_ALLOWED_ORIGINS: 'http://localhost:9000',
      });
      const res = await app.request('/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: 'http://evil.com' },
        body: JSON.stringify({ sentence: '日本語', provider: 'google', apiKey: 'test-key' }),
      });

      expect(res.status).toBe(403);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Origin not allowed');
    });

    test('returns 400 when analyze request body is invalid JSON', async () => {
      const app = createTestApp();
      const res = await app.request(analyzeRequest('not-valid-json'));

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Invalid JSON');
    });

    test('returns 400 for non-object analyze bodies instead of a 500', async () => {
      const app = createTestApp();
      for (const raw of ['null', '"a string"', '123']) {
        const res = await app.request(analyzeRequest(raw));
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toBe('Invalid request body');
      }
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('returns 400 when model is not a string and never calls upstream', async () => {
      const app = createTestApp();
      for (const model of [123, true, {}]) {
        const res = await app.request(
          analyzeRequest({ sentence: '日本語', provider: 'google', apiKey: 'user-key', model }),
        );
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toBe('Invalid model');
      }
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('returns 400 when provider is not a string and never calls upstream', async () => {
      const app = createTestApp();
      // { toString: null } throws when the normalizer interpolates the
      // unsupported-provider error; it must not escape as a 500.
      for (const provider of [123, true, { toString: null }]) {
        const res = await app.request(
          analyzeRequest({ sentence: '日本語', provider, apiKey: 'user-key' }),
        );
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toBe('LLM provider is required');
      }
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('returns 400 naming the rejected model and never calls upstream', async () => {
      const app = createTestApp();
      const res = await app.request(
        analyzeRequest({
          sentence: '日本語',
          provider: 'google',
          apiKey: 'user-key',
          model: 'gemini-2.5-flash-lite',
        }),
      );

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('gemini-2.5-flash-lite');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('returns 400 when openai provider has no api key', async () => {
      const app = createTestApp();
      const res = await app.request(analyzeRequest({ sentence: '日本語', provider: 'openai' }));

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Missing API key for OpenAI provider');
      expect(mockOpenAiCreate).not.toHaveBeenCalled();
    });

    test('returns 400 when anthropic provider has no api key', async () => {
      const app = createTestApp();
      const res = await app.request(analyzeRequest({ sentence: '日本語', provider: 'anthropic' }));

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Missing API key for Anthropic provider');
      expect(mockAnthropicStream).not.toHaveBeenCalled();
    });

    test('never falls back to a server key: dictionary analysis requires a user key', async () => {
      const app = createTestApp({
        GOOGLE_API_KEY: 'server-side-key',
        OPENROUTER_API_KEY: 'server-side-key',
      });

      for (const provider of ['google', 'openrouter'] as const) {
        const res = await app.request(analyzeRequest({ sentence: '日本語', provider }));
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toContain('Missing API key');
      }
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('returns 401 before any upstream call when unauthenticated', async () => {
      mockAuthConfig.userId = '';
      mockAuthConfig.userEmail = '';

      const app = createTestApp();
      const res = await app.request(
        analyzeRequest({ sentence: '日本語', provider: 'google', apiKey: 'user-key' }),
      );

      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Unauthorized');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('SAFETY finish after partial text emits an error frame, never done', async () => {
      const sseLines = [
        `data: ${JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'partial' }] }, finishReason: 'SAFETY' }],
        })}`,
      ];
      mockFetch.mockResolvedValueOnce({ ok: true, body: makeSseStream(sseLines) });

      const app = createTestApp();
      const res = await app.request(
        analyzeRequest({ sentence: '日本語', provider: 'google', apiKey: 'user-key' }),
      );

      expect(res.status).toBe(200);
      expect(await sseFrames(res)).toEqual([
        { type: 'metadata', provider: 'google', model: 'gemini-3.8-flash', sentence: '日本語' },
        { type: 'chunk', text: 'partial' },
        { type: 'error', error: 'Google stream finished early (SAFETY)' },
      ]);
    });

    test('stream end without a successful finish emits an error frame, never done', async () => {
      const sseLines = [
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: 'partial' }] } }] })}`,
      ];
      mockFetch.mockResolvedValueOnce({ ok: true, body: makeSseStream(sseLines) });

      const app = createTestApp();
      const res = await app.request(
        analyzeRequest({ sentence: '日本語', provider: 'google', apiKey: 'user-key' }),
      );

      expect(res.status).toBe(200);
      expect(await sseFrames(res)).toEqual([
        { type: 'metadata', provider: 'google', model: 'gemini-3.8-flash', sentence: '日本語' },
        { type: 'chunk', text: 'partial' },
        { type: 'error', error: 'Google stream ended without a successful finish' },
      ]);
    });

    test('openai provider: streams through the SDK with low effort and the user key', async () => {
      mockOpenAiCreate.mockResolvedValueOnce(
        (async function* () {
          yield { type: 'response.output_text.delta', delta: 'Tra' };
          yield { type: 'response.output_text.delta', delta: 'nslated.' };
          yield {
            type: 'response.completed',
            response: {
              usage: {
                input_tokens: 900,
                output_tokens: 12,
                input_tokens_details: { cached_tokens: 400 },
              },
            },
          };
        })(),
      );

      const app = createTestApp();
      const res = await app.request(
        analyzeRequest({ sentence: '日本語', provider: 'openai', apiKey: 'user-key' }),
      );

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      expect(await sseFrames(res)).toEqual([
        { type: 'metadata', provider: 'openai', model: 'gpt-6.1-sol', sentence: '日本語' },
        { type: 'chunk', text: 'Tra' },
        { type: 'chunk', text: 'nslated.' },
        { type: 'done' },
      ]);

      expect(mockOpenAiOptions.at(-1)).toEqual({ apiKey: 'user-key', maxRetries: 0 });
      const [params] = mockOpenAiCreate.mock.calls[0];
      expect(params).toMatchObject({
        model: 'gpt-6.1-sol',
        // 3072 caller budget + 1024 low-effort reasoning headroom.
        max_output_tokens: 4096,
        reasoning: { effort: 'low' },
        instructions: ANALYSIS_SYSTEM_PROMPT,
        input: [{ role: 'user', content: USER_PROMPT('日本語') }],
        stream: true,
      });
    });

    test('anthropic provider: streams through the SDK with low effort and cache control', async () => {
      mockAnthropicStream.mockReturnValueOnce(
        (async function* () {
          yield {
            type: 'message_start',
            message: { usage: { input_tokens: 10, output_tokens: 1 } },
          };
          yield { type: 'content_block_start', index: 0, content_block: { type: 'text' } };
          yield {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'Translation.' },
          };
          yield {
            type: 'message_delta',
            delta: { stop_reason: 'end_turn' },
            usage: {
              input_tokens: 12,
              cache_read_input_tokens: 200,
              cache_creation_input_tokens: 8,
              output_tokens: 42,
            },
          };
          yield { type: 'message_stop' };
        })(),
      );

      const app = createTestApp();
      const res = await app.request(
        analyzeRequest({ sentence: '日本語', provider: 'anthropic', apiKey: 'user-key' }),
      );

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      expect(await sseFrames(res)).toEqual([
        { type: 'metadata', provider: 'anthropic', model: 'claude-opus-5-5', sentence: '日本語' },
        { type: 'chunk', text: 'Translation.' },
        { type: 'done' },
      ]);

      // Payload logging disabled at construction — the SDK's default 'warn'
      // level logs raw malformed SSE chunks to server logs.
      expect(mockAnthropicOptions.at(-1)).toEqual({
        apiKey: 'user-key',
        maxRetries: 0,
        logLevel: 'off',
      });
      const [params] = mockAnthropicStream.mock.calls[0];
      expect(params).toMatchObject({
        model: 'claude-opus-5-5',
        // 3072 caller budget + 1024 low-effort reasoning headroom.
        max_tokens: 4096,
        output_config: { effort: 'low' },
        system: ANALYSIS_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
        fallbacks: 'default',
        betas: ['server-side-fallback-2026-07-01'],
        messages: [{ role: 'user', content: USER_PROMPT('日本語') }],
      });
    });

    test('browser-sent thinking is forwarded as the validated native effort', async () => {
      const sseLines = [`data: ${JSON.stringify({ candidates: [{ finishReason: 'STOP' }] })}`];
      mockFetch.mockResolvedValueOnce({ ok: true, body: makeSseStream(sseLines) });

      const app = createTestApp();
      const res = await app.request(
        analyzeRequest({
          sentence: '日本語',
          provider: 'google',
          apiKey: 'user-key',
          thinking: 'high',
        }),
      );

      expect(res.status).toBe(200);
      expect(await sseFrames(res)).toEqual([
        { type: 'metadata', provider: 'google', model: 'gemini-3.8-flash', sentence: '日本語' },
        { type: 'done' },
      ]);
      const [, init] = mockFetch.mock.calls[0];
      expect(JSON.parse(init.body).generationConfig).toEqual({
        maxOutputTokens: 7168,
        thinkingConfig: { thinkingLevel: 'HIGH' },
      });
    });

    test('rejects malformed and unsupported dictionary thinking before contacting the provider', async () => {
      const app = createTestApp();
      for (const thinking of ['ultra', 'max', 4]) {
        const res = await app.request(
          analyzeRequest({ sentence: '日本語', provider: 'google', apiKey: 'user-key', thinking }),
        );
        expect(res.status).toBe(400);
      }
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('ignores thinking for a free-form OpenRouter model', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, body: makeSseStream(['data: [DONE]']) });
      const res = await createTestApp().request(
        analyzeRequest({
          sentence: '日本語',
          provider: 'openrouter',
          apiKey: 'user-key',
          model: 'gpt-6.1-sol',
          thinking: 'high',
        }),
      );
      expect(res.status).toBe(200);
      await sseFrames(res);
      const [, init] = mockFetch.mock.calls[0];
      expect(JSON.parse(init.body)).not.toHaveProperty('reasoning');
      expect(JSON.parse(init.body)).not.toHaveProperty('thinking');
    });

    test('omitted thinking runs at low effort where the model supports it', async () => {
      for (const extra of [{}, { thinking: '   ' }]) {
        const sseLines = [`data: ${JSON.stringify({ candidates: [{ finishReason: 'STOP' }] })}`];
        mockFetch.mockResolvedValueOnce({ ok: true, body: makeSseStream(sseLines) });

        const app = createTestApp();
        const res = await app.request(
          analyzeRequest({
            sentence: '日本語',
            provider: 'google',
            apiKey: 'user-key',
            ...extra,
          }),
        );

        expect(res.status).toBe(200);
        const [, init] = mockFetch.mock.calls.at(-1)!;
        expect(JSON.parse(init.body).generationConfig.thinkingConfig).toEqual({
          thinkingLevel: 'LOW',
        });
      }
    });

    test('delivers metadata and chunk frames before the upstream stream completes', async () => {
      // Deferred upstream: the terminal chunk is held back behind a gate so
      // the test can prove frames leave the route while the upstream is
      // still mid-stream (local Bun progressive delivery).
      const encoder = new TextEncoder();
      let releaseUpstream!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseUpstream = resolve;
      });
      let upstreamCompleted = false;
      const deferredBody = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '日' }] } }] })}\n\n`,
            ),
          );
          gate.then(() => {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({ candidates: [{ finishReason: 'STOP' }] })}\n\n`,
              ),
            );
            controller.close();
            upstreamCompleted = true;
          });
        },
      });
      mockFetch.mockResolvedValueOnce({ ok: true, body: deferredBody });

      const app = createTestApp();
      const res = await app.request(
        analyzeRequest({ sentence: '日本語', provider: 'google', apiKey: 'user-key' }),
      );
      expect(res.status).toBe(200);

      // Read single frames from the undrained response body. Bun passes the
      // route's string frames through as string reads; decode defensively.
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      const readFrame = async (): Promise<Record<string, any>> => {
        for (;;) {
          const boundary = pending.indexOf('\n\n');
          if (boundary !== -1) {
            const line = pending.slice(0, boundary);
            pending = pending.slice(boundary + 2);
            return JSON.parse(line.slice('data: '.length));
          }
          const { done, value } = await reader.read();
          if (done) throw new Error('SSE stream ended before a frame arrived');
          pending += typeof value === 'string' ? value : decoder.decode(value, { stream: true });
        }
      };

      expect(await readFrame()).toEqual({
        type: 'metadata',
        provider: 'google',
        model: 'gemini-3.8-flash',
        sentence: '日本語',
      });
      expect(await readFrame()).toEqual({ type: 'chunk', text: '日' });
      // Both frames arrived while the upstream was still mid-stream.
      expect(upstreamCompleted).toBe(false);

      releaseUpstream();
      expect(await readFrame()).toEqual({ type: 'done' });
      expect(upstreamCompleted).toBe(true);
    });

    test('canceled upstream stream surfaces as an SSE error frame, never done', async () => {
      // A client disconnect propagates through the request signal, and the
      // vendor body read rejects with an AbortError — the real fetch abort
      // shape (Bun's mocked fetch ignores signals, so the body models it).
      // Queued upstream chunks are discarded on error, so only metadata and
      // the sanitized error frame are observable.
      const abortError = Object.assign(new Error('The operation was aborted'), {
        name: 'AbortError',
      });
      const canceledStream = new ReadableStream({
        start(controller) {
          controller.error(abortError);
        },
      });
      mockFetch.mockResolvedValueOnce({ ok: true, body: canceledStream });

      const app = createTestApp();
      const res = await app.request(
        analyzeRequest({ sentence: '日本語', provider: 'google', apiKey: 'user-key' }),
      );

      expect(res.status).toBe(200);
      expect(await sseFrames(res)).toEqual([
        { type: 'metadata', provider: 'google', model: 'gemini-3.8-flash', sentence: '日本語' },
        { type: 'error', error: 'Google request timed out' },
      ]);
    });
  });

  describe('POST / - unauthorized edge case', () => {
    test('returns 401 when user has no userId or email', async () => {
      mockAuthConfig.userId = '';
      mockAuthConfig.userEmail = '';

      const app = createTestApp();
      const res = await app.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentence: '日本語' }),
      });

      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Unauthorized');
    });
  });
});

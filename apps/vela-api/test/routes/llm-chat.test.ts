import { describe, test, expect, beforeEach, afterAll, vi } from 'bun:test';
import { Hono } from 'hono';
import { corsMiddleware } from '../../src/middleware/cors';
import { sseBody } from '../llm/helpers';
import type { Env } from '../../src/types';

// Mock fetch globally (Bun's fetch type includes preconnect, so cast to keep TS happy)
const originalFetch = global.fetch;
global.fetch = vi.fn() as unknown as typeof fetch;

const mockAuthConfig = { validToken: true };

// Mock requireAuth with the real middleware's contract: 401 for anonymous or
// invalid tokens, claims set for valid ones. Flipping validToken simulates an
// expired token; omitting the Authorization header simulates anonymous.
vi.mock('../../src/middleware/auth', () => ({
  requireAuth: async (_c: any, next: any) => {
    const header = _c.req.header('Authorization');
    if (!header?.startsWith('Bearer ') || !mockAuthConfig.validToken) {
      return _c.json({ error: 'Unauthorized: Missing or invalid Authorization header' }, 401);
    }
    _c.set('userId', 'test-user-id');
    _c.set('userEmail', 'test@example.com');
    await next();
  },
  AuthContext: {},
}));

// Import AFTER mocks are declared
const { llmChat } = await import('../../src/routes/llm-chat');

// Create a test app mirroring index.ts middleware order: env → CORS → route.
function createTestApp(env: Env = {}) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    c.env = c.env || {};
    Object.assign(c.env, env);
    await next();
  });
  app.use('*', corsMiddleware);
  app.route('/', llmChat);
  return app;
}

function chatRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer valid-token',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function sseResponse(lines: Array<string | Uint8Array>, status = 200) {
  return new Response(sseBody(lines), { status });
}

const GEMINI_OK = [
  'data: {"candidates":[{"content":{"parts":[{"text":"Hello"},{"text":"hidden reasoning","thought":true}]}}]}\n\n',
  'data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":6,"thoughtsTokenCount":4,"cachedContentTokenCount":3}}\n\n',
];

const GEMINI_OK_NO_USAGE = [
  'data: {"candidates":[{"content":{"parts":[{"text":"Plain answer"}]}}]}\n\n',
  'data: {"candidates":[{"finishReason":"STOP"}]}\n\n',
];

const OPENROUTER_OK = [
  'data: {"choices":[{"delta":{"content":"Hi","reasoning":"secret chain of thought"}}]}\n\n',
  'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":7,"completion_tokens":3,"prompt_tokens_details":{"cached_tokens":2}}}\n\n',
  'data: [DONE]\n\n',
];

describe('LLM Chat Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthConfig.validToken = true;
  });

  afterAll(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('Authentication', () => {
    test('rejects anonymous requests with 401 before any upstream call', async () => {
      const app = createTestApp({ GOOGLE_API_KEY: 'server-side-key' });
      const res = await app.request(
        chatRequest({ provider: 'google', prompt: 'Hello' }, { Authorization: '' }),
      );
      const json = await res.json();

      expect(res.status).toBe(401);
      expect(json.error).toContain('Unauthorized');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('rejects invalid or expired tokens with 401 before any upstream call', async () => {
      mockAuthConfig.validToken = false;
      const app = createTestApp({ GOOGLE_API_KEY: 'server-side-key' });
      const res = await app.request(chatRequest({ provider: 'google', prompt: 'Hello' }));
      const json = await res.json();

      expect(res.status).toBe(401);
      expect(json.error).toContain('Unauthorized');
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Input validation', () => {
    test('returns 400 for invalid JSON', async () => {
      const app = createTestApp();
      const res = await app.request(chatRequest('invalid json'));
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('Invalid JSON');
    });

    test('returns 400 for missing provider', async () => {
      const app = createTestApp();
      const res = await app.request(chatRequest({ prompt: 'Hello' }));
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('provider');
    });

    test('rejects the removed Chutes provider with 400', async () => {
      const app = createTestApp();
      const res = await app.request(chatRequest({ provider: 'chutes', prompt: 'Hello' }));
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('provider');
    });

    test('returns 400 for missing prompt and messages', async () => {
      const app = createTestApp();
      const res = await app.request(chatRequest({ provider: 'google', apiKey: 'k' }));
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('prompt or messages');
    });

    test('returns 400 for an empty messages array with no prompt', async () => {
      const app = createTestApp();
      const res = await app.request(chatRequest({ provider: 'google', messages: [] }));
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('prompt or messages');
    });

    test('rejects unsupported model IDs with 400 naming the rejected model', async () => {
      const app = createTestApp();
      const res = await app.request(
        chatRequest({
          provider: 'google',
          apiKey: 'k',
          model: 'gemini-2.5-flash-lite',
          prompt: 'Hello',
        }),
      );
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('gemini-2.5-flash-lite');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('rejects unsupported thinking values with 400 naming value and model', async () => {
      const app = createTestApp();
      const res = await app.request(
        chatRequest({
          provider: 'google',
          apiKey: 'k',
          model: 'gemini-3.8-flash',
          thinking: 'extreme',
          prompt: 'Hello',
        }),
      );
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain("Unsupported thinking 'extreme'");
      expect(json.error).toContain('gemini-3.8-flash');
    });
  });

  describe('Credential policy', () => {
    test('returns 400 for Google with neither user key nor server key', async () => {
      const app = createTestApp();
      const res = await app.request(chatRequest({ provider: 'google', prompt: 'Hello' }));
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('Missing API key for Google provider');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('uses the Google server-side key for authenticated chat', async () => {
      (global.fetch as any).mockResolvedValueOnce(sseResponse(GEMINI_OK));

      const app = createTestApp({ GOOGLE_API_KEY: 'server-side-key' });
      const res = await app.request(chatRequest({ provider: 'google', prompt: 'Hello' }));

      expect(res.status).toBe(200);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('generativelanguage.googleapis.com'),
        expect.objectContaining({
          headers: expect.objectContaining({ 'x-goog-api-key': 'server-side-key' }),
        }),
      );
    });

    test('user key takes precedence over the Google server key', async () => {
      (global.fetch as any).mockResolvedValueOnce(sseResponse(GEMINI_OK));

      const app = createTestApp({ GOOGLE_API_KEY: 'server-side-key' });
      const res = await app.request(
        chatRequest({ provider: 'google', apiKey: 'user-key', prompt: 'Hello' }),
      );

      expect(res.status).toBe(200);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('generativelanguage.googleapis.com'),
        expect.objectContaining({
          headers: expect.objectContaining({ 'x-goog-api-key': 'user-key' }),
        }),
      );
    });

    test('returns 400 for OpenRouter with neither user key nor server key', async () => {
      const app = createTestApp();
      const res = await app.request(chatRequest({ provider: 'openrouter', prompt: 'Hello' }));
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('Missing API key for OpenRouter provider');
    });

    test('uses the OpenRouter server-side key for authenticated chat', async () => {
      (global.fetch as any).mockResolvedValueOnce(sseResponse(OPENROUTER_OK));

      const app = createTestApp({ OPENROUTER_API_KEY: 'server-side-key' });
      const res = await app.request(chatRequest({ provider: 'openrouter', prompt: 'Hello' }));

      expect(res.status).toBe(200);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/chat/completions',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer server-side-key' }),
        }),
      );
    });

    test('user key takes precedence over the OpenRouter server key', async () => {
      (global.fetch as any).mockResolvedValueOnce(sseResponse(OPENROUTER_OK));

      const app = createTestApp({ OPENROUTER_API_KEY: 'server-side-key' });
      const res = await app.request(
        chatRequest({ provider: 'openrouter', apiKey: 'user-key', prompt: 'Hello' }),
      );

      expect(res.status).toBe(200);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/chat/completions',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer user-key' }),
        }),
      );
    });

    test('requires a user-provided key for OpenAI (no server fallback)', async () => {
      const app = createTestApp();
      const res = await app.request(
        chatRequest({ provider: 'openai', model: 'gpt-6.1-sol', prompt: 'Hello' }),
      );
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('Missing API key for OpenAI provider');
      expect(json.error).toContain('provide your own API key');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('requires a user-provided key for Anthropic (no server fallback)', async () => {
      const app = createTestApp();
      const res = await app.request(
        chatRequest({ provider: 'anthropic', model: 'claude-opus-5-5', prompt: 'Hello' }),
      );
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('Missing API key for Anthropic provider');
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe('Successful generation', () => {
    test('returns {text, usage} with normalized usage and no raw payload', async () => {
      (global.fetch as any).mockResolvedValueOnce(sseResponse(GEMINI_OK));

      const app = createTestApp();
      const res = await app.request(
        chatRequest({
          provider: 'google',
          apiKey: 'test-key',
          prompt: 'Hello',
          temperature: 0.7,
        }),
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.text).toBe('Hello'); // thought part excluded
      expect(json.usage).toEqual({
        inputTokens: 10,
        outputTokens: 10,
        cachedInputTokens: 3,
        cacheWriteTokens: 0,
      });
      expect(json.raw).toBeUndefined();
      expect(Object.keys(json).sort()).toEqual(['text', 'usage']);
    });

    test('defaults to all-zero usage when upstream reports none', async () => {
      (global.fetch as any).mockResolvedValueOnce(sseResponse(GEMINI_OK_NO_USAGE));

      const app = createTestApp();
      const res = await app.request(
        chatRequest({ provider: 'google', apiKey: 'k', prompt: 'Hello' }),
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.usage).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
      });
    });

    test('caps caller maxTokens at the chat budget and defaults to it', async () => {
      (global.fetch as any).mockResolvedValueOnce(sseResponse(GEMINI_OK));

      const app = createTestApp();
      const res = await app.request(
        chatRequest({
          provider: 'google',
          apiKey: 'k',
          prompt: 'Hello',
          maxTokens: 999999,
        }),
      );

      expect(res.status).toBe(200);
      const [, init] = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.generationConfig.maxOutputTokens).toBe(4096);
      // The removed temperature field must never reach the adapter.
      expect(body.generationConfig).not.toHaveProperty('temperature');
    });

    test('forwards smaller caller maxTokens unchanged', async () => {
      (global.fetch as any).mockResolvedValueOnce(sseResponse(GEMINI_OK));

      const app = createTestApp();
      await app.request(
        chatRequest({ provider: 'google', apiKey: 'k', prompt: 'Hello', maxTokens: 512 }),
      );

      const [, init] = (global.fetch as any).mock.calls[0];
      expect(JSON.parse(init.body).generationConfig.maxOutputTokens).toBe(512);
    });

    test('normalizes history: combines system once, strips leading greeting turn', async () => {
      (global.fetch as any).mockResolvedValueOnce(sseResponse(GEMINI_OK));

      const app = createTestApp();
      const res = await app.request(
        chatRequest({
          provider: 'google',
          apiKey: 'k',
          system: 'Be concise',
          prompt: 'This is ignored when messages exist',
          messages: [
            { role: 'assistant', content: 'greeting!' },
            { role: 'system', content: 'You are a Japanese tutor' },
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi!' },
            { role: 'user', content: 'How are you?' },
          ],
        }),
      );

      expect(res.status).toBe(200);
      const [, init] = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.systemInstruction.parts[0].text).toBe('Be concise\n\nYou are a Japanese tutor');
      expect(body.contents).toEqual([
        { role: 'user', parts: [{ text: 'Hello' }] },
        { role: 'model', parts: [{ text: 'Hi!' }] },
        { role: 'user', parts: [{ text: 'How are you?' }] },
      ]);
    });

    test('maps OpenRouter usage and preserves referer/appName attribution', async () => {
      (global.fetch as any).mockResolvedValueOnce(sseResponse(OPENROUTER_OK));

      const app = createTestApp();
      const res = await app.request(
        chatRequest({
          provider: 'openrouter',
          apiKey: 'k',
          model: 'openai/gpt-oss-20b:free',
          prompt: 'Hello',
          referer: 'https://test.com',
          appName: 'Test App',
        }),
      );
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.text).toBe('Hi');
      expect(json.usage).toEqual({
        inputTokens: 7,
        outputTokens: 3,
        cachedInputTokens: 2,
        cacheWriteTokens: 0,
      });
      expect(global.fetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/chat/completions',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer k',
            'HTTP-Referer': 'https://test.com',
            'X-Title': 'Test App',
          }),
        }),
      );
    });
  });

  describe('Upstream errors', () => {
    test('returns 502 with a sanitized message and no vendor data on HTTP failure', async () => {
      (global.fetch as any).mockResolvedValueOnce(
        new Response('{"error":{"message":"invalid key sk-SECRET-VALUE"}}', { status: 401 }),
      );

      const app = createTestApp();
      const res = await app.request(
        chatRequest({ provider: 'google', apiKey: 'bad-key', prompt: 'Hello' }),
      );
      const json = await res.json();

      expect(res.status).toBe(502);
      expect(json.error).toBe('Gemini request failed (401)');
      expect(JSON.stringify(json)).not.toContain('sk-SECRET-VALUE');
      expect(JSON.stringify(json)).not.toContain('invalid key');
    });

    test('returns 502 for an in-stream refusal terminal (SAFETY)', async () => {
      (global.fetch as any).mockResolvedValueOnce(
        sseResponse([
          'data: {"candidates":[{"content":{"parts":[{"text":"partial"}]},"finishReason":"SAFETY"}]}\n\n',
        ]),
      );

      const app = createTestApp();
      const res = await app.request(
        chatRequest({ provider: 'google', apiKey: 'k', prompt: 'Hello' }),
      );
      const json = await res.json();

      expect(res.status).toBe(502);
      expect(json.error).toContain('SAFETY');
    });

    test('returns 502 for OpenRouter error chunks without leaking vendor messages', async () => {
      (global.fetch as any).mockResolvedValueOnce(
        sseResponse(['data: {"error":{"code":429,"message":"Rate limited sk-or-SECRET"}}\n\n']),
      );

      const app = createTestApp();
      const res = await app.request(
        chatRequest({ provider: 'openrouter', apiKey: 'k', prompt: 'Hello' }),
      );
      const json = await res.json();

      expect(res.status).toBe(502);
      expect(json.error).toBe('OpenRouter stream error (429)');
      expect(JSON.stringify(json)).not.toContain('sk-or-SECRET');
    });

    test('returns 502 without echoing attacker-controlled error codes or finish reasons', async () => {
      (global.fetch as any).mockResolvedValueOnce(
        sseResponse([
          'data: {"error":{"code":"sk-or-v1-ATTACKERSECRET","message":"key sk-or-v1-ATTACKERSECRET rejected"}}\n\n',
        ]),
      );
      const app = createTestApp();
      const res = await app.request(
        chatRequest({ provider: 'openrouter', apiKey: 'k', prompt: 'Hello' }),
      );
      const json = await res.json();

      expect(res.status).toBe(502);
      expect(json.error).toBe('OpenRouter stream error (unknown)');
      expect(JSON.stringify(json)).not.toContain('ATTACKERSECRET');

      (global.fetch as any).mockResolvedValueOnce(
        sseResponse(['data: {"candidates":[{"finishReason":"ATTACKERSECRET-CODE"}]}\n\n']),
      );
      const res2 = await app.request(
        chatRequest({ provider: 'google', apiKey: 'k', prompt: 'Hello' }),
      );
      const json2 = await res2.json();

      expect(res2.status).toBe(502);
      expect(json2.error).toBe('Gemini stream finished early (unknown)');
      expect(JSON.stringify(json2)).not.toContain('ATTACKERSECRET');
    });
  });

  describe('CORS handling (unchanged, centralized)', () => {
    test('handles OPTIONS request without Origin by not setting Access-Control-Allow-Origin', async () => {
      const app = createTestApp({
        CORS_ALLOWED_ORIGINS: 'http://localhost:9000',
      });
      const req = new Request('http://localhost/', { method: 'OPTIONS' });
      const res = await app.request(req);

      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect(res.headers.get('Access-Control-Allow-Methods')).toBe(
        'GET, POST, PUT, DELETE, OPTIONS',
      );
    });

    test('sets Access-Control-Allow-Origin when Origin is allowed', async () => {
      const app = createTestApp({
        CORS_ALLOWED_ORIGINS: 'http://localhost:9000',
      });
      const req = new Request('http://localhost/', {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:9000' },
      });
      const res = await app.request(req);

      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:9000');
      expect(res.headers.get('Access-Control-Allow-Methods')).toBe(
        'GET, POST, PUT, DELETE, OPTIONS',
      );
    });

    test('rejects disallowed Origin with 403 and does not set wildcard', async () => {
      const app = createTestApp({
        CORS_ALLOWED_ORIGINS: 'http://localhost:9000',
      });
      const req = new Request('http://localhost/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://malicious.example.com',
        },
        body: JSON.stringify({ provider: 'google', apiKey: 'test-key', prompt: 'Hello' }),
      });
      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error).toContain('CORS policy violation: Origin not allowed');
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });
  });
});

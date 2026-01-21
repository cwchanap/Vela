import { describe, test, expect, beforeEach, vi } from 'bun:test';
import { Hono } from 'hono';
import { llmChat } from '../../src/routes/llm-chat';
import { corsMiddleware } from '../../src/middleware/cors';
import type { Env } from '../../src/types';

// Mock fetch globally
global.fetch = vi.fn();

// Create a test app that includes the environment
function createTestApp(env: Env = {}) {
  const app = new Hono<{ Bindings: Env }>();

  // Add environment to context
  app.use('*', async (c, next) => {
    // Initialize c.env if it doesn't exist and assign our test env
    c.env = c.env || {};
    Object.assign(c.env, env);
    await next();
  });

  // Apply CORS middleware (now centralized)
  app.use('*', corsMiddleware);

  // Mount the routes
  app.route('/', llmChat);

  return app;
}

describe('LLM Chat Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('CORS handling', () => {
    test('should handle OPTIONS request without Origin by not setting Access-Control-Allow-Origin', async () => {
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

    test('should set Access-Control-Allow-Origin when Origin is allowed', async () => {
      const app = createTestApp({
        CORS_ALLOWED_ORIGINS: 'http://localhost:9000',
      });
      const req = new Request('http://localhost/', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:9000',
        },
      });
      const res = await app.request(req);

      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:9000');
      expect(res.headers.get('Access-Control-Allow-Methods')).toBe(
        'GET, POST, PUT, DELETE, OPTIONS',
      );
    });

    test('should reject disallowed Origin with 403 and not set wildcard', async () => {
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

  describe('Input validation', () => {
    test('should return 400 for invalid JSON', async () => {
      const app = createTestApp();
      const req = new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json',
      });

      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('Invalid JSON');
    });

    test('should return 400 for missing provider', async () => {
      const app = createTestApp();
      const req = new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('Missing provider');
    });

    test('should return 400 for missing prompt and messages', async () => {
      const app = createTestApp();
      const req = new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'google', apiKey: 'test-key' }),
      });

      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('Missing prompt or messages');
    });
  });

  describe('Google provider', () => {
    test('should return 400 when API key is missing (no server key)', async () => {
      const app = createTestApp();
      const req = new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          prompt: 'Hello',
        }),
      });

      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('Missing API key for Google provider');
    });

    test('should use server-side API key when available', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'Server key response' }],
            },
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const app = createTestApp({
        GOOGLE_API_KEY: 'server-side-key',
      });
      const req = new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          prompt: 'Hello',
        }),
      });

      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.text).toBe('Server key response');

      // Verify the fetch call used server key via header
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('generativelanguage.googleapis.com'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-goog-api-key': 'server-side-key',
          }),
        }),
      );
    });

    test('should allow user key to override server key', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'User key response' }],
            },
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const app = createTestApp({
        GOOGLE_API_KEY: 'server-side-key',
      });
      const req = new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          apiKey: 'user-key',
          prompt: 'Hello',
        }),
      });

      const res = await app.request(req);
      await res.json(); // Consume response

      expect(res.status).toBe(200);

      // Verify the fetch call used user key (overriding server key) via header
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('generativelanguage.googleapis.com'),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-goog-api-key': 'user-key',
          }),
        }),
      );
    });

    test('should make successful request to Google API', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'Hello! How can I help you?' }],
            },
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const app = createTestApp();
      const req = new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          apiKey: 'test-key',
          prompt: 'Hello',
          model: 'gemini-2.5-flash-lite',
          temperature: 0.7,
          maxTokens: 1024,
        }),
      });

      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.text).toBe('Hello! How can I help you?');
      expect(json.raw).toEqual(mockResponse);

      // Verify the fetch call
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('generativelanguage.googleapis.com'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'x-goog-api-key': 'test-key',
          }),
        }),
      );
    });

    test('should handle Google API error', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Bad Request'),
      });

      const app = createTestApp();
      const req = new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          apiKey: 'test-key',
          prompt: 'Hello',
        }),
      });

      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toContain('Google error 400');
    });
  });

  describe('OpenRouter provider', () => {
    test('should return 400 when API key is missing (no server key)', async () => {
      const app = createTestApp();
      const req = new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openrouter',
          prompt: 'Hello',
        }),
      });

      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('Missing API key for OpenRouter provider');
    });

    test('should use server-side API key when available', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'Server key response',
            },
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const app = createTestApp({
        OPENROUTER_API_KEY: 'server-side-key',
        APP_NAME: 'Vela App',
      });
      const req = new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openrouter',
          prompt: 'Hello',
        }),
      });

      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.text).toBe('Server key response');

      // Verify the fetch call used server key
      expect(global.fetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/chat/completions',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer server-side-key',
          }),
        }),
      );
    });

    test('should allow user key to override server key', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'User key response',
            },
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const app = createTestApp({
        OPENROUTER_API_KEY: 'server-side-key',
        APP_NAME: 'Vela App',
      });
      const req = new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openrouter',
          apiKey: 'user-key',
          prompt: 'Hello',
        }),
      });

      const res = await app.request(req);
      await res.json(); // Consume response

      expect(res.status).toBe(200);

      // Verify the fetch call used user key, not server key
      expect(global.fetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/chat/completions',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer user-key',
          }),
        }),
      );
    });

    test('should make successful request to OpenRouter API', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'Hello! How can I help you?',
            },
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const app = createTestApp({
        APP_NAME: 'Vela App',
      });
      const req = new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openrouter',
          apiKey: 'test-key',
          prompt: 'Hello',
          model: 'openai/gpt-oss-20b:free',
          temperature: 0.7,
          maxTokens: 1024,
          appName: 'Test App',
          referer: 'https://test.com',
        }),
      });

      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.text).toBe('Hello! How can I help you?');
      expect(json.raw).toEqual(mockResponse);

      // Verify the fetch call
      expect(global.fetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-key',
            'X-Title': 'Test App',
            'HTTP-Referer': 'https://test.com',
          }),
        }),
      );
    });
  });

  describe('Chutes provider', () => {
    test('should return 400 when API key is missing', async () => {
      const app = createTestApp();
      const req = new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'chutes',
          prompt: 'Hello',
        }),
      });

      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(400);
      expect(json.error).toContain('Missing API key for Chutes.ai provider');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('should make successful request to Chutes.ai API with default model and stream=false', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'Chutes response',
            },
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const app = createTestApp();
      const req = new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'chutes',
          apiKey: 'test-key',
          prompt: 'Hello',
        }),
      });

      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.text).toBe('Chutes response');
      expect(json.raw).toEqual(mockResponse);

      expect(global.fetch).toHaveBeenCalledWith(
        'https://llm.chutes.ai/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-key',
          }),
        }),
      );

      const [, init] = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body).toEqual({
        model: 'openai/gpt-oss-120b',
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0.7,
        max_tokens: 1024,
        stream: false,
      });
    });

    test('should honor model/temperature/maxTokens overrides', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'ok',
            },
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const app = createTestApp();
      const req = new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'chutes',
          apiKey: 'test-key',
          prompt: 'Hello',
          model: 'openai/gpt-4.1-mini',
          temperature: 0.12,
          maxTokens: 42,
        }),
      });

      const res = await app.request(req);
      expect(res.status).toBe(200);

      const [, init] = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body).toEqual({
        model: 'openai/gpt-4.1-mini',
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0.12,
        max_tokens: 42,
        stream: false,
      });
    });

    test('should format messages and prefer messages over prompt', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'ok',
            },
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const app = createTestApp();
      const req = new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'chutes',
          apiKey: 'test-key',
          system: 'You are helpful',
          prompt: 'This should be ignored',
          messages: [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi!' },
            { role: 'user', content: 'How are you?' },
          ],
        }),
      });

      const res = await app.request(req);
      expect(res.status).toBe(200);

      const [, init] = (global.fetch as any).mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.messages).toEqual([
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi!' },
        { role: 'user', content: 'How are you?' },
      ]);
    });

    test('should handle Chutes.ai upstream error', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      const app = createTestApp();
      const req = new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'chutes',
          apiKey: 'test-key',
          prompt: 'Hello',
        }),
      });

      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toContain('Chutes.ai error 401: Unauthorized');
    });

    test('should handle Chutes.ai JSON parse error', async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve('not json'),
      });

      const app = createTestApp();
      const req = new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'chutes',
          apiKey: 'test-key',
          prompt: 'Hello',
        }),
      });

      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json.error).toContain('Chutes.ai JSON parse error');
    });
  });

  describe('Messages handling', () => {
    test('should process messages array for Google provider', async () => {
      const mockResponse = {
        candidates: [
          {
            content: {
              parts: [{ text: 'Response text' }],
            },
          },
        ],
      };

      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(mockResponse)),
      });

      const app = createTestApp();
      const req = new Request('http://localhost/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          apiKey: 'test-key',
          messages: [
            { role: 'system', content: 'You are helpful' },
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi there!' },
            { role: 'user', content: 'How are you?' },
          ],
        }),
      });

      const res = await app.request(req);

      expect(res.status).toBe(200);

      // Verify that fetch was called with the expected request body
      const expectedBody = {
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Hello' }],
          },
          {
            role: 'model',
            parts: [{ text: 'Hi there!' }],
          },
          {
            role: 'user',
            parts: [{ text: 'How are you?' }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 1024,
        },
        systemInstruction: {
          role: 'system',
          parts: [{ text: 'You are helpful' }],
        },
      };

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('generativelanguage.googleapis.com'),
        expect.objectContaining({
          body: JSON.stringify(expectedBody),
        }),
      );
    });
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { llmChat } from '../../src/routes/llm-chat';
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

  // Mount the routes
  app.route('/', llmChat);

  return app;
}

describe('LLM Chat Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('CORS handling', () => {
    it('should handle OPTIONS request', async () => {
      const app = createTestApp();
      const req = new Request('http://localhost/', { method: 'OPTIONS' });
      const res = await app.request(req);

      expect(res.status).toBe(200);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(res.headers.get('Access-Control-Allow-Methods')).toBe('POST,OPTIONS');
    });
  });

  describe('Input validation', () => {
    it('should return 400 for invalid JSON', async () => {
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

    it('should return 400 for missing provider', async () => {
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

    it('should return 400 for missing prompt and messages', async () => {
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
    it('should return 400 when API key is missing (no server key)', async () => {
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

    it('should use server-side API key when available', async () => {
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

    it('should allow user key to override server key', async () => {
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
      const fetchCall = (global.fetch as any).mock.calls[0];
      expect(fetchCall[0]).toEqual(expect.stringContaining('generativelanguage.googleapis.com'));
      expect(fetchCall[1]).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-goog-api-key': 'user-key',
          }),
        }),
      );
    });

    it('should make successful request to Google API', async () => {
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

    it('should handle Google API error', async () => {
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
    it('should return 400 when API key is missing (no server key)', async () => {
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

    it('should use server-side API key when available', async () => {
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

    it('should allow user key to override server key', async () => {
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

    it('should make successful request to OpenRouter API', async () => {
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

  describe('Messages handling', () => {
    it('should process messages array for Google provider', async () => {
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

      // Verify that fetch was called
      expect(global.fetch).toHaveBeenCalled();
      const fetchCall = (global.fetch as any).mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);

      // Should have system instruction
      expect(requestBody.systemInstruction).toEqual({
        role: 'system',
        parts: [{ text: 'You are helpful' }],
      });

      // Should have user and model messages (excluding system)
      expect(requestBody.contents).toHaveLength(3);
      expect(requestBody.contents[0]).toEqual({
        role: 'user',
        parts: [{ text: 'Hello' }],
      });
      expect(requestBody.contents[1]).toEqual({
        role: 'model',
        parts: [{ text: 'Hi there!' }],
      });
    });
  });
});

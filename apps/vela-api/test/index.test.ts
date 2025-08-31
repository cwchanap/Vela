import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { llmChat } from '../src/routes/llm-chat';
import { chatHistory } from '../src/routes/chat-history';

// Create the same app structure as in src/index.ts for testing
function createApp() {
  const app = new Hono();

  app.get('/', (c) => {
    return c.text('Vela API - Hello Hono!');
  });

  // Mount the LLM chat routes
  app.route('/api/llm-chat', llmChat);

  // Mount the chat history routes
  app.route('/api/chat-history', chatHistory);

  return app;
}

describe('Main App', () => {
  describe('Root endpoint', () => {
    it('should return hello message', async () => {
      const app = createApp();
      const req = new Request('http://localhost/');

      const res = await app.request(req);
      const text = await res.text();

      expect(res.status).toBe(200);
      expect(text).toBe('Vela API - Hello Hono!');
      expect(res.headers.get('content-type')).toContain('text/plain');
    });
  });

  describe('Route mounting', () => {
    it('should mount LLM chat routes', async () => {
      const app = createApp();
      const req = new Request('http://localhost/api/llm-chat', { method: 'OPTIONS' });

      const res = await app.request(req);

      // Should handle CORS OPTIONS request
      expect(res.status).toBe(200);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    it('should mount chat history routes', async () => {
      const app = createApp();
      const req = new Request('http://localhost/api/chat-history', { method: 'OPTIONS' });

      const res = await app.request(req);

      // Should handle request (even if not implemented, it shouldn't 404)
      expect(res.status).not.toBe(404);
    });
  });

  describe('404 handling', () => {
    it('should return 404 for unknown routes', async () => {
      const app = createApp();
      const req = new Request('http://localhost/unknown-route');

      const res = await app.request(req);

      expect(res.status).toBe(404);
    });
  });
});

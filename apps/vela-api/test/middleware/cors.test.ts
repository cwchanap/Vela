import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { corsMiddleware } from '../../src/middleware/cors';
import type { Env } from '../../src/types';

// Create a test app with CORS middleware
function createTestApp(env: Env = {}) {
  const app = new Hono<{ Bindings: Env }>();

  // Add environment to context
  app.use('*', async (c, next) => {
    c.env = c.env || {};
    Object.assign(c.env, env);
    await next();
  });

  // Apply CORS middleware
  app.use('*', corsMiddleware);

  // Add test routes
  app.get('/test', (c) => c.json({ message: 'GET success' }));
  app.post('/test', (c) => c.json({ message: 'POST success' }));
  app.put('/test', (c) => c.json({ message: 'PUT success' }));
  app.delete('/test', (c) => c.json({ message: 'DELETE success' }));

  return app;
}

describe('CORS Middleware', () => {
  describe('OPTIONS preflight requests', () => {
    it('should handle OPTIONS request without Origin header', async () => {
      const app = createTestApp({
        CORS_ALLOWED_ORIGINS: 'http://localhost:9000',
      });
      const req = new Request('http://localhost/test', { method: 'OPTIONS' });
      const res = await app.request(req);

      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect(res.headers.get('Access-Control-Allow-Methods')).toBe(
        'GET, POST, PUT, DELETE, OPTIONS',
      );
      expect(res.headers.get('Access-Control-Allow-Headers')).toBe(
        'authorization, x-client-info, apikey, content-type',
      );
    });

    it('should handle OPTIONS request with allowed Origin', async () => {
      const app = createTestApp({
        CORS_ALLOWED_ORIGINS: 'http://localhost:9000,https://example.com',
      });
      const req = new Request('http://localhost/test', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:9000',
        },
      });
      const res = await app.request(req);

      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:9000');
      expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
      expect(res.headers.get('Access-Control-Allow-Methods')).toBe(
        'GET, POST, PUT, DELETE, OPTIONS',
      );
      expect(res.headers.get('Access-Control-Allow-Headers')).toBe(
        'authorization, x-client-info, apikey, content-type',
      );
    });

    it('should return 204 for OPTIONS request with disallowed Origin', async () => {
      const app = createTestApp({
        CORS_ALLOWED_ORIGINS: 'http://localhost:9000',
      });
      const req = new Request('http://localhost/test', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://malicious.example.com',
        },
      });
      const res = await app.request(req);

      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    });
  });

  describe('GET requests', () => {
    it('should allow GET request without Origin', async () => {
      const app = createTestApp({
        CORS_ALLOWED_ORIGINS: 'http://localhost:9000',
      });
      const req = new Request('http://localhost/test', { method: 'GET' });
      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.message).toBe('GET success');
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });

    it('should allow GET request with allowed Origin', async () => {
      const app = createTestApp({
        CORS_ALLOWED_ORIGINS: 'http://localhost:9000,https://example.com',
      });
      const req = new Request('http://localhost/test', {
        method: 'GET',
        headers: {
          Origin: 'https://example.com',
        },
      });
      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.message).toBe('GET success');
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
      expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    });

    it('should reject GET request with disallowed Origin', async () => {
      const app = createTestApp({
        CORS_ALLOWED_ORIGINS: 'http://localhost:9000',
      });
      const req = new Request('http://localhost/test', {
        method: 'GET',
        headers: {
          Origin: 'https://malicious.example.com',
        },
      });
      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error).toContain('CORS policy violation: Origin not allowed');
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });
  });

  describe('POST requests', () => {
    it('should allow POST request without Origin', async () => {
      const app = createTestApp({
        CORS_ALLOWED_ORIGINS: 'http://localhost:9000',
      });
      const req = new Request('http://localhost/test', { method: 'POST' });
      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.message).toBe('POST success');
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });

    it('should allow POST request with allowed Origin', async () => {
      const app = createTestApp({
        CORS_ALLOWED_ORIGINS: 'http://localhost:9000',
      });
      const req = new Request('http://localhost/test', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:9000',
        },
      });
      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.message).toBe('POST success');
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:9000');
      expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    });

    it('should reject POST request with disallowed Origin', async () => {
      const app = createTestApp({
        CORS_ALLOWED_ORIGINS: 'http://localhost:9000',
      });
      const req = new Request('http://localhost/test', {
        method: 'POST',
        headers: {
          Origin: 'https://malicious.example.com',
        },
      });
      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error).toContain('CORS policy violation: Origin not allowed');
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });
  });

  describe('PUT requests', () => {
    it('should allow PUT request with allowed Origin', async () => {
      const app = createTestApp({
        CORS_ALLOWED_ORIGINS: 'http://localhost:9000',
      });
      const req = new Request('http://localhost/test', {
        method: 'PUT',
        headers: {
          Origin: 'http://localhost:9000',
        },
      });
      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.message).toBe('PUT success');
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:9000');
    });

    it('should reject PUT request with disallowed Origin', async () => {
      const app = createTestApp({
        CORS_ALLOWED_ORIGINS: 'http://localhost:9000',
      });
      const req = new Request('http://localhost/test', {
        method: 'PUT',
        headers: {
          Origin: 'https://malicious.example.com',
        },
      });
      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error).toContain('CORS policy violation: Origin not allowed');
    });
  });

  describe('DELETE requests', () => {
    it('should allow DELETE request with allowed Origin', async () => {
      const app = createTestApp({
        CORS_ALLOWED_ORIGINS: 'http://localhost:9000',
      });
      const req = new Request('http://localhost/test', {
        method: 'DELETE',
        headers: {
          Origin: 'http://localhost:9000',
        },
      });
      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.message).toBe('DELETE success');
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:9000');
    });

    it('should reject DELETE request with disallowed Origin', async () => {
      const app = createTestApp({
        CORS_ALLOWED_ORIGINS: 'http://localhost:9000',
      });
      const req = new Request('http://localhost/test', {
        method: 'DELETE',
        headers: {
          Origin: 'https://malicious.example.com',
        },
      });
      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error).toContain('CORS policy violation: Origin not allowed');
    });
  });

  describe('Multiple allowed origins', () => {
    it('should allow requests from multiple allowed origins', async () => {
      const app = createTestApp({
        CORS_ALLOWED_ORIGINS: 'http://localhost:9000,http://127.0.0.1:9000,https://example.com',
      });

      const origins = ['http://localhost:9000', 'http://127.0.0.1:9000', 'https://example.com'];

      for (const origin of origins) {
        const req = new Request('http://localhost/test', {
          method: 'GET',
          headers: { Origin: origin },
        });
        const res = await app.request(req);
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.message).toBe('GET success');
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      }
    });

    it('should reject request from unlisted origin', async () => {
      const app = createTestApp({
        CORS_ALLOWED_ORIGINS: 'http://localhost:9000,http://127.0.0.1:9000',
      });
      const req = new Request('http://localhost/test', {
        method: 'GET',
        headers: {
          Origin: 'https://unlisted.com',
        },
      });
      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error).toContain('CORS policy violation: Origin not allowed');
    });
  });

  describe('Environment configuration', () => {
    it('should handle empty CORS_ALLOWED_ORIGINS', async () => {
      const app = createTestApp({
        CORS_ALLOWED_ORIGINS: '',
      });
      const req = new Request('http://localhost/test', {
        method: 'GET',
        headers: {
          Origin: 'http://localhost:9000',
        },
      });
      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error).toContain('CORS policy violation: Origin not allowed');
    });

    it('should handle undefined CORS_ALLOWED_ORIGINS', async () => {
      const app = createTestApp({});
      const req = new Request('http://localhost/test', {
        method: 'GET',
        headers: {
          Origin: 'http://localhost:9000',
        },
      });
      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(403);
      expect(json.error).toContain('CORS policy violation: Origin not allowed');
    });

    it('should handle whitespace in allowed origins', async () => {
      const app = createTestApp({
        CORS_ALLOWED_ORIGINS: '  http://localhost:9000  ,  https://example.com  ',
      });
      const req = new Request('http://localhost/test', {
        method: 'GET',
        headers: {
          Origin: 'http://localhost:9000',
        },
      });
      const res = await app.request(req);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.message).toBe('GET success');
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:9000');
    });
  });

  describe('Consistency between OPTIONS and POST', () => {
    it('should return same status code (403) for disallowed origin on POST and 204 on OPTIONS', async () => {
      const app = createTestApp({
        CORS_ALLOWED_ORIGINS: 'http://localhost:9000',
      });

      // OPTIONS should return 204 without CORS headers
      const optionsReq = new Request('http://localhost/test', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://malicious.example.com',
        },
      });
      const optionsRes = await app.request(optionsReq);

      expect(optionsRes.status).toBe(204);
      expect(optionsRes.headers.get('Access-Control-Allow-Origin')).toBeNull();

      // POST should return 403
      const postReq = new Request('http://localhost/test', {
        method: 'POST',
        headers: {
          Origin: 'https://malicious.example.com',
        },
      });
      const postRes = await app.request(postReq);
      const json = await postRes.json();

      expect(postRes.status).toBe(403);
      expect(json.error).toContain('CORS policy violation: Origin not allowed');
      expect(postRes.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });
  });
});

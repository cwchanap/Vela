import { describe, test, expect } from 'bun:test';
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
    test('should handle OPTIONS request without Origin header', async () => {
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

    test('should handle OPTIONS request with allowed Origin', async () => {
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

    test('should return 204 for OPTIONS request with disallowed Origin', async () => {
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
    test('should allow GET request without Origin', async () => {
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

    test('should allow GET request with allowed Origin', async () => {
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

    test('should reject GET request with disallowed Origin', async () => {
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
    test('should allow POST request without Origin', async () => {
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

    test('should allow POST request with allowed Origin', async () => {
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

    test('should reject POST request with disallowed Origin', async () => {
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
    test('should allow PUT request with allowed Origin', async () => {
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

    test('should reject PUT request with disallowed Origin', async () => {
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
    test('should allow DELETE request with allowed Origin', async () => {
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

    test('should reject DELETE request with disallowed Origin', async () => {
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
    test('should allow requests from multiple allowed origins', async () => {
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

    test('should reject request from unlisted origin', async () => {
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
    test('should handle empty CORS_ALLOWED_ORIGINS', async () => {
      // Clear any cached process.env values
      delete process.env.CORS_ALLOWED_ORIGINS;

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

    test('should handle undefined CORS_ALLOWED_ORIGINS', async () => {
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

    test('should handle whitespace in allowed origins', async () => {
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

    test('should fallback to process.env.CORS_ALLOWED_ORIGINS when c.env is not available', async () => {
      // Set process.env for this test
      const originalEnv = process.env.CORS_ALLOWED_ORIGINS;
      process.env.CORS_ALLOWED_ORIGINS = 'http://fallback-origin.com';

      try {
        // Create app without c.env set (simulating production before env injection)
        const app = new Hono<{ Bindings: Env }>();
        app.use('*', corsMiddleware);
        app.get('/test', (c) => c.json({ message: 'GET success' }));

        const req = new Request('http://localhost/test', {
          method: 'GET',
          headers: {
            Origin: 'http://fallback-origin.com',
          },
        });
        const res = await app.request(req);
        const json = await res.json();

        expect(res.status).toBe(200);
        expect(json.message).toBe('GET success');
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://fallback-origin.com');
      } finally {
        // Restore original env
        if (originalEnv !== undefined) {
          process.env.CORS_ALLOWED_ORIGINS = originalEnv;
        } else {
          delete process.env.CORS_ALLOWED_ORIGINS;
        }
      }
    });
  });

  describe('Consistency between OPTIONS and POST', () => {
    test('should return same status code (403) for disallowed origin on POST and 204 on OPTIONS', async () => {
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

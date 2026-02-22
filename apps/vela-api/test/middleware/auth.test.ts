import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { Hono } from 'hono';

// Mock aws-jwt-verify before importing auth
const mockVerify = mock(() => Promise.resolve({ sub: 'user-123', email: 'user@example.com' }));
const mockCreate = mock(() => ({ verify: mockVerify }));

mock.module('aws-jwt-verify', () => ({
  CognitoJwtVerifier: { create: mockCreate },
}));

// Import AFTER mocking so the module uses the mocked CognitoJwtVerifier
const { requireAuth, initializeAuthVerifier } = await import('../../src/middleware/auth');

function createTestApp() {
  const app = new Hono();
  app.use('*', requireAuth as any);
  app.get('/test', (c) =>
    c.json({ userId: c.get('userId' as any), userEmail: c.get('userEmail' as any) }),
  );
  return app;
}

describe('requireAuth middleware', () => {
  beforeEach(() => {
    mockVerify.mockClear();
    // Ensure verifier is initialized so the token verification path is exercised
    initializeAuthVerifier('us-east-1_test', 'test-client-id');
  });

  test('returns 401 when Authorization header is missing', async () => {
    const app = createTestApp();
    const res = await app.request('/test');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Missing or invalid Authorization header');
  });

  test('returns 401 when Authorization header does not start with Bearer', async () => {
    const app = createTestApp();
    const res = await app.request('/test', {
      headers: { Authorization: 'Basic abc123' },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Missing or invalid Authorization header');
  });

  test('returns 401 when token verification fails', async () => {
    // Suppress the expected console.error from the middleware
    const originalConsoleError = console.error;
    console.error = () => {};

    try {
      mockVerify.mockImplementationOnce(() => Promise.reject(new Error('Token expired')));
      const app = createTestApp();
      const res = await app.request('/test', {
        headers: { Authorization: 'Bearer invalid-token' },
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Invalid or expired token');
    } finally {
      console.error = originalConsoleError;
    }
  });

  test('sets userId and userEmail in context on valid token', async () => {
    const app = createTestApp();
    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer valid-token' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string; userEmail: string };
    expect(body.userId).toBe('user-123');
    expect(body.userEmail).toBe('user@example.com');
  });

  test('sets userEmail to null when email claim is not a string', async () => {
    mockVerify.mockImplementationOnce(() => Promise.resolve({ sub: 'user-456', email: 12345 }));
    const app = createTestApp();
    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer valid-token' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { userId: string; userEmail: null };
    expect(body.userId).toBe('user-456');
    expect(body.userEmail).toBeNull();
  });

  test('returns 401 when verifier returns null (verify throws)', async () => {
    // Suppress the expected console.error from the middleware
    const originalConsoleError = console.error;
    console.error = () => {};

    try {
      // Simulates any scenario where getUserClaimsFromToken returns null
      mockVerify.mockImplementationOnce(() => Promise.reject(new Error('Invalid signature')));
      const app = createTestApp();
      const res = await app.request('/test', {
        headers: { Authorization: 'Bearer malformed-token' },
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Invalid or expired token');
    } finally {
      console.error = originalConsoleError;
    }
  });

  test('calls verifier with the extracted token (without Bearer prefix)', async () => {
    const app = createTestApp();
    await app.request('/test', {
      headers: { Authorization: 'Bearer my-actual-token' },
    });
    expect(mockVerify).toHaveBeenCalledTimes(1);
    expect(mockVerify).toHaveBeenCalledWith('my-actual-token');
  });
});

describe('initializeAuthVerifier', () => {
  test('does not throw with valid config', () => {
    expect(() => initializeAuthVerifier('us-east-1_test', 'client-id')).not.toThrow();
  });

  test('warns and returns without throwing when userPoolId is missing', () => {
    const originalConsoleWarn = console.warn;
    const warnMessages: string[] = [];
    console.warn = (msg: string) => warnMessages.push(msg);

    try {
      expect(() => initializeAuthVerifier('', 'client-id')).not.toThrow();
      expect(warnMessages.some((m) => m.includes('Cognito configuration missing'))).toBe(true);
    } finally {
      console.warn = originalConsoleWarn;
    }
  });

  test('warns and returns without throwing when clientId is missing', () => {
    const originalConsoleWarn = console.warn;
    const warnMessages: string[] = [];
    console.warn = (msg: string) => warnMessages.push(msg);

    try {
      expect(() => initializeAuthVerifier('us-east-1_test', '')).not.toThrow();
      expect(warnMessages.some((m) => m.includes('Cognito configuration missing'))).toBe(true);
    } finally {
      console.warn = originalConsoleWarn;
    }
  });

  test('warns and returns without throwing when both args are missing', () => {
    const originalConsoleWarn = console.warn;
    const warnMessages: string[] = [];
    console.warn = (msg: string) => warnMessages.push(msg);

    try {
      expect(() => initializeAuthVerifier('', '')).not.toThrow();
      expect(warnMessages.some((m) => m.includes('Cognito configuration missing'))).toBe(true);
    } finally {
      console.warn = originalConsoleWarn;
    }
  });
});

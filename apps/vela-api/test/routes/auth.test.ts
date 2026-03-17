import { describe, test, expect, beforeEach, vi } from 'bun:test';
import { Hono } from 'hono';
import type { Env } from '../../src/types';
import type { Context, Next } from 'hono';

// Mock Cognito client
const mockCognitoSend = vi.fn();

vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: vi.fn(() => ({ send: mockCognitoSend })),
  AdminConfirmSignUpCommand: vi.fn((params: object) => ({
    ...params,
    __type: 'AdminConfirmSignUpCommand',
  })),
  ListUsersCommand: vi.fn((params: object) => ({ ...params, __type: 'ListUsersCommand' })),
  InitiateAuthCommand: vi.fn((params: object) => ({ ...params, __type: 'InitiateAuthCommand' })),
  AdminUserGlobalSignOutCommand: vi.fn((params: object) => ({
    ...params,
    __type: 'AdminUserGlobalSignOutCommand',
  })),
  GetUserCommand: vi.fn((params: object) => ({ ...params, __type: 'GetUserCommand' })),
}));

vi.mock('../../src/middleware/auth', () => ({
  requireAuth: async (_c: Context, next: Next) => {
    _c.set('userId', 'test-user');
    _c.set('userEmail', 'user@example.com');
    await next();
  },
  AuthContext: {},
}));

// Import AFTER mocks are declared
const authApp = (await import('../../src/routes/auth')).default;

function createTestApp(env: Partial<Env> = {}) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    c.env = (c.env || {}) as Env;
    Object.assign(c.env, env);
    await next();
  });
  app.route('/', authApp);
  return app;
}

describe('Auth Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VITE_COGNITO_USER_POOL_ID = 'us-east-1_test123';
    process.env.VITE_COGNITO_USER_POOL_CLIENT_ID = 'test-client-id';
    process.env.COGNITO_CLIENT_ID = 'test-client-id';
  });

  describe('POST /refresh', () => {
    test('returns 400 when refreshToken is missing', async () => {
      const app = createTestApp({ VITE_COGNITO_USER_POOL_ID: 'us-east-1_test123' });
      const res = await app.request('/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Refresh token is required');
    });

    test('returns tokens on successful refresh', async () => {
      mockCognitoSend.mockResolvedValueOnce({
        AuthenticationResult: {
          AccessToken: 'new-access-token',
          IdToken: 'new-id-token',
        },
      });

      const app = createTestApp({ VITE_COGNITO_USER_POOL_ID: 'us-east-1_test123' });
      const res = await app.request('/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: 'old-refresh-token' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        tokens: { accessToken: string; refreshToken: string };
      };
      expect(body.success).toBe(true);
      expect(body.tokens.accessToken).toBe('new-access-token');
      expect(body.tokens.refreshToken).toBe('old-refresh-token');
    });

    test('returns 401 when AuthenticationResult is missing', async () => {
      mockCognitoSend.mockResolvedValueOnce({});

      const app = createTestApp({ VITE_COGNITO_USER_POOL_ID: 'us-east-1_test123' });
      const res = await app.request('/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: 'bad-token' }),
      });
      expect(res.status).toBe(401);
    });

    test('returns 401 on NotAuthorizedException', async () => {
      const err = new Error('Invalid refresh token');
      (err as any).name = 'NotAuthorizedException';
      mockCognitoSend.mockRejectedValueOnce(err);

      const app = createTestApp({ VITE_COGNITO_USER_POOL_ID: 'us-east-1_test123' });
      const res = await app.request('/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: 'expired-token' }),
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Invalid or expired refresh token');
    });

    test('returns 500 on generic error', async () => {
      mockCognitoSend.mockRejectedValueOnce(new Error('Network error'));

      const app = createTestApp({ VITE_COGNITO_USER_POOL_ID: 'us-east-1_test123' });
      const res = await app.request('/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: 'some-token' }),
      });
      expect(res.status).toBe(500);
    });
  });

  describe('POST /signout', () => {
    test('returns success when no authorization header', async () => {
      const app = createTestApp({ VITE_COGNITO_USER_POOL_ID: 'us-east-1_test123' });
      const res = await app.request('/signout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);
    });

    test('performs global sign out with valid bearer token', async () => {
      mockCognitoSend
        .mockResolvedValueOnce({ Username: 'test-username' }) // GetUserCommand
        .mockResolvedValueOnce({}); // AdminUserGlobalSignOutCommand

      const app = createTestApp({ VITE_COGNITO_USER_POOL_ID: 'us-east-1_test123' });
      const res = await app.request('/signout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-access-token',
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);
    });

    test('still returns success when global sign out fails', async () => {
      mockCognitoSend.mockRejectedValueOnce(new Error('Cognito error'));

      const app = createTestApp({ VITE_COGNITO_USER_POOL_ID: 'us-east-1_test123' });
      const res = await app.request('/signout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer some-token',
        },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
    });
  });

  describe('GET /session', () => {
    test('returns authenticated user info', async () => {
      const app = createTestApp({ VITE_COGNITO_USER_POOL_ID: 'us-east-1_test123' });
      const res = await app.request('/session');
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        authenticated: boolean;
        user: { userId: string; email: string };
      };
      expect(body.authenticated).toBe(true);
      expect(body.user.userId).toBe('test-user');
    });
  });

  describe('POST /signin', () => {
    test('returns 400 when email or password missing', async () => {
      const app = createTestApp({ VITE_COGNITO_USER_POOL_ID: 'us-east-1_test123' });
      const res = await app.request('/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@example.com' }),
      });
      expect(res.status).toBe(400);
    });

    test('returns tokens on successful sign in', async () => {
      mockCognitoSend.mockResolvedValueOnce({
        AuthenticationResult: {
          AccessToken: 'access-token',
          RefreshToken: 'refresh-token',
          IdToken: 'id-token',
        },
      });

      const app = createTestApp({ VITE_COGNITO_USER_POOL_ID: 'us-east-1_test123' });
      const res = await app.request('/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'user@example.com', password: 'password123' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; tokens: object };
      expect(body.success).toBe(true);
      expect(body.tokens).toBeDefined();
    });

    test('returns 401 on NotAuthorizedException', async () => {
      const err = new Error('Wrong password');
      (err as any).name = 'NotAuthorizedException';
      mockCognitoSend.mockRejectedValueOnce(err);

      const app = createTestApp({ VITE_COGNITO_USER_POOL_ID: 'us-east-1_test123' });
      const res = await app.request('/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'user@example.com', password: 'wrong' }),
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Invalid email or password');
    });

    test('returns 401 on UserNotConfirmedException', async () => {
      const err = new Error('User not confirmed');
      (err as any).name = 'UserNotConfirmedException';
      mockCognitoSend.mockRejectedValueOnce(err);

      const app = createTestApp({ VITE_COGNITO_USER_POOL_ID: 'us-east-1_test123' });
      const res = await app.request('/signin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'user@example.com', password: 'pass' }),
      });
      expect(res.status).toBe(401);
    });
  });
});

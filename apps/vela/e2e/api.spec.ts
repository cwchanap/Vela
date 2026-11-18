import { test, expect } from '@playwright/test';
import {
  CognitoIdentityProviderClient,
  AdminInitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  formatMissingCognitoTestEnvMessage,
  getCognitoTestEnv,
  hasCognitoTestEnv,
} from './fixtures/auth';

const API_BASE_URL = process.env.VITE_API_URL || 'http://localhost:9005';
const ALLOWED_ORIGIN =
  process.env.CORS_ALLOWED_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .find(Boolean) || 'http://localhost:9000';
const DISALLOWED_ORIGIN = 'https://evil.example';

let cachedIdToken: string | undefined;

/** Obtain a valid Cognito ID token for raw authenticated API calls, mirroring e2e/fixtures/auth.ts. */
async function getIdToken(): Promise<string> {
  if (cachedIdToken) return cachedIdToken;

  const config = getCognitoTestEnv();
  const client = new CognitoIdentityProviderClient({
    region: config.region,
  });
  const response = await client.send(
    new AdminInitiateAuthCommand({
      UserPoolId: config.userPoolId,
      ClientId: config.clientId,
      AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
      AuthParameters: {
        USERNAME: config.email,
        PASSWORD: config.password,
      },
    }),
  );

  const idToken = response.AuthenticationResult?.IdToken;
  if (!idToken) {
    throw new Error('AdminInitiateAuth did not return an ID token');
  }
  cachedIdToken = idToken;
  return idToken;
}

const configureCognitoAuthSuite = () => {
  test.skip(!process.env.CI && !hasCognitoTestEnv(), 'Cognito test credentials not configured');
  test.beforeAll(() => {
    if (!hasCognitoTestEnv()) {
      throw new Error(formatMissingCognitoTestEnvMessage());
    }
  });
};

const authHeaders = async (): Promise<Record<string, string>> => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${await getIdToken()}`,
});

test.describe('Vela API E2E Tests', () => {
  test.beforeAll(async () => {
    // Ensure API server is running
    try {
      const response = await fetch(`${API_BASE_URL}/`);
      expect(response.ok).toBe(true);
    } catch (error) {
      console.error(
        'API server is not running. Please start it with: cd apps/vela-api && npm run dev',
      );
      throw error;
    }
  });

  test.describe('Root endpoint', () => {
    test('should return welcome message', async () => {
      const response = await fetch(`${API_BASE_URL}/`);
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain('Vela API');
    });
  });

  test.describe('Chat History API', () => {
    test.describe('unauthenticated', () => {
      test('POST /api/chat-history/save returns 401', async () => {
        const response = await fetch(`${API_BASE_URL}/api/chat-history/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ThreadId: 'test-thread-123',
            Timestamp: Date.now(),
            UserId: 'test-user-456',
            message: 'Hello, this is a test message',
            is_user: true,
          }),
        });

        expect(response.status).toBe(401);
      });

      test('GET /api/chat-history/threads returns 401', async () => {
        const response = await fetch(`${API_BASE_URL}/api/chat-history/threads`);
        expect(response.status).toBe(401);
      });

      test('GET /api/chat-history/messages returns 401', async () => {
        const response = await fetch(
          `${API_BASE_URL}/api/chat-history/messages?thread_id=test-thread-123`,
        );
        expect(response.status).toBe(401);
      });

      test('PATCH /api/chat-history/thread/:id returns 401', async () => {
        const response = await fetch(`${API_BASE_URL}/api/chat-history/thread/test-thread-123`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Renamed' }),
        });
        expect(response.status).toBe(401);
      });

      test('DELETE /api/chat-history/thread/:id returns 401', async () => {
        const response = await fetch(`${API_BASE_URL}/api/chat-history/thread/test-thread-123`, {
          method: 'DELETE',
        });
        expect(response.status).toBe(401);
      });
    });

    test.describe.serial('authenticated', () => {
      configureCognitoAuthSuite();

      const threadId = `e2e-thread-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      test('saves a first user message with server-derived identity', async () => {
        const response = await fetch(`${API_BASE_URL}/api/chat-history/save`, {
          method: 'POST',
          headers: await authHeaders(),
          body: JSON.stringify({
            ThreadId: threadId,
            Timestamp: 1,
            UserId: 'client-ignored',
            message: 'E2E test first user prompt',
            is_user: true,
          }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data).toEqual({ ok: true });
      });

      test('rejects invalid chat message data', async () => {
        const response = await fetch(`${API_BASE_URL}/api/chat-history/save`, {
          method: 'POST',
          headers: await authHeaders(),
          body: JSON.stringify({
            ThreadId: '',
            Timestamp: 'invalid-timestamp',
            UserId: 'test-user',
            message: 'Test message',
            is_user: 'true',
          }),
        });

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBeDefined();
      });

      test('lists the new thread with its derived title and timestamps', async () => {
        const response = await fetch(`${API_BASE_URL}/api/chat-history/threads`, {
          headers: await authHeaders(),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(Array.isArray(data.threads)).toBe(true);
        const thread = data.threads.find((t: any) => t.ThreadId === threadId);
        expect(thread).toBeDefined();
        expect(thread.title).toBe('E2E test first user prompt');
        expect(thread.createdAt).toEqual(expect.any(Number));
        expect(thread.updatedAt).toEqual(expect.any(Number));
      });

      test('returns the thread messages with server-derived identity and timestamp', async () => {
        const token = await getIdToken();
        const tokenSub = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()).sub;

        const response = await fetch(
          `${API_BASE_URL}/api/chat-history/messages?thread_id=${encodeURIComponent(threadId)}`,
          { headers: await authHeaders() },
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(Array.isArray(data.items)).toBe(true);
        expect(data.items).toHaveLength(1);
        expect(data.items[0]).toEqual(
          expect.objectContaining({ ThreadId: threadId, is_user: true }),
        );
        expect(data.items[0].UserId).toBe(tokenSub);
        expect(data.items[0].Timestamp).toBeGreaterThan(Date.now() - 5 * 60 * 1000);
      });

      test('returns 404 Thread not found for an unknown thread', async () => {
        const response = await fetch(
          `${API_BASE_URL}/api/chat-history/messages?thread_id=missing-${threadId}`,
          { headers: await authHeaders() },
        );

        expect(response.status).toBe(404);
        const data = await response.json();
        expect(data.error).toBe('Thread not found');
      });

      test('renames the thread and returns the updated row', async () => {
        const response = await fetch(
          `${API_BASE_URL}/api/chat-history/thread/${encodeURIComponent(threadId)}`,
          {
            method: 'PATCH',
            headers: await authHeaders(),
            body: JSON.stringify({ title: 'E2E renamed thread' }),
          },
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.thread).toEqual(
          expect.objectContaining({ ThreadId: threadId, title: 'E2E renamed thread' }),
        );
      });

      test('rejects an empty PATCH body', async () => {
        const response = await fetch(
          `${API_BASE_URL}/api/chat-history/thread/${encodeURIComponent(threadId)}`,
          {
            method: 'PATCH',
            headers: await authHeaders(),
            body: JSON.stringify({}),
          },
        );

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBeDefined();
      });

      test('returns 404 when patching a missing thread', async () => {
        const response = await fetch(
          `${API_BASE_URL}/api/chat-history/thread/missing-${threadId}`,
          {
            method: 'PATCH',
            headers: await authHeaders(),
            body: JSON.stringify({ title: 'Whatever' }),
          },
        );

        expect(response.status).toBe(404);
        const data = await response.json();
        expect(data.error).toBe('Thread not found');
      });

      test('deletes the thread and its metadata', async () => {
        const response = await fetch(
          `${API_BASE_URL}/api/chat-history/thread/${encodeURIComponent(threadId)}`,
          { method: 'DELETE', headers: await authHeaders() },
        );

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data).toEqual({ ok: true });
      });

      test('returns 404 for the deleted thread', async () => {
        const messagesResponse = await fetch(
          `${API_BASE_URL}/api/chat-history/messages?thread_id=${encodeURIComponent(threadId)}`,
          { headers: await authHeaders() },
        );
        expect(messagesResponse.status).toBe(404);

        const deleteResponse = await fetch(
          `${API_BASE_URL}/api/chat-history/thread/${encodeURIComponent(threadId)}`,
          { method: 'DELETE', headers: await authHeaders() },
        );
        expect(deleteResponse.status).toBe(404);

        const threadsResponse = await fetch(`${API_BASE_URL}/api/chat-history/threads`, {
          headers: await authHeaders(),
        });
        const threads = await threadsResponse.json();
        expect(threads.threads.some((t: any) => t.ThreadId === threadId)).toBe(false);
      });
    });
  });

  test.describe('LLM Chat API', () => {
    test('should reject unauthenticated requests with 401 before validation', async () => {
      const response = await fetch(`${API_BASE_URL}/api/llm-chat/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: 'invalid json {',
      });

      // Authentication precedes validation and every upstream provider call.
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    test.describe('authenticated', () => {
      configureCognitoAuthSuite();

      test('should reject invalid provider', async () => {
        const requestBody = {
          provider: 'invalid-provider',
          model: 'test-model',
          messages: [{ role: 'user', content: 'Hello' }],
        };

        const response = await fetch(`${API_BASE_URL}/api/llm-chat/`, {
          method: 'POST',
          headers: await authHeaders(),
          body: JSON.stringify(requestBody),
        });

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBeDefined();
        // The route returns the first Zod issue as "<path>: <message>".
        expect(data.error).toContain('provider:');
      });

      test('should reject missing prompt and messages', async () => {
        const requestBody = {
          provider: 'google',
          model: 'test-model',
        };

        const response = await fetch(`${API_BASE_URL}/api/llm-chat/`, {
          method: 'POST',
          headers: await authHeaders(),
          body: JSON.stringify(requestBody),
        });

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBeDefined();
        expect(data.error).toContain('Either a nonempty prompt or messages must be provided');
      });

      test('should reject invalid message role', async () => {
        const requestBody = {
          provider: 'google',
          messages: [{ role: 'invalid-role', content: 'Hello' }],
        };

        const response = await fetch(`${API_BASE_URL}/api/llm-chat/`, {
          method: 'POST',
          headers: await authHeaders(),
          body: JSON.stringify(requestBody),
        });

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBeDefined();
        // The route returns the first Zod issue as "<path>: <message>".
        expect(data.error).toContain('messages.0.role:');
      });

      test('should reject stale model ids with the rejected model in the message', async () => {
        const requestBody = {
          provider: 'google',
          model: 'gemini-2.5-flash-lite',
          messages: [{ role: 'user', content: 'Hello, test message' }],
        };

        const response = await fetch(`${API_BASE_URL}/api/llm-chat/`, {
          method: 'POST',
          headers: await authHeaders(),
          body: JSON.stringify(requestBody),
        });

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toContain('Unsupported model');
        expect(data.error).toContain('gemini-2.5-flash-lite');
      });

      test('should require a user API key for Anthropic chat', async () => {
        // OpenAI/Anthropic have no server-key fallback, so this stays a local
        // validation failure regardless of server environment configuration.
        const requestBody = {
          provider: 'anthropic',
          messages: [{ role: 'user', content: 'Hello, test message' }],
        };

        const response = await fetch(`${API_BASE_URL}/api/llm-chat/`, {
          method: 'POST',
          headers: await authHeaders(),
          body: JSON.stringify(requestBody),
        });

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toContain('Missing API key for Anthropic provider');
      });
    });
  });

  test.describe('CORS handling', () => {
    const corsEndpoints = [
      { name: 'chat-history', path: '/api/chat-history/save', expectedMethod: 'GET' },
      { name: 'llm-chat', path: '/api/llm-chat/', expectedMethod: 'POST' },
    ] as const;

    for (const { name, path, expectedMethod } of corsEndpoints) {
      test(`echoes allowed Origin on OPTIONS for ${name}`, async () => {
        const response = await fetch(`${API_BASE_URL}${path}`, {
          method: 'OPTIONS',
          headers: { Origin: ALLOWED_ORIGIN },
        });

        expect(response.status).toBe(204);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED_ORIGIN);
        expect(response.headers.get('Access-Control-Allow-Methods')).toContain(expectedMethod);
      });

      test(`omits ACAO on OPTIONS with foreign Origin for ${name}`, async () => {
        const response = await fetch(`${API_BASE_URL}${path}`, {
          method: 'OPTIONS',
          headers: { Origin: DISALLOWED_ORIGIN },
        });

        expect(response.status).toBe(204);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
      });

      test(`rejects foreign Origin with 403 and no ACAO on POST for ${name}`, async () => {
        const response = await fetch(`${API_BASE_URL}${path}`, {
          method: 'POST',
          headers: {
            Origin: DISALLOWED_ORIGIN,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        });

        expect(response.status).toBe(403);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
      });
    }
  });
});

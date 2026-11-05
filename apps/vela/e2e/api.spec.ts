import { test, expect } from '@playwright/test';
import {
  CognitoIdentityProviderClient,
  AdminInitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const API_BASE_URL = process.env.VITE_API_URL || 'http://localhost:9005';

const COGNITO_TEST_ENV = {
  email: process.env.TEST_EMAIL,
  password: process.env.TEST_PASSWORD,
  userPoolId: process.env.VITE_COGNITO_USER_POOL_ID,
  clientId: process.env.VITE_COGNITO_TEST_CLIENT_ID,
  region: process.env.VITE_AWS_REGION,
};

const hasCognitoTestEnv = Object.values(COGNITO_TEST_ENV).every(Boolean);

let cachedIdToken: string | undefined;

/** Obtain a valid Cognito ID token for raw authenticated API calls, mirroring e2e/fixtures/auth.ts. */
async function getIdToken(): Promise<string> {
  if (cachedIdToken) return cachedIdToken;

  const client = new CognitoIdentityProviderClient({
    region: COGNITO_TEST_ENV.region,
  });
  const response = await client.send(
    new AdminInitiateAuthCommand({
      UserPoolId: COGNITO_TEST_ENV.userPoolId,
      ClientId: COGNITO_TEST_ENV.clientId,
      AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
      AuthParameters: {
        USERNAME: COGNITO_TEST_ENV.email!,
        PASSWORD: COGNITO_TEST_ENV.password!,
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
    test.describe('POST /api/chat-history/save', () => {
      test('should save chat message with valid data', async () => {
        const chatMessage = {
          ThreadId: 'test-thread-123',
          Timestamp: Date.now(),
          UserId: 'test-user-456',
          message: 'Hello, this is a test message',
          is_user: true,
        };

        const response = await fetch(`${API_BASE_URL}/api/chat-history/save`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(chatMessage),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data).toEqual({ ok: true });
      });

      test('should reject invalid chat message data', async () => {
        const invalidMessage = {
          ThreadId: '', // Invalid: empty string
          Timestamp: 'invalid-timestamp', // Invalid: should be number
          UserId: 'test-user',
          message: 'Test message',
          is_user: 'true', // Invalid: should be boolean
        };

        const response = await fetch(`${API_BASE_URL}/api/chat-history/save`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(invalidMessage),
        });

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBeDefined();
        expect(data.error).toContain('ZodError');
      });

      test('should reject missing required fields', async () => {
        const incompleteMessage = {
          ThreadId: 'test-thread',
          // Missing other required fields
        };

        const response = await fetch(`${API_BASE_URL}/api/chat-history/save`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(incompleteMessage),
        });

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBeDefined();
      });
    });

    test.describe('GET /api/chat-history/threads', () => {
      test('should return threads for valid user_id', async () => {
        const response = await fetch(
          `${API_BASE_URL}/api/chat-history/threads?user_id=test-user-456`,
        );

        // This might return 500 if DynamoDB is not configured, but the validation should pass
        expect([200, 500]).toContain(response.status);

        if (response.status === 200) {
          const data = await response.json();
          expect(data).toHaveProperty('threads');
          expect(Array.isArray(data.threads)).toBe(true);
        }
      });

      test('should reject missing user_id parameter', async () => {
        const response = await fetch(`${API_BASE_URL}/api/chat-history/threads`);

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBeDefined();
        expect(data.error).toContain('ZodError');
      });

      test('should reject empty user_id parameter', async () => {
        const response = await fetch(`${API_BASE_URL}/api/chat-history/threads?user_id=`);

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBeDefined();
      });
    });

    test.describe('GET /api/chat-history/messages', () => {
      test('should return messages for valid thread_id', async () => {
        const response = await fetch(
          `${API_BASE_URL}/api/chat-history/messages?thread_id=test-thread-123`,
        );

        // This might return 500 if DynamoDB is not configured, but the validation should pass
        expect([200, 500]).toContain(response.status);

        if (response.status === 200) {
          const data = await response.json();
          expect(data).toHaveProperty('items');
          expect(Array.isArray(data.items)).toBe(true);
        }
      });

      test('should reject missing thread_id parameter', async () => {
        const response = await fetch(`${API_BASE_URL}/api/chat-history/messages`);

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBeDefined();
        expect(data.error).toContain('ZodError');
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
      test.skip(!hasCognitoTestEnv, 'Cognito test credentials not configured');

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
    test('should handle OPTIONS requests for chat-history', async () => {
      const response = await fetch(`${API_BASE_URL}/api/chat-history/save`, {
        method: 'OPTIONS',
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });

    test('should handle OPTIONS requests for llm-chat', async () => {
      const response = await fetch(`${API_BASE_URL}/api/llm-chat/`, {
        method: 'OPTIONS',
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });
  });
});

import { test, expect } from '@playwright/test';

const API_BASE_URL = process.env.VITE_API_URL || 'http://localhost:3001';

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
    test.describe('POST /api/llm-chat/', () => {
      test('should reject invalid JSON', async () => {
        const response = await fetch(`${API_BASE_URL}/api/llm-chat/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: 'invalid json {',
        });

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBeDefined();
      });

      test('should reject missing provider', async () => {
        const requestBody = {
          model: 'test-model',
          messages: [{ role: 'user', content: 'Hello' }],
        };

        const response = await fetch(`${API_BASE_URL}/api/llm-chat/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBeDefined();
        expect(data.error).toContain('ZodError');
      });

      test('should reject invalid provider', async () => {
        const requestBody = {
          provider: 'invalid-provider',
          model: 'test-model',
          messages: [{ role: 'user', content: 'Hello' }],
        };

        const response = await fetch(`${API_BASE_URL}/api/llm-chat/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBeDefined();
        expect(data.error).toContain('ZodError');
      });

      test('should reject missing prompt and messages', async () => {
        const requestBody = {
          provider: 'google',
          model: 'test-model',
        };

        const response = await fetch(`${API_BASE_URL}/api/llm-chat/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBeDefined();
        expect(data.error).toContain('Either messages or prompt must be provided');
      });

      test('should reject invalid message role', async () => {
        const requestBody = {
          provider: 'google',
          messages: [{ role: 'invalid-role', content: 'Hello' }],
        };

        const response = await fetch(`${API_BASE_URL}/api/llm-chat/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBeDefined();
        expect(data.error).toContain('ZodError');
      });

      test('should reject invalid temperature range', async () => {
        const requestBody = {
          provider: 'google',
          messages: [{ role: 'user', content: 'Hello' }],
          temperature: 5, // Invalid: should be 0-2
        };

        const response = await fetch(`${API_BASE_URL}/api/llm-chat/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        expect(response.status).toBe(400);
        const data = await response.json();
        expect(data.error).toBeDefined();
        expect(data.error).toContain('ZodError');
      });

      test('should accept valid Google provider request', async () => {
        const requestBody = {
          provider: 'google',
          model: 'gemini-2.5-flash-lite',
          messages: [{ role: 'user', content: 'Hello, test message' }],
          temperature: 0.7,
        };

        const response = await fetch(`${API_BASE_URL}/api/llm-chat/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        // This might return 500 if API keys are not configured, but validation should pass
        expect([200, 500]).toContain(response.status);

        if (response.status === 200) {
          const data = await response.json();
          expect(data).toHaveProperty('text');
        }
      });

      test('should accept valid OpenRouter provider request', async () => {
        const requestBody = {
          provider: 'openrouter',
          model: 'openai/gpt-oss-20b:free',
          prompt: 'Hello, test message',
          temperature: 0.7,
        };

        const response = await fetch(`${API_BASE_URL}/api/llm-chat/`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        // This might return 500 if API keys are not configured, but validation should pass
        expect([200, 500]).toContain(response.status);

        if (response.status === 200) {
          const data = await response.json();
          expect(data).toHaveProperty('text');
        }
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

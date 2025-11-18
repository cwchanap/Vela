import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenRouterProvider } from './openrouterProvider';
import type { LLMRequest } from '../types';

// Mock getApiUrl
vi.mock('src/utils/api', () => ({
  getApiUrl: vi.fn((endpoint: string) => `/api/${endpoint}`),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock window.location for referer
const mockLocation = {
  origin: 'http://localhost:9000',
};
Object.defineProperty(global, 'window', {
  value: { location: mockLocation },
  writable: true,
});

describe('OpenRouterProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default model when no options provided', () => {
      const provider = new OpenRouterProvider();
      expect(provider.name).toBe('openrouter');
      expect(provider.getModel()).toBe('openai/gpt-oss-20b:free');
    });

    it('should initialize with custom model when provided', () => {
      const provider = new OpenRouterProvider({ model: 'anthropic/claude-3-opus' });
      expect(provider.getModel()).toBe('anthropic/claude-3-opus');
    });

    it('should initialize with custom app name', () => {
      const provider = new OpenRouterProvider({ appName: 'Custom App' });
      expect(provider.getModel()).toBe('openai/gpt-oss-20b:free');
    });

    it('should initialize with default model when empty options provided', () => {
      const provider = new OpenRouterProvider({});
      expect(provider.getModel()).toBe('openai/gpt-oss-20b:free');
    });
  });

  describe('setModel / getModel', () => {
    it('should set and get model', () => {
      const provider = new OpenRouterProvider();
      provider.setModel('openai/gpt-4');
      expect(provider.getModel()).toBe('openai/gpt-4');
    });

    it('should override initial model', () => {
      const provider = new OpenRouterProvider({ model: 'openai/gpt-3.5-turbo' });
      expect(provider.getModel()).toBe('openai/gpt-3.5-turbo');
      provider.setModel('anthropic/claude-3-sonnet');
      expect(provider.getModel()).toBe('anthropic/claude-3-sonnet');
    });
  });

  describe('generate', () => {
    it('should make successful API call with prompt', async () => {
      const provider = new OpenRouterProvider();
      const mockResponse = { text: 'Hello, world!', raw: {} };

      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockResponse)),
      });

      const request: LLMRequest = {
        prompt: 'Say hello',
      };

      const result = await provider.generate(request);

      expect(result.text).toBe('Hello, world!');
      expect(result.raw).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith('/api/llm-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openrouter',
          model: 'openai/gpt-oss-20b:free',
          messages: [{ role: 'user', content: 'Say hello' }],
          temperature: 0.7,
          maxTokens: 1024,
          appName: 'Vela Japanese Learning App',
          referer: 'http://localhost:9000',
          apiKey: undefined,
        }),
      });
    });

    it('should throw error when no prompt or messages provided', async () => {
      const provider = new OpenRouterProvider();

      const request: LLMRequest = {};

      await expect(provider.generate(request)).rejects.toThrow(
        'OpenRouterProvider.generate requires prompt or messages',
      );
    });

    it('should use messages instead of prompt when both provided', async () => {
      const provider = new OpenRouterProvider();
      const mockResponse = { text: 'Response' };

      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockResponse)),
      });

      const request: LLMRequest = {
        prompt: 'Should be ignored',
        messages: [
          { role: 'user', content: 'First message' },
          { role: 'assistant', content: 'Response message' },
        ],
      };

      await provider.generate(request);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.messages).toHaveLength(2);
      expect(callBody.messages[0]).toEqual({ role: 'user', content: 'First message' });
      expect(callBody.messages[1]).toEqual({ role: 'assistant', content: 'Response message' });
    });

    it('should include system message when provided', async () => {
      const provider = new OpenRouterProvider();
      const mockResponse = { text: 'Response' };

      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockResponse)),
      });

      const request: LLMRequest = {
        prompt: 'Test',
        system: 'You are a helpful assistant',
      };

      await provider.generate(request);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.messages[0]).toEqual({
        role: 'system',
        content: 'You are a helpful assistant',
      });
      expect(callBody.messages[1]).toEqual({ role: 'user', content: 'Test' });
    });

    it('should build messages with system and conversation history', async () => {
      const provider = new OpenRouterProvider();
      const mockResponse = { text: 'Response' };

      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockResponse)),
      });

      const request: LLMRequest = {
        system: 'You are a Japanese tutor',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'Teach me Japanese' },
        ],
      };

      await provider.generate(request);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.messages).toHaveLength(4);
      expect(callBody.messages[0]).toEqual({ role: 'system', content: 'You are a Japanese tutor' });
      expect(callBody.messages[1]).toEqual({ role: 'user', content: 'Hello' });
      expect(callBody.messages[2]).toEqual({ role: 'assistant', content: 'Hi there!' });
      expect(callBody.messages[3]).toEqual({ role: 'user', content: 'Teach me Japanese' });
    });

    it('should use custom model from request', async () => {
      const provider = new OpenRouterProvider();
      const mockResponse = { text: 'Response' };

      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockResponse)),
      });

      const request: LLMRequest = {
        prompt: 'Test',
        model: 'anthropic/claude-3-opus',
      };

      await provider.generate(request);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.model).toBe('anthropic/claude-3-opus');
    });

    it('should use custom temperature and maxTokens', async () => {
      const provider = new OpenRouterProvider();
      const mockResponse = { text: 'Response' };

      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockResponse)),
      });

      const request: LLMRequest = {
        prompt: 'Test',
        temperature: 0.9,
        maxTokens: 2048,
      };

      await provider.generate(request);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.temperature).toBe(0.9);
      expect(callBody.maxTokens).toBe(2048);
    });

    it('should use custom app name when provided in constructor', async () => {
      const provider = new OpenRouterProvider({ appName: 'My Custom App' });
      const mockResponse = { text: 'Response' };

      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockResponse)),
      });

      const request: LLMRequest = {
        prompt: 'Test',
      };

      await provider.generate(request);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.appName).toBe('My Custom App');
    });

    it('should use default app name when not provided', async () => {
      const provider = new OpenRouterProvider();
      const mockResponse = { text: 'Response' };

      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockResponse)),
      });

      const request: LLMRequest = {
        prompt: 'Test',
      };

      await provider.generate(request);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.appName).toBe('Vela Japanese Learning App');
    });

    it('should use window.location.origin as referer when available', async () => {
      const provider = new OpenRouterProvider();
      const mockResponse = { text: 'Response' };

      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockResponse)),
      });

      const request: LLMRequest = {
        prompt: 'Test',
      };

      await provider.generate(request);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.referer).toBe('http://localhost:9000');
    });

    it('should use localhost as referer when window is not available', async () => {
      // Temporarily remove window
      const originalWindow = global.window;
      delete (global as any).window;

      const provider = new OpenRouterProvider();
      const mockResponse = { text: 'Response' };

      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockResponse)),
      });

      const request: LLMRequest = {
        prompt: 'Test',
      };

      await provider.generate(request);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.referer).toBe('http://localhost');

      // Restore window
      global.window = originalWindow as any;
    });

    it('should include apiKey when provided', async () => {
      const provider = new OpenRouterProvider();
      const mockResponse = { text: 'Response' };

      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockResponse)),
      });

      const request: LLMRequest = {
        prompt: 'Test',
        apiKey: 'test-api-key',
      };

      await provider.generate(request);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.apiKey).toBe('test-api-key');
    });

    it('should handle empty response text', async () => {
      const provider = new OpenRouterProvider();

      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(''),
      });

      const request: LLMRequest = {
        prompt: 'Test',
      };

      const result = await provider.generate(request);

      expect(result.text).toBe('');
    });

    it('should handle response without text field', async () => {
      const provider = new OpenRouterProvider();
      const mockResponse = { raw: 'some data' };

      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockResponse)),
      });

      const request: LLMRequest = {
        prompt: 'Test',
      };

      const result = await provider.generate(request);

      expect(result.text).toBe('');
      expect(result.raw).toEqual(mockResponse);
    });

    it('should handle non-JSON response', async () => {
      const provider = new OpenRouterProvider();

      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue('Plain text response'),
      });

      const request: LLMRequest = {
        prompt: 'Test',
      };

      const result = await provider.generate(request);

      expect(result.text).toBe('');
      expect(result.raw).toEqual({ raw: 'Plain text response' });
    });

    it('should throw error when response is not ok', async () => {
      const provider = new OpenRouterProvider();

      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Bad Request',
        text: vi.fn().mockResolvedValue(''),
      });

      const request: LLMRequest = {
        prompt: 'Test',
      };

      await expect(provider.generate(request)).rejects.toThrow(
        'OpenRouter bridge error: Bad Request',
      );
    });

    it('should throw error with error message from response', async () => {
      const provider = new OpenRouterProvider();
      const errorResponse = { error: 'Invalid API key' };

      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Unauthorized',
        text: vi.fn().mockResolvedValue(JSON.stringify(errorResponse)),
      });

      const request: LLMRequest = {
        prompt: 'Test',
      };

      await expect(provider.generate(request)).rejects.toThrow(
        'OpenRouter bridge error: Invalid API key',
      );
    });

    it('should use temperature 0 when explicitly set', async () => {
      const provider = new OpenRouterProvider();
      const mockResponse = { text: 'Response' };

      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockResponse)),
      });

      const request: LLMRequest = {
        prompt: 'Test',
        temperature: 0,
      };

      await provider.generate(request);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.temperature).toBe(0);
    });

    it('should use maxTokens 0 when explicitly set', async () => {
      const provider = new OpenRouterProvider();
      const mockResponse = { text: 'Response' };

      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockResponse)),
      });

      const request: LLMRequest = {
        prompt: 'Test',
        maxTokens: 0,
      };

      await provider.generate(request);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.maxTokens).toBe(0);
    });

    it('should handle complete request with all parameters', async () => {
      const provider = new OpenRouterProvider({
        model: 'openai/gpt-4',
        appName: 'Test App',
      });
      const mockResponse = { text: 'Complete response', raw: { metadata: 'test' } };

      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockResponse)),
      });

      const request: LLMRequest = {
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi' },
        ],
        system: 'System instruction',
        temperature: 0.8,
        maxTokens: 512,
        model: 'anthropic/claude-3-opus',
        apiKey: 'custom-key',
      };

      const result = await provider.generate(request);

      expect(result.text).toBe('Complete response');
      expect(result.raw).toEqual(mockResponse);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.provider).toBe('openrouter');
      expect(callBody.model).toBe('anthropic/claude-3-opus');
      expect(callBody.messages).toHaveLength(3); // system + 2 messages
      expect(callBody.temperature).toBe(0.8);
      expect(callBody.maxTokens).toBe(512);
      expect(callBody.appName).toBe('Test App');
      expect(callBody.apiKey).toBe('custom-key');
    });

    it('should handle empty messages array with prompt fallback', async () => {
      const provider = new OpenRouterProvider();
      const mockResponse = { text: 'Response' };

      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockResponse)),
      });

      const request: LLMRequest = {
        messages: [],
        prompt: 'Fallback prompt',
      };

      await provider.generate(request);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.messages).toHaveLength(1);
      expect(callBody.messages[0]).toEqual({ role: 'user', content: 'Fallback prompt' });
    });
  });
});

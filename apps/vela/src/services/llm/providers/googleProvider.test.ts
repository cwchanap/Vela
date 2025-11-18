import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GoogleProvider } from './googleProvider';
import type { LLMRequest } from '../types';

// Mock getApiUrl
vi.mock('src/utils/api', () => ({
  getApiUrl: vi.fn((endpoint: string) => `/api/${endpoint}`),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('GoogleProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default model when no options provided', () => {
      const provider = new GoogleProvider();
      expect(provider.name).toBe('google');
      expect(provider.getModel()).toBe('gemini-2.5-flash-lite');
    });

    it('should initialize with custom model when provided', () => {
      const provider = new GoogleProvider({ model: 'gemini-pro' });
      expect(provider.getModel()).toBe('gemini-pro');
    });

    it('should initialize with default model when empty options provided', () => {
      const provider = new GoogleProvider({});
      expect(provider.getModel()).toBe('gemini-2.5-flash-lite');
    });
  });

  describe('setModel / getModel', () => {
    it('should set and get model', () => {
      const provider = new GoogleProvider();
      provider.setModel('gemini-1.5-pro');
      expect(provider.getModel()).toBe('gemini-1.5-pro');
    });

    it('should override initial model', () => {
      const provider = new GoogleProvider({ model: 'gemini-flash' });
      expect(provider.getModel()).toBe('gemini-flash');
      provider.setModel('gemini-pro');
      expect(provider.getModel()).toBe('gemini-pro');
    });
  });

  describe('generate', () => {
    it('should make successful API call with prompt', async () => {
      const provider = new GoogleProvider();
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
          provider: 'google',
          model: 'gemini-2.5-flash-lite',
          messages: undefined,
          prompt: 'Say hello',
          system: undefined,
          temperature: 0.7,
          maxTokens: 1024,
          apiKey: undefined,
        }),
      });
    });

    it('should use custom model from request', async () => {
      const provider = new GoogleProvider();
      const mockResponse = { text: 'Response' };

      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockResponse)),
      });

      const request: LLMRequest = {
        prompt: 'Test',
        model: 'gemini-custom',
      };

      await provider.generate(request);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"model":"gemini-custom"'),
        }),
      );
    });

    it('should include messages in request', async () => {
      const provider = new GoogleProvider();
      const mockResponse = { text: 'Response' };

      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockResponse)),
      });

      const request: LLMRequest = {
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
        ],
      };

      await provider.generate(request);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"messages"'),
        }),
      );
    });

    it('should include system message in request', async () => {
      const provider = new GoogleProvider();
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

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"system":"You are a helpful assistant"'),
        }),
      );
    });

    it('should use custom temperature and maxTokens', async () => {
      const provider = new GoogleProvider();
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

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"temperature":0.9'),
        }),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"maxTokens":2048'),
        }),
      );
    });

    it('should include apiKey when provided', async () => {
      const provider = new GoogleProvider();
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

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"apiKey":"test-api-key"'),
        }),
      );
    });

    it('should handle empty response text', async () => {
      const provider = new GoogleProvider();

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
      const provider = new GoogleProvider();
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
      const provider = new GoogleProvider();

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
      const provider = new GoogleProvider();

      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Bad Request',
        text: vi.fn().mockResolvedValue(''),
      });

      const request: LLMRequest = {
        prompt: 'Test',
      };

      await expect(provider.generate(request)).rejects.toThrow(
        'GoogleProvider bridge error: Bad Request',
      );
    });

    it('should throw error with error message from response', async () => {
      const provider = new GoogleProvider();
      const errorResponse = { error: 'API key is invalid' };

      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Unauthorized',
        text: vi.fn().mockResolvedValue(JSON.stringify(errorResponse)),
      });

      const request: LLMRequest = {
        prompt: 'Test',
      };

      await expect(provider.generate(request)).rejects.toThrow(
        'GoogleProvider bridge error: API key is invalid',
      );
    });

    it('should use default temperature when temperature is 0', async () => {
      const provider = new GoogleProvider();
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

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"temperature":0'),
        }),
      );
    });

    it('should use default maxTokens when maxTokens is 0', async () => {
      const provider = new GoogleProvider();
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

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"maxTokens":0'),
        }),
      );
    });

    it('should handle complete request with all parameters', async () => {
      const provider = new GoogleProvider({ model: 'gemini-pro' });
      const mockResponse = { text: 'Complete response', raw: { metadata: 'test' } };

      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockResponse)),
      });

      const request: LLMRequest = {
        prompt: 'Test prompt',
        messages: [{ role: 'user', content: 'Previous message' }],
        system: 'System instruction',
        temperature: 0.8,
        maxTokens: 512,
        model: 'gemini-custom',
        apiKey: 'custom-key',
      };

      const result = await provider.generate(request);

      expect(result.text).toBe('Complete response');
      expect(result.raw).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith('/api/llm-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'google',
          model: 'gemini-custom',
          messages: [{ role: 'user', content: 'Previous message' }],
          prompt: 'Test prompt',
          system: 'System instruction',
          temperature: 0.8,
          maxTokens: 512,
          apiKey: 'custom-key',
        }),
      });
    });
  });
});

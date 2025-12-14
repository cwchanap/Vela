import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChutesProvider } from './chutesProvider';
import type { LLMRequest } from '../types';

// Mock getApiUrl
vi.mock('src/utils/api', () => ({
  getApiUrl: vi.fn((endpoint: string) => `/api/${endpoint}`),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('ChutesProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default model when no options provided', () => {
      const provider = new ChutesProvider();
      expect(provider.name).toBe('chutes');
      expect(provider.getModel()).toBe('openai/gpt-oss-120b');
    });

    it('should initialize with custom model when provided', () => {
      const provider = new ChutesProvider({ model: 'deepseek-ai/DeepSeek-V3' });
      expect(provider.getModel()).toBe('deepseek-ai/DeepSeek-V3');
    });

    it('should initialize with default model when empty options provided', () => {
      const provider = new ChutesProvider({});
      expect(provider.getModel()).toBe('openai/gpt-oss-120b');
    });
  });

  describe('setModel / getModel', () => {
    it('should set and get model', () => {
      const provider = new ChutesProvider();
      provider.setModel('deepseek-ai/DeepSeek-V3.2');
      expect(provider.getModel()).toBe('deepseek-ai/DeepSeek-V3.2');
    });

    it('should override initial model', () => {
      const provider = new ChutesProvider({ model: 'openai/gpt-oss-120b' });
      expect(provider.getModel()).toBe('openai/gpt-oss-120b');
      provider.setModel('deepseek-ai/DeepSeek-V3');
      expect(provider.getModel()).toBe('deepseek-ai/DeepSeek-V3');
    });
  });

  describe('generate', () => {
    it('should make successful API call with prompt', async () => {
      const provider = new ChutesProvider();
      const mockResponse = { text: 'Hello, world!', raw: {} };

      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockResponse)),
      });

      const request: LLMRequest = {
        prompt: 'Say hello',
        apiKey: 'test-api-key',
      };

      const result = await provider.generate(request);

      expect(result.text).toBe('Hello, world!');
      expect(result.raw).toEqual(mockResponse);
      expect(mockFetch).toHaveBeenCalledWith('/api/llm-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'chutes',
          model: 'openai/gpt-oss-120b',
          messages: [{ role: 'user', content: 'Say hello' }],
          temperature: 0.7,
          maxTokens: 1024,
          apiKey: 'test-api-key',
        }),
      });
    });

    it('should use custom model from request', async () => {
      const provider = new ChutesProvider();
      const mockResponse = { text: 'Response' };

      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockResponse)),
      });

      const request: LLMRequest = {
        prompt: 'Test',
        model: 'deepseek-ai/DeepSeek-V3',
        apiKey: 'test-api-key',
      };

      await provider.generate(request);

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/llm-chat',
        expect.objectContaining({
          body: expect.stringContaining('"model":"deepseek-ai/DeepSeek-V3"'),
        }),
      );
    });

    it('should include system message when provided', async () => {
      const provider = new ChutesProvider();
      const mockResponse = { text: 'Response' };

      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockResponse)),
      });

      const request: LLMRequest = {
        prompt: 'Hello',
        system: 'You are a helpful assistant',
        apiKey: 'test-api-key',
      };

      await provider.generate(request);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.messages).toContainEqual({
        role: 'system',
        content: 'You are a helpful assistant',
      });
    });

    it('should use messages array when provided', async () => {
      const provider = new ChutesProvider();
      const mockResponse = { text: 'Response' };

      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockResponse)),
      });

      const request: LLMRequest = {
        messages: [
          { role: 'user', content: 'First message' },
          { role: 'assistant', content: 'First response' },
          { role: 'user', content: 'Second message' },
        ],
        apiKey: 'test-api-key',
      };

      await provider.generate(request);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.messages).toEqual([
        { role: 'user', content: 'First message' },
        { role: 'assistant', content: 'First response' },
        { role: 'user', content: 'Second message' },
      ]);
    });

    it('should throw error when neither prompt nor messages provided', async () => {
      const provider = new ChutesProvider();

      const request: LLMRequest = {
        apiKey: 'test-api-key',
      };

      await expect(provider.generate(request)).rejects.toThrow(
        'ChutesProvider.generate requires prompt or messages',
      );
    });

    it('should throw error on API failure', async () => {
      const provider = new ChutesProvider();

      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Internal Server Error',
        text: vi.fn().mockResolvedValue(JSON.stringify({ error: 'API Error' })),
      });

      const request: LLMRequest = {
        prompt: 'Test',
        apiKey: 'test-api-key',
      };

      await expect(provider.generate(request)).rejects.toThrow('Chutes bridge error: API Error');
    });

    it('should use statusText when no error in response', async () => {
      const provider = new ChutesProvider();

      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Bad Request',
        text: vi.fn().mockResolvedValue('{}'),
      });

      const request: LLMRequest = {
        prompt: 'Test',
        apiKey: 'test-api-key',
      };

      await expect(provider.generate(request)).rejects.toThrow('Chutes bridge error: Bad Request');
    });

    it('should handle non-JSON response body', async () => {
      const provider = new ChutesProvider();

      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue('not valid json'),
      });

      const request: LLMRequest = {
        prompt: 'Test',
        apiKey: 'test-api-key',
      };

      const result = await provider.generate(request);
      expect(result.text).toBe('not valid json');
      expect(result.raw).toEqual({ raw: 'not valid json', text: 'not valid json' });
    });

    it('should use custom temperature and maxTokens', async () => {
      const provider = new ChutesProvider();
      const mockResponse = { text: 'Response' };

      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(JSON.stringify(mockResponse)),
      });

      const request: LLMRequest = {
        prompt: 'Test',
        temperature: 0.5,
        maxTokens: 2048,
        apiKey: 'test-api-key',
      };

      await provider.generate(request);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.temperature).toBe(0.5);
      expect(callBody.maxTokens).toBe(2048);
    });

    it('should handle empty response text', async () => {
      const provider = new ChutesProvider();

      mockFetch.mockResolvedValue({
        ok: true,
        text: vi.fn().mockResolvedValue(''),
      });

      const request: LLMRequest = {
        prompt: 'Test',
        apiKey: 'test-api-key',
      };

      const result = await provider.generate(request);
      expect(result.text).toBe('');
      expect(result.raw).toBeNull();
    });
  });
});

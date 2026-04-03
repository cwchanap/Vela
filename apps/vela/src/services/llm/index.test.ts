import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config
vi.mock('../../config', () => ({
  config: {
    app: { name: 'TestApp' },
  },
}));

// Use vi.hoisted to avoid temporal dead zone issues with hoisted vi.mock()
const {
  mockGoogleGenerate,
  mockGoogleSetModel,
  mockGoogleGetModel,
  mockOpenRouterGenerate,
  mockOpenRouterSetModel,
  mockOpenRouterGetModel,
  mockChutesGenerate,
  mockChutesSetModel,
  mockChutesGetModel,
  MockGoogleProvider,
  MockOpenRouterProvider,
  MockChutesProvider,
} = vi.hoisted(() => {
  const mockGoogleGenerate = vi.fn();
  const mockGoogleSetModel = vi.fn();
  const mockGoogleGetModel = vi.fn().mockReturnValue('gemini-2.5-flash-lite');
  const mockOpenRouterGenerate = vi.fn();
  const mockOpenRouterSetModel = vi.fn();
  const mockOpenRouterGetModel = vi.fn().mockReturnValue('openrouter-default');
  const mockChutesGenerate = vi.fn();
  const mockChutesSetModel = vi.fn();
  const mockChutesGetModel = vi.fn().mockReturnValue('chutes-default');

  const MockGoogleProvider = vi.fn().mockImplementation(() => ({
    name: 'google',
    generate: mockGoogleGenerate,
    setModel: mockGoogleSetModel,
    getModel: mockGoogleGetModel,
  }));

  const MockOpenRouterProvider = vi.fn().mockImplementation(() => ({
    name: 'openrouter',
    generate: mockOpenRouterGenerate,
    setModel: mockOpenRouterSetModel,
    getModel: mockOpenRouterGetModel,
  }));

  const MockChutesProvider = vi.fn().mockImplementation(() => ({
    name: 'chutes',
    generate: mockChutesGenerate,
    setModel: mockChutesSetModel,
    getModel: mockChutesGetModel,
  }));

  return {
    mockGoogleGenerate,
    mockGoogleSetModel,
    mockGoogleGetModel,
    mockOpenRouterGenerate,
    mockOpenRouterSetModel,
    mockOpenRouterGetModel,
    mockChutesGenerate,
    mockChutesSetModel,
    mockChutesGetModel,
    MockGoogleProvider,
    MockOpenRouterProvider,
    MockChutesProvider,
  };
});

vi.mock('./providers/googleProvider', () => ({
  GoogleProvider: MockGoogleProvider,
}));

vi.mock('./providers/openrouterProvider', () => ({
  OpenRouterProvider: MockOpenRouterProvider,
}));

vi.mock('./providers/chutesProvider', () => ({
  ChutesProvider: MockChutesProvider,
}));

import { LLMService } from './index';

describe('LLMService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGoogleGetModel.mockReturnValue('gemini-2.5-flash-lite');
    mockOpenRouterGetModel.mockReturnValue('openrouter-default');
    mockChutesGetModel.mockReturnValue('chutes-default');
    MockGoogleProvider.mockImplementation(() => ({
      name: 'google',
      generate: mockGoogleGenerate,
      setModel: mockGoogleSetModel,
      getModel: mockGoogleGetModel,
    }));
    MockOpenRouterProvider.mockImplementation(() => ({
      name: 'openrouter',
      generate: mockOpenRouterGenerate,
      setModel: mockOpenRouterSetModel,
      getModel: mockOpenRouterGetModel,
    }));
    MockChutesProvider.mockImplementation(() => ({
      name: 'chutes',
      generate: mockChutesGenerate,
      setModel: mockChutesSetModel,
      getModel: mockChutesGetModel,
    }));
  });

  describe('constructor', () => {
    it('initializes with google as default provider', () => {
      const service = new LLMService();
      expect(service.getProviderName()).toBe('google');
    });
  });

  describe('getProviderName', () => {
    it('returns the current provider name', () => {
      const service = new LLMService();
      expect(service.getProviderName()).toBe('google');
    });
  });

  describe('setProvider', () => {
    it('switches to openrouter provider', () => {
      const service = new LLMService();
      service.setProvider('openrouter');
      expect(service.getProviderName()).toBe('openrouter');
    });

    it('switches to chutes provider', () => {
      const service = new LLMService();
      service.setProvider('chutes');
      expect(service.getProviderName()).toBe('chutes');
    });

    it('switches back to google provider', () => {
      const service = new LLMService();
      service.setProvider('openrouter');
      service.setProvider('google');
      expect(service.getProviderName()).toBe('google');
    });

    it('accepts optional model parameter', () => {
      const service = new LLMService();
      service.setProvider('google', 'gemini-pro');
      expect(service.getProviderName()).toBe('google');
    });

    it('reuses cached provider instance when switching back', () => {
      const service = new LLMService();
      const initialCallCount = MockGoogleProvider.mock.calls.length;
      service.setProvider('openrouter');
      service.setProvider('google'); // switch back to already-initialized google

      // GoogleProvider should not have been called again
      expect(MockGoogleProvider.mock.calls.length).toBe(initialCallCount);
    });

    it('falls back to google when an unsupported provider name is forced in', () => {
      const service = new LLMService();
      const initialCallCount = MockGoogleProvider.mock.calls.length;

      service.setProvider('unsupported-provider' as never);

      expect(MockGoogleProvider).toHaveBeenCalledTimes(initialCallCount + 1);
      expect(service.getProviderName()).toBe('google');
    });
  });

  describe('setModel', () => {
    it('sets model on current provider', () => {
      const service = new LLMService();
      service.setModel('gemini-pro');
      expect(mockGoogleSetModel).toHaveBeenCalledWith('gemini-pro');
    });

    it('sets model on openrouter when that provider is active', () => {
      const service = new LLMService();
      service.setProvider('openrouter');
      service.setModel('gpt-4');
      expect(mockOpenRouterSetModel).toHaveBeenCalledWith('gpt-4');
    });
  });

  describe('getModel', () => {
    it('returns model from current provider', () => {
      const service = new LLMService();
      const model = service.getModel();
      expect(mockGoogleGetModel).toHaveBeenCalled();
      expect(model).toBe('gemini-2.5-flash-lite');
    });

    it('returns model from openrouter when that provider is active', () => {
      const service = new LLMService();
      service.setProvider('openrouter');
      const model = service.getModel();
      expect(model).toBe('openrouter-default');
    });
  });

  describe('setApiKey', () => {
    it('stores api key for use in generate', async () => {
      const service = new LLMService();
      service.setApiKey('my-api-key');
      mockGoogleGenerate.mockResolvedValue({ text: 'response', raw: {} });

      await service.generate({ prompt: 'test' });

      expect(mockGoogleGenerate).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'my-api-key' }),
      );
    });

    it('trims whitespace from api key', async () => {
      const service = new LLMService();
      service.setApiKey('  my-key  ');
      mockGoogleGenerate.mockResolvedValue({ text: 'response', raw: {} });

      await service.generate({ prompt: 'test' });

      expect(mockGoogleGenerate).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'my-key' }),
      );
    });

    it('clears a previously set key when called with undefined', async () => {
      const service = new LLMService();
      service.setApiKey('stale-key');
      service.setApiKey(undefined);
      mockGoogleGenerate.mockResolvedValue({ text: 'response', raw: {} });

      await service.generate({ prompt: 'test' });

      const callArg = mockGoogleGenerate.mock.calls[0][0];
      expect(callArg.apiKey).toBeUndefined();
    });
  });

  describe('generate', () => {
    it('calls provider generate with request', async () => {
      const service = new LLMService();
      const mockResponse = { text: 'Hello!', raw: {} };
      mockGoogleGenerate.mockResolvedValue(mockResponse);

      const result = await service.generate({ prompt: 'Say hello' });

      expect(mockGoogleGenerate).toHaveBeenCalledWith({ prompt: 'Say hello' });
      expect(result).toEqual(mockResponse);
    });

    it('passes apiKey from service to request when set', async () => {
      const service = new LLMService();
      service.setApiKey('test-key');
      const mockResponse = { text: 'Response', raw: {} };
      mockGoogleGenerate.mockResolvedValue(mockResponse);

      await service.generate({ prompt: 'test' });

      expect(mockGoogleGenerate).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'test-key' }),
      );
    });

    it('preserves existing apiKey in request when service key not set', async () => {
      const service = new LLMService();
      const mockResponse = { text: 'Response', raw: {} };
      mockGoogleGenerate.mockResolvedValue(mockResponse);

      await service.generate({ prompt: 'test', apiKey: 'request-key' });

      // apiKey from the original request should be present
      const callArg = mockGoogleGenerate.mock.calls[0][0];
      expect(callArg.apiKey).toBe('request-key');
    });

    it('delegates to openrouter when that provider is active', async () => {
      const service = new LLMService();
      service.setProvider('openrouter');
      const mockResponse = { text: 'OpenRouter response', raw: {} };
      mockOpenRouterGenerate.mockResolvedValue(mockResponse);

      const result = await service.generate({ prompt: 'test' });

      expect(mockOpenRouterGenerate).toHaveBeenCalled();
      expect(result).toEqual(mockResponse);
    });

    it('delegates to chutes when that provider is active', async () => {
      const service = new LLMService();
      service.setProvider('chutes');
      const mockResponse = { text: 'Chutes response', raw: {} };
      mockChutesGenerate.mockResolvedValue(mockResponse);

      const result = await service.generate({ prompt: 'test' });

      expect(mockChutesGenerate).toHaveBeenCalled();
      expect(result).toEqual(mockResponse);
    });

    it('does not mutate the original request object', async () => {
      const service = new LLMService();
      service.setApiKey('service-key');
      mockGoogleGenerate.mockResolvedValue({ text: 'Response', raw: {} });

      const originalRequest = { prompt: 'test' };
      await service.generate(originalRequest);

      // Original request should not have apiKey added
      expect(Object.keys(originalRequest)).not.toContain('apiKey');
    });
  });

  describe('singleton llmService export', () => {
    it('exports llmService singleton', async () => {
      const { llmService } = await import('./index');
      expect(llmService).toBeDefined();
      expect(typeof llmService.generate).toBe('function');
      expect(typeof llmService.setProvider).toBe('function');
      expect(typeof llmService.setModel).toBe('function');
      expect(typeof llmService.getModel).toBe('function');
      expect(typeof llmService.setApiKey).toBe('function');
    });
  });
});

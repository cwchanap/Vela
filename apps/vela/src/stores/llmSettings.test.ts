import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { LLM_PROVIDER_REGISTRY } from '@vela/common';

const mockLocalStorage = {
  set: vi.fn(),
  has: vi.fn(() => false),
  getItem: vi.fn(() => null),
};

const mockNotify = { create: vi.fn() };

vi.mock('quasar', () => ({
  LocalStorage: mockLocalStorage,
  Notify: mockNotify,
}));

const mockAuthStore = {
  user: null as null | { id: string; preferences?: Record<string, unknown> },
  updateProfile: vi.fn(),
};

vi.mock('./auth', () => ({
  useAuthStore: () => mockAuthStore,
}));

describe('useLLMSettingsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockAuthStore.user = null;
    mockLocalStorage.has.mockReturnValue(false);
    mockLocalStorage.getItem.mockReturnValue(null);
  });

  describe('initial state', () => {
    it('has default provider google', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      const store = useLLMSettingsStore();
      expect(store.provider).toBe('google');
    });

    it('has registry-backed default models for every provider', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      const store = useLLMSettingsStore();
      expect(store.models.google).toBe(LLM_PROVIDER_REGISTRY.google.defaultModel);
      expect(store.models.openai).toBe(LLM_PROVIDER_REGISTRY.openai.defaultModel);
      expect(store.models.anthropic).toBe(LLM_PROVIDER_REGISTRY.anthropic.defaultModel);
      expect(store.models.openrouter).toBe(LLM_PROVIDER_REGISTRY.openrouter.defaultModel);
    });

    it('has empty keys', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      const store = useLLMSettingsStore();
      expect(store.keys).toEqual({});
    });
  });

  describe('computed: currentModel', () => {
    it('has default model from the registry', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      const store = useLLMSettingsStore();
      expect(store.currentModel).toBe(LLM_PROVIDER_REGISTRY.google.defaultModel);
    });

    it('falls back to the default provider model for unexpected runtime providers', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      const store = useLLMSettingsStore();

      store.models = {} as any;
      store.provider = 'unexpected-provider' as any;

      expect(store.currentModel).toBe(LLM_PROVIDER_REGISTRY.google.defaultModel);
    });
  });

  describe('computed: currentApiKey', () => {
    it('returns undefined when no key set', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      const store = useLLMSettingsStore();
      expect(store.currentApiKey).toBeUndefined();
    });

    it('returns key for current provider', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      const store = useLLMSettingsStore();
      store.setApiKey('test-api-key');
      expect(store.currentApiKey).toBe('test-api-key');
    });
  });

  describe('setProvider', () => {
    it('changes provider and persists', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      const store = useLLMSettingsStore();
      store.setProvider('openrouter');
      expect(store.provider).toBe('openrouter');
      expect(mockLocalStorage.set).toHaveBeenCalled();
    });

    it('ensures model is set for new provider', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      const store = useLLMSettingsStore();
      store.models = { google: LLM_PROVIDER_REGISTRY.google.defaultModel } as any; // clear other models
      store.setProvider('anthropic');
      expect(store.models.anthropic).toBe(LLM_PROVIDER_REGISTRY.anthropic.defaultModel);
    });

    it('keeps per-provider keys isolated when switching providers', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      const store = useLLMSettingsStore();
      store.setApiKey('google-key');
      store.setProvider('openai');
      expect(store.currentApiKey).toBeUndefined();
      store.setProvider('google');
      expect(store.currentApiKey).toBe('google-key');
    });
  });

  describe('setModel', () => {
    it('sets model for current provider', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      const store = useLLMSettingsStore();
      store.setModel('gemini-pro');
      expect(store.models.google).toBe('gemini-pro');
      expect(mockLocalStorage.set).toHaveBeenCalled();
    });
  });

  describe('setApiKey', () => {
    it('sets API key for current provider', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      const store = useLLMSettingsStore();
      store.setApiKey('my-key-123');
      expect(store.keys.google).toBe('my-key-123');
    });

    it('removes key when empty string', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      const store = useLLMSettingsStore();
      store.setApiKey('my-key-123');
      store.setApiKey('');
      expect(store.keys.google).toBeUndefined();
    });

    it('removes key when null', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      const store = useLLMSettingsStore();
      store.setApiKey('my-key-123');
      store.setApiKey(null);
      expect(store.keys.google).toBeUndefined();
    });

    it('trims whitespace from key', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      const store = useLLMSettingsStore();
      store.setApiKey('  my-key-123  ');
      expect(store.keys.google).toBe('my-key-123');
    });
  });

  describe('persist', () => {
    it('saves settings to LocalStorage', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      const store = useLLMSettingsStore();
      store.persist();
      expect(mockLocalStorage.set).toHaveBeenCalledWith(
        'llm_settings_v1',
        expect.objectContaining({ provider: 'google' }),
      );
    });
  });

  describe('load', () => {
    it('loads from localStorage when no profile', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      mockLocalStorage.getItem.mockReturnValue({
        provider: 'openrouter',
        models: { openrouter: 'gpt-4o' },
        keys: { openrouter: 'or-key' },
      });
      const store = useLLMSettingsStore();
      store.load();
      expect(store.provider).toBe('openrouter');
      expect(store.models.openrouter).toBe('gpt-4o');
    });

    it('loads from user profile when available', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      mockAuthStore.user = {
        id: 'user-1',
        preferences: {
          llm_provider: 'anthropic',
          llm_models: { anthropic: 'claude-opus-5-5' },
        },
      };
      const store = useLLMSettingsStore();
      store.load();
      expect(store.provider).toBe('anthropic');
    });

    it('falls back to the default provider for a removed provider value', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      // 'chutes' was a selectable provider before the registry migration;
      // leaving it in place would 400 every request.
      mockLocalStorage.getItem.mockReturnValue({
        provider: 'chutes',
        models: { google: 'gemini-3.8-flash' },
      });
      const store = useLLMSettingsStore();
      store.load();
      expect(store.provider).toBe('google');
    });

    it('falls back to the registry default for a removed model', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      // 'gemini-2.5-flash-lite' was the pre-registry Google default.
      mockLocalStorage.getItem.mockReturnValue({
        provider: 'google',
        models: { google: 'gemini-2.5-flash-lite' },
      });
      const store = useLLMSettingsStore();
      store.load();
      expect(store.models.google).toBe(LLM_PROVIDER_REGISTRY.google.defaultModel);
    });

    it('keeps a custom OpenRouter model ID from persisted settings', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      mockLocalStorage.getItem.mockReturnValue({
        provider: 'openrouter',
        models: { openrouter: 'acme/custom-model:free' },
      });
      const store = useLLMSettingsStore();
      store.load();
      expect(store.models.openrouter).toBe('acme/custom-model:free');
    });

    it('sanitizes profile-loaded values without rewriting persisted preferences', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      mockAuthStore.user = {
        id: 'user-1',
        preferences: {
          llm_provider: 'chutes',
          llm_models: { google: 'gemini-2.5-flash-lite' },
        },
      };
      const store = useLLMSettingsStore();
      store.load();
      expect(store.provider).toBe('google');
      expect(store.models.google).toBe(LLM_PROVIDER_REGISTRY.google.defaultModel);
      // Sanitization is in-memory only — load must never persist.
      expect(mockLocalStorage.set).not.toHaveBeenCalled();
    });
  });

  describe('notifySaved', () => {
    it('creates a positive notification', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      const store = useLLMSettingsStore();
      store.notifySaved();
      expect(mockNotify.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'positive' }));
    });
  });

  describe('resetToDefaults', () => {
    it('resets to default provider and models', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      const store = useLLMSettingsStore();
      mockAuthStore.updateProfile.mockResolvedValue(true);
      store.setProvider('openrouter');
      store.setApiKey('some-key');
      await store.resetToDefaults();
      expect(store.provider).toBe('google');
      expect(store.keys).toEqual({});
    });
  });

  describe('save', () => {
    it('persists and saves to profile', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      mockAuthStore.user = { id: 'user-1', preferences: {} };
      mockAuthStore.updateProfile.mockResolvedValue(true);
      const store = useLLMSettingsStore();
      await store.save();
      expect(mockLocalStorage.set).toHaveBeenCalled();
      expect(mockAuthStore.updateProfile).toHaveBeenCalled();
    });

    it('only persists locally when no user logged in', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      const store = useLLMSettingsStore();
      await store.save();
      expect(mockLocalStorage.set).toHaveBeenCalled();
      expect(mockAuthStore.updateProfile).not.toHaveBeenCalled();
    });
  });
});

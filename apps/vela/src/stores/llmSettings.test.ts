import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const mockLlmService = {
  setProvider: vi.fn(),
  setModel: vi.fn(),
  setApiKey: vi.fn(),
};

vi.mock('../services/llm', () => ({
  llmService: mockLlmService,
}));

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

    it('has default models configured', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      const store = useLLMSettingsStore();
      expect(store.models.google).toBe('gemini-2.5-flash-lite');
      expect(store.models.openrouter).toBeDefined();
      expect(store.models.chutes).toBeDefined();
    });

    it('has empty keys', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      const store = useLLMSettingsStore();
      expect(store.keys).toEqual({});
    });
  });

  describe('computed: currentModel', () => {
    it('returns model for current provider', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      const store = useLLMSettingsStore();
      expect(store.currentModel).toBe('gemini-2.5-flash-lite');
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
    it('changes provider and updates service', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      const store = useLLMSettingsStore();
      store.setProvider('openrouter');
      expect(store.provider).toBe('openrouter');
      expect(mockLlmService.setProvider).toHaveBeenCalledWith('openrouter', expect.any(String));
      expect(mockLocalStorage.set).toHaveBeenCalled();
    });

    it('ensures model is set for new provider', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      const store = useLLMSettingsStore();
      store.models = { google: 'gemini-2.5-flash-lite' } as any; // clear other models
      store.setProvider('openrouter');
      expect(store.models.openrouter).toBeDefined();
    });
  });

  describe('setModel', () => {
    it('sets model for current provider', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      const store = useLLMSettingsStore();
      store.setModel('gemini-pro');
      expect(store.models.google).toBe('gemini-pro');
      expect(mockLlmService.setModel).toHaveBeenCalledWith('gemini-pro');
      expect(mockLocalStorage.set).toHaveBeenCalled();
    });
  });

  describe('setApiKey', () => {
    it('sets API key for current provider', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      const store = useLLMSettingsStore();
      store.setApiKey('my-key-123');
      expect(store.keys.google).toBe('my-key-123');
      expect(mockLlmService.setApiKey).toHaveBeenCalledWith('my-key-123');
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
          llm_provider: 'chutes',
          llm_models: { chutes: 'gpt-120b' },
        },
      };
      const store = useLLMSettingsStore();
      store.load();
      expect(store.provider).toBe('chutes');
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
      expect(mockLlmService.setProvider).toHaveBeenCalledWith('google', expect.any(String));
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

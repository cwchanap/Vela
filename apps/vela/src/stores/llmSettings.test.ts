import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick, reactive } from 'vue';
import { LLM_PROVIDER_REGISTRY } from '@vela/common';
import type { LlmPreferences, UserPreferences } from '../types/shared';

const GOOGLE_DEFAULT = LLM_PROVIDER_REGISTRY.google.defaultModel;

interface MockUser {
  id: string;
  preferences?: Record<string, unknown>;
}

const mockAuthStore = reactive({
  user: null as MockUser | null,
  updatePreferences: vi.fn(),
});

vi.mock('./auth', () => ({
  useAuthStore: () => mockAuthStore,
}));

const makeUser = (id: string, llm?: LlmPreferences): MockUser => ({
  id,
  preferences: llm ? { llm } : {},
});

const makeLlm = (overrides: Partial<LlmPreferences> = {}): LlmPreferences => ({
  keys: {},
  thinking: {},
  defaultModel: { provider: 'google', model: GOOGLE_DEFAULT },
  ...overrides,
});

const resolvePatch = (partial: unknown): Partial<UserPreferences> =>
  typeof partial === 'function'
    ? (partial as (_current: UserPreferences) => Partial<UserPreferences>)(
        (mockAuthStore.user?.preferences ?? {}) as UserPreferences,
      )
    : (partial as Partial<UserPreferences>);

const lastPatch = () => resolvePatch(mockAuthStore.updatePreferences.mock.calls.at(-1)![0]);

const mockUpdateSuccess = () => {
  mockAuthStore.updatePreferences.mockImplementation(async (partial: unknown) => {
    if (!mockAuthStore.user) return false;
    mockAuthStore.user.preferences = {
      ...(mockAuthStore.user.preferences ?? {}),
      ...resolvePatch(partial),
    };
    return true;
  });
};

describe('useLLMSettingsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockAuthStore.user = null;
    mockUpdateSuccess();
  });

  describe('initial state', () => {
    it('starts from the registry Google default with empty keys and overrides', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      const store = useLLMSettingsStore();
      expect(store.llm).toEqual({
        keys: {},
        thinking: {},
        defaultModel: { provider: 'google', model: GOOGLE_DEFAULT },
      });
    });

    it('derives selection without an API key or thinking override', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      const store = useLLMSettingsStore();
      expect(store.selection).toEqual({
        provider: 'google',
        model: GOOGLE_DEFAULT,
        apiKey: undefined,
        thinking: undefined,
      });
    });
  });

  describe('profile hydration', () => {
    it('hydrates llm state from the authenticated user preferences', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      mockAuthStore.user = makeUser(
        'user-1',
        makeLlm({
          keys: { anthropic: 'anthropic-key' },
          thinking: { 'claude-opus-5-5': 'high' },
          defaultModel: { provider: 'anthropic', model: 'claude-opus-5-5' },
        }),
      );
      const store = useLLMSettingsStore();
      expect(store.llm).toEqual({
        keys: { anthropic: 'anthropic-key' },
        thinking: { 'claude-opus-5-5': 'high' },
        defaultModel: { provider: 'anthropic', model: 'claude-opus-5-5' },
      });
      expect(store.selection).toEqual({
        provider: 'anthropic',
        model: 'claude-opus-5-5',
        apiKey: 'anthropic-key',
        thinking: 'high',
      });
    });

    it('syncs when the user object arrives after store creation', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      const store = useLLMSettingsStore();
      mockAuthStore.user = makeUser('user-1', makeLlm({ keys: { openai: 'openai-key' } }));
      await nextTick();
      expect(store.llm.keys).toEqual({ openai: 'openai-key' });
    });

    it('resyncs on preference hydration even when the user id stays the same', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      mockAuthStore.user = makeUser('user-1');
      const store = useLLMSettingsStore();
      expect(store.llm.keys).toEqual({});

      mockAuthStore.user = makeUser('user-1', makeLlm({ keys: { google: 'hydrated-key' } }));
      await nextTick();
      expect(store.llm.keys).toEqual({ google: 'hydrated-key' });
    });

    it('resyncs when preferences.llm is assigned in place', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      mockAuthStore.user = makeUser('user-1');
      const store = useLLMSettingsStore();

      mockAuthStore.user.preferences = {
        llm: makeLlm({ keys: { openrouter: 'or-key' } }),
      };
      await nextTick();
      expect(store.llm.keys).toEqual({ openrouter: 'or-key' });
    });

    it('falls back to fresh defaults when the stored llm subtree is malformed', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      mockAuthStore.user = {
        id: 'user-1',
        preferences: {
          llm: { keys: { google: 'leaked' }, thinking: {}, defaultModel: { provider: 'bogus' } },
        },
      };
      const store = useLLMSettingsStore();
      expect(store.llm).toEqual({
        keys: {},
        thinking: {},
        defaultModel: { provider: 'google', model: GOOGLE_DEFAULT },
      });
    });
  });

  describe('sign-out and account switching', () => {
    it('clears in-memory keys and resets the model on sign-out', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      mockAuthStore.user = makeUser(
        'user-a',
        makeLlm({
          keys: { google: 'user-a-google-key', openai: 'user-a-openai-key' },
          thinking: { 'gpt-6.1-sol': 'max' },
          defaultModel: { provider: 'openai', model: 'gpt-6.1-sol' },
        }),
      );
      const store = useLLMSettingsStore();
      expect(store.llm.keys.google).toBe('user-a-google-key');

      mockAuthStore.user = null;
      await nextTick();

      expect(store.llm).toEqual({
        keys: {},
        thinking: {},
        defaultModel: { provider: 'google', model: GOOGLE_DEFAULT },
      });
      expect(store.selection.apiKey).toBeUndefined();
      expect(store.selection.thinking).toBeUndefined();
    });

    it('gives a second user with no llm preferences fresh defaults, never the first user keys', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      mockAuthStore.user = makeUser('user-a', makeLlm({ keys: { google: 'user-a-google-key' } }));
      const store = useLLMSettingsStore();
      expect(store.llm.keys.google).toBe('user-a-google-key');

      mockAuthStore.user = makeUser('user-b');
      await nextTick();

      expect(store.llm).toEqual({
        keys: {},
        thinking: {},
        defaultModel: { provider: 'google', model: GOOGLE_DEFAULT },
      });
    });
  });

  describe('selection', () => {
    it('returns an undefined apiKey when the default provider has no saved key', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      mockAuthStore.user = makeUser(
        'user-1',
        makeLlm({
          keys: { openai: 'openai-key' },
          defaultModel: { provider: 'google', model: GOOGLE_DEFAULT },
        }),
      );
      const store = useLLMSettingsStore();
      expect(store.selection.apiKey).toBeUndefined();
      expect(store.selection.provider).toBe('google');
    });

    it('exposes the saved thinking override only for the selected model', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      mockAuthStore.user = makeUser(
        'user-1',
        makeLlm({
          thinking: { 'claude-sonnet-5-5': 'xhigh', 'gpt-6.1-sol': 'low' },
          defaultModel: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
        }),
      );
      const store = useLLMSettingsStore();
      expect(store.selection.thinking).toBe('xhigh');
    });
  });

  describe('saveProvider', () => {
    it('saves a key for only the target provider and preserves everything else', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      mockAuthStore.user = makeUser(
        'user-1',
        makeLlm({
          keys: { google: 'saved-google-key' },
          thinking: { 'gemini-3.8-flash': 'low' },
          defaultModel: { provider: 'openai', model: 'gpt-6.1-sol' },
        }),
      );
      const store = useLLMSettingsStore();

      const ok = await store.saveProvider('openai', ' new-openai-key ', {
        'gpt-6.1-sol': 'high',
      });

      expect(ok).toBe(true);
      expect(lastPatch()).toEqual({
        llm: {
          keys: { google: 'saved-google-key', openai: 'new-openai-key' },
          thinking: { 'gemini-3.8-flash': 'low', 'gpt-6.1-sol': 'high' },
          defaultModel: { provider: 'openai', model: 'gpt-6.1-sol' },
        },
      });
      expect(store.llm.keys.openai).toBe('new-openai-key');
      expect(store.llm.thinking['gpt-6.1-sol']).toBe('high');
    });

    it('removes a saved key on empty input without changing the default model', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      mockAuthStore.user = makeUser(
        'user-1',
        makeLlm({
          keys: { google: 'saved-google-key' },
          defaultModel: { provider: 'google', model: GOOGLE_DEFAULT },
        }),
      );
      const store = useLLMSettingsStore();

      const ok = await store.saveProvider('google', '');

      expect(ok).toBe(true);
      expect(lastPatch()).toEqual({
        llm: expect.objectContaining({
          keys: {},
          defaultModel: { provider: 'google', model: GOOGLE_DEFAULT },
        }),
      });
      expect(store.llm.keys.google).toBeUndefined();
      expect(store.selection.provider).toBe('google');
      expect(store.selection.model).toBe(GOOGLE_DEFAULT);
    });

    it('deletes a thinking override when the patch entry is null', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      mockAuthStore.user = makeUser('user-1', makeLlm({ thinking: { 'gpt-6.1-sol': 'high' } }));
      const store = useLLMSettingsStore();

      await store.saveProvider('openai', 'k', { 'gpt-6.1-sol': null });

      expect(lastPatch()).toEqual({
        llm: expect.objectContaining({ thinking: {} }),
      });
      expect(store.llm.thinking['gpt-6.1-sol']).toBeUndefined();
    });

    it('ignores thinking patch entries for models that belong to other providers', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      mockAuthStore.user = makeUser('user-1', makeLlm({ thinking: { 'gpt-6.1-sol': 'low' } }));
      const store = useLLMSettingsStore();

      const ok = await store.saveProvider('google', 'google-key', {
        'gpt-6.1-sol': 'high',
        'gemini-3.8-flash': 'low',
      });

      expect(ok).toBe(true);
      expect(lastPatch()).toEqual({
        llm: expect.objectContaining({
          thinking: { 'gpt-6.1-sol': 'low', 'gemini-3.8-flash': 'low' },
        }),
      });
      expect(store.llm.thinking['gpt-6.1-sol']).toBe('low');
      expect(store.llm.thinking['gemini-3.8-flash']).toBe('low');
    });

    it('applies no thinking entries for an openrouter save', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      mockAuthStore.user = makeUser('user-1', makeLlm({ thinking: { 'gemini-3.8-flash': 'low' } }));
      const store = useLLMSettingsStore();

      const ok = await store.saveProvider('openrouter', 'or-key', {
        'acme/custom:free': 'high',
        'gpt-6.1-sol': 'high',
      });

      expect(ok).toBe(true);
      expect(lastPatch()).toEqual({
        llm: expect.objectContaining({
          keys: { openrouter: 'or-key' },
          thinking: { 'gemini-3.8-flash': 'low' },
        }),
      });
      expect(store.llm.thinking).toEqual({ 'gemini-3.8-flash': 'low' });
    });

    it('does not commit locally and reports failure when the profile write fails', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      mockAuthStore.user = makeUser('user-1', makeLlm({ keys: { google: 'before' } }));
      const store = useLLMSettingsStore();
      mockAuthStore.updatePreferences.mockResolvedValue(false);

      const ok = await store.saveProvider('google', 'after', {});

      expect(ok).toBe(false);
      expect(store.llm.keys.google).toBe('before');
    });

    it('returns false when no user is signed in', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      const store = useLLMSettingsStore();
      const ok = await store.saveProvider('google', 'k', {});
      expect(ok).toBe(false);
      expect(mockAuthStore.updatePreferences).not.toHaveBeenCalled();
    });
  });

  describe('saveDefault', () => {
    it('persists only the provider/model pair', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      mockAuthStore.user = makeUser(
        'user-1',
        makeLlm({
          keys: { google: 'saved-google-key' },
          thinking: { 'claude-opus-5-5': 'low' },
        }),
      );
      const store = useLLMSettingsStore();

      const ok = await store.saveDefault({ provider: 'anthropic', model: 'claude-opus-5-5' });

      expect(ok).toBe(true);
      expect(lastPatch()).toEqual({
        llm: {
          keys: { google: 'saved-google-key' },
          thinking: { 'claude-opus-5-5': 'low' },
          defaultModel: { provider: 'anthropic', model: 'claude-opus-5-5' },
        },
      });
      expect(store.selection.provider).toBe('anthropic');
      expect(store.selection.model).toBe('claude-opus-5-5');
      expect(store.selection.apiKey).toBeUndefined();
      expect(store.selection.thinking).toBe('low');
    });

    it('accepts a free-form OpenRouter model id', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      mockAuthStore.user = makeUser('user-1', makeLlm());
      const store = useLLMSettingsStore();

      await store.saveDefault({ provider: 'openrouter', model: 'acme/custom:free' });

      expect(lastPatch()).toEqual({
        llm: expect.objectContaining({
          defaultModel: { provider: 'openrouter', model: 'acme/custom:free' },
        }),
      });
    });

    it('does not commit locally when the profile write fails', async () => {
      const { useLLMSettingsStore } = await import('./llmSettings');
      mockAuthStore.user = makeUser('user-1', makeLlm());
      const store = useLLMSettingsStore();
      mockAuthStore.updatePreferences.mockResolvedValue(false);

      const ok = await store.saveDefault({ provider: 'openai', model: 'gpt-6.1-sol' });

      expect(ok).toBe(false);
      expect(store.llm.defaultModel).toEqual({ provider: 'google', model: GOOGLE_DEFAULT });
    });
  });
});

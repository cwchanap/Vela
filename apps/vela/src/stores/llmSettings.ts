import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { LocalStorage } from 'quasar';
import {
  LLM_PROVIDER_REGISTRY,
  LLM_PROVIDERS,
  type LlmProvider,
  type LlmEffort,
} from '@vela/common';
import { useAuthStore } from './auth';
import type { LlmPreferences } from '../types/shared';

export interface LlmSelection {
  provider: LlmProvider;
  model: string;
  apiKey?: string | undefined;
  thinking?: LlmEffort | undefined;
}

export type LlmThinkingPatch = Record<string, LlmEffort | null | undefined>;

const DEFAULT_PROVIDER: LlmProvider = 'google';
const LEGACY_STORAGE_KEY = 'llm_settings_v1';

const purgeLegacyStorage = () => {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
  } catch {
    // Ignore environments where localStorage is unavailable
  }
  try {
    if (LocalStorage.has(LEGACY_STORAGE_KEY)) {
      LocalStorage.remove(LEGACY_STORAGE_KEY);
    }
  } catch {
    // Ignore Quasar LocalStorage mock/SSR errors
  }
};

const emptyLlm = (): LlmPreferences => ({
  keys: {},
  thinking: {},
  defaultModel: {
    provider: DEFAULT_PROVIDER,
    model: LLM_PROVIDER_REGISTRY[DEFAULT_PROVIDER].defaultModel,
  },
});

const isKnownProvider = (p: unknown): p is LlmProvider =>
  typeof p === 'string' && (LLM_PROVIDERS as readonly string[]).includes(p);

const isLlmPreferences = (value: unknown): value is LlmPreferences => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<LlmPreferences>;
  const dm = candidate.defaultModel;
  return (
    !!candidate.keys &&
    typeof candidate.keys === 'object' &&
    !!candidate.thinking &&
    typeof candidate.thinking === 'object' &&
    !!dm &&
    typeof dm === 'object' &&
    isKnownProvider(dm.provider) &&
    typeof dm.model === 'string'
  );
};

const cloneLlm = (value: LlmPreferences): LlmPreferences => ({
  keys: { ...value.keys },
  thinking: { ...value.thinking },
  defaultModel: { ...value.defaultModel },
});

export const useLLMSettingsStore = defineStore('llmSettings', () => {
  purgeLegacyStorage();

  const auth = useAuthStore();

  const llm = ref<LlmPreferences>(emptyLlm());

  const selection = computed<LlmSelection>(() => {
    const { provider, model } = llm.value.defaultModel;
    return {
      provider,
      model,
      apiKey: llm.value.keys[provider],
      thinking: llm.value.thinking[model],
    };
  });

  const syncFromAuth = () => {
    const prefs = auth.user?.preferences?.llm;
    llm.value = isLlmPreferences(prefs) ? cloneLlm(prefs) : emptyLlm();
  };

  watch(() => [auth.user?.id, auth.user?.preferences?.llm], syncFromAuth, {
    deep: true,
    immediate: true,
  });

  const saveProvider = async (
    provider: LlmProvider,
    key: string | null | undefined,
    thinkingPatch: LlmThinkingPatch = {},
  ): Promise<boolean> => {
    if (!auth.user) return false;
    const trimmed = (key ?? '').trim();
    const allowedModelIds = new Set(
      LLM_PROVIDER_REGISTRY[provider].models?.map((model) => model.id) ?? [],
    );
    return await auth.updatePreferences((current) => {
      const next = isLlmPreferences(current.llm) ? cloneLlm(current.llm) : emptyLlm();
      if (trimmed) {
        next.keys[provider] = trimmed;
      } else {
        delete next.keys[provider];
      }
      for (const [modelId, effort] of Object.entries(thinkingPatch)) {
        if (!allowedModelIds.has(modelId)) continue;
        if (effort) {
          next.thinking[modelId] = effort;
        } else {
          delete next.thinking[modelId];
        }
      }
      return { llm: next };
    });
  };

  const saveDefault = async (pair: { provider: LlmProvider; model: string }): Promise<boolean> => {
    if (!auth.user) return false;
    return await auth.updatePreferences((current) => {
      const next = isLlmPreferences(current.llm) ? cloneLlm(current.llm) : emptyLlm();
      next.defaultModel = { provider: pair.provider, model: pair.model };
      return { llm: next };
    });
  };

  return {
    llm,
    selection,
    saveProvider,
    saveDefault,
  };
});

import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import {
  LLM_PROVIDER_REGISTRY,
  LLM_PROVIDERS,
  MAX_LLM_THINKING_OVERRIDES,
  type LlmModelPair,
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

export type LlmThinkingPatch = Record<string, LlmEffort | null>;

const DEFAULT_PROVIDER: LlmProvider = 'google';

const emptyLlm = (): LlmPreferences => ({
  keys: {},
  thinking: {},
  defaultModel: {
    provider: DEFAULT_PROVIDER,
    model: LLM_PROVIDER_REGISTRY[DEFAULT_PROVIDER].defaultModel,
  },
});

const REGISTRY_MODEL_IDS = new Set(
  LLM_PROVIDERS.flatMap(
    (provider) => LLM_PROVIDER_REGISTRY[provider].models?.map((model) => model.id) ?? [],
  ),
);

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
  const auth = useAuthStore();

  const llm = ref<LlmPreferences>(emptyLlm());

  // Single source of pair → { key, saved effort } lookup; the global selection
  // and thread-specific chat choices both resolve through it.
  const selectionFor = (pair: LlmModelPair): LlmSelection => {
    const { provider, model } = pair;
    return {
      provider,
      model,
      apiKey: llm.value.keys[provider],
      thinking:
        LLM_PROVIDER_REGISTRY[provider].models?.some((entry) => entry.id === model) &&
        Object.hasOwn(llm.value.thinking, model)
          ? llm.value.thinking[model]
          : undefined,
    };
  };

  const selection = computed<LlmSelection>(() => selectionFor(llm.value.defaultModel));

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
      // Overrides for models outside this build's registry can't be removed
      // through the UI, and at the API cap they block every save. Drop just
      // enough of them to bring the write under the limit.
      if (Object.keys(next.thinking).length > MAX_LLM_THINKING_OVERRIDES) {
        for (const modelId of Object.keys(next.thinking)) {
          if (REGISTRY_MODEL_IDS.has(modelId)) continue;
          delete next.thinking[modelId];
          if (Object.keys(next.thinking).length <= MAX_LLM_THINKING_OVERRIDES) break;
        }
      }
      return { llm: next };
    });
  };

  const saveDefault = async (pair: LlmModelPair): Promise<boolean> => {
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
    selectionFor,
    saveProvider,
    saveDefault,
  };
});

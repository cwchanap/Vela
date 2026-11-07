import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
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

  watch(() => auth.user, syncFromAuth, { deep: true, immediate: true });

  const currentSnapshot = (): LlmPreferences => {
    const prefs = auth.user?.preferences?.llm;
    return isLlmPreferences(prefs) ? cloneLlm(prefs) : emptyLlm();
  };

  let mutationQueue: Promise<void> = Promise.resolve();

  const enqueueMutation = <T>(task: () => Promise<T>): Promise<T> => {
    const run = mutationQueue.then(task);
    mutationQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const saveProvider = (
    provider: LlmProvider,
    key: string | null | undefined,
    thinkingPatch: LlmThinkingPatch = {},
  ): Promise<boolean> => {
    const initiatorId = auth.user?.id;
    return enqueueMutation(async () => {
      if (!initiatorId || auth.user?.id !== initiatorId) return false;
      const next = currentSnapshot();
      const trimmed = (key ?? '').trim();
      if (trimmed) {
        next.keys[provider] = trimmed;
      } else {
        delete next.keys[provider];
      }
      for (const [modelId, effort] of Object.entries(thinkingPatch)) {
        if (effort) {
          next.thinking[modelId] = effort;
        } else {
          delete next.thinking[modelId];
        }
      }
      const ok = await auth.updatePreferences({ llm: next });
      if (ok && auth.user?.id === initiatorId) {
        llm.value = cloneLlm(next);
      }
      return ok;
    });
  };

  const saveDefault = (pair: { provider: LlmProvider; model: string }): Promise<boolean> => {
    const initiatorId = auth.user?.id;
    return enqueueMutation(async () => {
      if (!initiatorId || auth.user?.id !== initiatorId) return false;
      const next = currentSnapshot();
      next.defaultModel = { provider: pair.provider, model: pair.model };
      const ok = await auth.updatePreferences({ llm: next });
      if (ok && auth.user?.id === initiatorId) {
        llm.value = cloneLlm(next);
      }
      return ok;
    });
  };

  return {
    llm,
    selection,
    saveProvider,
    saveDefault,
  };
});

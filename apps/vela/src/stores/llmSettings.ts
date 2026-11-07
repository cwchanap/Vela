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

/** Per-request snapshot consumed by Chat and My Dictionaries. */
export interface LlmSelection {
  provider: LlmProvider;
  model: string;
  apiKey?: string | undefined;
  thinking?: LlmEffort | undefined;
}

/** Effort overrides to apply per model id; a nullish value deletes the entry. */
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

// The profile route tolerantly drops malformed `llm` subtrees on read, but a
// stale write or a preferences payload assembled outside that path can still
// surface one here; anything that does not match the
// {keys,thinking,defaultModel} contract is treated as absent so the snapshot
// resets to fresh defaults instead of keeping partial state.
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

  // State: the single authenticated llm snapshot. The profile is the only
  // source of truth — there is no localStorage mirror.
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

  // Unconditionally replace state on any auth user/profile transition:
  // sign-out, account switch, and preference hydration (even when the user id
  // stays the same) all rebuild from the latest preferences. A missing or
  // malformed llm subtree resets to fresh defaults rather than retaining the
  // previous user's keys.
  const syncFromAuth = () => {
    const prefs = auth.user?.preferences?.llm;
    llm.value = isLlmPreferences(prefs) ? cloneLlm(prefs) : emptyLlm();
  };

  watch(() => auth.user, syncFromAuth, { deep: true, immediate: true });

  // Build the next snapshot from the latest authenticated preferences so a
  // save can never resurrect state the profile no longer holds.
  const currentSnapshot = (): LlmPreferences => {
    const prefs = auth.user?.preferences?.llm;
    return isLlmPreferences(prefs) ? cloneLlm(prefs) : emptyLlm();
  };

  const saveProvider = async (
    provider: LlmProvider,
    key: string | null | undefined,
    thinkingPatch: LlmThinkingPatch = {},
  ): Promise<boolean> => {
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
    if (ok) llm.value = cloneLlm(next);
    return ok;
  };

  const saveDefault = async (pair: { provider: LlmProvider; model: string }): Promise<boolean> => {
    const next = currentSnapshot();
    next.defaultModel = { provider: pair.provider, model: pair.model };
    const ok = await auth.updatePreferences({ llm: next });
    if (ok) llm.value = cloneLlm(next);
    return ok;
  };

  return {
    llm,
    selection,
    saveProvider,
    saveDefault,
  };
});

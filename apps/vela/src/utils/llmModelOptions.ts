import {
  LLM_PROVIDER_REGISTRY,
  LLM_PROVIDERS,
  type LlmEffort,
  type LlmModelInfo,
  type LlmProvider,
} from '@vela/common';

/**
 * Pure model-option rules shared by Settings and Chat: provider-encoded pair
 * values, registry model/effort lists, key/capability filtering, the
 * OpenRouter custom-model entry and the display-only unavailable option.
 * No store or query access — callers pass plain data.
 */

export interface LlmModelPair {
  provider: LlmProvider;
  model: string;
}

export interface LlmModelOption {
  label: string;
  value: string;
  provider: LlmProvider;
  /** Set for display-only options that cannot be activated right now. */
  disabled?: boolean;
}

/** Select value for a free-form OpenRouter model ID awaiting confirmation. */
export const OPENROUTER_CUSTOM_VALUE = 'openrouter::__custom__';

export const encodeModelPair = (provider: LlmProvider, model: string): string =>
  `${provider}::${model}`;

export const pairToOptionValue = (provider: LlmProvider, model: string): string =>
  provider === 'openrouter' ? OPENROUTER_CUSTOM_VALUE : encodeModelPair(provider, model);

export const decodeModelValue = (value: string): LlmModelPair | null => {
  const separator = value.indexOf('::');
  if (separator <= 0) return null;
  const provider = value.slice(0, separator);
  if (!(LLM_PROVIDERS as readonly string[]).includes(provider)) return null;
  return { provider: provider as LlmProvider, model: value.slice(separator + 2) };
};

export const registryModels = (provider: LlmProvider): readonly LlmModelInfo[] =>
  LLM_PROVIDER_REGISTRY[provider].models ?? [];

export const registryModel = (pair: LlmModelPair | null): LlmModelInfo | null =>
  pair
    ? (LLM_PROVIDER_REGISTRY[pair.provider].models?.find((model) => model.id === pair.model) ??
      null)
    : null;

export const effortOptions = (
  model: Pick<LlmModelInfo, 'efforts'>,
): Array<{ label: string; value: LlmEffort | '' }> => [
  { label: 'Default', value: '' },
  ...model.efforts.map((effort) => ({ label: effort, value: effort })),
];

/** /llm-chat/capabilities is the only source of server-key eligibility; a
 * failed or missing lookup means no server-key-only choices. */
export const confirmedServerKeyProviders = (
  data: unknown,
  opts: { isAuthenticated: boolean; isError: boolean },
): LlmProvider[] => {
  if (!opts.isAuthenticated || opts.isError) return [];
  const providers: unknown = (data as { serverKeyProviders?: unknown } | null | undefined)
    ?.serverKeyProviders;
  if (!Array.isArray(providers)) return [];
  return providers.filter(
    (provider): provider is LlmProvider =>
      typeof provider === 'string' && (LLM_PROVIDERS as readonly string[]).includes(provider),
  );
};

/** One option per model of every provider with a user key or confirmed server key. */
export const buildLlmModelOptions = (
  keys: Partial<Record<LlmProvider, string>>,
  serverKeyProviders: readonly LlmProvider[] = [],
): LlmModelOption[] => {
  const options: LlmModelOption[] = [];
  for (const provider of LLM_PROVIDERS) {
    const hasUserKey = !!keys[provider];
    const hasServerKey = serverKeyProviders.includes(provider);
    if (!hasUserKey && !hasServerKey) continue;
    const registry = LLM_PROVIDER_REGISTRY[provider];
    const suffix = hasUserKey ? '' : ' (server key)';
    if (registry.models) {
      for (const model of registry.models) {
        options.push({
          label: `${registry.label} — ${model.id}${suffix}`,
          value: encodeModelPair(provider, model.id),
          provider,
        });
      }
    } else {
      options.push({
        label: `OpenRouter (custom ID${hasUserKey ? '' : ', server key'})`,
        value: OPENROUTER_CUSTOM_VALUE,
        provider,
      });
    }
  }
  return options;
};

/** Display-only option for a saved/current pair outside the available set. */
export const llmPairOption = (provider: LlmProvider, model: string): LlmModelOption => ({
  label:
    provider === 'openrouter'
      ? 'OpenRouter (custom ID)'
      : `${LLM_PROVIDER_REGISTRY[provider].label} — ${model}`,
  value: pairToOptionValue(provider, model),
  provider,
});

/** Whether a pair is an actually selectable option (display-only unavailable
 * options and options missing from the set are not). */
export const isPairAvailable = (
  options: readonly LlmModelOption[],
  pair: LlmModelPair,
): boolean => {
  const value = pairToOptionValue(pair.provider, pair.model);
  const option = options.find((candidate) => candidate.value === value);
  return option !== undefined && option.disabled !== true;
};

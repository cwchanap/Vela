/**
 * Shared LLM provider contract: the closed provider tuple, the per-model
 * registry, and the normalized message/usage/event types every provider
 * adapter maps to.
 *
 * Pure data and types only — no SDK imports, no runtime provider discovery —
 * so the web app can re-export it through the root barrel while the API
 * imports the `@vela/common/contracts/llm` subpath without pulling in
 * Vue/query-client code.
 */

/** Native effort/thinking values used across supported providers. */
export const LLM_EFFORT_LEVELS = ['none', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export type LlmEffort = (typeof LLM_EFFORT_LEVELS)[number];

/** Maximum per-model thinking overrides stored in a profile (API write cap). */
export const MAX_LLM_THINKING_OVERRIDES = 128;

/** Closed list of supported providers; the single source for provider unions. */
export const LLM_PROVIDERS = ['google', 'openai', 'anthropic', 'openrouter'] as const;

export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export interface LlmModelPair {
  provider: LlmProvider;
  model: string;
}

export interface LlmPreferences {
  keys: Partial<Record<LlmProvider, string>>;
  thinking: Record<string, LlmEffort>;
  defaultModel: LlmModelPair;
}

export type LlmMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
};

export type LlmEvent =
  | { type: 'text'; text: string }
  | { type: 'usage'; usage: LlmUsage }
  | { type: 'error'; message: string };

export type LlmResponse = { text: string; usage: LlmUsage };

export interface LlmModelInfo {
  /** Model ID exactly as the provider API expects it. */
  id: string;
  /** Native effort values this model accepts, in provider order. */
  efforts: readonly LlmEffort[];
  /** Effort applied when a request does not specify one. */
  defaultEffort: LlmEffort;
}

export interface LlmProviderInfo {
  /** Single display label for the provider — UI selects, API error messages. */
  label: string;
  /** Model used when a request omits `model`. */
  defaultModel: string;
  /** Server-side prompt cache TTL in seconds; null when the provider has none. */
  cacheTtlSeconds: number | null;
  /**
   * Fixed model registry, or null for free-form providers (OpenRouter) that
   * accept any user-specified model ID.
   */
  models: readonly LlmModelInfo[] | null;
}

const LOW_TO_HIGH = ['low', 'medium', 'high'] as const satisfies readonly LlmEffort[];
const LOW_TO_MAX = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly LlmEffort[];
const NONE_TO_MAX = [
  'none',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly LlmEffort[];

// Model IDs, effort lists, defaults, and cache TTLs verified against provider
// docs on 2026-11-05 — see task-0-report.md §3–5 in
// .superpowers/sdd/2026-11-03-hpa754-llm-provider-foundation/.
export const LLM_PROVIDER_REGISTRY: Readonly<Record<LlmProvider, LlmProviderInfo>> = {
  google: {
    label: 'Google',
    defaultModel: 'gemini-3.8-flash',
    cacheTtlSeconds: null,
    models: [
      { id: 'gemini-3.8-flash', efforts: LOW_TO_HIGH, defaultEffort: 'medium' },
      { id: 'gemini-4-argon', efforts: LOW_TO_HIGH, defaultEffort: 'medium' },
    ],
  },
  openai: {
    label: 'OpenAI',
    defaultModel: 'gpt-6.1-sol',
    cacheTtlSeconds: 1800,
    models: [
      { id: 'gpt-6.1-sol', efforts: LOW_TO_MAX, defaultEffort: 'medium' },
      { id: 'gpt-6.1-terra', efforts: NONE_TO_MAX, defaultEffort: 'medium' },
      { id: 'gpt-6-luna', efforts: NONE_TO_MAX, defaultEffort: 'medium' },
      { id: 'gpt-6-astra', efforts: LOW_TO_MAX, defaultEffort: 'medium' },
      { id: 'gpt-5.6-sol', efforts: NONE_TO_MAX, defaultEffort: 'medium' },
      { id: 'gpt-5.6-terra', efforts: NONE_TO_MAX, defaultEffort: 'medium' },
      { id: 'gpt-5.6-luna', efforts: NONE_TO_MAX, defaultEffort: 'medium' },
    ],
  },
  anthropic: {
    label: 'Anthropic',
    defaultModel: 'claude-opus-5-5',
    cacheTtlSeconds: 300,
    models: [
      { id: 'claude-opus-5-5', efforts: LOW_TO_MAX, defaultEffort: 'medium' },
      { id: 'claude-sonnet-5-5', efforts: LOW_TO_MAX, defaultEffort: 'high' },
      { id: 'claude-haiku-5-5', efforts: LOW_TO_MAX, defaultEffort: 'medium' },
    ],
  },
  openrouter: {
    label: 'OpenRouter',
    defaultModel: 'openai/gpt-oss-20b:free',
    cacheTtlSeconds: null,
    models: null,
  },
};

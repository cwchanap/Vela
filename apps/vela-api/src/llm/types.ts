import type { LlmEffort, LlmEvent, LlmMessage } from '@vela/common/contracts/llm';

/** Chat output-token default; conservative for thinking models. */
export const CHAT_MAX_TOKENS = 4096;
/** Dictionary analysis output-token default, deliberately below chat. */
export const DICTIONARY_MAX_TOKENS = 3072;
/**
 * Hard ceiling on any single provider request, strictly below the API
 * gateway's ~29-second integration timeout (deployed at 29000 ms).
 */
export const REQUEST_TIMEOUT_MS = 25_000;

/**
 * Private adapter input: a normalized request plus credentials and limits.
 * Built by routes from `NormalizedLlmRequest`; never exposed to the browser.
 */
export interface LlmStreamInput {
  model: string;
  /** Resolved native effort; null when the provider has no effort concept. */
  effort: LlmEffort | null;
  /** Single combined system instruction, or null when none was supplied. */
  system: string | null;
  messages: LlmMessage[];
  apiKey: string;
  maxTokens: number;
  /** Caller cancellation (e.g. client disconnect); combined with the timeout. */
  signal?: AbortSignal;
  /** OpenRouter attribution headers (existing behavior). */
  referer?: string;
  appName?: string;
}

export interface LlmProviderAdapter {
  stream(input: LlmStreamInput): AsyncIterable<LlmEvent>; // eslint-disable-line no-unused-vars
}

/**
 * Pure vendor-event mapper: translates recorded vendor events into shared
 * LlmEvents so it can be tested from fixtures alone.
 *
 * `end()` runs when the vendor stream is exhausted and MUST flag a missing
 * successful terminal as an error: `LlmEvent` has no success-terminal
 * variant, so both `collectStream` and the dictionary SSE route treat normal
 * exhaustion as success. Without this guard a truncated or failing stream
 * would be reported as a false success.
 */
export interface VendorEventMapper<T> {
  push(vendorEvent: T): LlmEvent[]; // eslint-disable-line no-unused-vars
  end(): LlmEvent[];
}

/**
 * Sanitize any provider failure into a safe error event: HTTP status or error
 * name only. Vendor bodies and messages can echo request material (including
 * API keys) and must never reach the browser.
 */
export function sanitizeProviderError(provider: string, error: unknown): LlmEvent {
  const candidate = error as { status?: unknown; name?: unknown } | null;
  const detail =
    typeof candidate?.status === 'number'
      ? String(candidate.status)
      : typeof candidate?.name === 'string' && candidate.name && candidate.name !== 'Error'
        ? candidate.name
        : null;
  return {
    type: 'error',
    message: detail ? `${provider} request failed (${detail})` : `${provider} request failed`,
  };
}

/**
 * Abort signal that fires on the shared request timeout, or earlier when the
 * caller's own signal aborts. Used by the fetch-based adapters; the SDK
 * adapters receive `timeout` and `signal` as separate request options.
 */
export function withRequestTimeout(callerSignal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
}

import type { LlmEffort, LlmEvent, LlmMessage, LlmProvider } from '@vela/common/contracts/llm';

/** Display labels for error messages; single source for the API routes. */
export const PROVIDER_LABELS: Record<LlmProvider, string> = {
  google: 'Google',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
};

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
 * Deadline/abort error classes across transports: DOM fetch/AbortSignal
 * ('TimeoutError'/'AbortError' — Node's AbortSignal.timeout aborts fetch with
 * TimeoutError) and the SDKs ('APIUserAbortError' from a signal abort,
 * 'APIConnectionTimeoutError' from the SDK's own `timeout`). SDK error
 * classes carry `name === 'Error'`, so the constructor name is checked too.
 * Fixed class names only — never vendor data.
 */
const TIMEOUT_ERROR_CLASSES = new Set([
  'TimeoutError',
  'AbortError',
  'APIUserAbortError',
  'APIConnectionTimeoutError',
]);

function isTimeoutFailure(error: unknown): boolean {
  const candidate = error as { name?: unknown; constructor?: { name?: unknown } } | null;
  return (
    (typeof candidate?.name === 'string' && TIMEOUT_ERROR_CLASSES.has(candidate.name)) ||
    (typeof candidate?.constructor?.name === 'string' &&
      TIMEOUT_ERROR_CLASSES.has(candidate.constructor.name))
  );
}

/**
 * Sanitize any provider failure into a safe error event: HTTP status or error
 * name only. Vendor bodies and messages can echo request material (including
 * API keys) and must never reach the browser. Deadline/abort failures get a
 * fixed timeout message so the browser can surface its deadline hint (the
 * status stays a plain 502/SSE error, never a gateway 504).
 */
export function sanitizeProviderError(provider: string, error: unknown): LlmEvent {
  if (isTimeoutFailure(error)) {
    return { type: 'error', message: `${provider} request timed out` };
  }
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
 * Vendor event codes and finish reasons are untrusted: a compromised or
 * intercepted upstream can put any string there (including echoed API keys),
 * and every consumer of these events (chat route and dictionary SSE) exposes
 * error messages to the browser. Only finite numbers and explicitly
 * allowlisted enum names may be interpolated; anything else degrades to a
 * fixed label. Unknown-but-legitimate future codes also degrade safely.
 */
export function safeVendorCode(code: unknown, allowed: ReadonlySet<string>): string {
  if (typeof code === 'number' && Number.isFinite(code)) return String(code);
  if (typeof code === 'string' && allowed.has(code)) return code;
  return 'unknown';
}

/**
 * Abort signal that fires on the shared request timeout, or earlier when the
 * caller's own signal aborts. Used by the fetch-based adapters directly and
 * passed as the SDK adapters' request signal — the SDK's own `timeout` only
 * bounds time-to-headers, so this signal is what bounds stream consumption.
 */
export function withRequestTimeout(callerSignal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
}

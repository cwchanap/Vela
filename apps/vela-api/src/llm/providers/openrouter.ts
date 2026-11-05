import type { LlmEvent } from '@vela/common/contracts/llm';
import { readSseDataLines } from '../sse';
import {
  safeVendorCode,
  sanitizeProviderError,
  withRequestTimeout,
  type LlmProviderAdapter,
  type LlmStreamInput,
  type VendorEventMapper,
} from '../types';

/** Minimal Chat Completions SSE chunk shape the mapper consumes. */
export interface OpenRouterStreamChunk {
  choices?: Array<{
    delta?: { content?: string; reasoning?: string };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  error?: { code?: number | string; message?: string };
}

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

// Documented string codes in this stream shape: Chat Completions failure
// finish reasons ('stop' is the success terminal). Error `code` is documented
// as numeric, so numbers pass as-is via the number branch.
const OPENROUTER_KNOWN_CODES = new Set(['length', 'content_filter', 'tool_calls', 'function_call']);

/**
 * Pure OpenRouter Chat Completions chunk mapper. Success terminal is
 * `finish_reason: 'stop'`; OpenRouter puts the finish reason on a
 * content-free delta in the final usage chunk. Error objects and non-stop
 * finish reasons are failures, and `end()` flags a stream that never
 * finished.
 */
export function createOpenRouterMapper(): VendorEventMapper<OpenRouterStreamChunk> {
  let status: 'pending' | 'succeeded' | 'failed' = 'pending';
  return {
    push(chunk) {
      if (chunk.error) {
        if (status === 'pending') status = 'failed';
        return [
          {
            type: 'error',
            message: `OpenRouter stream error (${safeVendorCode(chunk.error.code, OPENROUTER_KNOWN_CODES)})`,
          },
        ];
      }
      const events: LlmEvent[] = [];
      const choice = chunk.choices?.[0];
      // Reasoning deltas are thinking output, never user-visible text.
      if (choice?.delta?.content) events.push({ type: 'text', text: choice.delta.content });
      if (chunk.usage) {
        events.push({
          type: 'usage',
          usage: {
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
            cachedInputTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
            cacheWriteTokens: 0,
          },
        });
      }
      const finish = choice?.finish_reason;
      if (finish && status === 'pending') {
        if (finish === 'stop') {
          status = 'succeeded';
        } else {
          status = 'failed';
          events.push({
            type: 'error',
            message: `OpenRouter stream finished early (${safeVendorCode(finish, OPENROUTER_KNOWN_CODES)})`,
          });
        }
      }
      return events;
    },
    end() {
      if (status !== 'pending') return [];
      return [{ type: 'error', message: 'OpenRouter stream ended without a successful finish' }];
    },
  };
}

export async function* streamOpenRouterChat(
  input: LlmStreamInput,
  fetchFn: typeof fetch = fetch,
): AsyncIterable<LlmEvent> {
  const mapper = createOpenRouterMapper();
  try {
    const res = await fetchFn(OPENROUTER_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.apiKey}`,
        ...(input.referer ? { 'HTTP-Referer': input.referer } : {}),
        'X-Title': input.appName || 'Vela Japanese Learning App',
      },
      body: JSON.stringify({
        model: input.model,
        messages: [
          ...(input.system ? [{ role: 'system', content: input.system }] : []),
          ...input.messages.map((message) => ({ role: message.role, content: message.content })),
        ],
        // Current sampling behavior, unchanged from the existing route.
        temperature: 0.7,
        max_tokens: input.maxTokens,
        stream: true,
      }),
      signal: withRequestTimeout(input.signal),
    });
    if (!res.ok) {
      yield sanitizeProviderError('OpenRouter', { status: res.status });
      return;
    }
    if (!res.body) {
      yield { type: 'error', message: 'OpenRouter request failed (empty body)' };
      return;
    }
    for await (const line of readSseDataLines(res.body)) {
      if (line === '[DONE]') continue;
      let chunk: unknown;
      try {
        chunk = JSON.parse(line);
      } catch {
        // Malformed upstream data is a failed stream, never a success: emit
        // a sanitized error and stop, so no later terminal can yield done.
        yield { type: 'error', message: 'OpenRouter stream failed (malformed data)' };
        return;
      }
      yield* mapper.push(chunk as OpenRouterStreamChunk);
    }
    yield* mapper.end();
  } catch (error) {
    yield sanitizeProviderError('OpenRouter', error);
  }
}

export const openrouterProvider: LlmProviderAdapter = {
  stream: (input) => streamOpenRouterChat(input),
};

import OpenAI from 'openai';
import type { LlmEvent } from '@vela/common/contracts/llm';
import {
  REQUEST_TIMEOUT_MS,
  sanitizeProviderError,
  type LlmProviderAdapter,
  type LlmStreamInput,
  type VendorEventMapper,
} from '../types';

/* eslint-disable no-unused-vars -- function-type parameter names are never "used" */
type SdkClientFactory<C> = (apiKey: string) => C;
/* eslint-enable no-unused-vars */

/** Minimal Responses streaming-event shape the mapper consumes. */
export interface OpenAiStreamEvent {
  type: string;
  /** Text delta on `response.output_text.delta`; object deltas elsewhere. */
  delta?: unknown;
  code?: string | null;
  response?: {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
    } | null;
    error?: { code?: string | null } | null;
    incomplete_details?: { reason?: string | null } | null;
  };
}

type OpenAiUsage = NonNullable<NonNullable<OpenAiStreamEvent['response']>['usage']>;

function usageEvents(usage?: OpenAiUsage | null): LlmEvent[] {
  if (!usage) return [];
  return [
    {
      type: 'usage',
      usage: {
        // input_tokens already includes cached reads and cache writes.
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cachedInputTokens: usage.input_tokens_details?.cached_tokens ?? 0,
        cacheWriteTokens: usage.input_tokens_details?.cache_write_tokens ?? 0,
      },
    },
  ];
}

/**
 * Pure OpenAI Responses event mapper. Success terminal is
 * `response.completed`; `response.failed`, `response.incomplete`,
 * refusal deltas, and mid-stream `error` events are failures, and `end()`
 * flags a stream that never completed.
 */
export function createOpenAiMapper(): VendorEventMapper<OpenAiStreamEvent> {
  let status: 'pending' | 'succeeded' | 'failed' = 'pending';
  return {
    push(event) {
      switch (event.type) {
        case 'response.output_text.delta':
          return typeof event.delta === 'string' ? [{ type: 'text', text: event.delta }] : [];
        case 'response.completed': {
          status = 'succeeded';
          return usageEvents(event.response?.usage);
        }
        case 'response.failed': {
          status = 'failed';
          return [
            {
              type: 'error',
              message: `OpenAI response failed (${event.response?.error?.code ?? 'unknown'})`,
            },
          ];
        }
        case 'response.incomplete': {
          status = 'failed';
          return [
            {
              type: 'error',
              message: `OpenAI response incomplete (${event.response?.incomplete_details?.reason ?? 'unknown'})`,
            },
          ];
        }
        case 'response.refusal.delta':
        case 'response.refusal.done':
          if (status === 'pending') {
            status = 'failed';
            return [{ type: 'error', message: 'OpenAI response was refused' }];
          }
          return [];
        case 'error':
          status = 'failed';
          return [{ type: 'error', message: 'OpenAI stream error' }];
        default:
          return [];
      }
    },
    end() {
      if (status !== 'pending') return [];
      return [{ type: 'error', message: 'OpenAI stream ended without a completed response' }];
    },
  };
}

export async function* streamOpenAiResponses(
  input: LlmStreamInput,
  createClient: SdkClientFactory<OpenAI> = (apiKey) =>
    new OpenAI({ apiKey: apiKey, maxRetries: 0 }),
): AsyncIterable<LlmEvent> {
  const mapper = createOpenAiMapper();
  try {
    const stream = await createClient(input.apiKey).responses.create(
      {
        model: input.model,
        max_output_tokens: input.maxTokens,
        ...(input.effort ? { reasoning: { effort: input.effort } } : {}),
        ...(input.system ? { instructions: input.system } : {}),
        input: input.messages.map((message) => ({ role: message.role, content: message.content })),
        stream: true,
      },
      // Retries disabled: SDK retries could exceed the gateway's ~29 s budget.
      { maxRetries: 0, timeout: REQUEST_TIMEOUT_MS, signal: input.signal ?? undefined },
    );
    for await (const event of stream) yield* mapper.push(event);
    yield* mapper.end();
  } catch (error) {
    yield sanitizeProviderError('OpenAI', error);
  }
}

export const openaiProvider: LlmProviderAdapter = {
  stream: (input) => streamOpenAiResponses(input),
};

import Anthropic from '@anthropic-ai/sdk';
import type { LlmEvent } from '@vela/common/contracts/llm';
import {
  REQUEST_TIMEOUT_MS,
  sanitizeProviderError,
  type LlmProviderAdapter,
  type LlmStreamInput,
  type VendorEventMapper,
} from '../types';

export interface AnthropicUsageSnapshot {
  input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  output_tokens?: number | null;
}

/** Minimal Messages streaming-event shape the mapper consumes. */
export type AnthropicStreamEvent =
  | { type: 'message_start'; message: { usage?: AnthropicUsageSnapshot } }
  | { type: 'content_block_start'; index: number; content_block: { type: string } }
  | { type: 'content_block_delta'; index: number; delta: { type: string; text?: string } }
  | { type: 'content_block_stop'; index: number }
  | {
      type: 'message_delta';
      delta: { stop_reason?: string | null };
      usage?: AnthropicUsageSnapshot | null;
    }
  | { type: 'message_stop' };

const SUCCESS_STOP_REASONS = new Set(['end_turn', 'stop_sequence']);

const ANTHROPIC_FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/* eslint-disable no-unused-vars -- function-type parameter names are never "used" */
type SdkClientFactory<C> = (apiKey: string) => C;
/* eslint-enable no-unused-vars */

function usageEvents(usage?: AnthropicUsageSnapshot | null): LlmEvent[] {
  if (!usage) return [];
  return [
    {
      type: 'usage',
      // Anthropic's documented total: input + cache reads + cache writes.
      usage: {
        inputTokens:
          (usage.input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0),
        outputTokens: usage.output_tokens ?? 0,
        cachedInputTokens: usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      },
    },
  ];
}

/**
 * Pure Anthropic Messages event mapper. Success terminal is an `end_turn` /
 * `stop_sequence` stop reason; `refusal`, `max_tokens`, and any other stop
 * reason are failures, and `end()` flags a stream that never stopped
 * successfully.
 *
 * Server-side fallback: `fallback` control blocks (which carry the serving
 * model) are invisible, and only the final reported usage is surfaced —
 * per-attempt `usage.iterations` billing is never summed across attempts.
 */
export function createAnthropicMapper(): VendorEventMapper<AnthropicStreamEvent> {
  let status: 'pending' | 'succeeded' | 'failed' = 'pending';
  return {
    push(event) {
      switch (event.type) {
        case 'message_start':
          return usageEvents(event.message?.usage);
        case 'content_block_delta':
          // Thinking deltas and tool input never reach the UI.
          if (event.delta?.type === 'text_delta' && event.delta.text) {
            return [{ type: 'text', text: event.delta.text }];
          }
          return [];
        case 'message_delta': {
          const events = usageEvents(event.usage);
          const stopReason = event.delta?.stop_reason;
          if (stopReason && status === 'pending') {
            if (SUCCESS_STOP_REASONS.has(stopReason)) {
              status = 'succeeded';
            } else {
              status = 'failed';
              events.push({
                type: 'error',
                message:
                  stopReason === 'refusal'
                    ? 'Anthropic response was refused'
                    : `Anthropic stream finished early (${stopReason})`,
              });
            }
          }
          return events;
        }
        default:
          // content_block_start (incl. fallback control blocks), content_block_stop, message_stop
          return [];
      }
    },
    end() {
      if (status !== 'pending') return [];
      return [{ type: 'error', message: 'Anthropic stream ended without a successful stop' }];
    },
  };
}

export async function* streamAnthropicMessages(
  input: LlmStreamInput,
  createClient: SdkClientFactory<Anthropic> = (apiKey) =>
    new Anthropic({ apiKey: apiKey, maxRetries: 0 }),
): AsyncIterable<LlmEvent> {
  const mapper = createAnthropicMapper();
  try {
    const effort = input.effort;
    const stream = createClient(input.apiKey).beta.messages.stream(
      {
        model: input.model,
        max_tokens: input.maxTokens,
        messages: input.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        ...(input.system ? { system: input.system } : {}),
        // Adaptive thinking stays on (the default); effort is the control.
        ...(effort && effort !== 'none' ? { output_config: { effort } } : {}),
        cache_control: { type: 'ephemeral' },
        // Native server-side refusal fallback. Haiku 5.5 has none server-side;
        // requesting it there is a documented no-op and refusals stay refusals.
        fallbacks: 'default',
        betas: [ANTHROPIC_FALLBACK_BETA],
      },
      // Retries disabled: SDK retries could exceed the gateway's ~29 s budget.
      { maxRetries: 0, timeout: REQUEST_TIMEOUT_MS, signal: input.signal ?? undefined },
    );
    for await (const event of stream) yield* mapper.push(event as AnthropicStreamEvent);
    yield* mapper.end();
  } catch (error) {
    yield sanitizeProviderError('Anthropic', error);
  }
}

export const anthropicProvider: LlmProviderAdapter = {
  stream: (input) => streamAnthropicMessages(input),
};

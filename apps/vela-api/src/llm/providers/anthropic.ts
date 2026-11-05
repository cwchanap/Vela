import Anthropic from '@anthropic-ai/sdk';
import type { LlmEvent } from '@vela/common/contracts/llm';
import {
  REQUEST_TIMEOUT_MS,
  sanitizeProviderError,
  withRequestTimeout,
  type LlmProviderAdapter,
  type LlmStreamInput,
  type VendorEventMapper,
} from '../types';

export interface AnthropicUsageSnapshot {
  input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  output_tokens?: number | null;
  /** Per-attempt billing breakdown; carried for identification only — never summed. */
  iterations?: readonly unknown[] | null;
}

/** Minimal Messages streaming-event shape the mapper consumes. */
export type AnthropicStreamEvent =
  | { type: 'message_start'; message: { usage?: AnthropicUsageSnapshot } }
  | {
      type: 'content_block_start';
      index: number;
      content_block: {
        type: string;
        from?: { model?: string | null } | null;
        to?: { model?: string | null } | null;
      };
    }
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

/**
 * Pure Anthropic Messages event mapper. Success requires BOTH a successful
 * stop reason (`end_turn` / `stop_sequence`) AND the terminal `message_stop`;
 * `refusal`, `max_tokens`, and any other stop reason are failures, and `end()`
 * flags a stream truncated anywhere short of that pair.
 *
 * Server-side fallback: `fallback` control blocks are invisible as events but
 * identify the serving model (`to.model`, matching the SDK's own relabeling);
 * `servingModel()` exposes it without expanding the browser contract. Usage
 * snapshots are cumulative whole-message totals whose fields are omitted (or
 * null) when they don't apply, so counters merge field-by-field and never add
 * across snapshots or per-attempt `usage.iterations` entries.
 */
export function createAnthropicMapper(): VendorEventMapper<AnthropicStreamEvent> & {
  servingModel(): string | null;
} {
  let status: 'pending' | 'succeeded' | 'failed' = 'pending';
  let sawSuccessfulStop = false;
  let serving: string | null = null;
  let inputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let outputTokens = 0;
  const mergeUsage = (usage?: AnthropicUsageSnapshot | null): void => {
    if (usage?.input_tokens != null) inputTokens = usage.input_tokens;
    if (usage?.cache_read_input_tokens != null) cacheReadTokens = usage.cache_read_input_tokens;
    if (usage?.cache_creation_input_tokens != null) {
      cacheWriteTokens = usage.cache_creation_input_tokens;
    }
    if (usage?.output_tokens != null) outputTokens = usage.output_tokens;
  };
  const usageEvent = (): LlmEvent => ({
    type: 'usage',
    usage: {
      inputTokens: inputTokens + cacheReadTokens + cacheWriteTokens,
      outputTokens: outputTokens,
      cachedInputTokens: cacheReadTokens,
      cacheWriteTokens: cacheWriteTokens,
    },
  });
  return {
    push(event) {
      switch (event.type) {
        case 'message_start': {
          mergeUsage(event.message?.usage);
          return event.message?.usage ? [usageEvent()] : [];
        }
        case 'content_block_start': {
          // The final hop's fallback block names the model that served the response.
          if (event.content_block?.type === 'fallback' && event.content_block.to?.model) {
            serving = event.content_block.to.model;
          }
          return [];
        }
        case 'content_block_delta': {
          // Thinking deltas and tool input never reach the UI.
          if (event.delta?.type === 'text_delta' && event.delta.text) {
            return [{ type: 'text', text: event.delta.text }];
          }
          return [];
        }
        case 'message_delta': {
          mergeUsage(event.usage);
          const events = event.usage ? [usageEvent()] : [];
          const stopReason = event.delta?.stop_reason;
          if (stopReason && status === 'pending') {
            if (SUCCESS_STOP_REASONS.has(stopReason)) {
              sawSuccessfulStop = true;
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
        case 'message_stop': {
          if (status === 'pending' && sawSuccessfulStop) status = 'succeeded';
          return [];
        }
        default:
          // content_block_stop
          return [];
      }
    },
    end() {
      if (status !== 'pending') return [];
      return [{ type: 'error', message: 'Anthropic stream ended without a successful stop' }];
    },
    servingModel() {
      return serving;
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
      // The SDK's `timeout` only bounds time-to-headers, so the combined
      // deadline/caller signal bounds stream consumption too.
      {
        maxRetries: 0,
        timeout: REQUEST_TIMEOUT_MS,
        signal: withRequestTimeout(input.signal),
      },
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

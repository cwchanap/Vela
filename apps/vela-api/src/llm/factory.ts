import type { LlmEvent, LlmProvider, LlmResponse, LlmUsage } from '@vela/common/contracts/llm';
import { anthropicProvider } from './providers/anthropic';
import { googleProvider } from './providers/google';
import { openaiProvider } from './providers/openai';
import { openrouterProvider } from './providers/openrouter';
import type { LlmProviderAdapter } from './types';

const ZERO_USAGE: LlmUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
};

/** Closed provider switch — the only place adapters are selected. */
export function createLlmProvider(provider: LlmProvider): LlmProviderAdapter {
  switch (provider) {
    case 'google':
      return googleProvider;
    case 'openai':
      return openaiProvider;
    case 'anthropic':
      return anthropicProvider;
    case 'openrouter':
      return openrouterProvider;
    default:
      throw new Error(`Unsupported provider '${String(provider)}'`);
  }
}

/**
 * Aggregate one provider stream into a chat response: concatenate text,
 * keep the latest usage, and throw on any error event. Adapters already
 * convert refusal, incomplete, and missing-terminal failures into error
 * events, so normal exhaustion here means success. Missing usage becomes
 * zeros, never speculative estimates.
 */
export async function collectStream(stream: AsyncIterable<LlmEvent>): Promise<LlmResponse> {
  let text = '';
  let usage: LlmUsage | null = null;
  for await (const event of stream) {
    if (event.type === 'text') {
      text += event.text;
    } else if (event.type === 'usage') {
      usage = event.usage;
    } else {
      throw new Error(event.message);
    }
  }
  return { text, usage: usage ?? ZERO_USAGE };
}

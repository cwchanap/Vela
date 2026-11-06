import { LLM_PROVIDER_REGISTRY, type LlmEvent } from '@vela/common/contracts/llm';
import { readSseDataLines } from '../sse';
import {
  providerMaxTokens,
  safeVendorCode,
  sanitizeProviderError,
  withRequestTimeout,
  type LlmProviderAdapter,
  type LlmStreamInput,
  type VendorEventMapper,
} from '../types';

/** Minimal `GenerateContentResponse` SSE chunk shape the mapper consumes. */
export interface GeminiStreamChunk {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    cachedContentTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  promptFeedback?: { blockReason?: string };
}

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const PROVIDER = LLM_PROVIDER_REGISTRY.google.label;

// REST thinkingConfig takes proto3 enum names, not the lowercase guide values.
const THINKING_LEVELS: Record<string, string> = { low: 'LOW', medium: 'MEDIUM', high: 'HIGH' };

// Documented GenerateContent enums; 'STOP' is the success terminal.
const GEMINI_FINISH_REASONS = new Set([
  'MAX_TOKENS',
  'SAFETY',
  'RECITATION',
  'PROHIBITED_CONTENT',
  'BLOCKLIST',
  'SPII',
  'MALFORMED_FUNCTION_CALL',
  'IMAGE_SAFETY',
  'UNEXPECTED_TOOL_CALL',
  'TOO_MANY_TOOL_CALLS',
  'FINISH_REASON_UNSPECIFIED',
  'OTHER',
]);
const GEMINI_BLOCK_REASONS = new Set([
  'BLOCK_REASON_UNSPECIFIED',
  'SAFETY',
  'OTHER',
  'BLOCKLIST',
  'PROHIBITED_CONTENT',
  'IMAGE_SAFETY',
  'SPII',
  'EMPTY',
]);

/**
 * Pure Google `:streamGenerateContent?alt=sse` chunk mapper. Success terminal
 * is `finishReason: 'STOP'`; every other finish reason and any prompt
 * blocklist hit is a failure, and `end()` flags a stream that never finished.
 */
export function createGeminiMapper(): VendorEventMapper<GeminiStreamChunk> {
  let status: 'pending' | 'succeeded' | 'failed' = 'pending';
  return {
    push(chunk) {
      const events: LlmEvent[] = [];
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        // Thought summaries are reasoning artifacts, never user-visible text.
        if (part.text && part.thought !== true) events.push({ type: 'text', text: part.text });
      }
      const meta = chunk.usageMetadata;
      if (meta) {
        events.push({
          type: 'usage',
          usage: {
            // promptTokenCount already includes cachedContentTokenCount.
            inputTokens: meta.promptTokenCount ?? 0,
            outputTokens: (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0),
            cachedInputTokens: meta.cachedContentTokenCount ?? 0,
            cacheWriteTokens: 0,
          },
        });
      }
      const blockReason = chunk.promptFeedback?.blockReason;
      if (blockReason && status === 'pending') {
        status = 'failed';
        events.push({
          type: 'error',
          message: `${PROVIDER} request blocked (${safeVendorCode(blockReason, GEMINI_BLOCK_REASONS)})`,
        });
      }
      const finishReason = chunk.candidates?.[0]?.finishReason;
      if (finishReason && status === 'pending') {
        if (finishReason === 'STOP') {
          status = 'succeeded';
        } else {
          status = 'failed';
          events.push({
            type: 'error',
            message: `${PROVIDER} stream finished early (${safeVendorCode(finishReason, GEMINI_FINISH_REASONS)})`,
          });
        }
      }
      return events;
    },
    end() {
      if (status !== 'pending') return [];
      return [{ type: 'error', message: `${PROVIDER} stream ended without a successful finish` }];
    },
  };
}

export async function* streamGemini(
  input: LlmStreamInput,
  fetchFn: typeof fetch = fetch,
): AsyncIterable<LlmEvent> {
  const mapper = createGeminiMapper();
  try {
    const body = {
      contents: input.messages.map((message) => ({
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: message.content }],
      })),
      ...(input.system ? { systemInstruction: { parts: [{ text: input.system }] } } : {}),
      generationConfig: {
        maxOutputTokens: providerMaxTokens(input),
        ...(input.effort && THINKING_LEVELS[input.effort]
          ? { thinkingConfig: { thinkingLevel: THINKING_LEVELS[input.effort] } }
          : {}),
      },
    };
    const res = await fetchFn(`${GEMINI_ENDPOINT}/${input.model}:streamGenerateContent?alt=sse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': input.apiKey },
      body: JSON.stringify(body),
      signal: withRequestTimeout(input.signal),
    });
    if (!res.ok) {
      yield sanitizeProviderError(PROVIDER, { status: res.status });
      return;
    }
    if (!res.body) {
      yield { type: 'error', message: `${PROVIDER} request failed (empty body)` };
      return;
    }
    for await (const line of readSseDataLines(res.body)) {
      let chunk: unknown;
      try {
        chunk = JSON.parse(line);
      } catch {
        // Malformed upstream data is a failed stream, never a success: emit
        // a sanitized error and stop, so no later terminal can yield done.
        yield { type: 'error', message: `${PROVIDER} stream failed (malformed data)` };
        return;
      }
      yield* mapper.push(chunk as GeminiStreamChunk);
    }
    yield* mapper.end();
  } catch (error) {
    yield sanitizeProviderError(PROVIDER, error);
  }
}

export const googleProvider: LlmProviderAdapter = { stream: (input) => streamGemini(input) };

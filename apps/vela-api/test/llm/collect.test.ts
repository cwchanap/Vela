import { describe, expect, test } from 'bun:test';
import type { LlmEvent, LlmProvider } from '@vela/common/contracts/llm';
import { collectStream, createLlmProvider } from '../../src/llm/factory';
import { anthropicProvider } from '../../src/llm/providers/anthropic';
import { googleProvider } from '../../src/llm/providers/google';
import { openaiProvider } from '../../src/llm/providers/openai';
import { openrouterProvider } from '../../src/llm/providers/openrouter';
import { CHAT_MAX_TOKENS, DICTIONARY_MAX_TOKENS, REQUEST_TIMEOUT_MS } from '../../src/llm/types';

async function* of(...events: LlmEvent[]): AsyncGenerator<LlmEvent> {
  yield* events;
}

describe('collectStream', () => {
  test('concatenates text and keeps the last usage', async () => {
    expect(
      await collectStream(
        of(
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
          {
            type: 'usage',
            usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0 },
          },
          {
            type: 'usage',
            usage: { inputTokens: 2, outputTokens: 3, cachedInputTokens: 4, cacheWriteTokens: 5 },
          },
        ),
      ),
    ).toEqual({
      text: 'ab',
      usage: { inputTokens: 2, outputTokens: 3, cachedInputTokens: 4, cacheWriteTokens: 5 },
    });
  });

  test('defaults missing usage to zeros', async () => {
    expect(await collectStream(of({ type: 'text', text: 'x' }))).toEqual({
      text: 'x',
      usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0 },
    });
  });

  test('empty stream yields an empty response with zero usage', async () => {
    expect(await collectStream(of())).toEqual({
      text: '',
      usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0 },
    });
  });

  test('throws on error events (refusal/incomplete/missing-terminal arrive as errors)', async () => {
    await expect(collectStream(of({ type: 'error', message: 'boom' }))).rejects.toThrow('boom');
  });
});

describe('createLlmProvider', () => {
  test('closed switch returns exactly one adapter per provider', () => {
    expect(createLlmProvider('google')).toBe(googleProvider);
    expect(createLlmProvider('openai')).toBe(openaiProvider);
    expect(createLlmProvider('anthropic')).toBe(anthropicProvider);
    expect(createLlmProvider('openrouter')).toBe(openrouterProvider);
    for (const provider of ['google', 'openai', 'anthropic', 'openrouter'] as const) {
      expect(typeof createLlmProvider(provider).stream).toBe('function');
    }
  });

  test('rejects values outside the provider tuple', () => {
    expect(() => createLlmProvider('chutes' as LlmProvider)).toThrow('Unsupported provider');
  });
});

describe('conservative limits', () => {
  test('chat and dictionary token defaults and the request timeout stay under budget', () => {
    expect(CHAT_MAX_TOKENS).toBe(4096);
    expect(DICTIONARY_MAX_TOKENS).toBe(3072);
    expect(DICTIONARY_MAX_TOKENS).toBeLessThan(CHAT_MAX_TOKENS);
    // Gateway cuts the integration at ~29 s; stay strictly below.
    expect(REQUEST_TIMEOUT_MS).toBeLessThan(29000);
  });
});

import { describe, expect, test } from 'bun:test';
import type { Anthropic } from '@anthropic-ai/sdk';
import {
  createAnthropicMapper,
  streamAnthropicMessages,
  type AnthropicStreamEvent,
} from '../../src/llm/providers/anthropic';
import { collectEvents, mapperEvents } from './helpers';

const baseInput = {
  model: 'claude-opus-5-5',
  effort: 'medium' as const,
  system: 'Be terse.',
  messages: [{ role: 'user' as const, content: 'こんにちは' }],
  apiKey: 'a-key',
  maxTokens: 4096,
};

const messageStart = (usage?: Record<string, number>): AnthropicStreamEvent => ({
  type: 'message_start',
  message: { usage },
});

const textDelta = (text: string, index = 0): AnthropicStreamEvent => ({
  type: 'content_block_delta',
  index,
  delta: { type: 'text_delta', text },
});

const blockStart = (blockType: string, index = 0): AnthropicStreamEvent => ({
  type: 'content_block_start',
  index,
  content_block: { type: blockType },
});

const messageDelta = (
  stopReason: string | null,
  usage?: Record<string, number>,
): AnthropicStreamEvent => ({ type: 'message_delta', delta: { stop_reason: stopReason }, usage });

const FINAL_USAGE = {
  input_tokens: 12,
  cache_read_input_tokens: 200,
  cache_creation_input_tokens: 8,
  output_tokens: 42,
};

describe('anthropic mapper', () => {
  test('maps text deltas and normalizes cache arithmetic exactly', () => {
    expect(
      mapperEvents(createAnthropicMapper, [
        messageStart({
          input_tokens: 10,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 5,
          output_tokens: 3,
        }),
        blockStart('text'),
        textDelta('こん'),
        textDelta('にちは'),
        { type: 'content_block_stop', index: 0 },
        messageDelta('end_turn', FINAL_USAGE),
        { type: 'message_stop' },
      ]),
    ).toEqual([
      {
        type: 'usage',
        usage: { inputTokens: 115, outputTokens: 3, cachedInputTokens: 100, cacheWriteTokens: 5 },
      },
      { type: 'text', text: 'こん' },
      { type: 'text', text: 'にちは' },
      // Last usage wins: 12 + 200 + 8 = 220 input tokens.
      {
        type: 'usage',
        usage: { inputTokens: 220, outputTokens: 42, cachedInputTokens: 200, cacheWriteTokens: 8 },
      },
    ]);
  });

  test('successful fallback: control block invisible and no cross-attempt usage summing', () => {
    expect(
      mapperEvents(createAnthropicMapper, [
        messageStart({ input_tokens: 10, cache_read_input_tokens: 100, output_tokens: 3 }),
        blockStart('text', 0),
        textDelta('I can', 0),
        { type: 'content_block_stop', index: 0 },
        // Mid-output decline: the fallback control block carries the serving model.
        {
          type: 'content_block_start',
          index: 1,
          content_block: {
            type: 'fallback',
            from: { model: 'claude-opus-5-5' },
            to: { model: 'claude-sonnet-5-5' },
          },
        },
        { type: 'content_block_stop', index: 1 },
        blockStart('text', 2),
        textDelta(' help with that.', 2),
        { type: 'content_block_stop', index: 2 },
        messageDelta('end_turn', {
          input_tokens: 30,
          cache_read_input_tokens: 0,
          output_tokens: 9,
        }),
        { type: 'message_stop' },
      ]),
    ).toEqual([
      {
        type: 'usage',
        usage: { inputTokens: 110, outputTokens: 3, cachedInputTokens: 100, cacheWriteTokens: 0 },
      },
      { type: 'text', text: 'I can' },
      { type: 'text', text: ' help with that.' },
      // Final reported usage only (39), not message_start + final added together.
      {
        type: 'usage',
        usage: { inputTokens: 30, outputTokens: 9, cachedInputTokens: 0, cacheWriteTokens: 0 },
      },
    ]);
  });

  test('unresolved refusal becomes an error terminal', () => {
    expect(
      mapperEvents(createAnthropicMapper, [
        messageStart({ input_tokens: 5, output_tokens: 1 }),
        messageDelta('refusal', { input_tokens: 5, output_tokens: 1 }),
        { type: 'message_stop' },
      ]),
    ).toEqual([
      {
        type: 'usage',
        usage: { inputTokens: 5, outputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0 },
      },
      {
        type: 'usage',
        usage: { inputTokens: 5, outputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0 },
      },
      { type: 'error', message: 'Anthropic response was refused' },
    ]);
  });

  test('max_tokens stop becomes an error terminal', () => {
    expect(mapperEvents(createAnthropicMapper, [messageDelta('max_tokens')])).toEqual([
      { type: 'error', message: 'Anthropic stream finished early (max_tokens)' },
    ]);
  });

  test('thinking deltas are never surfaced as text', () => {
    expect(
      mapperEvents(createAnthropicMapper, [
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'thinking_delta', text: 'secret thought' },
        },
        messageDelta('end_turn'),
        { type: 'message_stop' },
      ]),
    ).toEqual([]);
  });

  test('empty but end_turn stream is a harmless empty result', () => {
    expect(
      mapperEvents(createAnthropicMapper, [
        messageStart(),
        messageDelta('end_turn'),
        { type: 'message_stop' },
      ]),
    ).toEqual([]);
  });

  test('missing usage emits no usage events', () => {
    expect(
      mapperEvents(createAnthropicMapper, [messageStart(undefined), messageDelta('end_turn')]),
    ).toEqual([]);
  });

  test('stream ending without a successful stop yields a missing-terminal error', () => {
    expect(mapperEvents(createAnthropicMapper, [blockStart('text'), textDelta('partial')])).toEqual(
      [
        { type: 'text', text: 'partial' },
        { type: 'error', message: 'Anthropic stream ended without a successful stop' },
      ],
    );
  });
});

describe('anthropic adapter', () => {
  /* eslint-disable no-unused-vars -- function-type parameter names are never "used" */
  function fakeClient(
    handler: (
      body: Record<string, unknown>,
      options: unknown,
    ) => AsyncIterable<AnthropicStreamEvent>,
  ) {
    /* eslint-enable no-unused-vars */
    return {
      beta: {
        messages: {
          stream: (body: Record<string, unknown>, options: unknown) => handler(body, options),
        },
      },
    } as unknown as Anthropic;
  }

  async function* eventsOf(events: AnthropicStreamEvent[]): AsyncIterable<AnthropicStreamEvent> {
    yield* events;
  }

  test('sends effort, ephemeral cache_control, default fallbacks, and the fallback beta', async () => {
    let capturedBody: Record<string, unknown> = {};
    let capturedOptions: Record<string, unknown> = {};
    const client = fakeClient((body, options) => {
      capturedBody = body;
      capturedOptions = options as Record<string, unknown>;
      return eventsOf([
        messageStart({ input_tokens: 4, output_tokens: 2 }),
        messageDelta('end_turn'),
        { type: 'message_stop' },
      ]);
    });
    const events = await collectEvents(streamAnthropicMessages(baseInput, () => client));
    expect(events).toEqual([
      {
        type: 'usage',
        usage: { inputTokens: 4, outputTokens: 2, cachedInputTokens: 0, cacheWriteTokens: 0 },
      },
    ]);
    expect(capturedBody).toEqual({
      model: 'claude-opus-5-5',
      max_tokens: 4096,
      messages: [{ role: 'user', content: 'こんにちは' }],
      system: 'Be terse.',
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      fallbacks: 'default',
      betas: ['server-side-fallback-2026-07-01'],
    });
    expect('temperature' in capturedBody).toBe(false);
    expect('thinking' in capturedBody).toBe(false);
    expect(capturedOptions.maxRetries).toBe(0);
    expect(capturedOptions.timeout).toBeLessThan(29000);
  });

  test('Haiku 5.5 still requests default fallbacks and reports its unresolved refusal', async () => {
    let capturedBody: Record<string, unknown> = {};
    const client = fakeClient((body) => {
      capturedBody = body;
      return eventsOf([messageDelta('refusal'), { type: 'message_stop' }]);
    });
    const events = await collectEvents(
      streamAnthropicMessages({ ...baseInput, model: 'claude-haiku-5-5' }, () => client),
    );
    expect(capturedBody.fallbacks).toBe('default');
    expect(events).toEqual([{ type: 'error', message: 'Anthropic response was refused' }]);
  });

  test('SDK exception yields one sanitized error without vendor payload', async () => {
    const overloaded = Object.assign(new Error('{"type":"overloaded_error"}'), { status: 529 });
    const client = fakeClient(() => {
      throw overloaded;
    });
    const events = await collectEvents(streamAnthropicMessages(baseInput, () => client));
    expect(events).toEqual([{ type: 'error', message: 'Anthropic request failed (529)' }]);
  });

  test('user abort yields a sanitized abort error', async () => {
    async function* aborted(): AsyncIterable<AnthropicStreamEvent> {
      yield messageStart({ input_tokens: 2 });
      const abortError = new Error('Request was aborted.');
      abortError.name = 'APIUserAbortError';
      throw abortError;
    }
    const client = fakeClient(() => aborted());
    const events = await collectEvents(streamAnthropicMessages(baseInput, () => client));
    expect(events).toEqual([
      {
        type: 'usage',
        usage: { inputTokens: 2, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0 },
      },
      { type: 'error', message: 'Anthropic request failed (APIUserAbortError)' },
    ]);
  });
});

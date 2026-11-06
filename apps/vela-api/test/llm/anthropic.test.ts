import { describe, expect, test } from 'bun:test';
import { Anthropic } from '@anthropic-ai/sdk';
import {
  createAnthropicMapper,
  streamAnthropicMessages,
  type AnthropicStreamEvent,
} from '../../src/llm/providers/anthropic';
import { collectEvents, mapperEvents, sseBody } from './helpers';

const baseInput = {
  model: 'claude-opus-5-5',
  effort: 'medium' as const,
  system: 'Be terse.',
  messages: [{ role: 'user' as const, content: 'こんにちは' }],
  apiKey: 'a-key',
  maxTokens: 4096,
};

const messageStart = (usage?: Record<string, number | null>): AnthropicStreamEvent => ({
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
  usage?: Record<string, number | null>,
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

  test('attacker-controlled stop reasons never reach the error message', () => {
    const events = mapperEvents(createAnthropicMapper, [messageDelta('sk-ant-ATTACKERSECRET')]);
    expect(events).toEqual([
      { type: 'error', message: 'Anthropic stream finished early (unknown)' },
    ]);
    expect(JSON.stringify(events)).not.toContain('ATTACKERSECRET');
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
      mapperEvents(createAnthropicMapper, [
        messageStart(undefined),
        messageDelta('end_turn'),
        { type: 'message_stop' },
      ]),
    ).toEqual([]);
  });

  test('output-only usage delta preserves previously reported input and cache counts', () => {
    expect(
      mapperEvents(createAnthropicMapper, [
        messageStart({
          input_tokens: 12,
          cache_read_input_tokens: 200,
          cache_creation_input_tokens: 8,
        }),
        // Output-only delta: input fields omitted, must not zero the counts.
        messageDelta('end_turn', { output_tokens: 42 }),
        { type: 'message_stop' },
      ]),
    ).toEqual([
      {
        type: 'usage',
        usage: { inputTokens: 220, outputTokens: 0, cachedInputTokens: 200, cacheWriteTokens: 8 },
      },
      {
        type: 'usage',
        usage: { inputTokens: 220, outputTokens: 42, cachedInputTokens: 200, cacheWriteTokens: 8 },
      },
    ]);
  });

  test('null-valued usage fields do not erase known counts', () => {
    expect(
      mapperEvents(createAnthropicMapper, [
        messageStart({
          input_tokens: 12,
          cache_read_input_tokens: 200,
          cache_creation_input_tokens: 8,
          output_tokens: 1,
        }),
        messageDelta('end_turn', {
          input_tokens: null,
          cache_read_input_tokens: null,
          cache_creation_input_tokens: null,
          output_tokens: 42,
        }),
        { type: 'message_stop' },
      ]),
    ).toEqual([
      {
        type: 'usage',
        usage: { inputTokens: 220, outputTokens: 1, cachedInputTokens: 200, cacheWriteTokens: 8 },
      },
      {
        type: 'usage',
        usage: { inputTokens: 220, outputTokens: 42, cachedInputTokens: 200, cacheWriteTokens: 8 },
      },
    ]);
  });

  test('stream truncated right before message_stop is an error despite a success stop reason', () => {
    expect(
      mapperEvents(createAnthropicMapper, [
        messageStart({ input_tokens: 5 }),
        messageDelta('end_turn'),
      ]),
    ).toEqual([
      {
        type: 'usage',
        usage: { inputTokens: 5, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0 },
      },
      { type: 'error', message: 'Anthropic stream ended without a successful stop' },
    ]);
  });

  test('message_stop without a preceding success stop reason is a missing-terminal error', () => {
    expect(mapperEvents(createAnthropicMapper, [messageStart(), { type: 'message_stop' }])).toEqual(
      [{ type: 'error', message: 'Anthropic stream ended without a successful stop' }],
    );
  });

  test('fallback blocks are invisible and per-attempt iterations never inflate usage', () => {
    const fixture: AnthropicStreamEvent[] = [
      messageStart({
        input_tokens: 12,
        cache_read_input_tokens: 200,
        cache_creation_input_tokens: 8,
        output_tokens: 2,
      }),
      blockStart('text', 0),
      textDelta('I can', 0),
      { type: 'content_block_stop', index: 0 },
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'fallback' },
      },
      { type: 'content_block_stop', index: 1 },
      blockStart('text', 2),
      textDelta(' help.', 2),
      { type: 'content_block_stop', index: 2 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: {
          input_tokens: 12,
          cache_read_input_tokens: 200,
          cache_creation_input_tokens: 8,
          output_tokens: 9,
          // Per-attempt billing breakdown: carried but never summed into usage.
          iterations: [
            { type: 'message', model: 'claude-opus-5-5', input_tokens: 12, output_tokens: 2 },
            {
              type: 'fallback_message',
              model: 'claude-sonnet-5-5',
              input_tokens: 12,
              output_tokens: 7,
            },
          ],
        },
      },
      { type: 'message_stop' },
    ];
    expect(mapperEvents(createAnthropicMapper, fixture)).toEqual([
      {
        type: 'usage',
        usage: { inputTokens: 220, outputTokens: 2, cachedInputTokens: 200, cacheWriteTokens: 8 },
      },
      { type: 'text', text: 'I can' },
      { type: 'text', text: ' help.' },
      // Top-level cumulative totals only (220/9) — iteration entries never add in.
      {
        type: 'usage',
        usage: { inputTokens: 220, outputTokens: 9, cachedInputTokens: 200, cacheWriteTokens: 8 },
      },
    ]);
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
      // 4096 caller budget + 2048 medium-effort reasoning headroom.
      max_tokens: 6144,
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

  test('SDK request carries a deadline signal combined with the caller signal', async () => {
    let capturedOptions: Record<string, unknown> = {};
    const client = fakeClient((_body, options) => {
      capturedOptions = options as Record<string, unknown>;
      return eventsOf([messageDelta('end_turn'), { type: 'message_stop' }]);
    });
    const caller = new AbortController();
    await collectEvents(
      streamAnthropicMessages({ ...baseInput, signal: caller.signal }, () => client),
    );
    const signal = capturedOptions.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal).not.toBe(caller.signal); // timeout combined in, not the raw caller signal
    expect((signal as AbortSignal).aborted).toBe(false);
    caller.abort();
    expect((signal as AbortSignal).aborted).toBe(true); // caller cancellation still reaches the SDK
  });

  test('SDK request carries a deadline signal even without a caller signal', async () => {
    let capturedOptions: Record<string, unknown> = {};
    const client = fakeClient((_body, options) => {
      capturedOptions = options as Record<string, unknown>;
      return eventsOf([messageDelta('end_turn'), { type: 'message_stop' }]);
    });
    await collectEvents(streamAnthropicMessages(baseInput, () => client));
    expect(capturedOptions.signal).toBeInstanceOf(AbortSignal);
  });

  test('fallback stream through the installed SDK: iterations never inflate normalized usage', async () => {
    // Mocked transport, real @anthropic-ai/sdk: exercises its SSE parsing and
    // BetaMessageStream path, not a hand-rolled client double.
    const sse =
      [
        'event: message_start',
        'data: {"type":"message_start","message":{"id":"msg_fb1","type":"message","role":"assistant","model":"claude-opus-5-5","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":12,"cache_read_input_tokens":200,"cache_creation_input_tokens":8,"output_tokens":2}}}',
        '',
        'event: content_block_start',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"I can"}}',
        '',
        'event: content_block_stop',
        'data: {"type":"content_block_stop","index":0}',
        '',
        'event: content_block_start',
        'data: {"type":"content_block_start","index":1,"content_block":{"type":"fallback","from":{"model":"claude-opus-5-5"},"to":{"model":"claude-sonnet-5-5"},"trigger":"refusal"}}',
        '',
        'event: content_block_stop',
        'data: {"type":"content_block_stop","index":1}',
        '',
        'event: content_block_start',
        'data: {"type":"content_block_start","index":2,"content_block":{"type":"text","text":""}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":2,"delta":{"type":"text_delta","text":" help."}}',
        '',
        'event: content_block_stop',
        'data: {"type":"content_block_stop","index":2}',
        '',
        'event: message_delta',
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"input_tokens":12,"cache_read_input_tokens":200,"cache_creation_input_tokens":8,"output_tokens":9,"iterations":[{"type":"message","model":"claude-opus-5-5","input_tokens":12,"cache_read_input_tokens":200,"cache_creation_input_tokens":8,"output_tokens":2},{"type":"fallback_message","model":"claude-sonnet-5-5","input_tokens":12,"cache_read_input_tokens":200,"cache_creation_input_tokens":8,"output_tokens":7}]}}',
        '',
        'event: message_stop',
        'data: {"type":"message_stop"}',
        '',
      ].join('\n') + '\n';
    const client = new Anthropic({
      apiKey: 'a-key',
      maxRetries: 0,
      fetch: async () =>
        new Response(sseBody([sse]), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        }),
    });
    const events = await collectEvents(streamAnthropicMessages(baseInput, () => client));
    expect(events).toEqual([
      {
        type: 'usage',
        usage: { inputTokens: 220, outputTokens: 2, cachedInputTokens: 200, cacheWriteTokens: 8 },
      },
      { type: 'text', text: 'I can' },
      { type: 'text', text: ' help.' },
      // Cumulative top-level totals only; the two iteration entries never add in.
      {
        type: 'usage',
        usage: { inputTokens: 220, outputTokens: 9, cachedInputTokens: 200, cacheWriteTokens: 8 },
      },
    ]);
  });

  test('SDK exception yields one sanitized error without vendor payload', async () => {
    const overloaded = Object.assign(new Error('{"type":"overloaded_error"}'), { status: 529 });
    const client = fakeClient(() => {
      throw overloaded;
    });
    const events = await collectEvents(streamAnthropicMessages(baseInput, () => client));
    expect(events).toEqual([{ type: 'error', message: 'Anthropic request failed (529)' }]);
  });

  test('user abort (deadline or caller cancel) yields a sanitized timeout error', async () => {
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
      { type: 'error', message: 'Anthropic request timed out' },
    ]);
  });

  test('real SDK logs no raw payload on malformed SSE data (payload logging disabled)', async () => {
    // Real @anthropic-ai/sdk with a mocked transport: its default 'warn' log
    // level enables `logger.error`, which prints the raw `sse.data` and
    // `sse.raw` chunks on malformed data. Unique logger objects avoid the
    // SDK's module-global console WeakMap cache (which binds `console.error`
    // once and would bypass a property spy).
    const makeClient = (options: Record<string, unknown>) => {
      const logged: unknown[][] = [];
      const logger = {
        error: (...args: unknown[]) => logged.push(args),
        warn: (...args: unknown[]) => logged.push(args),
        info: (...args: unknown[]) => logged.push(args),
        debug: (...args: unknown[]) => logged.push(args),
      };
      const client = new Anthropic({
        apiKey: 'a-key',
        maxRetries: 0,
        fetch: async () =>
          // A named event whose data payload is not JSON reaches the SDK's
          // JSON.parse failure path (unnamed data lines are skipped entirely).
          new Response(sseBody(['event: content_block_delta\ndata: {not-json\n\n']), {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          }),
        ...options,
        logger,
      });
      return { client, logged };
    };

    // SDK default log level ('warn'): malformed data IS logged raw — the
    // reason the adapter must disable payload logging.
    const sdkDefault = makeClient({});
    await collectEvents(streamAnthropicMessages(baseInput, () => sdkDefault.client));
    expect(JSON.stringify(sdkDefault.logged)).toContain('not-json');

    // Adapter's construction (logLevel 'off'): nothing raw is logged and the
    // failure still surfaces as one sanitized error event.
    const silenced = makeClient({ logLevel: 'off' });
    const events = await collectEvents(streamAnthropicMessages(baseInput, () => silenced.client));
    // The SDK rethrows the parse failure wrapped as a plain Error: sanitized
    // to a fixed message, never the raw chunk.
    expect(events).toEqual([{ type: 'error', message: 'Anthropic request failed' }]);
    expect(JSON.stringify(silenced.logged)).not.toContain('not-json');
    expect(JSON.stringify(silenced.logged)).not.toContain('Could not parse message into JSON');
  });
});

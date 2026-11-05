import { describe, expect, test } from 'bun:test';
import type { OpenAI } from 'openai';
import {
  createOpenAiMapper,
  streamOpenAiResponses,
  type OpenAiStreamEvent,
} from '../../src/llm/providers/openai';
import { collectEvents, mapperEvents } from './helpers';

const baseInput = {
  model: 'gpt-6.1-sol',
  effort: 'medium' as const,
  system: 'Be terse.',
  messages: [{ role: 'user' as const, content: 'こんにちは' }],
  apiKey: 'o-key',
  maxTokens: 4096,
};

const delta = (text: string): OpenAiStreamEvent => ({
  type: 'response.output_text.delta',
  delta: text,
});

type OpenAiUsage = NonNullable<NonNullable<OpenAiStreamEvent['response']>['usage']>;

const completed = (usage?: OpenAiUsage): OpenAiStreamEvent => ({
  type: 'response.completed',
  response: { usage },
});

/** Minimal SDK client double whose responses.create() returns a fixed event stream. */
/* eslint-disable no-unused-vars -- function-type parameter names are never "used" */
function fakeClient(
  handler: (body: unknown, options: unknown) => AsyncIterable<OpenAiStreamEvent> | never,
) {
  /* eslint-enable no-unused-vars */
  return {
    responses: {
      create: async (body: unknown, options: unknown) => handler(body, options),
    },
  } as unknown as OpenAI;
}

async function* eventsOf(events: OpenAiStreamEvent[]): AsyncIterable<OpenAiStreamEvent> {
  yield* events;
}

describe('openai mapper', () => {
  test('maps text deltas, final usage, and completed terminal', () => {
    expect(
      mapperEvents(createOpenAiMapper, [
        delta('He'),
        delta('llo'),
        completed({
          input_tokens: 12000,
          output_tokens: 33,
          input_tokens_details: { cached_tokens: 4000, cache_write_tokens: 7000 },
        }),
      ]),
    ).toEqual([
      { type: 'text', text: 'He' },
      { type: 'text', text: 'llo' },
      {
        type: 'usage',
        // input_tokens already includes cached reads and cache writes.
        usage: {
          inputTokens: 12000,
          outputTokens: 33,
          cachedInputTokens: 4000,
          cacheWriteTokens: 7000,
        },
      },
    ]);
  });

  test('response.failed becomes an error terminal', () => {
    expect(
      mapperEvents(createOpenAiMapper, [
        { type: 'response.failed', response: { error: { code: 'rate_limit_exceeded' } } },
      ]),
    ).toEqual([{ type: 'error', message: 'OpenAI response failed (rate_limit_exceeded)' }]);
  });

  test('response.incomplete becomes an error terminal', () => {
    expect(
      mapperEvents(createOpenAiMapper, [
        {
          type: 'response.incomplete',
          response: { incomplete_details: { reason: 'max_output_tokens' } },
        },
      ]),
    ).toEqual([{ type: 'error', message: 'OpenAI response incomplete (max_output_tokens)' }]);
  });

  test('refusal deltas become an error terminal', () => {
    expect(
      mapperEvents(createOpenAiMapper, [{ type: 'response.refusal.delta', delta: 'cannot help' }]),
    ).toEqual([{ type: 'error', message: 'OpenAI response was refused' }]);
  });

  test('mid-stream error event becomes an error terminal', () => {
    expect(mapperEvents(createOpenAiMapper, [{ type: 'error', code: 'server_error' }])).toEqual([
      { type: 'error', message: 'OpenAI stream error' },
    ]);
  });

  test('empty but completed stream is a harmless empty result', () => {
    expect(mapperEvents(createOpenAiMapper, [completed(undefined)])).toEqual([]);
  });

  test('missing usage emits no usage event', () => {
    expect(mapperEvents(createOpenAiMapper, [delta('x'), completed()])).toEqual([
      { type: 'text', text: 'x' },
    ]);
  });

  test('stream ending without response.completed yields a missing-terminal error', () => {
    expect(mapperEvents(createOpenAiMapper, [delta('partial')])).toEqual([
      { type: 'text', text: 'partial' },
      { type: 'error', message: 'OpenAI stream ended without a completed response' },
    ]);
  });
});

describe('openai adapter', () => {
  test('sends Responses params with effort, no sampling, and bounded request options', async () => {
    let capturedBody: Record<string, unknown> = {};
    let capturedOptions: Record<string, unknown> = {};
    const client = fakeClient((body, options) => {
      capturedBody = body as Record<string, unknown>;
      capturedOptions = options as Record<string, unknown>;
      return eventsOf([completed({ input_tokens: 5, output_tokens: 1 })]);
    });
    const events = await collectEvents(streamOpenAiResponses(baseInput, () => client));
    expect(events).toEqual([
      {
        type: 'usage',
        usage: { inputTokens: 5, outputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0 },
      },
    ]);
    expect(capturedBody).toEqual({
      model: 'gpt-6.1-sol',
      max_output_tokens: 4096,
      reasoning: { effort: 'medium' },
      instructions: 'Be terse.',
      input: [{ role: 'user', content: 'こんにちは' }],
      stream: true,
    });
    expect(capturedOptions.maxRetries).toBe(0);
    expect(capturedOptions.timeout).toBeLessThan(29000);
  });

  test('omits reasoning when effort is null and omits instructions without a system', async () => {
    let capturedBody: Record<string, unknown> = {};
    const client = fakeClient((body) => {
      capturedBody = body as Record<string, unknown>;
      return eventsOf([completed()]);
    });
    await collectEvents(
      streamOpenAiResponses({ ...baseInput, effort: null, system: null }, () => client),
    );
    expect(capturedBody).toEqual({
      model: 'gpt-6.1-sol',
      max_output_tokens: 4096,
      input: [{ role: 'user', content: 'こんにちは' }],
      stream: true,
    });
  });

  test('API exception from create() yields one sanitized error', async () => {
    const apiError = Object.assign(new Error('Incorrect API key provided: sk-SECRET'), {
      status: 401,
    });
    const client = fakeClient(() => {
      throw apiError;
    });
    const events = await collectEvents(streamOpenAiResponses(baseInput, () => client));
    expect(events).toEqual([{ type: 'error', message: 'OpenAI request failed (401)' }]);
  });

  test('error thrown mid-iteration yields a sanitized error after prior text', async () => {
    async function* failing(): AsyncIterable<OpenAiStreamEvent> {
      yield delta('partial');
      throw new Error('connection reset');
    }
    const client = fakeClient(() => failing());
    const events = await collectEvents(streamOpenAiResponses(baseInput, () => client));
    expect(events).toEqual([
      { type: 'text', text: 'partial' },
      { type: 'error', message: 'OpenAI request failed' },
    ]);
  });
});

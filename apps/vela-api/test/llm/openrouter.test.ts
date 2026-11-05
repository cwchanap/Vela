import { describe, expect, test } from 'bun:test';
import {
  createOpenRouterMapper,
  streamOpenRouterChat,
  type OpenRouterStreamChunk,
} from '../../src/llm/providers/openrouter';
import { collectEvents, fakeFetch, mapperEvents, sseBody } from './helpers';

const baseInput = {
  model: 'openai/gpt-oss-20b:free',
  effort: null,
  system: 'Be terse.',
  messages: [{ role: 'user' as const, content: 'こんにちは' }],
  apiKey: 'or-key',
  maxTokens: 4096,
  referer: 'https://vela.cwchanap.dev',
  appName: 'Vela Japanese Learning App',
};

const sse = (chunks: OpenRouterStreamChunk[]): string[] =>
  chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`);

describe('openrouter mapper', () => {
  test('maps content deltas, final usage with cached tokens, and stop terminal', () => {
    expect(
      mapperEvents(createOpenRouterMapper, [
        { choices: [{ delta: { content: 'he' } }] },
        { choices: [{ delta: { content: 'llo' } }] },
        {
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            prompt_tokens_details: { cached_tokens: 40 },
          },
        },
      ]),
    ).toEqual([
      { type: 'text', text: 'he' },
      { type: 'text', text: 'llo' },
      {
        type: 'usage',
        usage: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 40, cacheWriteTokens: 0 },
      },
    ]);
  });

  test('reasoning deltas are not surfaced as text', () => {
    expect(
      mapperEvents(createOpenRouterMapper, [
        { choices: [{ delta: { reasoning: 'internal thought' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
      ]),
    ).toEqual([]);
  });

  test('length finish becomes an error terminal', () => {
    expect(
      mapperEvents(createOpenRouterMapper, [{ choices: [{ delta: {}, finish_reason: 'length' }] }]),
    ).toEqual([{ type: 'error', message: 'OpenRouter stream finished early (length)' }]);
  });

  test('content_filter finish becomes an error terminal', () => {
    expect(
      mapperEvents(createOpenRouterMapper, [
        { choices: [{ delta: {}, finish_reason: 'content_filter' }] },
      ]),
    ).toEqual([{ type: 'error', message: 'OpenRouter stream finished early (content_filter)' }]);
  });

  test('upstream error chunk becomes a sanitized error without the vendor message', () => {
    expect(
      mapperEvents(createOpenRouterMapper, [
        { error: { code: 429, message: 'Rate limit exceeded for sk-or-SECRET' } },
      ]),
    ).toEqual([{ type: 'error', message: 'OpenRouter stream error (429)' }]);
  });

  test('attacker-controlled error codes never reach the error message', () => {
    const events = mapperEvents(createOpenRouterMapper, [
      {
        error: { code: 'sk-or-v1-ATTACKERSECRET', message: 'key sk-or-v1-ATTACKERSECRET rejected' },
      },
    ]);
    expect(events).toEqual([{ type: 'error', message: 'OpenRouter stream error (unknown)' }]);
    expect(JSON.stringify(events)).not.toContain('ATTACKERSECRET');
  });

  test('attacker-controlled finish reasons never reach the error message', () => {
    const events = mapperEvents(createOpenRouterMapper, [
      { choices: [{ delta: {}, finish_reason: 'sk-or-v1-ATTACKERSECRET' }] },
    ]);
    expect(events).toEqual([
      { type: 'error', message: 'OpenRouter stream finished early (unknown)' },
    ]);
    expect(JSON.stringify(events)).not.toContain('ATTACKERSECRET');
  });

  test('empty but stopped stream is a harmless empty result', () => {
    expect(
      mapperEvents(createOpenRouterMapper, [{ choices: [{ delta: {}, finish_reason: 'stop' }] }]),
    ).toEqual([]);
  });

  test('missing usage emits no usage event', () => {
    expect(
      mapperEvents(createOpenRouterMapper, [
        { choices: [{ delta: { content: 'x' } }] },
        { choices: [{ delta: {}, finish_reason: 'stop' }] },
      ]),
    ).toEqual([{ type: 'text', text: 'x' }]);
  });

  test('stream ending without a finish reason yields a missing-terminal error', () => {
    expect(
      mapperEvents(createOpenRouterMapper, [{ choices: [{ delta: { content: 'partial' } }] }]),
    ).toEqual([
      { type: 'text', text: 'partial' },
      { type: 'error', message: 'OpenRouter stream ended without a successful finish' },
    ]);
  });
});

describe('openrouter adapter', () => {
  test('keeps Chat Completions REST shape, attribution headers, and current sampling', async () => {
    let capturedUrl = '';
    let capturedInit: { headers?: unknown; body?: unknown; method?: string } = {};
    const fetchFn = fakeFetch((url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(
        sseBody([
          ...sse([{ choices: [{ delta: {}, finish_reason: 'stop' }] }]),
          'data: [DONE]\n\n',
        ]),
      );
    });
    const events = await collectEvents(streamOpenRouterChat(baseInput, fetchFn));
    expect(events).toEqual([]);

    expect(capturedUrl).toBe('https://openrouter.ai/api/v1/chat/completions');
    const headers = new Headers(capturedInit.headers as ConstructorParameters<typeof Headers>[0]);
    expect(headers.get('Authorization')).toBe('Bearer or-key');
    expect(headers.get('HTTP-Referer')).toBe('https://vela.cwchanap.dev');
    expect(headers.get('X-Title')).toBe('Vela Japanese Learning App');
    expect(JSON.parse(String(capturedInit.body))).toEqual({
      model: 'openai/gpt-oss-20b:free',
      messages: [
        { role: 'system', content: 'Be terse.' },
        { role: 'user', content: 'こんにちは' },
      ],
      temperature: 0.7,
      max_tokens: 4096,
      stream: true,
    });
  });

  test('streams text through to the [DONE] marker', async () => {
    const events = await collectEvents(
      streamOpenRouterChat(
        baseInput,
        fakeFetch(
          () =>
            new Response(
              sseBody([
                ...sse([{ choices: [{ delta: { content: 'hi' } }] }]),
                ...sse([
                  {
                    choices: [{ delta: {}, finish_reason: 'stop' }],
                    usage: { prompt_tokens: 9, completion_tokens: 1 },
                  },
                ]),
                'data: [DONE]\n\n',
              ]),
            ),
        ),
      ),
    );
    expect(events).toEqual([
      { type: 'text', text: 'hi' },
      {
        type: 'usage',
        usage: { inputTokens: 9, outputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0 },
      },
    ]);
  });

  test('non-OK upstream response yields one sanitized error', async () => {
    const events = await collectEvents(
      streamOpenRouterChat(
        baseInput,
        fakeFetch(
          () => new Response('{"error":{"message":"Invalid key sk-or-SECRET"}}', { status: 401 }),
        ),
      ),
    );
    expect(events).toEqual([{ type: 'error', message: 'OpenRouter request failed (401)' }]);
  });

  test('skips malformed upstream lines and still completes on a valid terminal', async () => {
    const events = await collectEvents(
      streamOpenRouterChat(
        baseInput,
        fakeFetch(
          () =>
            new Response(
              sseBody([
                'data: {not json\n\n',
                ...sse([{ choices: [{ delta: { content: 'ok' } }] }]),
                ...sse([{ choices: [{ delta: {}, finish_reason: 'stop' }] }]),
              ]),
            ),
        ),
      ),
    );
    expect(events).toEqual([{ type: 'text', text: 'ok' }]);
  });
});

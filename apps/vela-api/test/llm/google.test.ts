import { describe, expect, test } from 'bun:test';
import {
  createGeminiMapper,
  streamGemini,
  type GeminiStreamChunk,
} from '../../src/llm/providers/google';
import { collectEvents, fakeFetch, mapperEvents, sseBody } from './helpers';

const baseInput = {
  model: 'gemini-3.8-flash',
  effort: 'medium' as const,
  system: 'Be terse.',
  messages: [{ role: 'user' as const, content: 'こんにちは' }],
  apiKey: 'g-key',
  maxTokens: 4096,
};

const sse = (chunks: GeminiStreamChunk[]): string[] =>
  chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`);

describe('gemini mapper', () => {
  test('maps text parts, final usage, and STOP terminal', () => {
    expect(
      mapperEvents(createGeminiMapper, [
        { candidates: [{ content: { parts: [{ text: 'こん' }, { text: 'にちは' }] } }] },
        {
          candidates: [{ content: { parts: [{ text: '!' }] }, finishReason: 'STOP' }],
          usageMetadata: {
            promptTokenCount: 120,
            cachedContentTokenCount: 40,
            candidatesTokenCount: 7,
            thoughtsTokenCount: 5,
          },
        },
      ]),
    ).toEqual([
      { type: 'text', text: 'こん' },
      { type: 'text', text: 'にちは' },
      { type: 'text', text: '!' },
      {
        type: 'usage',
        // promptTokenCount already includes cachedContentTokenCount; thoughts add to output.
        usage: { inputTokens: 120, outputTokens: 12, cachedInputTokens: 40, cacheWriteTokens: 0 },
      },
    ]);
  });

  test('filters thought summary parts from text output', () => {
    expect(
      mapperEvents(createGeminiMapper, [
        {
          candidates: [
            {
              content: { parts: [{ text: 'hidden thought', thought: true }, { text: 'visible' }] },
              finishReason: 'STOP',
            },
          ],
        },
      ]),
    ).toEqual([{ type: 'text', text: 'visible' }]);
  });

  test('SAFETY finish becomes an error terminal', () => {
    expect(
      mapperEvents(createGeminiMapper, [{ candidates: [{ finishReason: 'SAFETY' }] }]),
    ).toEqual([{ type: 'error', message: 'Gemini stream finished early (SAFETY)' }]);
  });

  test('MAX_TOKENS finish becomes an error terminal', () => {
    expect(
      mapperEvents(createGeminiMapper, [{ candidates: [{ finishReason: 'MAX_TOKENS' }] }]),
    ).toEqual([{ type: 'error', message: 'Gemini stream finished early (MAX_TOKENS)' }]);
  });

  test('blocked prompt feedback becomes an error', () => {
    expect(
      mapperEvents(createGeminiMapper, [{ promptFeedback: { blockReason: 'SAFETY' } }]),
    ).toEqual([{ type: 'error', message: 'Gemini request blocked (SAFETY)' }]);
  });

  test('attacker-controlled finish reasons never reach the error message', () => {
    const events = mapperEvents(createGeminiMapper, [
      { candidates: [{ finishReason: 'ATTACKERSECRET-CODE' }] },
    ]);
    expect(events).toEqual([{ type: 'error', message: 'Gemini stream finished early (unknown)' }]);
    expect(JSON.stringify(events)).not.toContain('ATTACKERSECRET');
  });

  test('attacker-controlled block reasons never reach the error message', () => {
    const events = mapperEvents(createGeminiMapper, [
      { promptFeedback: { blockReason: 'ATTACKERSECRET-CODE' } },
    ]);
    expect(events).toEqual([{ type: 'error', message: 'Gemini request blocked (unknown)' }]);
    expect(JSON.stringify(events)).not.toContain('ATTACKERSECRET');
  });

  test('empty but successfully finished stream is a harmless empty result', () => {
    expect(
      mapperEvents(createGeminiMapper, [
        { candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] },
      ]),
    ).toEqual([]);
  });

  test('missing usage emits no usage event', () => {
    expect(mapperEvents(createGeminiMapper, [{ candidates: [{ finishReason: 'STOP' }] }])).toEqual(
      [],
    );
  });

  test('stream ending without a finish reason yields a missing-terminal error', () => {
    expect(
      mapperEvents(createGeminiMapper, [
        { candidates: [{ content: { parts: [{ text: 'hi' }] } }] },
      ]),
    ).toEqual([
      { type: 'text', text: 'hi' },
      { type: 'error', message: 'Gemini stream ended without a successful finish' },
    ]);
  });
});

describe('gemini adapter', () => {
  test('streams text and usage from an SSE body', async () => {
    const fetchFn = fakeFetch(
      () =>
        new Response(
          sseBody([
            ...sse([{ candidates: [{ content: { parts: [{ text: 'hello' }] } }] }]),
            ...sse([
              {
                candidates: [{ content: {}, finishReason: 'STOP' }],
                usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 },
              },
            ]),
          ]),
        ),
    );
    expect(await collectEvents(streamGemini(baseInput, fetchFn))).toEqual([
      { type: 'text', text: 'hello' },
      {
        type: 'usage',
        usage: { inputTokens: 10, outputTokens: 2, cachedInputTokens: 0, cacheWriteTokens: 0 },
      },
    ]);
  });

  test('sends thinking level, no sampling params, system instruction, and model roles', async () => {
    let capturedUrl = '';
    let capturedInit: { headers?: unknown; body?: unknown; method?: string } = {};
    const fetchFn = fakeFetch((url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(sseBody(sse([{ candidates: [{ finishReason: 'STOP' }] }])));
    });
    await collectEvents(streamGemini(baseInput, fetchFn));

    expect(capturedUrl).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse',
    );
    expect(capturedInit.method).toBe('POST');
    expect(
      new Headers(capturedInit.headers as ConstructorParameters<typeof Headers>[0]).get(
        'x-goog-api-key',
      ),
    ).toBe('g-key');
    const body = JSON.parse(String(capturedInit.body));
    expect(body.generationConfig).toEqual({
      maxOutputTokens: 4096,
      thinkingConfig: { thinkingLevel: 'MEDIUM' },
    });
    expect(body.contents).toEqual([{ role: 'user', parts: [{ text: 'こんにちは' }] }]);
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'Be terse.' }] });
  });

  test('maps assistant history turns to the model role and low effort to LOW', async () => {
    let capturedInit: { headers?: unknown; body?: unknown; method?: string } = {};
    const fetchFn = fakeFetch((_url, init) => {
      capturedInit = init;
      return new Response(sseBody(sse([{ candidates: [{ finishReason: 'STOP' }] }])));
    });
    await collectEvents(
      streamGemini(
        {
          ...baseInput,
          effort: 'low',
          system: null,
          messages: [
            { role: 'user', content: 'q' },
            { role: 'assistant', content: 'a' },
          ],
        },
        fetchFn,
      ),
    );
    const body = JSON.parse(String(capturedInit.body));
    expect(body.systemInstruction).toBeUndefined();
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: 'q' }] },
      { role: 'model', parts: [{ text: 'a' }] },
    ]);
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'LOW' });
  });

  test('non-OK upstream response yields one sanitized error without the vendor body', async () => {
    const events = await collectEvents(
      streamGemini(
        baseInput,
        fakeFetch(() => new Response('{"error":{"message":"API key not valid"}}', { status: 400 })),
      ),
    );
    expect(events).toEqual([{ type: 'error', message: 'Gemini request failed (400)' }]);
  });

  test('aborted upstream stream yields a sanitized abort error', async () => {
    const abortError = Object.assign(new Error('The operation was aborted'), {
      name: 'AbortError',
    });
    const failingBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(abortError);
      },
    });
    const events = await collectEvents(
      streamGemini(
        baseInput,
        fakeFetch(() => new Response(failingBody)),
      ),
    );
    expect(events).toEqual([{ type: 'error', message: 'Gemini request failed (AbortError)' }]);
  });

  test('truncated stream without terminal yields the missing-terminal error', async () => {
    const events = await collectEvents(
      streamGemini(
        baseInput,
        fakeFetch(
          () =>
            new Response(
              sseBody(sse([{ candidates: [{ content: { parts: [{ text: 'partial' }] } }] }])),
            ),
        ),
      ),
    );
    expect(events).toEqual([
      { type: 'text', text: 'partial' },
      { type: 'error', message: 'Gemini stream ended without a successful finish' },
    ]);
  });

  test('malformed upstream data yields a sanitized error, never a success', async () => {
    const events = await collectEvents(
      streamGemini(
        baseInput,
        fakeFetch(
          () =>
            new Response(
              sseBody([
                ...sse([{ candidates: [{ content: { parts: [{ text: 'partial' }] } }] }]),
                'data: {not json\n\n',
                ...sse([{ candidates: [{ finishReason: 'STOP' }] }]),
              ]),
            ),
        ),
      ),
    );
    expect(events).toEqual([
      { type: 'text', text: 'partial' },
      { type: 'error', message: 'Gemini stream failed (malformed data)' },
    ]);
  });
});

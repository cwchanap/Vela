import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn(),
}));

vi.mock('../../config', () => ({
  config: { api: { url: 'http://localhost:9005/api/' } },
}));

import { fetchAuthSession } from 'aws-amplify/auth';
import { llmClient, describeLlmError, type AnalysisFrame } from './index';

const mockFetchAuthSession = vi.mocked(fetchAuthSession);

/** Build a mocked SSE Response whose body delivers `chunks` as separate reads. */
function sseResponse(chunks: string[], ok = true, status = 200) {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    ok,
    status,
    headers: new Headers({ 'content-type': 'text/event-stream' }),
    body: {
      getReader: () => ({
        read: async () =>
          index < chunks.length
            ? { done: false, value: encoder.encode(chunks[index++]) }
            : { done: true, value: undefined },
        cancel: async () => {},
      }),
    },
  };
}

describe('llmClient.generate', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof global.fetch;
    mockFetchAuthSession.mockResolvedValue({
      tokens: { idToken: { toString: () => 'mock-id-token' } },
    } as Awaited<ReturnType<typeof fetchAuthSession>>);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.resetAllMocks();
  });

  it('sends an authenticated JSON POST to the chat endpoint and returns the response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        text: 'こんにちは',
        usage: { inputTokens: 3, outputTokens: 4, cachedInputTokens: 0, cacheWriteTokens: 0 },
      }),
    });

    const result = await llmClient.generate({
      provider: 'google',
      model: 'gemini-3.8-flash',
      apiKey: 'user-key',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Hello' }],
    });

    expect(result.text).toBe('こんにちは');
    expect(result.usage.outputTokens).toBe(4);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:9005/api/llm-chat');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer mock-id-token',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(init.body))).toEqual({
      provider: 'google',
      model: 'gemini-3.8-flash',
      apiKey: 'user-key',
      system: 'You are helpful',
      messages: [{ role: 'user', content: 'Hello' }],
    });
  });

  it('forwards the optional thinking field when provided', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        text: 'ok',
        usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, cacheWriteTokens: 0 },
      }),
    });

    await llmClient.generate({
      provider: 'anthropic',
      messages: [{ role: 'user', content: 'hi' }],
      thinking: 'low',
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).thinking).toBe('low');
  });

  it('rejects with the server error message and status on a non-ok response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: 'Unsupported model' }),
    });

    const error = await llmClient
      .generate({ provider: 'openai', messages: [{ role: 'user', content: 'hi' }] })
      .catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Unsupported model');
    expect(error.status).toBe(400);
  });
});

describe('llmClient.analyzeSentenceStream', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof global.fetch;
    mockFetchAuthSession.mockResolvedValue({
      tokens: { idToken: { toString: () => 'mock-id-token' } },
    } as Awaited<ReturnType<typeof fetchAuthSession>>);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.resetAllMocks();
  });

  const startStream = async (response: unknown) => {
    fetchMock.mockResolvedValueOnce(response);
    const events: AnalysisFrame[] = [];
    await llmClient.analyzeSentenceStream(
      {
        sentence: '日本語を勉強しています',
        provider: 'google',
        model: 'gemini-3.8-flash',
        apiKey: 'user-key',
      },
      (frame) => events.push(frame),
    );
    return events;
  };

  it('sends an authenticated POST with the provider snapshot', async () => {
    await startStream(sseResponse(['data: {"type":"done"}\n\n']));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:9005/api/my-dictionaries/analyze');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer mock-id-token',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(String(init.body))).toEqual({
      sentence: '日本語を勉強しています',
      provider: 'google',
      model: 'gemini-3.8-flash',
      apiKey: 'user-key',
    });
  });

  it('delivers frames in order and resolves on done (buffered single-chunk body)', async () => {
    // Deployed API Gateway/CloudFront buffer the whole response into one body
    // chunk; the same line-splitting logic must parse it.
    const events = await startStream(
      sseResponse([
        'data: {"type":"metadata","sentence":"日本語を勉強しています","provider":"google","model":"gemini-3.8-flash"}\n\n' +
          'data: {"type":"chunk","text":"This means "}\n\n' +
          'data: {"type":"chunk","text":"studying Japanese."}\n\n' +
          'data: {"type":"done"}\n\n',
      ]),
    );

    expect(events).toEqual([
      {
        type: 'metadata',
        sentence: '日本語を勉強しています',
        provider: 'google',
        model: 'gemini-3.8-flash',
      },
      { type: 'chunk', text: 'This means ' },
      { type: 'chunk', text: 'studying Japanese.' },
    ]);
  });

  it('reassembles frames split across reads, including a UTF-8 character split mid-stream', async () => {
    const whole = 'data: {"type":"chunk","text":"日本語"}\n\n' + 'data: {"type":"done"}\n\n';
    // Split at byte offsets that cut mid-frame and inside a multi-byte char
    // (日 at bytes 27..29 of the encoded whole).
    const bytes = new TextEncoder().encode(whole);
    const reads = [bytes.slice(0, 24), bytes.slice(24, 28), bytes.slice(28)];

    const events: AnalysisFrame[] = [];
    let index = 0;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: {
        getReader: () => ({
          read: async () =>
            index < reads.length
              ? { done: false, value: reads[index++] }
              : { done: true, value: undefined },
          cancel: async () => {},
        }),
      },
    });
    await llmClient.analyzeSentenceStream({ sentence: '日本語', provider: 'google' }, (frame) =>
      events.push(frame),
    );

    expect(events).toEqual([{ type: 'chunk', text: '日本語' }]);
  });

  it('flushes a trailing data: line that has no final newline', async () => {
    const events: AnalysisFrame[] = [];
    fetchMock.mockResolvedValueOnce(sseResponse(['data: {"type":"chunk","text":"tail text"}']));
    // Direct call without provider snapshot fields to keep the test focused.
    await llmClient
      .analyzeSentenceStream({ sentence: 's', provider: 'google' }, (f) => events.push(f))
      .catch(() => events.push({ type: 'chunk', text: '__rejected__' }));

    // No done frame follows the flushed chunk, so the stream must reject —
    // but only AFTER the trailing frame was delivered.
    expect(events[0]).toEqual({ type: 'chunk', text: 'tail text' });
    expect(events[events.length - 1]).toEqual({ type: 'chunk', text: '__rejected__' });
  });

  it('rejects when the body ends without a done frame', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse(['data: {"type":"metadata","sentence":"s","provider":"google","model":"m"}\n\n']),
    );

    await expect(
      llmClient.analyzeSentenceStream({ sentence: 's', provider: 'google' }, () => {}),
    ).rejects.toThrow(/ended without completion/i);
  });

  it('rejects with the error frame message', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse(['data: {"type":"error","error":"Gemini request failed (401)"}\n\n']),
    );

    await expect(
      llmClient.analyzeSentenceStream({ sentence: 's', provider: 'google' }, () => {}),
    ).rejects.toThrow('Gemini request failed (401)');
  });

  it('skips malformed lines without swallowing later valid frames', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const events = await startStream(
      sseResponse([
        'data: {"type":"metadata","sentence":"s","provider":"google","model":"m"}\n\n',
        'data: {invalid-json}\n\n',
        'data: {"type":"chunk","text":"still valid"}\n\n',
        'data: {"type":"done"}\n\n',
      ]),
    );

    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(events).toEqual([
      { type: 'metadata', sentence: 's', provider: 'google', model: 'm' },
      { type: 'chunk', text: 'still valid' },
    ]);
    consoleErrorSpy.mockRestore();
  });

  it('rejects with the JSON error message on a non-ok response', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ error: 'Missing API key for Anthropic provider.' }),
    });

    await expect(
      llmClient.analyzeSentenceStream(
        { sentence: 's', provider: 'anthropic', apiKey: '' },
        () => {},
      ),
    ).rejects.toThrow('Missing API key for Anthropic provider.');
  });

  it('rejects when there is no response body', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/event-stream' }),
      body: null,
    });

    await expect(
      llmClient.analyzeSentenceStream({ sentence: 's', provider: 'google' }, () => {}),
    ).rejects.toThrow('No response body');
  });

  it('rejects when no auth token is available', async () => {
    mockFetchAuthSession.mockResolvedValue({
      tokens: {},
    } as Awaited<ReturnType<typeof fetchAuthSession>>);

    await expect(
      llmClient.analyzeSentenceStream({ sentence: 's', provider: 'google' }, () => {}),
    ).rejects.toThrow('Authentication required');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('describeLlmError', () => {
  it('maps a 504 gateway timeout to a helpful message', () => {
    const error = Object.assign(new Error('Gateway Timeout'), { status: 504 });
    expect(describeLlmError(error)).toBe(
      'The AI provider timed out before responding. Try a shorter request or a lighter model.',
    );
  });

  it('passes through ordinary error messages', () => {
    expect(describeLlmError(new Error('Unsupported model'))).toBe('Unsupported model');
  });

  it('falls back for non-Error values', () => {
    expect(describeLlmError(undefined, 'Failed to get AI response')).toBe(
      'Failed to get AI response',
    );
  });
});

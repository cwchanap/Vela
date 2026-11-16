import { describe, test, expect, beforeEach, afterEach, vi } from 'bun:test';
import { ElevenLabsProvider } from '../../../src/tts/providers/elevenlabs';
import { REQUEST_TIMEOUT_MS } from '../../../src/llm/types';

const originalFetch = globalThis.fetch;

const request = {
  text: '日本語',
  apiKey: 'test-key',
  voiceId: 'ErXwobaYiN019PkySvjV',
  model: 'eleven_v4',
};

describe('ElevenLabsProvider', () => {
  let provider: ElevenLabsProvider;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new ElevenLabsProvider();
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('has correct name', () => {
    expect(provider.name).toBe('elevenlabs');
  });

  test('sends the resolved voice and model in the request body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    });

    await provider.generate({ ...request, text: '図書館', voiceId: 'custom-voice-id' });

    const [url, init] = mockFetch.mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
    ];
    expect(url).toBe('https://api.elevenlabs.io/v1/text-to-speech/custom-voice-id');
    expect(init.headers).toMatchObject({
      Accept: 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': 'test-key',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      text: '図書館',
      model_id: 'eleven_v4',
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    });
  });

  test('URL-encodes reserved and path-traversal characters in voiceId', async () => {
    for (const [voiceId, encoded] of [
      ['../../v1/voices', '..%2F..%2Fv1%2Fvoices'],
      ['voice?output_format=pcm_16000#frag', 'voice%3Foutput_format%3Dpcm_16000%23frag'],
    ] as const) {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1]).buffer,
      });

      await provider.generate({ ...request, voiceId });

      const [url] = mockFetch.mock.calls.at(-1) as [string];
      expect(url).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${encoded}`);
    }
  });

  test('sends the alternate resolved model without adapter defaults', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1]).buffer,
    });

    await provider.generate({ ...request, model: 'eleven_multilingual_v2' });

    const callBody = JSON.parse((mockFetch.mock.calls[0] as any[])[1].body);
    expect(callBody.model_id).toBe('eleven_multilingual_v2');
  });

  test('returns audio buffer and audio/mpeg content type', async () => {
    const audioData = new Uint8Array([10, 20, 30]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => audioData.buffer,
    });

    const result = await provider.generate(request);

    expect(result.contentType).toBe('audio/mpeg');
    expect(result.audioBuffer).toBeInstanceOf(Buffer);
  });

  test('stops an oversized streamed audio body before full allocation', async () => {
    let cancelled = false;
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(64 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    mockFetch.mockResolvedValueOnce(new Response(stream));

    const error = await provider.generate(request).catch((failure) => failure);

    expect(error.message).toContain('too large');
    expect(cancelled).toBe(true);
  });

  test('throws error on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    await expect(provider.generate({ ...request, apiKey: 'bad-key' })).rejects.toThrow(
      'ElevenLabs API error 401',
    );
  });

  test('applies the shared 25 s deadline and propagates TimeoutError', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
    const timeoutError = new Error('The operation timed out');
    timeoutError.name = 'TimeoutError';
    mockFetch.mockImplementationOnce(async (_url: string, init: { signal?: AbortSignal }) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      throw timeoutError;
    });

    try {
      const error = await provider.generate(request).catch((failure) => failure);

      expect(error.name).toBe('TimeoutError');
      expect(timeoutSpy).toHaveBeenCalledWith(REQUEST_TIMEOUT_MS);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  test('rethrows non-abort errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await expect(provider.generate(request)).rejects.toThrow('Network error');
  });
});

import { describe, test, expect, beforeEach, afterEach, vi } from 'bun:test';
import { GeminiProvider } from '../../../src/tts/providers/gemini';
import { MAX_TTS_AUDIO_BYTES } from '../../../src/tts/types';
import { REQUEST_TIMEOUT_MS } from '../../../src/llm/types';
import { pcm16ToWav } from '../../../src/tts/wav';

const originalFetch = globalThis.fetch;

interface AudioPart {
  type: string;
  data: string;
  mime_type?: string;
}

function audioPart(data: Buffer, mimeType?: string): AudioPart {
  return {
    type: 'audio',
    data: data.toString('base64'),
    ...(mimeType === undefined ? {} : { mime_type: mimeType }),
  };
}

function makeResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeInteractionsResponse(parts: AudioPart[], status = 'completed'): Response {
  return makeResponse({
    id: 'int_1',
    object: 'interaction',
    status,
    steps: [{ type: 'model_output', content: parts }],
  });
}

function validWav(pcm = Buffer.alloc(8)): Buffer {
  return pcm16ToWav(pcm, 24_000);
}

const request = {
  text: '日本語',
  apiKey: 'test-key',
  voiceId: 'Kore',
  model: 'gemini-3.8-flash-tts',
};

describe('GeminiProvider', () => {
  let provider: GeminiProvider;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new GeminiProvider();
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('has correct name', () => {
    expect(provider.name).toBe('gemini');
  });

  for (const model of ['gemini-3.8-flash-tts', 'gemini-3.8-flash-lite-tts']) {
    test(`posts the Interactions contract for ${model}`, async () => {
      mockFetch.mockResolvedValueOnce(
        makeInteractionsResponse([audioPart(validWav(), 'audio/wav')]),
      );

      const result = await provider.generate({ ...request, model });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0] as [
        string,
        { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
      ];
      expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
      expect(init.method).toBe('POST');
      expect(init.headers).toMatchObject({
        'Content-Type': 'application/json',
        'x-goog-api-key': 'test-key',
      });
      expect(JSON.parse(init.body as string)).toEqual({
        model,
        input: [{ type: 'user_input', content: [{ type: 'text', text: '日本語' }] }],
        response_format: { type: 'audio' },
        generation_config: { speech_config: [{ voice: 'Kore' }] },
      });
      expect(result.contentType).toBe('audio/wav');
    });
  }

  test('passes a complete RIFF/WAVE file through unchanged, including trailing chunks', async () => {
    const wav = validWav(Buffer.from([1, 2, 3, 4]));
    const withC2pa = Buffer.concat([wav, Buffer.from('C2PA trailing manifest bytes')]);
    mockFetch.mockResolvedValueOnce(makeInteractionsResponse([audioPart(withC2pa, 'audio/wav')]));

    const result = await provider.generate(request);

    expect(result.contentType).toBe('audio/wav');
    expect(result.audioBuffer.equals(withC2pa)).toBe(true);
  });

  test('rejects malformed RIFF instead of wrapping it as PCM', async () => {
    const tooShort = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(20)]);
    const notWave = Buffer.alloc(48);
    notWave.write('RIFF', 0, 'ascii');
    notWave.write('XXXX', 8, 'ascii');

    mockFetch
      .mockResolvedValueOnce(makeInteractionsResponse([audioPart(tooShort, 'audio/wav')]))
      .mockResolvedValueOnce(makeInteractionsResponse([audioPart(notWave, 'audio/wav')]));

    await expect(provider.generate(request)).rejects.toThrow('malformed WAV');
    await expect(provider.generate(request)).rejects.toThrow('malformed WAV');
  });

  test('wraps non-RIFF PCM16LE with accepted PCM/L16 MIME metadata', async () => {
    for (const mimeType of ['audio/pcm', 'audio/pcm; rate=24000', 'AUDIO/L16']) {
      const pcm = Buffer.from([1, 2, 3, 4]);
      mockFetch.mockResolvedValueOnce(makeInteractionsResponse([audioPart(pcm, mimeType)]));

      const result = await provider.generate(request);

      expect(result.contentType).toBe('audio/wav');
      expect(result.audioBuffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
      expect(result.audioBuffer.length).toBe(pcm.length + 44);
      expect(result.audioBuffer.subarray(44).equals(pcm)).toBe(true);
    }
  });

  test('rejects non-RIFF audio without confirmed PCM metadata', async () => {
    const pcm = Buffer.alloc(4);
    mockFetch
      .mockResolvedValueOnce(makeInteractionsResponse([audioPart(pcm)]))
      .mockResolvedValueOnce(makeInteractionsResponse([audioPart(pcm, 'audio/wav')]));

    await expect(provider.generate(request)).rejects.toThrow('missing MIME type');
    await expect(provider.generate(request)).rejects.toThrow('unsupported audio format');
  });

  test('rejects explicitly compressed MIME types', async () => {
    for (const mimeType of ['audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/opus']) {
      mockFetch.mockResolvedValueOnce(
        makeInteractionsResponse([audioPart(Buffer.alloc(4), mimeType)]),
      );

      await expect(provider.generate(request)).rejects.toThrow('unsupported audio format');
    }
  });

  test('rejects a non-completed interaction even when valid audio is present', async () => {
    for (const status of ['failed', 'incomplete', 'cancelled']) {
      mockFetch.mockResolvedValueOnce(
        makeInteractionsResponse([audioPart(validWav(), 'audio/wav')], status),
      );

      await expect(provider.generate(request)).rejects.toThrow('interaction did not complete');
    }

    mockFetch.mockResolvedValueOnce(
      makeResponse({
        steps: [{ type: 'model_output', content: [audioPart(validWav(), 'audio/wav')] }],
      }),
    );

    await expect(provider.generate(request)).rejects.toThrow('interaction did not complete');
  });

  test('rejects multiple audio parts in one model-output step as ambiguous', async () => {
    mockFetch.mockResolvedValueOnce(
      makeInteractionsResponse([
        audioPart(validWav(), 'audio/wav'),
        audioPart(validWav(), 'audio/wav'),
      ]),
    );

    await expect(provider.generate(request)).rejects.toThrow('ambiguous audio response');
  });

  test('rejects audio parts across multiple model-output steps as ambiguous', async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse({
        status: 'completed',
        steps: [
          { type: 'model_output', content: [audioPart(validWav(), 'audio/wav')] },
          { type: 'model_output', content: [audioPart(validWav(), 'audio/wav')] },
        ],
      }),
    );

    await expect(provider.generate(request)).rejects.toThrow('ambiguous audio response');
  });

  test('rejects odd-length non-RIFF bytes', async () => {
    mockFetch.mockResolvedValueOnce(
      makeInteractionsResponse([audioPart(Buffer.alloc(3), 'audio/pcm')]),
    );

    await expect(provider.generate(request)).rejects.toThrow('invalid PCM16LE');
  });

  test('rejects malformed base64 before decoding', async () => {
    for (const data of ['AQ!!I=', 'AQI', 'AQID!!!!', 'AQIDBA=']) {
      mockFetch.mockResolvedValueOnce(
        makeInteractionsResponse([{ type: 'audio', data, mime_type: 'audio/wav' }]),
      );

      await expect(provider.generate(request)).rejects.toThrow('invalid base64 audio data');
    }
  });

  test('rejects a sole audio part without usable string data', async () => {
    const invalidParts = [
      { type: 'audio', data: '', mime_type: 'audio/wav' },
      { type: 'audio', data: null, mime_type: 'audio/wav' },
      { type: 'audio', mime_type: 'audio/wav' },
      { type: 'audio', data: 42, mime_type: 'audio/wav' },
    ];

    for (const part of invalidParts) {
      mockFetch.mockResolvedValueOnce(makeInteractionsResponse([part as any]));

      await expect(provider.generate(request)).rejects.toThrow('invalid audio data');
    }
  });

  test('rejects a valid audio part with an invalid audio sibling in the same step', async () => {
    const invalidSiblings = [
      { type: 'audio', data: '', mime_type: 'audio/wav' },
      { type: 'audio', data: null, mime_type: 'audio/wav' },
      { type: 'audio', mime_type: 'audio/wav' },
      { type: 'audio', data: 42, mime_type: 'audio/wav' },
    ];

    for (const sibling of invalidSiblings) {
      mockFetch.mockResolvedValueOnce(
        makeInteractionsResponse([audioPart(validWav(), 'audio/wav'), sibling as any]),
      );

      await expect(provider.generate(request)).rejects.toThrow('ambiguous audio response');
    }
  });

  test('rejects a valid audio part with an invalid audio sibling in a separate model-output step', async () => {
    const invalidSiblings = [
      { type: 'audio', data: '', mime_type: 'audio/wav' },
      { type: 'audio', data: null, mime_type: 'audio/wav' },
      { type: 'audio', mime_type: 'audio/wav' },
      { type: 'audio', data: 42, mime_type: 'audio/wav' },
    ];

    for (const sibling of invalidSiblings) {
      mockFetch.mockResolvedValueOnce(
        makeResponse({
          status: 'completed',
          steps: [
            { type: 'model_output', content: [audioPart(validWav(), 'audio/wav')] },
            { type: 'model_output', content: [sibling] },
          ],
        }),
      );

      await expect(provider.generate(request)).rejects.toThrow('ambiguous audio response');
    }
  });

  test('rejects encoded audio above the base64 budget', async () => {
    mockFetch.mockResolvedValueOnce(
      makeInteractionsResponse([audioPart(Buffer.alloc(MAX_TTS_AUDIO_BYTES + 2), 'audio/pcm')]),
    );

    await expect(provider.generate(request)).rejects.toThrow('too large');
  });

  test('stops an oversized streamed response before full allocation', async () => {
    let cancelled = false;
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(64 * 1024));
      },
      cancel() {
        cancelled = true;
      },
    });
    mockFetch.mockResolvedValueOnce(new Response(stream, { status: 200 }));

    const error = await provider.generate(request).catch((failure) => failure);

    expect(error.message).toContain('too large');
    expect(cancelled).toBe(true);
  });

  test('throws error when no audio data in response', async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse({
        status: 'completed',
        steps: [{ type: 'model_output', content: [{ type: 'text', text: 'hi' }] }],
      }),
    );

    await expect(provider.generate(request)).rejects.toThrow(
      'Gemini TTS: no audio data in response',
    );
  });

  test('throws error on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Bad Request', { status: 400 }));

    const failure = provider.generate({ ...request, apiKey: 'bad-key' }).catch((error) => error);
    const error = await failure;

    expect(error.message).toContain('Gemini TTS API error 400');
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
    mockFetch.mockRejectedValueOnce(new Error('DNS resolution failed'));

    await expect(provider.generate(request)).rejects.toThrow('DNS resolution failed');
  });
});

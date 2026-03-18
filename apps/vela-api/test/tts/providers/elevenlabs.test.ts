import { describe, test, expect, beforeEach, afterEach, vi } from 'bun:test';
import {
  ElevenLabsProvider,
  DEFAULT_VOICE_ID,
  DEFAULT_MODEL,
} from '../../../src/tts/providers/elevenlabs';

const originalFetch = globalThis.fetch;

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

  test('uses default voice and model when not specified', async () => {
    const audioData = new Uint8Array([1, 2, 3, 4]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => audioData.buffer,
    });

    await provider.generate({ text: '日本語', apiKey: 'test-key', voiceId: null, model: null });

    expect(mockFetch).toHaveBeenCalledWith(
      `https://api.elevenlabs.io/v1/text-to-speech/${DEFAULT_VOICE_ID}`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'xi-api-key': 'test-key',
        }),
      }),
    );
    const callBody = JSON.parse((mockFetch.mock.calls[0] as any[])[1].body);
    expect(callBody.model_id).toBe(DEFAULT_MODEL);
  });

  test('uses provided voice and model', async () => {
    const audioData = new Uint8Array([1, 2, 3, 4]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => audioData.buffer,
    });

    await provider.generate({
      text: '日本語',
      apiKey: 'test-key',
      voiceId: 'custom-voice-id',
      model: 'custom-model',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.elevenlabs.io/v1/text-to-speech/custom-voice-id',
      expect.any(Object),
    );
    const callBody = JSON.parse((mockFetch.mock.calls[0] as any[])[1].body);
    expect(callBody.model_id).toBe('custom-model');
  });

  test('returns audio buffer and audio/mpeg content type', async () => {
    const audioData = new Uint8Array([10, 20, 30]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => audioData.buffer,
    });

    const result = await provider.generate({
      text: 'hello',
      apiKey: 'test-key',
      voiceId: null,
      model: null,
    });

    expect(result.contentType).toBe('audio/mpeg');
    expect(result.audioBuffer).toBeInstanceOf(Buffer);
  });

  test('sends correct voice settings in request body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new Uint8Array([]).buffer,
    });

    await provider.generate({ text: 'hello', apiKey: 'key', voiceId: null, model: null });

    const callBody = JSON.parse((mockFetch.mock.calls[0] as any[])[1].body);
    expect(callBody.voice_settings).toEqual({ stability: 0.5, similarity_boost: 0.75 });
    expect(callBody.text).toBe('hello');
  });

  test('throws error on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    await expect(
      provider.generate({ text: 'hello', apiKey: 'bad-key', voiceId: null, model: null }),
    ).rejects.toThrow('ElevenLabs API error 401');
  });

  test('throws timeout error on AbortError', async () => {
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    mockFetch.mockRejectedValueOnce(abortError);

    await expect(
      provider.generate({ text: 'hello', apiKey: 'test-key', voiceId: null, model: null }),
    ).rejects.toThrow('Request timeout');
  });

  test('rethrows non-abort errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await expect(
      provider.generate({ text: 'hello', apiKey: 'test-key', voiceId: null, model: null }),
    ).rejects.toThrow('Network error');
  });
});

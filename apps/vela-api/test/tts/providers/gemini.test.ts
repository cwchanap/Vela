import { describe, test, expect, beforeEach, afterEach, vi } from 'bun:test';
import {
  GeminiProvider,
  DEFAULT_VOICE_ID,
  DEFAULT_MODEL,
  VOICES,
} from '../../../src/tts/providers/gemini';

const originalFetch = globalThis.fetch;

function makeGeminiResponse(b64Data: string, mimeType = 'audio/mpeg') {
  return {
    ok: true,
    json: async () => ({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  data: b64Data,
                  mimeType,
                },
              },
            ],
          },
        },
      ],
    }),
  };
}

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

  test('VOICES contains expected values', () => {
    expect(VOICES).toContain('Kore');
    expect(VOICES).toContain('Zephyr');
    expect(VOICES).toContain('Puck');
  });

  test('uses default voice and model when not specified', async () => {
    const b64 = Buffer.from('audio-data').toString('base64');
    mockFetch.mockResolvedValueOnce(makeGeminiResponse(b64));

    await provider.generate({ text: '日本語', apiKey: 'test-key', voiceId: null, model: null });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining(DEFAULT_MODEL),
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-goog-api-key': 'test-key' }),
      }),
    );
    const callBody = JSON.parse((mockFetch.mock.calls[0] as any[])[1].body);
    expect(callBody.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe(
      DEFAULT_VOICE_ID,
    );
  });

  test('uses provided voice and model', async () => {
    const b64 = Buffer.from('audio-data').toString('base64');
    mockFetch.mockResolvedValueOnce(makeGeminiResponse(b64));

    await provider.generate({
      text: '日本語',
      apiKey: 'test-key',
      voiceId: 'Zephyr',
      model: 'custom-model',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('custom-model'),
      expect.any(Object),
    );
    const callBody = JSON.parse((mockFetch.mock.calls[0] as any[])[1].body);
    expect(callBody.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe(
      'Zephyr',
    );
  });

  test('returns audio buffer from base64 response', async () => {
    const audioData = Buffer.from('hello audio');
    const b64 = audioData.toString('base64');
    mockFetch.mockResolvedValueOnce(makeGeminiResponse(b64));

    const result = await provider.generate({
      text: 'hello',
      apiKey: 'key',
      voiceId: null,
      model: null,
    });

    expect(result.audioBuffer).toBeInstanceOf(Buffer);
    expect(result.audioBuffer.toString()).toBe('hello audio');
  });

  test('resolves content type from mimeType audio/ogg in response', async () => {
    const b64 = Buffer.from('data').toString('base64');
    mockFetch.mockResolvedValueOnce(makeGeminiResponse(b64, 'audio/ogg'));

    const result = await provider.generate({
      text: 'hello',
      apiKey: 'key',
      voiceId: null,
      model: null,
    });

    expect(result.contentType).toBe('audio/ogg');
  });

  test('resolves content type from mimeType audio/wav in response', async () => {
    const b64 = Buffer.from('data').toString('base64');
    mockFetch.mockResolvedValueOnce(makeGeminiResponse(b64, 'audio/wav'));

    const result = await provider.generate({
      text: 'hello',
      apiKey: 'key',
      voiceId: null,
      model: null,
    });

    expect(result.contentType).toBe('audio/wav');
  });

  test('falls back to audio/mpeg for unknown content type', async () => {
    const b64 = Buffer.from('data').toString('base64');
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    data: b64,
                    mimeType: 'audio/completely-unknown-format',
                  },
                },
              ],
            },
          },
        ],
      }),
    });

    const result = await provider.generate({
      text: 'hello',
      apiKey: 'key',
      voiceId: null,
      model: null,
    });

    expect(result.contentType).toBe('audio/mpeg');
  });

  test('throws error when no audio data in response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'no audio here' }] } }],
      }),
    });

    await expect(
      provider.generate({ text: 'hello', apiKey: 'key', voiceId: null, model: null }),
    ).rejects.toThrow('Gemini TTS: no audio data in response');
  });

  test('throws error on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Bad Request',
    });

    await expect(
      provider.generate({ text: 'hello', apiKey: 'bad-key', voiceId: null, model: null }),
    ).rejects.toThrow('Gemini TTS API error 400');
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
    mockFetch.mockRejectedValueOnce(new Error('DNS resolution failed'));

    await expect(
      provider.generate({ text: 'hello', apiKey: 'test-key', voiceId: null, model: null }),
    ).rejects.toThrow('DNS resolution failed');
  });

  test('sends AUDIO responseModalities in request body', async () => {
    const b64 = Buffer.from('data').toString('base64');
    mockFetch.mockResolvedValueOnce(makeGeminiResponse(b64));

    await provider.generate({ text: 'hello', apiKey: 'key', voiceId: null, model: null });

    const callBody = JSON.parse((mockFetch.mock.calls[0] as any[])[1].body);
    expect(callBody.generationConfig.responseModalities).toContain('AUDIO');
  });
});

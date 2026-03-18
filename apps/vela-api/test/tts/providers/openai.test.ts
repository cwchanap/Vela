import { describe, test, expect, beforeEach, afterEach, vi } from 'bun:test';
import {
  OpenAIProvider,
  DEFAULT_VOICE_ID,
  DEFAULT_MODEL,
  VOICES,
} from '../../../src/tts/providers/openai';

const originalFetch = globalThis.fetch;

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    provider = new OpenAIProvider();
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('has correct name', () => {
    expect(provider.name).toBe('openai');
  });

  test('VOICES contains expected values', () => {
    expect(VOICES).toContain('alloy');
    expect(VOICES).toContain('echo');
    expect(VOICES).toContain('nova');
  });

  test('uses default voice and model when not specified', async () => {
    const audioData = new Uint8Array([1, 2, 3]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => audioData.buffer,
    });

    await provider.generate({ text: '日本語', apiKey: 'test-key', voiceId: null, model: null });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/audio/speech',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
        }),
      }),
    );
    const callBody = JSON.parse((mockFetch.mock.calls[0] as any[])[1].body);
    expect(callBody.voice).toBe(DEFAULT_VOICE_ID);
    expect(callBody.model).toBe(DEFAULT_MODEL);
  });

  test('uses provided voice and model', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new Uint8Array([]).buffer,
    });

    await provider.generate({
      text: '日本語',
      apiKey: 'test-key',
      voiceId: 'nova',
      model: 'tts-1-hd',
    });

    const callBody = JSON.parse((mockFetch.mock.calls[0] as any[])[1].body);
    expect(callBody.voice).toBe('nova');
    expect(callBody.model).toBe('tts-1-hd');
  });

  test('sends mp3 response format', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new Uint8Array([]).buffer,
    });

    await provider.generate({ text: 'hello', apiKey: 'key', voiceId: null, model: null });

    const callBody = JSON.parse((mockFetch.mock.calls[0] as any[])[1].body);
    expect(callBody.response_format).toBe('mp3');
  });

  test('sends the text in the request body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new Uint8Array([]).buffer,
    });

    await provider.generate({ text: '日本語テスト', apiKey: 'key', voiceId: null, model: null });

    const callBody = JSON.parse((mockFetch.mock.calls[0] as any[])[1].body);
    expect(callBody.input).toBe('日本語テスト');
  });

  test('returns audio buffer and audio/mpeg content type', async () => {
    const audioData = new Uint8Array([10, 20, 30]);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => audioData.buffer,
    });

    const result = await provider.generate({
      text: 'hello',
      apiKey: 'key',
      voiceId: null,
      model: null,
    });

    expect(result.contentType).toBe('audio/mpeg');
    expect(result.audioBuffer).toBeInstanceOf(Buffer);
  });

  test('throws error on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    });

    await expect(
      provider.generate({ text: 'hello', apiKey: 'bad-key', voiceId: null, model: null }),
    ).rejects.toThrow('OpenAI TTS API error 403');
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
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    await expect(
      provider.generate({ text: 'hello', apiKey: 'test-key', voiceId: null, model: null }),
    ).rejects.toThrow('Connection refused');
  });
});

import { describe, test, expect, beforeEach, afterEach, vi } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { OpenAIRealtimeWS } from 'openai/realtime/ws';
import { OpenAIProvider } from '../../../src/tts/providers/openai';
import { MAX_TTS_AUDIO_BYTES } from '../../../src/tts/types';
import { REQUEST_TIMEOUT_MS } from '../../../src/llm/types';

class FakeSocket extends EventEmitter {
  readyState = 0; // CONNECTING
  terminate = vi.fn();
}

class FakeRealtime extends EventEmitter {
  socket = new FakeSocket();
  send = vi.fn();
  close = vi.fn();
}

const request = {
  text: '図書館',
  apiKey: 'test-key',
  voiceId: 'marin',
  model: 'gpt-realtime-2.1-mini',
};

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function captureRejection(promise: Promise<unknown>): Promise<any> {
  return promise.then(
    () => {
      throw new Error('Expected the generation to fail');
    },
    (error) => error,
  );
}

function emitCompleted(
  fake: FakeRealtime,
  options: {
    pcm?: Buffer;
    transcript?: string | null;
    status?: 'completed' | 'failed';
    output?: unknown[];
  },
) {
  const { pcm, transcript, status = 'completed', output = [] } = options;
  if (pcm && pcm.length > 0) {
    fake.emit('response.output_audio.delta', {
      type: 'response.output_audio.delta',
      delta: pcm.toString('base64'),
    });
  }
  if (transcript !== null && transcript !== undefined) {
    fake.emit('response.output_audio_transcript.done', {
      type: 'response.output_audio_transcript.done',
      transcript,
    });
  }
  fake.emit('response.done', {
    type: 'response.done',
    response: { status, output },
  });
}

async function completeSession(fake: FakeRealtime, options: Parameters<typeof emitCompleted>[1]) {
  await tick();
  fake.emit('session.created', { type: 'session.created' });
  fake.emit('session.updated', { type: 'session.updated' });
  emitCompleted(fake, options);
}

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;
  let fake: FakeRealtime;
  let createClient: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fake = new FakeRealtime();
    createClient = vi.fn(() => fake as unknown as OpenAIRealtimeWS);
    provider = new OpenAIProvider(createClient as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('has correct name', () => {
    expect(provider.name).toBe('openai');
  });

  test('does not send while the socket is CONNECTING and opens on session.created', async () => {
    const generation = provider.generate(request);
    await tick();

    expect(createClient).toHaveBeenCalledWith('test-key', 'gpt-realtime-2.1-mini');
    expect(fake.socket.readyState).toBe(0);
    expect(fake.send).not.toHaveBeenCalled();

    fake.emit('session.created', { type: 'session.created' });

    expect(fake.send).toHaveBeenCalledTimes(1);
    expect(fake.send.mock.calls[0]![0]).toMatchObject({
      type: 'session.update',
      session: {
        type: 'realtime',
        instructions:
          "Read the user's text aloud exactly as written, in Japanese, without adding or changing anything.",
        output_modalities: ['audio'],
        audio: {
          output: {
            format: { type: 'audio/pcm', rate: 24_000 },
            voice: 'marin',
          },
        },
      },
    });

    emitCompleted(fake, { pcm: Buffer.from([1, 2]), transcript: '図書館' });
    await generation;
  });

  test('opens the handshake on the underlying socket open when session.created is absent', async () => {
    const generation = provider.generate(request);
    await tick();

    fake.socket.emit('open');

    expect(fake.send).toHaveBeenCalledTimes(1);
    expect(fake.send.mock.calls[0]![0]).toMatchObject({ type: 'session.update' });

    emitCompleted(fake, { pcm: Buffer.from([1, 2]), transcript: '図書館' });
    await generation;
  });

  test('sends one input item and response.create only after session.updated', async () => {
    const generation = provider.generate({ ...request, text: '今日はいい天気ですね。' });
    await tick();
    fake.emit('session.created', { type: 'session.created' });

    expect(fake.send).toHaveBeenCalledTimes(1);

    fake.emit('session.updated', { type: 'session.updated' });

    expect(fake.send).toHaveBeenCalledTimes(3);
    expect(fake.send.mock.calls[1]![0]).toEqual({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: '今日はいい天気ですね。' }],
      },
    });
    expect(fake.send.mock.calls[2]![0]).toEqual({
      type: 'response.create',
      response: { output_modalities: ['audio'] },
    });

    fake.emit('session.created', { type: 'session.created' });
    fake.emit('session.updated', { type: 'session.updated' });
    expect(fake.send).toHaveBeenCalledTimes(3);

    emitCompleted(fake, { pcm: Buffer.from([1, 2]), transcript: '今日はいい天気ですね。' });
    await generation;
  });

  test('returns a 24 kHz WAV on a completed response and cleans up', async () => {
    const pcm = Buffer.from([1, 2, 3, 4, 5, 6]);
    const generation = provider.generate({ ...request, text: 'ひらがな' });
    await completeSession(fake, { pcm, transcript: 'ひらがな' });

    const result = await generation;

    expect(result.contentType).toBe('audio/wav');
    expect(result.audioBuffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(result.audioBuffer.readUInt32LE(24)).toBe(24_000);
    expect(result.audioBuffer.readUInt32LE(40)).toBe(pcm.length);
    expect(result.audioBuffer.subarray(44).equals(pcm)).toBe(true);
    expect(fake.close).toHaveBeenCalledTimes(1);
    expect(fake.socket.terminate).not.toHaveBeenCalled();
    expect(fake.listenerCount('response.done')).toBe(0);
    expect(fake.listenerCount('error')).toBe(0);
    expect(fake.socket.listenerCount('close')).toBe(0);
  });

  test('uses the response.done output transcript when the transcript event is absent or empty', async () => {
    for (const transcript of [null, '']) {
      const generation = provider.generate({ ...request, text: 'ひらがな' });
      await completeSession(fake, {
        pcm: Buffer.from([1, 2]),
        transcript,
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_audio', transcript: 'ひらがな' }],
          },
        ],
      });

      const result = await generation;
      expect(result.contentType).toBe('audio/wav');
    }
  });

  test('fails promptly when the underlying socket closes before completion', async () => {
    const generation = provider.generate(request);
    const rejection = captureRejection(generation);
    await tick();

    fake.socket.emit('close');

    const error = await rejection;
    expect(error.message).toContain('socket closed before response completed');
    expect(fake.socket.terminate).toHaveBeenCalledTimes(1);
    expect(fake.listenerCount('error')).toBe(0);
  });

  test('rejects on an SDK error', async () => {
    const generation = provider.generate(request);
    const rejection = captureRejection(generation);
    await tick();

    fake.emit('error', new Error('upstream 500 with secret material'));

    const error = await rejection;
    expect(error.message).toBe('OpenAI Realtime TTS session failed');
    expect(fake.socket.terminate).toHaveBeenCalledTimes(1);
  });

  test('bridges the shared 25 s deadline to socket cleanup and a TimeoutError', async () => {
    const controller = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const generation = provider.generate(request);
    const rejection = captureRejection(generation);
    await tick();
    fake.emit('session.created', { type: 'session.created' });

    controller.abort();

    const error = await rejection;
    expect(error.name).toBe('TimeoutError');
    expect(timeoutSpy).toHaveBeenCalledWith(REQUEST_TIMEOUT_MS);
    expect(fake.socket.terminate).toHaveBeenCalledTimes(1);
    expect(fake.listenerCount('response.done')).toBe(0);
  });

  test('rejects a completed response with empty audio', async () => {
    const generation = provider.generate(request);
    const rejection = captureRejection(generation);
    await completeSession(fake, { transcript: '図書館' });

    const error = await rejection;
    expect(error.message).toContain('audio');
    expect(fake.socket.terminate).toHaveBeenCalledTimes(1);
  });

  test('rejects a completed response with no transcript', async () => {
    const generation = provider.generate(request);
    const rejection = captureRejection(generation);
    await completeSession(fake, { pcm: Buffer.from([1, 2]), transcript: null });

    const error = await rejection;
    expect(error.message).toContain('transcript');
  });

  test('rejects obvious commentary instead of returning it for upload', async () => {
    const generation = provider.generate({ ...request, text: 'ひらがな' });
    const rejection = captureRejection(generation);
    await completeSession(fake, {
      pcm: Buffer.from([1, 2]),
      transcript: 'ひらがなは、日本語の文字の一種で、漢字に対して使われる文字です。',
    });

    const error = await rejection;
    expect(error.message).toContain('transcript');
    expect(fake.socket.terminate).toHaveBeenCalledTimes(1);
  });

  test('rejects an odd-length PCM stream as invalid', async () => {
    const generation = provider.generate(request);
    const rejection = captureRejection(generation);
    await completeSession(fake, { pcm: Buffer.from([1, 2, 3]), transcript: '図書館' });

    const error = await rejection;
    expect(error.message).toContain('invalid PCM16LE');
    expect(fake.socket.terminate).toHaveBeenCalledTimes(1);
  });

  test('rejects a non-completed response status', async () => {
    const generation = provider.generate(request);
    const rejection = captureRejection(generation);
    await completeSession(fake, {
      pcm: Buffer.from([1, 2]),
      transcript: '図書館',
      status: 'failed',
    });

    const error = await rejection;
    expect(error.message).toContain('did not complete');
  });

  test('rejects audio above the bounded pronunciation buffer', async () => {
    const generation = provider.generate(request);
    const rejection = captureRejection(generation);
    await tick();
    fake.emit('session.created', { type: 'session.created' });
    fake.emit('session.updated', { type: 'session.updated' });
    fake.emit('response.output_audio.delta', {
      type: 'response.output_audio.delta',
      delta: Buffer.alloc(MAX_TTS_AUDIO_BYTES + 2).toString('base64'),
    });

    const error = await rejection;
    expect(error.message).toContain('too large');
    expect(fake.socket.terminate).toHaveBeenCalledTimes(1);
  });
});

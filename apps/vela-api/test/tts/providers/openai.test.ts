import { describe, test, expect, beforeEach, afterEach, vi } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { OpenAIRealtimeWS } from 'openai/realtime/ws';
import {
  OpenAIProvider,
  OPENAI_REALTIME_MAX_PAYLOAD_BYTES,
} from '../../../src/tts/providers/openai';
import { MAX_TTS_AUDIO_BASE64_CHARS, MAX_TTS_AUDIO_BYTES } from '../../../src/tts/types';
import { REQUEST_TIMEOUT_MS } from '../../../src/llm/types';

/**
 * Models the installed `ws`/SDK behaviour the DOM EventEmitter fake used to
 * miss: CONNECTING termination emits a transport error asynchronously, and the
 * SDK turns an error with no listener into an unhandled rejected promise.
 */
class FakeSocket extends EventEmitter {
  readyState = 0; // CONNECTING
  close = vi.fn();
  terminate = vi.fn(() => {
    setImmediate(() => {
      this.emit('error', new Error('WebSocket was closed before the connection was established'));
      this.emit('close');
    });
  });
}

class FakeRealtime extends EventEmitter {
  socket = new FakeSocket();
  send = vi.fn();
  close = vi.fn(() => {
    this.socket.close();
  });

  constructor() {
    super();
    this.socket.on('error', (error: Error) => this.forwardSocketError(error));
  }

  /** Mirrors the SDK's no-listener unhandled rejection. */
  emitLateError(error: Error) {
    this.forwardSocketError(error);
  }

  private forwardSocketError(error: Error) {
    if (this.listenerCount('error') === 0) {
      void Promise.reject(error);
      return;
    }
    this.emit('error', error);
  }
}

const request = {
  text: '図書館',
  apiKey: 'test-key',
  voiceId: 'marin',
  model: 'gpt-realtime-2.1-mini',
};

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const drain = async () => {
  await tick();
  await tick();
};

function captureRejection(promise: Promise<unknown>): Promise<any> {
  return promise.then(
    () => {
      throw new Error('Expected the generation to fail');
    },
    (error) => error,
  );
}

async function collectUnhandled(run: () => Promise<void>): Promise<unknown[]> {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    await run();
    await new Promise((resolve) => setTimeout(resolve, 10));
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  return unhandled;
}

function emitDelta(fake: FakeRealtime, pcm: Buffer) {
  fake.emit('response.output_audio.delta', {
    type: 'response.output_audio.delta',
    delta: pcm.toString('base64'),
  });
}

function emitTranscript(fake: FakeRealtime, transcript: string) {
  fake.emit('response.output_audio_transcript.done', {
    type: 'response.output_audio_transcript.done',
    transcript,
  });
}

function emitDone(
  fake: FakeRealtime,
  options: {
    status?: 'completed' | 'failed' | 'incomplete';
    output?: unknown;
  } = {},
) {
  fake.emit('response.done', {
    type: 'response.done',
    response: { status: options.status ?? 'completed', output: options.output ?? [] },
  });
}

async function openSession(fake: FakeRealtime) {
  await tick();
  fake.emit('session.created', { type: 'session.created' });
  fake.emit('session.updated', { type: 'session.updated' });
}

function emitCompleted(
  fake: FakeRealtime,
  options: {
    pcm?: Buffer;
    pcmChunks?: Buffer[];
    transcript?: string | null;
    status?: 'completed' | 'failed' | 'incomplete';
    output?: unknown;
  },
) {
  const { pcm, pcmChunks = [], transcript, status, output } = options;
  if (pcm && pcm.length > 0) emitDelta(fake, pcm);
  for (const chunk of pcmChunks) emitDelta(fake, chunk);
  if (transcript !== null && transcript !== undefined) emitTranscript(fake, transcript);
  emitDone(fake, { status, output });
}

async function completeSession(fake: FakeRealtime, options: Parameters<typeof emitCompleted>[1]) {
  await openSession(fake);
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

  test('exposes a finite ws message cap above the encoded audio envelope', () => {
    expect(Number.isFinite(OPENAI_REALTIME_MAX_PAYLOAD_BYTES)).toBe(true);
    expect(OPENAI_REALTIME_MAX_PAYLOAD_BYTES).toBe(MAX_TTS_AUDIO_BASE64_CHARS + 64 * 1024);
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

  test('returns a 24 kHz WAV with ordered chunks and finalizes listeners on close', async () => {
    const pcmChunks = [Buffer.from([1, 2]), Buffer.from([3, 4, 5, 6])];
    const generation = provider.generate({ ...request, text: 'ひらがな' });
    await completeSession(fake, { pcmChunks, transcript: 'ひらがな' });

    const result = await generation;

    expect(result.contentType).toBe('audio/wav');
    expect(result.audioBuffer.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(result.audioBuffer.readUInt32LE(24)).toBe(24_000);
    expect(result.audioBuffer.readUInt32LE(40)).toBe(6);
    expect(result.audioBuffer.subarray(44).equals(Buffer.concat(pcmChunks))).toBe(true);
    expect(fake.close).toHaveBeenCalledTimes(1);
    expect(fake.socket.terminate).not.toHaveBeenCalled();
    expect(fake.listenerCount('response.done')).toBe(0);
    // The SDK error/transport-close listeners stay until the socket closes.
    expect(fake.listenerCount('error')).toBe(1);
    expect(fake.socket.listenerCount('close')).toBe(1);

    fake.socket.emit('close');

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

  test('accepts a kana transcript for kanji input because equality is not required', async () => {
    const generation = provider.generate({ ...request, text: '漢字' });
    await completeSession(fake, { pcm: Buffer.from([1, 2]), transcript: 'かんじ' });

    const result = await generation;

    expect(result.contentType).toBe('audio/wav');
  });

  test('fails promptly when the underlying socket closes before completion', async () => {
    const generation = provider.generate(request);
    const rejection = captureRejection(generation);
    await tick();

    fake.socket.emit('close');

    const error = await rejection;
    expect(error.message).toContain('socket closed before response completed');
    // The socket is already closed, so it must not schedule another teardown.
    expect(fake.socket.terminate).not.toHaveBeenCalled();
    expect(fake.listenerCount('error')).toBe(0);
    expect(fake.socket.listenerCount('close')).toBe(0);
  });

  test('rejects on an SDK error and retains the listener through asynchronous teardown', async () => {
    const generation = provider.generate(request);
    const rejection = captureRejection(generation);

    const unhandled = await collectUnhandled(async () => {
      await tick();
      fake.emit('error', new Error('upstream 500 with secret material'));

      const error = await rejection;
      expect(error.message).toBe('OpenAI Realtime TTS session failed');
      expect(fake.socket.terminate).toHaveBeenCalledTimes(1);
      expect(fake.listenerCount('error')).toBe(1);

      await drain();
      expect(fake.listenerCount('error')).toBe(0);
      expect(fake.socket.listenerCount('close')).toBe(0);
    });

    expect(unhandled).toEqual([]);
  });

  test('bridges the shared 25 s deadline to a CONNECTING terminate without unhandled rejections', async () => {
    const controller = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const generation = provider.generate(request);
    const rejection = captureRejection(generation);

    const unhandled = await collectUnhandled(async () => {
      await tick();
      controller.abort();

      const error = await rejection;
      expect(error.name).toBe('TimeoutError');
      expect(timeoutSpy).toHaveBeenCalledWith(REQUEST_TIMEOUT_MS);
      expect(fake.socket.terminate).toHaveBeenCalledTimes(1);
      // ws emits the handshake-abort error asynchronously; the SDK listener
      // must remain attached until its close event.
      expect(fake.listenerCount('error')).toBe(1);

      await drain();
      expect(fake.listenerCount('error')).toBe(0);
      expect(fake.socket.listenerCount('close')).toBe(0);
    });

    expect(unhandled).toEqual([]);
  });

  test('keeps the listener through a late error after success and does not log it', async () => {
    const consoleError = vi.spyOn(console, 'error');
    const generation = provider.generate({ ...request, text: 'ひらがな' });
    await completeSession(fake, { pcm: Buffer.from([1, 2]), transcript: 'ひらがな' });
    await generation;

    expect(fake.listenerCount('error')).toBe(1);

    const unhandled = await collectUnhandled(async () => {
      fake.emitLateError(new Error('late upstream secret'));
      expect(fake.listenerCount('error')).toBe(1);

      fake.socket.emit('close');
      expect(fake.listenerCount('error')).toBe(0);
      expect(fake.socket.listenerCount('close')).toBe(0);
    });

    expect(unhandled).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
  });

  test('rejects a malformed audio delta without throwing out of the emitter', async () => {
    const generation = provider.generate(request);
    const rejection = captureRejection(generation);
    await openSession(fake);

    fake.emit('response.output_audio.delta', {
      type: 'response.output_audio.delta',
      delta: null,
    } as any);

    const error = await rejection;
    expect(error.message).toContain('malformed audio event');
    expect(fake.socket.terminate).toHaveBeenCalledTimes(1);
    await drain();
    expect(fake.listenerCount('error')).toBe(0);
  });

  test('rejects a non-string transcript event', async () => {
    const generation = provider.generate(request);
    const rejection = captureRejection(generation);
    await openSession(fake);

    fake.emit('response.output_audio_transcript.done', {
      type: 'response.output_audio_transcript.done',
      transcript: 42,
    } as any);

    const error = await rejection;
    expect(error.message).toContain('malformed transcript event');
    await drain();
    expect(fake.listenerCount('error')).toBe(0);
  });

  test('rejects a terminal event with no response object', async () => {
    const generation = provider.generate(request);
    const rejection = captureRejection(generation);
    await openSession(fake);

    fake.emit('response.done', { type: 'response.done' } as any);

    const error = await rejection;
    expect(error.message).toContain('malformed done event');
    await drain();
    expect(fake.listenerCount('error')).toBe(0);
  });

  test('rejects malformed fallback output without throwing', async () => {
    const generation = provider.generate(request);
    const rejection = captureRejection(generation);
    await openSession(fake);
    emitDelta(fake, Buffer.from([1, 2]));
    emitDone(fake, { output: 'not-an-array' });

    const error = await rejection;
    expect(error.message).toContain('transcript');
    await drain();
    expect(fake.listenerCount('error')).toBe(0);
  });

  test('rejects malformed base64 audio before decoding', async () => {
    const generation = provider.generate(request);
    const rejection = captureRejection(generation);
    await openSession(fake);

    fake.emit('response.output_audio.delta', {
      type: 'response.output_audio.delta',
      delta: 'AQ!!I=',
    });

    const error = await rejection;
    expect(error.message).toContain('malformed base64');
    await drain();
    expect(fake.listenerCount('error')).toBe(0);
  });

  test('rejects one encoded delta above the base64 budget before decoding', async () => {
    const generation = provider.generate(request);
    const rejection = captureRejection(generation);
    await openSession(fake);

    fake.emit('response.output_audio.delta', {
      type: 'response.output_audio.delta',
      delta: 'A'.repeat(MAX_TTS_AUDIO_BASE64_CHARS + 4),
    });

    const error = await rejection;
    expect(error.message).toContain('too large');
    await drain();
    expect(fake.listenerCount('error')).toBe(0);
  });

  test('rejects cumulative decoded audio above the bounded buffer', async () => {
    const chunk = Buffer.alloc(Math.floor(MAX_TTS_AUDIO_BYTES / 2) + 2);
    const generation = provider.generate(request);
    const rejection = captureRejection(generation);
    await openSession(fake);

    emitDelta(fake, chunk);
    emitDelta(fake, chunk);

    const error = await rejection;
    expect(error.message).toContain('too large');
    await drain();
    expect(fake.listenerCount('error')).toBe(0);
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
});

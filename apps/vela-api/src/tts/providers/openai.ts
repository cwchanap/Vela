import OpenAI from 'openai';
import { OpenAIRealtimeWS } from 'openai/realtime/ws';
import type {
  ResponseAudioDeltaEvent,
  ResponseAudioTranscriptDoneEvent,
  ResponseDoneEvent,
} from 'openai/resources/realtime/realtime';
import { withRequestTimeout } from '../../llm/types';
import type { TTSGenerateRequest, TTSGenerateResult, TTSProvider } from '../types';
import { MAX_TTS_AUDIO_BASE64_CHARS, MAX_TTS_AUDIO_BYTES } from '../types';
import { isValidBase64 } from '../transport';
import { pcm16ToWav } from '../wav';

/* eslint-disable no-unused-vars -- function-type parameter names are never "used" */
type RealtimeClientFactory = (apiKey: string, model: string) => OpenAIRealtimeWS;
/* eslint-enable no-unused-vars */

const SESSION_INSTRUCTIONS =
  "Read the user's text aloud exactly as written, in Japanese, without adding or changing anything.";
/** Slack added to twice the normalized input length for the cheap guard. */
const TRANSCRIPT_LENGTH_SLACK = 8;
/**
 * Finite `ws` message cap: the largest accepted encoded audio plus JSON event
 * overhead. The SDK otherwise leaves `maxPayload` at 0 (unlimited).
 */
export const OPENAI_REALTIME_MAX_PAYLOAD_BYTES = MAX_TTS_AUDIO_BASE64_CHARS + 64 * 1024;

function createRealtimeClient(apiKey: string, model: string): OpenAIRealtimeWS {
  return new OpenAIRealtimeWS(
    { model, options: { maxPayload: OPENAI_REALTIME_MAX_PAYLOAD_BYTES } },
    new OpenAI({ apiKey }),
  );
}

function timeoutError(): Error {
  const error = new Error('TTS request timed out');
  error.name = 'TimeoutError';
  return error;
}

function normalizeLength(text: string): number {
  return text.replace(/[\s\p{P}\p{S}]/gu, '').length;
}

function hasPlausibleTranscript(input: string, transcript: string | null): boolean {
  if (!transcript) return false;
  const outputLength = normalizeLength(transcript);
  // shortcut: a normalized-length heuristic is not a semantic verifier. It can
  // miss short paraphrases and kanji→kana re-readings; refine only from
  // observed Japanese samples, never with a second model or parser.
  return outputLength > 0 && outputLength <= normalizeLength(input) * 2 + TRANSCRIPT_LENGTH_SLACK;
}

/**
 * `response.done` output is the Step 0-confirmed fallback for the transcript.
 * Runtime payloads are untrusted despite the SDK's TypeScript types: every
 * traversal level is checked so malformed data becomes a missing transcript
 * rather than an exception escaping an event callback.
 */
function transcriptFromResponse(response: unknown): string | null {
  const output = (response as { output?: unknown } | null)?.output;
  if (!Array.isArray(output)) return null;

  for (const item of output) {
    if (typeof item !== 'object' || item === null) continue;
    const message = item as { type?: unknown; role?: unknown; content?: unknown };
    if (message.type !== 'message' || message.role !== 'assistant') continue;
    if (!Array.isArray(message.content)) continue;

    for (const part of message.content) {
      if (typeof part !== 'object' || part === null) continue;
      const transcript = (part as { transcript?: unknown }).transcript;
      if (typeof transcript === 'string' && transcript.trim()) return transcript;
    }
  }
  return null;
}

/**
 * One short-lived Realtime socket per pronunciation request. Reconnect is not
 * enabled, so the SDK forwards transport closure through `rt.socket.once('close')`
 * (its own `close` event is wired only with recovery).
 */
export class OpenAIProvider implements TTSProvider {
  readonly name = 'openai' as const;
  private readonly createClient: RealtimeClientFactory;

  constructor(createClient: RealtimeClientFactory = createRealtimeClient) {
    this.createClient = createClient;
  }

  async generate(request: TTSGenerateRequest): Promise<TTSGenerateResult> {
    const rt = this.createClient(request.apiKey, request.model);
    const signal = withRequestTimeout();
    const chunks: Buffer[] = [];
    let audioBytes = 0;
    let encodedChars = 0;
    let transcript: string | null = null;
    let settled = false;
    let transportClosed = false;
    let sentSessionUpdate = false;
    let sentResponse = false;
    let removeAbortListener = () => {};
    const resultRemovers: Array<() => void> = [];

    return new Promise<TTSGenerateResult>((resolve, reject) => {
      const removeResultHandlers = () => {
        removeAbortListener();
        for (const remove of resultRemovers) remove();
      };

      const removeTransportHandlers = () => {
        rt.off('error', onSdkError);
        rt.socket.off('close', onSocketClose);
      };

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        removeResultHandlers();
        // A closed socket must not be terminated again: ws schedules a
        // transport error for CONNECTING termination, not for an already
        // closed socket.
        if (!transportClosed) {
          try {
            rt.socket.terminate();
          } catch {
            // Best-effort teardown; the rejection is the request outcome.
          }
        }
        if (transportClosed) removeTransportHandlers();
        reject(error);
      };

      const succeed = (result: TTSGenerateResult) => {
        if (settled) return;
        settled = true;
        removeResultHandlers();
        try {
          rt.close();
        } catch {
          // The socket is single-use; nothing else to release.
        }
        if (transportClosed) removeTransportHandlers();
        resolve(result);
      };

      // Deliberately retained after settlement until the underlying socket
      // closes: the SDK turns a late transport error with no listener into an
      // unhandled rejected promise carrying upstream details. This handler is
      // non-logging and only keeps that failure inside the request outcome.
      const onSdkError = () => fail(new Error('OpenAI Realtime TTS session failed'));

      // Registered before any close/terminate so asynchronous shutdown errors
      // still reach the SDK listener; final removal happens on terminal close.
      const onSocketClose = () => {
        transportClosed = true;
        if (!settled) {
          fail(new Error('OpenAI Realtime TTS socket closed before response completed'));
        }
        removeTransportHandlers();
      };

      // The SDK's non-reconnecting send() does not buffer while CONNECTING, so
      // act only after the socket opens or the server's session.created arrives.
      const sendSessionUpdate = () => {
        if (settled || sentSessionUpdate) return;
        sentSessionUpdate = true;
        rt.send({
          type: 'session.update',
          session: {
            type: 'realtime',
            instructions: SESSION_INSTRUCTIONS,
            output_modalities: ['audio'],
            audio: {
              output: {
                format: { type: 'audio/pcm', rate: 24_000 },
                voice: request.voiceId,
              },
            },
          },
        });
      };

      const onSessionUpdated = () => {
        if (settled || sentResponse) return;
        sentResponse = true;
        rt.send({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: request.text }],
          },
        });
        rt.send({ type: 'response.create', response: { output_modalities: ['audio'] } });
      };

      const onAudioDelta = (event: ResponseAudioDeltaEvent) => {
        if (settled) return;
        const delta = (event as { delta?: unknown } | null)?.delta;
        if (typeof delta !== 'string') {
          fail(new Error('OpenAI Realtime TTS received a malformed audio event'));
          return;
        }
        if (delta.length === 0) return;
        if (encodedChars + delta.length > MAX_TTS_AUDIO_BASE64_CHARS) {
          fail(new Error('OpenAI Realtime TTS audio response too large'));
          return;
        }
        if (!isValidBase64(delta)) {
          fail(new Error('OpenAI Realtime TTS received malformed base64 audio'));
          return;
        }
        const chunk = Buffer.from(delta, 'base64');
        audioBytes += chunk.length;
        if (audioBytes > MAX_TTS_AUDIO_BYTES) {
          fail(new Error('OpenAI Realtime TTS audio response too large'));
          return;
        }
        encodedChars += delta.length;
        chunks.push(chunk);
      };

      const onTranscript = (event: ResponseAudioTranscriptDoneEvent) => {
        if (settled) return;
        const value = (event as { transcript?: unknown } | null)?.transcript;
        if (typeof value !== 'string') {
          fail(new Error('OpenAI Realtime TTS received a malformed transcript event'));
          return;
        }
        transcript = value;
      };

      const onResponseDone = (event: ResponseDoneEvent) => {
        if (settled) return;
        const response = (event as { response?: unknown } | null)?.response;
        if (typeof response !== 'object' || response === null) {
          fail(new Error('OpenAI Realtime TTS received a malformed done event'));
          return;
        }
        if ((response as { status?: unknown }).status !== 'completed') {
          fail(new Error('OpenAI Realtime TTS response did not complete'));
          return;
        }
        const finalTranscript = transcript || transcriptFromResponse(response);
        if (!hasPlausibleTranscript(request.text, finalTranscript)) {
          fail(new Error('OpenAI Realtime TTS transcript was missing or implausible'));
          return;
        }
        if (audioBytes === 0) {
          fail(new Error('OpenAI Realtime TTS returned empty audio'));
          return;
        }
        try {
          const pcm = Buffer.concat(chunks, audioBytes);
          succeed({ audioBuffer: pcm16ToWav(pcm, 24_000), contentType: 'audio/wav' });
        } catch {
          fail(new Error('OpenAI Realtime TTS returned invalid PCM16LE audio'));
        }
      };

      const onAbort = () => fail(timeoutError());

      // Failure/transport handlers are registered before any send attempt.
      rt.on('error', onSdkError);
      rt.socket.once('close', onSocketClose);
      rt.on('session.created', sendSessionUpdate);
      resultRemovers.push(() => rt.off('session.created', sendSessionUpdate));
      rt.socket.once('open', sendSessionUpdate);
      resultRemovers.push(() => rt.socket.off('open', sendSessionUpdate));
      rt.on('session.updated', onSessionUpdated);
      resultRemovers.push(() => rt.off('session.updated', onSessionUpdated));
      rt.on('response.output_audio.delta', onAudioDelta);
      resultRemovers.push(() => rt.off('response.output_audio.delta', onAudioDelta));
      rt.on('response.output_audio_transcript.done', onTranscript);
      resultRemovers.push(() => rt.off('response.output_audio_transcript.done', onTranscript));
      rt.on('response.done', onResponseDone);
      resultRemovers.push(() => rt.off('response.done', onResponseDone));

      removeAbortListener = () => signal.removeEventListener('abort', onAbort);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}

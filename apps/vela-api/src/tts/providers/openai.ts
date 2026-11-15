import OpenAI from 'openai';
import { OpenAIRealtimeWS } from 'openai/realtime/ws';
import type {
  RealtimeResponse,
  ResponseAudioDeltaEvent,
  ResponseAudioTranscriptDoneEvent,
  ResponseDoneEvent,
} from 'openai/resources/realtime/realtime';
import { withRequestTimeout } from '../../llm/types';
import type { TTSGenerateRequest, TTSGenerateResult, TTSProvider } from '../types';
import { MAX_TTS_AUDIO_BYTES } from '../types';
import { pcm16ToWav } from '../wav';

/* eslint-disable no-unused-vars -- function-type parameter names are never "used" */
type RealtimeClientFactory = (apiKey: string, model: string) => OpenAIRealtimeWS;
/* eslint-enable no-unused-vars */

const SESSION_INSTRUCTIONS =
  "Read the user's text aloud exactly as written, in Japanese, without adding or changing anything.";
/** Slack added to twice the normalized input length for the cheap guard. */
const TRANSCRIPT_LENGTH_SLACK = 8;

function createRealtimeClient(apiKey: string, model: string): OpenAIRealtimeWS {
  return new OpenAIRealtimeWS({ model }, new OpenAI({ apiKey }));
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

/** `response.done` output is the Step 0-confirmed fallback for the transcript. */
function transcriptFromResponse(response: RealtimeResponse): string | null {
  for (const item of response.output ?? []) {
    if (item.type !== 'message' || item.role !== 'assistant') continue;
    for (const part of item.content) {
      if (typeof part.transcript === 'string' && part.transcript.trim()) {
        return part.transcript;
      }
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
    let transcript: string | null = null;
    let settled = false;
    let sentSessionUpdate = false;
    let sentResponse = false;
    let removeAbortListener = () => {};
    const removers: Array<() => void> = [];

    return new Promise<TTSGenerateResult>((resolve, reject) => {
      const cleanup = () => {
        removeAbortListener();
        for (const remove of removers) remove();
      };

      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        try {
          rt.socket.terminate();
        } catch {
          // Best-effort teardown; the rejection is the request outcome.
        }
        reject(error);
      };

      const succeed = (result: TTSGenerateResult) => {
        if (settled) return;
        settled = true;
        try {
          rt.close();
        } catch {
          // The socket is single-use; nothing else to release.
        }
        cleanup();
        resolve(result);
      };

      const onSdkError = () => fail(new Error('OpenAI Realtime TTS session failed'));
      const onSocketClose = () =>
        fail(new Error('OpenAI Realtime TTS socket closed before response completed'));

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
        const chunk = Buffer.from(event.delta, 'base64');
        audioBytes += chunk.length;
        if (audioBytes > MAX_TTS_AUDIO_BYTES) {
          fail(new Error('OpenAI Realtime TTS audio response too large'));
          return;
        }
        chunks.push(chunk);
      };

      const onTranscript = (event: ResponseAudioTranscriptDoneEvent) => {
        transcript = event.transcript;
      };

      const onResponseDone = (event: ResponseDoneEvent) => {
        if (settled) return;
        if (event.response.status !== 'completed') {
          fail(new Error('OpenAI Realtime TTS response did not complete'));
          return;
        }
        const finalTranscript = transcript || transcriptFromResponse(event.response);
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

      // Register failure handlers before any send attempt.
      rt.on('error', onSdkError);
      removers.push(() => rt.off('error', onSdkError));
      rt.socket.once('close', onSocketClose);
      removers.push(() => rt.socket.off('close', onSocketClose));
      rt.on('session.created', sendSessionUpdate);
      removers.push(() => rt.off('session.created', sendSessionUpdate));
      rt.socket.once('open', sendSessionUpdate);
      removers.push(() => rt.socket.off('open', sendSessionUpdate));
      rt.on('session.updated', onSessionUpdated);
      removers.push(() => rt.off('session.updated', onSessionUpdated));
      rt.on('response.output_audio.delta', onAudioDelta);
      removers.push(() => rt.off('response.output_audio.delta', onAudioDelta));
      rt.on('response.output_audio_transcript.done', onTranscript);
      removers.push(() => rt.off('response.output_audio_transcript.done', onTranscript));
      rt.on('response.done', onResponseDone);
      removers.push(() => rt.off('response.done', onResponseDone));

      removeAbortListener = () => signal.removeEventListener('abort', onAbort);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }
}

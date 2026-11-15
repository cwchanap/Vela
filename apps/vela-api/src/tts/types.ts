import type { TtsProvider } from '@vela/common/contracts/tts';

export type TTSProviderName = TtsProvider;

/**
 * Bound for one short pronunciation request. 24 kHz PCM16 mono is 48 kB/s, so
 * this is roughly 43 seconds of audio — far above observed unary output while
 * still preventing an unbounded stream/session buffer.
 */
export const MAX_TTS_AUDIO_BYTES = 2 * 1024 * 1024;

export interface TTSGenerateRequest {
  text: string;
  apiKey: string;
  /** Resolved by the route from the shared registry; adapters never default it. */
  voiceId: string;
  model: string;
}

export interface TTSGenerateResult {
  audioBuffer: Buffer;
  contentType: string;
}

export interface TTSProvider {
  readonly name: TTSProviderName;
  generate(request: TTSGenerateRequest): Promise<TTSGenerateResult>; // eslint-disable-line no-unused-vars
}

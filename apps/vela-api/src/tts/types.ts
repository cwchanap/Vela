import type { TtsProvider } from '@vela/common/contracts/tts';

export type TTSProviderName = TtsProvider;

export interface TTSGenerateRequest {
  text: string;
  apiKey: string;
  /** Resolved by the route from the shared registry; adapters never default it. */
  voiceId: string;
  model: string;
  outputFormat?: string;
}

export interface TTSGenerateResult {
  audioBuffer: Buffer;
  contentType: string;
}

export interface TTSProvider {
  readonly name: TTSProviderName;
  generate(request: TTSGenerateRequest): Promise<TTSGenerateResult>; // eslint-disable-line no-unused-vars
}

export type TTSProviderName = 'elevenlabs' | 'openai' | 'gemini';

export interface TTSGenerateRequest {
  text: string;
  apiKey: string;
  voiceId: string | null;
  model: string | null;
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

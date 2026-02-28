import type { TTSProvider, TTSGenerateRequest, TTSGenerateResult } from '../types';

export const DEFAULT_VOICE_ID = 'alloy';
export const DEFAULT_MODEL = 'tts-1';

export const VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'] as const;

export class OpenAIProvider implements TTSProvider {
  readonly name = 'openai' as const;

  async generate(request: TTSGenerateRequest): Promise<TTSGenerateResult> {
    const voice = request.voiceId || DEFAULT_VOICE_ID;
    const model = request.model || DEFAULT_MODEL;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${request.apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: request.text,
          voice,
          response_format: 'mp3',
        }),
        signal: controller.signal,
      });
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Request timeout: TTS generation took too long');
      }
      throw error;
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI TTS API error ${response.status}: ${errorText}`);
    }

    return {
      audioBuffer: Buffer.from(await response.arrayBuffer()),
      contentType: 'audio/mpeg',
    };
  }
}

import type { TTSProvider, TTSGenerateRequest, TTSGenerateResult } from '../types';

export class ElevenLabsProvider implements TTSProvider {
  readonly name = 'elevenlabs' as const;

  async generate(request: TTSGenerateRequest): Promise<TTSGenerateResult> {
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${request.voiceId}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Accept: 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': request.apiKey,
        },
        body: JSON.stringify({
          text: request.text,
          model_id: request.model,
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
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
      throw new Error(`ElevenLabs API error ${response.status}: ${errorText}`);
    }

    return {
      audioBuffer: Buffer.from(await response.arrayBuffer()),
      contentType: 'audio/mpeg',
    };
  }
}

import { withRequestTimeout } from '../../llm/types';
import type { TTSProvider, TTSGenerateRequest, TTSGenerateResult } from '../types';

export class ElevenLabsProvider implements TTSProvider {
  readonly name = 'elevenlabs' as const;

  async generate(request: TTSGenerateRequest): Promise<TTSGenerateResult> {
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${request.voiceId}`, {
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
      signal: withRequestTimeout(),
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs API error ${response.status}`);
    }

    return {
      audioBuffer: Buffer.from(await response.arrayBuffer()),
      contentType: 'audio/mpeg',
    };
  }
}

import { withRequestTimeout } from '../../llm/types';
import type { TTSProvider, TTSGenerateRequest, TTSGenerateResult } from '../types';
import { MAX_TTS_AUDIO_BYTES } from '../types';
import { readBoundedBody } from '../transport';

export class ElevenLabsProvider implements TTSProvider {
  readonly name = 'elevenlabs' as const;

  async generate(request: TTSGenerateRequest): Promise<TTSGenerateResult> {
    const encodedVoiceId = encodeURIComponent(request.voiceId);
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodedVoiceId}`, {
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
      // An unconsumed error body holds the connection until the request deadline.
      await response.body?.cancel().catch(() => {});
      throw new Error(`ElevenLabs API error ${response.status}`);
    }

    return {
      audioBuffer: await readBoundedBody(response, MAX_TTS_AUDIO_BYTES),
      contentType: 'audio/mpeg',
    };
  }
}

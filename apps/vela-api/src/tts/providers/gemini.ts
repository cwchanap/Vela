import type { TTSProvider, TTSGenerateRequest, TTSGenerateResult } from '../types';

export const DEFAULT_VOICE_ID = 'Kore';
export const DEFAULT_MODEL = 'gemini-2.5-flash-preview-tts';

export const VOICES = [
  'Zephyr',
  'Puck',
  'Charon',
  'Kore',
  'Fenrir',
  'Leda',
  'Orus',
  'Aoede',
  'Callirrhoe',
  'Autonoe',
  'Enceladus',
  'Iocaste',
] as const;

export class GeminiProvider implements TTSProvider {
  readonly name = 'gemini' as const;

  async generate(request: TTSGenerateRequest): Promise<TTSGenerateResult> {
    const voiceName = request.voiceId || DEFAULT_VOICE_ID;
    const model = request.model || DEFAULT_MODEL;
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': request.apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: request.text }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName },
              },
            },
          },
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
      throw new Error(`Gemini TTS API error ${response.status}: ${errorText}`);
    }

    const data: any = await response.json();
    const inlineData = data?.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    const b64 = inlineData?.data as string | undefined;

    if (!b64) {
      throw new Error('Gemini TTS: no audio data in response');
    }

    const mimeType = inlineData?.mimeType as string | undefined;
    const contentType: 'audio/mpeg' | 'audio/wav' =
      mimeType?.startsWith('audio/wav') || mimeType?.startsWith('audio/L16')
        ? 'audio/wav'
        : 'audio/mpeg';

    return {
      audioBuffer: Buffer.from(b64, 'base64'),
      contentType,
    };
  }
}

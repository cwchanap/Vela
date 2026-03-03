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

const FORMAT_TO_CONTENT_TYPE: Record<string, string> = {
  MP3: 'audio/mpeg',
  MPEG: 'audio/mpeg',
  AUDIO_MPEG: 'audio/mpeg',
  OGG_OPUS: 'audio/ogg',
  OGG: 'audio/ogg',
  AUDIO_OGG: 'audio/ogg',
  AUDIO_OPUS: 'audio/ogg',
  WAV: 'audio/wav',
  AUDIO_WAV: 'audio/wav',
  WAV_L16: 'audio/wav',
  L16: 'audio/L16',
  AUDIO_L16: 'audio/L16',
  PCM: 'audio/pcm',
  AUDIO_PCM: 'audio/pcm',
  PCM_L16: 'audio/pcm',
  ALAW: 'audio/PCMA',
  AUDIO_PCMA: 'audio/PCMA',
  MULAW: 'audio/PCMU',
  MU_LAW: 'audio/PCMU',
  AUDIO_PCMU: 'audio/PCMU',
};

function normalizeFormat(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_');
}

function resolveContentType(
  requestedFormat?: string,
  responseFormat?: string,
  mimeType?: string,
): string {
  const candidates = [requestedFormat, responseFormat, mimeType]
    .filter((candidate): candidate is string => !!candidate)
    .map((candidate) => candidate.split(';')[0]?.trim() ?? candidate)
    .map(normalizeFormat);

  for (const candidate of candidates) {
    const mapped = FORMAT_TO_CONTENT_TYPE[candidate];
    if (mapped) {
      return mapped;
    }
  }

  return 'audio/mpeg';
}

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
    const responseFormat = inlineData?.outputFormat as string | undefined;
    const contentType = resolveContentType(request.outputFormat, responseFormat, mimeType);

    return {
      audioBuffer: Buffer.from(b64, 'base64'),
      contentType,
    };
  }
}

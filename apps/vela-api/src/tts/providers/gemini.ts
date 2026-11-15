import { withRequestTimeout } from '../../llm/types';
import type { TTSProvider, TTSGenerateRequest, TTSGenerateResult } from '../types';
import { MAX_TTS_AUDIO_BYTES } from '../types';
import { pcm16ToWav } from '../wav';

const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const PCM_MIME_TYPES = new Set(['audio/pcm', 'audio/l16']);

interface InteractionAudioPart {
  type?: unknown;
  data?: unknown;
  mime_type?: unknown;
}

/** Find the first audio content part without exposing the untyped vendor body. */
function findAudioPart(payload: unknown): InteractionAudioPart | null {
  const steps = (payload as { steps?: unknown } | null)?.steps;
  if (!Array.isArray(steps)) return null;

  for (const step of steps) {
    const content = (step as { content?: unknown } | null)?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content as InteractionAudioPart[]) {
      if (part?.type === 'audio' && typeof part.data === 'string' && part.data.length > 0) {
        return part;
      }
    }
  }
  return null;
}

function mimeEssence(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.split(';')[0]?.trim().toLowerCase() || null;
}

/**
 * The 3.8 unary endpoint returns complete 24 kHz mono RIFF/WAVE files (with a
 * trailing C2PA chunk), so valid WAV passes through untouched. Headerless raw
 * PCM has no magic bytes and is accepted only when the response also declares a
 * PCM/L16 MIME. Live unary responses always carried `audio/wav`; the
 * absent-MIME raw-PCM branch stays disabled until a real response confirms it.
 */
export class GeminiProvider implements TTSProvider {
  readonly name = 'gemini' as const;

  async generate(request: TTSGenerateRequest): Promise<TTSGenerateResult> {
    const response = await fetch(GEMINI_INTERACTIONS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': request.apiKey,
      },
      body: JSON.stringify({
        model: request.model,
        input: [{ type: 'user_input', content: [{ type: 'text', text: request.text }] }],
        response_format: { type: 'audio' },
        generation_config: { speech_config: [{ voice: request.voiceId }] },
      }),
      signal: withRequestTimeout(),
    });

    if (!response.ok) {
      throw new Error(`Gemini TTS API error ${response.status}`);
    }

    const payload: unknown = await response.json();
    const part = findAudioPart(payload);
    if (!part || typeof part.data !== 'string') {
      throw new Error('Gemini TTS: no audio data in response');
    }

    const audio = Buffer.from(part.data, 'base64');
    if (audio.length === 0) {
      throw new Error('Gemini TTS: empty audio data in response');
    }
    if (audio.length > MAX_TTS_AUDIO_BYTES) {
      throw new Error('Gemini TTS: audio response too large');
    }

    if (audio.subarray(0, 4).toString('ascii') === 'RIFF') {
      if (audio.length <= 44 || audio.subarray(8, 12).toString('ascii') !== 'WAVE') {
        throw new Error('Gemini TTS: malformed WAV response');
      }
      return { audioBuffer: audio, contentType: 'audio/wav' };
    }

    if (audio.length % 2 !== 0) {
      throw new Error('Gemini TTS: invalid PCM16LE audio data');
    }

    const mimeType = mimeEssence(part.mime_type);
    if (!mimeType) {
      throw new Error('Gemini TTS: missing MIME type for non-WAV audio');
    }
    if (!PCM_MIME_TYPES.has(mimeType)) {
      throw new Error('Gemini TTS: unsupported audio format');
    }

    return { audioBuffer: pcm16ToWav(audio, 24_000), contentType: 'audio/wav' };
  }
}

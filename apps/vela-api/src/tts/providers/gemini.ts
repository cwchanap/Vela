import { withRequestTimeout } from '../../llm/types';
import type { TTSProvider, TTSGenerateRequest, TTSGenerateResult } from '../types';
import { MAX_TTS_AUDIO_BASE64_CHARS, MAX_TTS_AUDIO_BYTES } from '../types';
import { isValidBase64, readBoundedBody } from '../transport';
import { pcm16ToWav } from '../wav';

const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const PCM_MIME_TYPES = new Set(['audio/pcm', 'audio/l16']);
/** Base64 audio plus the small interaction envelope (id, status, usage, MIME). */
const MAX_GEMINI_RESPONSE_BYTES = MAX_TTS_AUDIO_BASE64_CHARS + 64 * 1024;

interface InteractionAudioPart {
  type?: unknown;
  data?: unknown;
  mime_type?: unknown;
}

/**
 * Locate exactly one completed model-output audio part. Runtime payloads are
 * untrusted: non-completed interactions and multiple audio results must fail
 * before any candidate is uploaded.
 */
function findSingleAudioPart(payload: unknown): InteractionAudioPart {
  const root = payload as { status?: unknown; steps?: unknown } | null;
  if (root?.status !== 'completed') {
    throw new Error('Gemini TTS: interaction did not complete');
  }
  if (!Array.isArray(root.steps)) {
    throw new Error('Gemini TTS: no audio data in response');
  }

  const audioParts: InteractionAudioPart[] = [];
  for (const step of root.steps) {
    const candidate = step as { type?: unknown; content?: unknown } | null;
    if (!candidate || candidate.type !== 'model_output' || !Array.isArray(candidate.content)) {
      continue;
    }
    for (const part of candidate.content as InteractionAudioPart[]) {
      if (part?.type === 'audio' && typeof part.data === 'string' && part.data.length > 0) {
        audioParts.push(part);
      }
    }
  }

  if (audioParts.length === 0) {
    throw new Error('Gemini TTS: no audio data in response');
  }
  if (audioParts.length > 1) {
    throw new Error('Gemini TTS: ambiguous audio response');
  }
  return audioParts[0]!;
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

    const body = await readBoundedBody(response, MAX_GEMINI_RESPONSE_BYTES);
    let payload: unknown;
    try {
      payload = JSON.parse(body.toString('utf8'));
    } catch {
      throw new Error('Gemini TTS: invalid JSON response');
    }

    const part = findSingleAudioPart(payload);
    const encoded = part.data as string;
    if (encoded.length > MAX_TTS_AUDIO_BASE64_CHARS) {
      throw new Error('Gemini TTS: audio response too large');
    }
    if (!isValidBase64(encoded)) {
      throw new Error('Gemini TTS: invalid base64 audio data');
    }

    const audio = Buffer.from(encoded, 'base64');
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

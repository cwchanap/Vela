import { withRequestTimeout } from '../../llm/types';
import type { TTSProvider, TTSGenerateRequest, TTSGenerateResult } from '../types';
import { MAX_TTS_AUDIO_BASE64_CHARS, MAX_TTS_AUDIO_BYTES } from '../types';
import { isValidBase64, readBoundedBody } from '../transport';
import { isValidWav, pcm16ToWav } from '../wav';

const GEMINI_INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const PCM_MIME_TYPES = new Set(['audio/pcm', 'audio/l16']);
const DEFAULT_PCM_SAMPLE_RATE = 24_000;
const MAX_PCM_SAMPLE_RATE = 384_000;
/** Base64 audio plus the small interaction envelope (id, status, usage, MIME). */
const MAX_GEMINI_RESPONSE_BYTES = MAX_TTS_AUDIO_BASE64_CHARS + 64 * 1024;

interface InteractionAudioPart {
  type?: unknown;
  data?: unknown;
  mime_type?: unknown;
}

/**
 * Locate exactly one completed model-output audio part. Runtime payloads are
 * untrusted: every model-output audio part is counted before inspecting its
 * data, so a valid part plus an empty/malformed sibling still counts as an
 * ambiguous multi-part response rather than being silently discarded.
 */
function findSingleAudioPart(payload: unknown): InteractionAudioPart & { data: string } {
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
      if (part?.type === 'audio') {
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

  const part = audioParts[0]!;
  if (typeof part.data !== 'string' || part.data.length === 0) {
    throw new Error('Gemini TTS: invalid audio data');
  }
  return part as InteractionAudioPart & { data: string };
}

function parsePcmMime(value: unknown): { mimeType: string; sampleRate: number } {
  if (typeof value !== 'string') {
    throw new Error('Gemini TTS: missing MIME type for non-WAV audio');
  }
  const [rawEssence, ...rawParams] = value.split(';');
  const mimeType = rawEssence?.trim().toLowerCase() || '';
  if (!mimeType) {
    throw new Error('Gemini TTS: missing MIME type for non-WAV audio');
  }
  if (!PCM_MIME_TYPES.has(mimeType)) {
    throw new Error('Gemini TTS: unsupported audio format');
  }

  let sampleRate = DEFAULT_PCM_SAMPLE_RATE;
  for (const rawParam of rawParams) {
    const param = rawParam.trim();
    if (!param) continue;
    const eqIndex = param.indexOf('=');
    const key = (eqIndex === -1 ? param : param.slice(0, eqIndex)).trim().toLowerCase();
    if (key !== 'rate') continue;
    const rawRate =
      eqIndex === -1
        ? ''
        : param
            .slice(eqIndex + 1)
            .trim()
            .replace(/^"(.*)"$/, '$1');
    if (!/^\d+$/.test(rawRate)) {
      throw new Error('Gemini TTS: invalid audio sample rate');
    }
    const parsedRate = Number(rawRate);
    if (!Number.isSafeInteger(parsedRate) || parsedRate <= 0 || parsedRate > MAX_PCM_SAMPLE_RATE) {
      throw new Error('Gemini TTS: invalid audio sample rate');
    }
    sampleRate = parsedRate;
  }

  return { mimeType, sampleRate };
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
      // An unconsumed error body holds the connection until the request deadline.
      await response.body?.cancel().catch(() => {});
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
    const encoded = part.data;
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
      if (!isValidWav(audio)) {
        throw new Error('Gemini TTS: malformed WAV response');
      }
      return { audioBuffer: audio, contentType: 'audio/wav' };
    }

    if (audio.length % 2 !== 0) {
      throw new Error('Gemini TTS: invalid PCM16LE audio data');
    }

    const { mimeType, sampleRate } = parsePcmMime(part.mime_type);
    // RFC 2586 audio/L16 is big-endian; the WAV container declares PCM16LE.
    if (mimeType === 'audio/l16') audio.swap16();

    return { audioBuffer: pcm16ToWav(audio, sampleRate), contentType: 'audio/wav' };
  }
}

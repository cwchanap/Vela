export type TtsProvider = 'elevenlabs' | 'openai' | 'gemini';

export type TtsSettings = {
  provider: TtsProvider;
  voiceId: string | null;
  model: string | null;
  hasApiKey: boolean;
};

export type GeneratePronunciationRequest = {
  vocabularyId: string;
  text: string;
};

export type GeneratePronunciationResponse = {
  audioUrl: string;
  cached: boolean;
};

export type TtsApiErrorCode =
  | 'tts_not_configured'
  | 'tts_invalid_provider_configuration'
  | 'tts_audio_service_unavailable'
  | 'tts_generation_timeout'
  | 'tts_generation_failed'
  | 'tts_audio_storage_failed'
  | 'tts_audio_access_failed';

export type TtsApiErrorResponse = {
  error: string;
  code?: TtsApiErrorCode;
};

const TTS_PROVIDERS = new Set<TtsProvider>(['elevenlabs', 'openai', 'gemini']);
const TTS_API_ERROR_CODES = new Set<TtsApiErrorCode>([
  'tts_not_configured',
  'tts_invalid_provider_configuration',
  'tts_audio_service_unavailable',
  'tts_generation_timeout',
  'tts_generation_failed',
  'tts_audio_storage_failed',
  'tts_audio_access_failed',
]);

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`invalid_tts_${field}`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new TypeError(`invalid_tts_${field}`);
  }
  return value;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError(`invalid_tts_${field}`);
  }
  return value;
}

function requireNullableString(value: unknown, field: string): string | null {
  if (value !== null && typeof value !== 'string') {
    throw new TypeError(`invalid_tts_${field}`);
  }
  return value;
}

export function parseTtsSettings(value: unknown): TtsSettings {
  const root = requireRecord(value, 'settings:root');
  const provider = requireString(root.provider, 'settings:provider');
  if (!TTS_PROVIDERS.has(provider as TtsProvider)) {
    throw new TypeError('invalid_tts_settings:provider');
  }

  return {
    provider: provider as TtsProvider,
    voiceId: requireNullableString(root.voiceId, 'settings:voiceId'),
    model: requireNullableString(root.model, 'settings:model'),
    hasApiKey: requireBoolean(root.hasApiKey, 'settings:hasApiKey'),
  };
}

export function parseGeneratePronunciationRequest(value: unknown): GeneratePronunciationRequest {
  const root = requireRecord(value, 'generate_request:root');
  const vocabularyId = requireString(root.vocabularyId, 'generate_request:vocabularyId').trim();
  const text = requireString(root.text, 'generate_request:text').trim();

  if (!vocabularyId) {
    throw new TypeError('invalid_tts_generate_request:vocabularyId');
  }
  if (!text) {
    throw new TypeError('invalid_tts_generate_request:text');
  }

  return { vocabularyId, text };
}

export function parseGeneratePronunciationResponse(value: unknown): GeneratePronunciationResponse {
  const root = requireRecord(value, 'generate_response:root');
  const audioUrl = requireString(root.audioUrl, 'generate_response:audioUrl');
  const parsed = new URL(audioUrl);
  if (parsed.protocol !== 'https:') throw new TypeError('invalid_tts_generate_response:audioUrl');
  return { audioUrl, cached: requireBoolean(root.cached, 'generate_response:cached') };
}

export function parseTtsApiErrorResponse(value: unknown): TtsApiErrorResponse {
  const root = requireRecord(value, 'api_error');
  const error = requireString(root.error, 'api_error:error');
  const code = root.code;

  if (code === undefined) {
    return { error };
  }
  if (typeof code !== 'string' || !TTS_API_ERROR_CODES.has(code as TtsApiErrorCode)) {
    throw new TypeError('invalid_tts_api_error:code');
  }
  return { error, code: code as TtsApiErrorCode };
}

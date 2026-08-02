const TTS_PROVIDERS = ['elevenlabs', 'openai', 'gemini'] as const;
export type TtsProvider = (typeof TTS_PROVIDERS)[number];

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

/**
 * The provider/voice/model the backend actually used to produce (or look up)
 * the audio for a generate request. The backend re-reads TTS settings during
 * `POST /tts/generate`, so these can differ from the settings a client read
 * via `GET /tts/settings` if settings changed between the two requests.
 * Clients use this to avoid caching audio under a stale settings identity.
 */
export type TtsEffectiveSettings = {
  provider: TtsProvider;
  voiceId: string | null;
  model: string | null;
};

export type GeneratePronunciationResponse = {
  audioUrl: string;
  cached: boolean;
  effectiveSettings?: TtsEffectiveSettings;
};

export type TtsAudioUrlResponse = {
  audioUrl: string;
  /**
   * The provider/voice/model the backend used to derive the S3 cache key for
   * the looked-up audio. The backend re-reads TTS settings during
   * `GET /tts/audio/:vocabularyId`, so these can differ from the settings a
   * client read via `GET /tts/settings` if settings changed between the two
   * requests. Clients use this to avoid caching audio under a stale settings
   * identity. Optional for backward compatibility with older deployments.
   */
  effectiveSettings?: TtsEffectiveSettings;
};

const TTS_API_ERROR_CODES = [
  'tts_not_configured',
  'tts_invalid_provider_configuration',
  'tts_audio_service_unavailable',
  'tts_generation_timeout',
  'tts_generation_failed',
  'tts_audio_storage_failed',
  'tts_audio_access_failed',
  'tts_audio_bucket_not_configured',
  'tts_unexpected_error',
] as const;
export type TtsApiErrorCode = (typeof TTS_API_ERROR_CODES)[number];

export type TtsApiErrorResponse = {
  error: string;
  code?: TtsApiErrorCode;
};

const TTS_PROVIDER_VALUES: ReadonlySet<string> = new Set(TTS_PROVIDERS);
const TTS_API_ERROR_CODE_VALUES: ReadonlySet<string> = new Set(TTS_API_ERROR_CODES);

function isTtsProvider(value: string): value is TtsProvider {
  return TTS_PROVIDER_VALUES.has(value);
}

function isTtsApiErrorCode(value: string): value is TtsApiErrorCode {
  return TTS_API_ERROR_CODE_VALUES.has(value);
}

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

function requireHttpsAudioUrl(value: unknown, field: string): string {
  const audioUrl = requireString(value, field);
  let parsed: URL;
  try {
    parsed = new URL(audioUrl);
  } catch {
    throw new TypeError(`invalid_tts_${field}`);
  }
  if (parsed.protocol !== 'https:') throw new TypeError(`invalid_tts_${field}`);
  return audioUrl;
}

export function parseTtsSettings(value: unknown): TtsSettings {
  const root = requireRecord(value, 'settings:root');
  const provider = requireString(root.provider, 'settings:provider');
  if (!isTtsProvider(provider)) {
    throw new TypeError('invalid_tts_settings:provider');
  }

  return {
    provider,
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

/**
 * Parse the optional `effectiveSettings` object shared by the generate and
 * audio URL responses. `fieldPrefix` scopes the TypeError field path so each
 * response type reports its own origin (e.g. `generate_response:...` vs
 * `audio_response:...`).
 */
function parseEffectiveSettings(
  value: unknown,
  fieldPrefix: string,
): TtsEffectiveSettings | undefined {
  if (value === undefined) return undefined;
  const settingsRecord = requireRecord(value, `${fieldPrefix}:effectiveSettings`);
  const provider = requireString(
    settingsRecord.provider,
    `${fieldPrefix}:effectiveSettings:provider`,
  );
  if (!isTtsProvider(provider)) {
    throw new TypeError(`invalid_tts_${fieldPrefix}:effectiveSettings:provider`);
  }
  return {
    provider,
    voiceId: requireNullableString(
      settingsRecord.voiceId,
      `${fieldPrefix}:effectiveSettings:voiceId`,
    ),
    model: requireNullableString(settingsRecord.model, `${fieldPrefix}:effectiveSettings:model`),
  };
}

export function parseGeneratePronunciationResponse(value: unknown): GeneratePronunciationResponse {
  const root = requireRecord(value, 'generate_response:root');
  const audioUrl = requireHttpsAudioUrl(root.audioUrl, 'generate_response:audioUrl');
  const response: GeneratePronunciationResponse = {
    audioUrl,
    cached: requireBoolean(root.cached, 'generate_response:cached'),
  };

  const effectiveSettings = parseEffectiveSettings(root.effectiveSettings, 'generate_response');
  if (effectiveSettings) response.effectiveSettings = effectiveSettings;

  return response;
}

export function parseTtsAudioUrlResponse(value: unknown): TtsAudioUrlResponse {
  const root = requireRecord(value, 'audio_response:root');
  const audioUrl = requireHttpsAudioUrl(root.audioUrl, 'audio_response:audioUrl');
  const response: TtsAudioUrlResponse = { audioUrl };

  const effectiveSettings = parseEffectiveSettings(root.effectiveSettings, 'audio_response');
  if (effectiveSettings) response.effectiveSettings = effectiveSettings;

  return response;
}

export function parseTtsApiErrorResponse(value: unknown): TtsApiErrorResponse {
  const root = requireRecord(value, 'api_error');
  const error = requireString(root.error, 'api_error:error');
  const code = root.code;

  if (code === undefined) {
    return { error };
  }
  if (typeof code !== 'string' || !isTtsApiErrorCode(code)) {
    throw new TypeError('invalid_tts_api_error:code');
  }
  return { error, code };
}

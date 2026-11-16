/** Closed list of supported providers; the single source for provider unions. */
export const TTS_PROVIDERS = ['elevenlabs', 'openai', 'gemini'] as const;
export type TtsProvider = (typeof TTS_PROVIDERS)[number];

export interface TtsModelInfo {
  /** Model ID exactly as the provider API expects it. */
  id: string;
  /** Single display label for pickers. */
  label: string;
}

export interface TtsProviderInfo {
  /** Single display label for the provider — UI selects, API error messages. */
  label: string;
  /** Label for the provider's API key input. */
  apiKeyLabel: string;
  /** Hint for the provider's API key input when no key is saved for it. */
  apiKeyHint: string;
  /** Model used when a stored value is null, legacy or unsupported. */
  defaultModel: string;
  /** Models a new save may select. */
  models: readonly TtsModelInfo[];
  /** Voice used when a stored value is null, legacy or unsupported. */
  defaultVoice: string;
  /** Fixed voice IDs, or null for free-form providers (ElevenLabs). */
  voices: readonly string[] | null;
}

/** The provider/voice/model a request actually uses; never null after resolution. */
export type TtsSelection = {
  provider: TtsProvider;
  voiceId: string;
  model: string;
};

// Defaults and voice lists verified against provider docs on 2026-11-15:
// ElevenLabs https://elevenlabs.io/docs/overview/models,
// OpenAI Realtime https://developers.openai.com/api/docs/guides/voice-websockets,
// Gemini https://ai.google.dev/gemini-api/docs/speech-generation.
export const TTS_PROVIDER_REGISTRY: Readonly<Record<TtsProvider, TtsProviderInfo>> = {
  elevenlabs: {
    label: 'ElevenLabs',
    apiKeyLabel: 'ElevenLabs API Key',
    apiKeyHint: 'Your ElevenLabs API key',
    defaultModel: 'eleven_v4',
    models: [
      { id: 'eleven_v4', label: 'Eleven v4' },
      { id: 'eleven_multilingual_v2', label: 'Eleven Multilingual v2' },
    ],
    defaultVoice: 'ErXwobaYiN019PkySvjV',
    voices: null,
  },
  openai: {
    label: 'OpenAI',
    apiKeyLabel: 'OpenAI API Key',
    apiKeyHint: 'Your OpenAI API key (sk-...)',
    defaultModel: 'gpt-realtime-2.1-mini',
    models: [{ id: 'gpt-realtime-2.1-mini', label: 'GPT Realtime 2.1 Mini' }],
    defaultVoice: 'alloy',
    voices: [
      'alloy',
      'ash',
      'ballad',
      'coral',
      'echo',
      'sage',
      'shimmer',
      'verse',
      'marin',
      'cedar',
    ],
  },
  gemini: {
    label: 'Google Gemini',
    apiKeyLabel: 'Google AI API Key',
    apiKeyHint: 'Your Google AI Studio API key',
    defaultModel: 'gemini-3.8-flash-tts',
    models: [
      { id: 'gemini-3.8-flash-tts', label: 'Gemini 3.8 Flash TTS' },
      { id: 'gemini-3.8-flash-lite-tts', label: 'Gemini 3.8 Flash-Lite TTS' },
    ],
    defaultVoice: 'Kore',
    // Official 30 prebuilt voices; Iocaste is not in the current list.
    voices: [
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
      'Iapetus',
      'Umbriel',
      'Algieba',
      'Despina',
      'Erinome',
      'Algenib',
      'Rasalgethi',
      'Laomedeia',
      'Achernar',
      'Alnilam',
      'Schedar',
      'Gacrux',
      'Pulcherrima',
      'Achird',
      'Zubenelgenubi',
      'Vindemiatrix',
      'Sadachbia',
      'Sadaltager',
      'Sulafat',
    ],
  },
};

/**
 * Resolve stored (possibly null, legacy, unsupported or wrong-type) settings to
 * the values a request must actually use. DynamoDB returns raw Items, so the
 * model/voice boundary is `unknown`: only strings are candidates, and anything
 * else is treated as absent. New saves are validated at the route; this helper
 * only normalizes what is already persisted.
 */
export function resolveTtsSelection(
  provider: TtsProvider,
  model: unknown,
  voiceId: unknown,
): TtsSelection {
  const info = TTS_PROVIDER_REGISTRY[provider];
  const storedModel = typeof model === 'string' ? model.trim() : '';
  const storedVoice = typeof voiceId === 'string' ? voiceId.trim() : '';

  return {
    provider,
    model: info.models.some(({ id }) => id === storedModel) ? storedModel : info.defaultModel,
    voiceId:
      storedVoice && (info.voices === null || info.voices.includes(storedVoice))
        ? storedVoice
        : info.defaultVoice,
  };
}

export type TtsSettings = TtsSelection & {
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
export type TtsEffectiveSettings = TtsSelection;

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

/**
 * Compare the GET /tts/settings snapshot (used to derive the client cache key)
 * against the effective settings the backend reports it actually used for the
 * generation or audio lookup. The backend re-reads settings during
 * `POST /tts/generate` and `GET /tts/audio/:vocabularyId`, so a concurrent
 * settings change can make these differ. When they differ, the audio was
 * produced under new settings but the client key was derived from the old
 * snapshot, so the entry must not be cached under that stale key.
 *
 * When the backend omits `effectiveSettings` (older deployment), this returns
 * false to avoid caching under a settings identity the backend did not
 * confirm. Playback still succeeds; only the memory cache is skipped.
 */
export function effectiveSettingsMatch(
  snapshot: TtsSettings,
  effective: TtsEffectiveSettings | undefined,
): boolean {
  if (!effective) return false;
  return (
    effective.provider === snapshot.provider &&
    effective.voiceId === snapshot.voiceId &&
    effective.model === snapshot.model
  );
}

const TTS_API_ERROR_CODES = [
  'tts_not_configured',
  'tts_invalid_provider_configuration',
  'tts_settings_conflict',
  'tts_audio_service_unavailable',
  'tts_generation_timeout',
  'tts_generation_failed',
  'tts_audio_storage_failed',
  'tts_audio_access_failed',
  'tts_audio_bucket_not_configured',
  'tts_audio_not_found',
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
    voiceId: requireString(root.voiceId, 'settings:voiceId'),
    model: requireString(root.model, 'settings:model'),
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
    voiceId: requireString(settingsRecord.voiceId, `${fieldPrefix}:effectiveSettings:voiceId`),
    model: requireString(settingsRecord.model, `${fieldPrefix}:effectiveSettings:model`),
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

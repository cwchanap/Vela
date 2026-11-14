/**
 * @vela/common - Shared TanStack Query configuration, utilities, and domain contracts
 *
 * This package provides shared query configuration, cache timing constants,
 * and query key factories for use across Vela apps (web app and extension).
 *
 * The tokenizer is exported via a separate sub-path (`@vela/common/tokenizer`)
 * to avoid pulling kuromoji into bundles that only need query helpers.
 */

// Export query client configuration
export { createQueryClient, QUERY_STALE_TIME, QUERY_GC_TIME } from './config';

// Export query key factories
export {
  authKeys,
  chatKeys,
  dictionaryKeys,
  gameKeys,
  progressKeys,
  savedSentencesKeys,
  srsKeys,
  ttsKeys,
} from './keys';

// Export shared constants
export { DEFAULT_DAILY_LESSON_GOAL, DEFAULT_LESSON_DURATION_MINUTES } from './constants';

// Export shared domain contracts
export { parseSrsStats, type SRSStats } from './contracts/srs';

// Export shared LLM provider contract
export {
  LLM_EFFORT_LEVELS,
  LLM_PROVIDER_REGISTRY,
  LLM_PROVIDERS,
  MAX_LLM_THINKING_OVERRIDES,
  type LlmEffort,
  type LlmEvent,
  type LlmMessage,
  type LlmModelInfo,
  type LlmModelPair,
  type LlmPreferences,
  type LlmProvider,
  type LlmProviderInfo,
  type LlmResponse,
  type LlmUsage,
} from './contracts/llm';

// Export shared TTS contracts
export {
  effectiveSettingsMatch,
  parseGeneratePronunciationRequest,
  parseGeneratePronunciationResponse,
  parseTtsApiErrorResponse,
  parseTtsAudioUrlResponse,
  parseTtsSettings,
  type GeneratePronunciationRequest,
  type GeneratePronunciationResponse,
  type TtsApiErrorCode,
  type TtsApiErrorResponse,
  type TtsAudioUrlResponse,
  type TtsEffectiveSettings,
  type TtsProvider,
  type TtsSettings,
} from './contracts/tts';

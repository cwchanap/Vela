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

// Export shared TTS contracts
export {
  parseGeneratePronunciationRequest,
  parseGeneratePronunciationResponse,
  parseTtsApiErrorResponse,
  parseTtsSettings,
  type GeneratePronunciationRequest,
  type GeneratePronunciationResponse,
  type TtsApiErrorCode,
  type TtsApiErrorResponse,
  type TtsProvider,
  type TtsSettings,
} from './contracts/tts';

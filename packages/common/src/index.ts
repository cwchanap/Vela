/**
 * @vela/query - Shared TanStack Query configuration and utilities
 *
 * This package provides shared query configuration, cache timing constants,
 * and query key factories for use across Vela apps (web app and extension).
 */

// Export query client configuration
export { createQueryClient, QUERY_STALE_TIME, QUERY_GC_TIME } from './config';

// Export query key factories
export { authKeys, gameKeys, progressKeys, savedSentencesKeys } from './keys';

// Export shared constants
export { DEFAULT_DAILY_LESSON_GOAL, DEFAULT_LESSON_DURATION_MINUTES } from './constants';

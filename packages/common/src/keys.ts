/**
 * Query key factories for consistent cache management
 * These factories create hierarchical query keys for easy invalidation
 */

/**
 * Auth-related query keys
 */
export const authKeys = {
  all: ['auth'] as const,
  session: () => [...authKeys.all, 'session'] as const,
  user: () => [...authKeys.all, 'user'] as const,
  profile: (userId: string | null) => [...authKeys.all, 'profile', userId] as const,
};

/**
 * Game-related query keys
 */
export const gameKeys = {
  all: ['games'] as const,
  vocabulary: (count: number) => [...gameKeys.all, 'vocabulary', count] as const,
  sentences: (count: number) => [...gameKeys.all, 'sentences', count] as const,
};

/**
 * Progress-related query keys
 */
export const progressKeys = {
  all: ['progress'] as const,
  analytics: (userId: string | null) => [...progressKeys.all, 'analytics', userId] as const,
  session: (sessionId: string) => [...progressKeys.all, 'session', sessionId] as const,
};

/**
 * Saved sentences query keys
 */
export const savedSentencesKeys = {
  all: ['saved-sentences'] as const,
  list: (limit?: number) => [...savedSentencesKeys.all, 'list', limit] as const,
  detail: (id: string) => [...savedSentencesKeys.all, 'detail', id] as const,
};

/**
 * SRS (Spaced Repetition System) query keys
 */
export const srsKeys = {
  all: ['srs'] as const,
  due: (limit?: number, jlpt?: number[]) => [...srsKeys.all, 'due', limit, jlpt] as const,
  stats: (jlpt?: number[]) => [...srsKeys.all, 'stats', jlpt] as const,
  progress: (vocabularyId: string) => [...srsKeys.all, 'progress', vocabularyId] as const,
  allProgress: () => [...srsKeys.all, 'all'] as const,
};

/**
 * TTS (Text-to-Speech) query keys
 */
export const ttsKeys = {
  all: ['tts'] as const,
  settings: () => [...ttsKeys.all, 'settings'] as const,
};

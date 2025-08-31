// Application constants

// Game configuration
export const GAME_CONFIG = {
  VOCABULARY: {
    POINTS_PER_CORRECT: 10,
    TIME_BONUS_MULTIPLIER: 1.5,
    MAX_TIME_BONUS: 50,
  },
  SENTENCE: {
    POINTS_PER_CORRECT: 15,
    HINT_PENALTY: 2,
    TIME_BONUS_MULTIPLIER: 2,
  },
  GENERAL: {
    SESSION_TIMEOUT: 30 * 60 * 1000, // 30 minutes
    AUTO_SAVE_INTERVAL: 10 * 1000, // 10 seconds
  },
} as const;

// Learning levels
export const LEARNING_LEVELS = {
  BEGINNER: 1,
  ELEMENTARY: 2,
  INTERMEDIATE: 3,
  ADVANCED: 4,
  EXPERT: 5,
} as const;

// Mastery levels for spaced repetition
export const MASTERY_LEVELS = {
  NEW: 0,
  LEARNING: 1,
  FAMILIAR: 2,
  KNOWN: 3,
  MASTERED: 4,
  EXPERT: 5,
} as const;

// Experience points configuration
export const EXPERIENCE_CONFIG = {
  VOCABULARY_CORRECT: 10,
  SENTENCE_CORRECT: 15,
  DAILY_LOGIN: 5,
  STREAK_BONUS: 20,
  LEVEL_UP_BONUS: 100,
} as const;

// UI constants
export const UI_CONFIG = {
  MOBILE_BREAKPOINT: 768,
  TABLET_BREAKPOINT: 1024,
  DESKTOP_BREAKPOINT: 1200,
  ANIMATION_DURATION: 300,
  TOAST_DURATION: 3000,
} as const;

// Storage keys
export const STORAGE_KEYS = {
  USER_PREFERENCES: 'user_preferences',
  GAME_STATE: 'game_state',
  OFFLINE_DATA: 'offline_data',
  LAST_SYNC: 'last_sync',
} as const;

// API endpoints (relative to base URL)
export const API_ENDPOINTS = {
  AUTH: {
    LOGIN: '/auth/login',
    LOGOUT: '/auth/logout',
    REFRESH: '/auth/refresh',
  },
  VOCABULARY: {
    LIST: '/vocabulary',
    RANDOM: '/vocabulary/random',
    SEARCH: '/vocabulary/search',
  },
  PROGRESS: {
    USER: '/progress/user',
    UPDATE: '/progress/update',
    STATS: '/progress/stats',
  },
  CHAT: {
    SEND: '/chat/send',
    HISTORY: '/chat/history',
  },
} as const;

// Shared types used across the application
// Canonical defaults for optional UserPreferences fields
export { DEFAULT_DAILY_LESSON_GOAL, DEFAULT_LESSON_DURATION_MINUTES } from '@vela/common';

export interface UserPreferences {
  dailyGoal: number;
  /**
   * Optional daily lesson count goal.
   * When undefined, use DEFAULT_DAILY_LESSON_GOAL.
   */
  dailyLessonGoal?: number;
  /**
   * Optional preferred lesson duration in minutes.
   * When undefined, use DEFAULT_LESSON_DURATION_MINUTES.
   */
  lessonDurationMinutes?: number;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  notifications: boolean;
  todayStudyTime?: number;
  // Theme preferences
  darkMode?: boolean;
  // Per-user LLM preferences
  llm_provider?: 'google' | 'openrouter' | 'chutes';
  llm_models?: Partial<Record<'google' | 'openrouter' | 'chutes', string>>;
  // Optional per-provider API keys saved by the user
  llm_keys?: Partial<Record<'google' | 'openrouter' | 'chutes', string>>;
}

export interface ChatContext {
  [key: string]: unknown;
}

export interface Profile {
  id: string;
  username: string | null;
  email: string | null;
  avatar_url: string | null;
  native_language: string;
  current_level: number;
  total_experience: number;
  learning_streak: number;
  last_activity: string | null;
  preferences: UserPreferences;
  created_at: string;
  updated_at: string;
}

export interface ProfileInsert {
  id: string;
  username?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  native_language?: string;
  current_level?: number;
  total_experience?: number;
  learning_streak?: number;
  last_activity?: string | null;
  preferences?: UserPreferences;
  created_at?: string;
  updated_at?: string;
}

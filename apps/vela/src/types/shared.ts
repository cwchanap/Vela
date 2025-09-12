// Shared types used across the application
export interface UserPreferences {
  dailyGoal: number;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  notifications: boolean;
  todayStudyTime?: number;
  // Per-user LLM preferences
  llm_provider?: 'google' | 'openrouter';
  llm_models?: Partial<Record<'google' | 'openrouter', string>>;
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

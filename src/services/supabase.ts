import { createClient } from '@supabase/supabase-js';

// Environment variables with fallbacks for local development
const supabaseUrl = (() => {
  try {
    // Browser environment
    if (typeof window !== 'undefined' && import.meta.env) {
      return import.meta.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
    }
    // Node.js environment
    if (typeof process !== 'undefined' && process.env) {
      return process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
    }
    return 'http://127.0.0.1:54321';
  } catch {
    return 'http://127.0.0.1:54321';
  }
})();

const supabaseAnonKey = (() => {
  try {
    // Browser environment
    if (typeof window !== 'undefined' && import.meta.env) {
      return (
        import.meta.env.VITE_SUPABASE_ANON_KEY ||
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
      );
    }
    // Node.js environment
    if (typeof process !== 'undefined' && process.env) {
      return (
        process.env.VITE_SUPABASE_ANON_KEY ||
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
      );
    }
    return 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
  } catch {
    return 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
  }
})();

// Validate environment variables
if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('⚠️ Missing Supabase environment variables. Using local development defaults.');
}

// Database types for TypeScript support
export interface UserPreferences {
  dailyGoal: number;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  notifications: boolean;
  todayStudyTime?: number;
}

export interface ChatContext {
  [key: string]: unknown;
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
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
        };
        Insert: {
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
        };
        Update: {
          id?: string;
          username?: string | null;
          email?: string | null;
          avatar_url?: string | null;
          native_language?: string;
          current_level?: number;
          total_experience?: number;
          learning_streak?: number;
          last_activity?: string | null;
          preferences?: Partial<UserPreferences>;
          created_at?: string;
          updated_at?: string;
        };
      };
      vocabulary: {
        Row: {
          id: string;
          japanese_word: string;
          hiragana: string | null;
          katakana: string | null;
          romaji: string | null;
          english_translation: string;
          difficulty_level: number;
          category: string | null;
          example_sentence_jp: string | null;
          example_sentence_en: string | null;
          audio_url: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          japanese_word: string;
          hiragana?: string | null;
          katakana?: string | null;
          romaji?: string | null;
          english_translation: string;
          difficulty_level?: number;
          category?: string | null;
          example_sentence_jp?: string | null;
          example_sentence_en?: string | null;
          audio_url?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          japanese_word?: string;
          hiragana?: string | null;
          katakana?: string | null;
          romaji?: string | null;
          english_translation?: string;
          difficulty_level?: number;
          category?: string | null;
          example_sentence_jp?: string | null;
          example_sentence_en?: string | null;
          audio_url?: string | null;
          created_at?: string;
        };
      };
      user_progress: {
        Row: {
          id: string;
          user_id: string;
          vocabulary_id: string;
          mastery_level: number;
          correct_attempts: number;
          total_attempts: number;
          last_reviewed: string | null;
          next_review: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          vocabulary_id: string;
          mastery_level?: number;
          correct_attempts?: number;
          total_attempts?: number;
          last_reviewed?: string | null;
          next_review?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          vocabulary_id?: string;
          mastery_level?: number;
          correct_attempts?: number;
          total_attempts?: number;
          last_reviewed?: string | null;
          next_review?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      game_sessions: {
        Row: {
          id: string;
          user_id: string;
          game_type: string;
          score: number;
          duration_seconds: number | null;
          questions_answered: number;
          correct_answers: number;
          experience_gained: number;
          completed_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          game_type: string;
          score?: number;
          duration_seconds?: number | null;
          questions_answered?: number;
          correct_answers?: number;
          experience_gained?: number;
          completed_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          game_type?: string;
          score?: number;
          duration_seconds?: number | null;
          questions_answered?: number;
          correct_answers?: number;
          experience_gained?: number;
          completed_at?: string;
        };
      };
      chat_history: {
        Row: {
          id: string;
          user_id: string;
          message_type: string;
          content: string;
          context: ChatContext;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          message_type: string;
          content: string;
          context?: ChatContext;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          message_type?: string;
          content?: string;
          context?: ChatContext;
          created_at?: string;
        };
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
  };
}

// Create Supabase client with TypeScript support
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

// Export types for use in other files
export type Profile = Database['public']['Tables']['profiles']['Row'];
export type ProfileInsert = Database['public']['Tables']['profiles']['Insert'];
export type ProfileUpdate = Database['public']['Tables']['profiles']['Update'];

export type Vocabulary = Database['public']['Tables']['vocabulary']['Row'];
export type UserProgress = Database['public']['Tables']['user_progress']['Row'];
export type GameSession = Database['public']['Tables']['game_sessions']['Row'];
export type ChatMessage = Database['public']['Tables']['chat_history']['Row'];

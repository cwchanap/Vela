export interface Env {
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  APP_NAME?: string;

  // Supabase configuration
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
}

// Re-export types from validation schemas for backward compatibility
export type {
  ChatMessage,
  LLMBridgeRequest,
  ChatHistoryItem,
  ChatThreadSummary,
} from './validation';

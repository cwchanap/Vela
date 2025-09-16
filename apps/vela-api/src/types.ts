export interface Env {
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  APP_NAME?: string;

  // Supabase configuration
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;

  // AWS configuration
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_REGION?: string;
  VITE_COGNITO_USER_POOL_ID?: string;
  COGNITO_CLIENT_ID?: string;

  // DynamoDB configuration
  DDB_ENDPOINT?: string;
  DDB_REGION?: string;
  DDB_TABLE?: string;
}

// Re-export types from validation schemas for backward compatibility
export type {
  ChatMessage,
  LLMBridgeRequest,
  ChatHistoryItem,
  ChatThreadSummary,
} from './validation';

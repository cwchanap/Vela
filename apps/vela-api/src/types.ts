export interface Env {
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  APP_NAME?: string;

  // AWS DynamoDB configuration for chat history
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  DDB_ENDPOINT?: string; // e.g. https://dynamodb.us-east-1.amazonaws.com
  DDB_REGION?: string; // e.g. us-east-1
  DDB_TABLE?: string; // e.g. VelaChatMessages
}

// Re-export types from validation schemas for backward compatibility
export type {
  ChatMessage,
  LLMBridgeRequest,
  ChatHistoryItem,
  ChatThreadSummary,
} from './validation';

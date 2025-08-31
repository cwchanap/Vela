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

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMBridgeRequest {
  provider: 'google' | 'openrouter';
  model?: string;
  messages?: ChatMessage[];
  prompt?: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  appName?: string; // optional for OpenRouter X-Title
  referer?: string; // optional for OpenRouter HTTP-Referer
}

export type ChatHistoryItem = {
  ThreadId: string; // thread id (PK when using DDB)
  Timestamp: number; // Unix timestamp in milliseconds (SK when using DDB)
  UserId: string; // owner id (used by GSI in DDB)
  message: string;
  is_user: boolean;
};

export type ChatThreadSummary = {
  ThreadId: string;
  lastTimestamp: number;
  title: string;
  messageCount: number;
};

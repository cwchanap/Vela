// Shared LLM types and provider interface

export type LLMProviderName = 'google' | 'openrouter';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface LLMRequest {
  // Provide either prompt or messages
  prompt?: string;
  messages?: ChatMessage[];
  system?: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

export interface LLMResponse {
  text: string;
  raw?: unknown;
}

export interface LLMStreamChunk {
  textDelta: string;
  raw?: unknown;
}

export interface LLMProvider {
  readonly name: LLMProviderName;
  setModel(model: string): void;
  getModel(): string;
  generate(request: LLMRequest): Promise<LLMResponse>;
  // Optional streaming API. Providers can throw if unsupported.
  stream?(request: LLMRequest, onToken: (chunk: LLMStreamChunk) => void): Promise<LLMResponse>;
}

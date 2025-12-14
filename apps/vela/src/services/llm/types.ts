// Shared LLM types and provider interface

export type LLMProviderName = 'google' | 'openrouter' | 'chutes';

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
  apiKey?: string;
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
  setModel(_model: string): void;
  getModel(): string;
  generate(_request: LLMRequest): Promise<LLMResponse>;
  // Optional streaming API. Providers can throw if unsupported.
  stream?(_request: LLMRequest, _onToken: (_chunk: LLMStreamChunk) => void): Promise<LLMResponse>;
}

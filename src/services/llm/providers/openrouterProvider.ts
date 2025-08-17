import type { LLMProvider, LLMProviderName, LLMRequest, LLMResponse, ChatMessage } from '../types';

interface OpenRouterOptions {
  apiKey?: string;
  model?: string;
  appName?: string;
}

/**
 * OpenRouter provider (OpenAI-compatible Chat Completions)
 * Docs: https://openrouter.ai/docs
 */
export class OpenRouterProvider implements LLMProvider {
  readonly name: LLMProviderName = 'openrouter';
  private apiKey: string | undefined;
  private model: string;
  private appName: string | null;

  constructor(options?: OpenRouterOptions) {
    this.apiKey = options?.apiKey;
    this.model = options?.model || 'openai/gpt-4o-mini';
    this.appName = options?.appName ?? null;
  }

  setModel(model: string): void {
    this.model = model;
  }

  getModel(): string {
    return this.model;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    if (!this.apiKey) {
      console.warn('[OpenRouterProvider] Missing API key. Set VITE_OPENROUTER_API_KEY');
    }

    const endpoint = 'https://openrouter.ai/api/v1/chat/completions';

    // Build messages
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

    const pushMsg = (m: ChatMessage) => messages.push({ role: m.role, content: m.content });

    if (request.system) messages.push({ role: 'system', content: request.system });

    if (request.messages && request.messages.length > 0) {
      for (const m of request.messages) pushMsg(m);
    } else if (request.prompt) {
      messages.push({ role: 'user', content: request.prompt });
    } else {
      throw new Error('OpenRouterProvider.generate requires prompt or messages');
    }

    type CreateBody = {
      model: string;
      messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
      temperature?: number;
      max_tokens?: number;
    };

    const body: CreateBody = {
      model: request.model || this.model,
      messages,
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 1024,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey || 'YOUR_OPENROUTER_API_KEY'}`,
      'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'http://localhost',
      'X-Title': this.appName || 'Vela Japanese Learning App',
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`OpenRouterProvider error ${res.status}: ${txt}`);
    }

    const data = await res.json();
    const text: string = data?.choices?.[0]?.message?.content ?? '';

    return { text, raw: data };
  }
}

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
  private model: string;
  private appName: string | null;

  constructor(options?: OpenRouterOptions) {
    // API calls are proxied via AWS Lambda API; no client-side API key
    this.model = options?.model || 'openai/gpt-oss-20b:free';
    this.appName = options?.appName ?? null;
  }

  setModel(model: string): void {
    this.model = model;
  }

  getModel(): string {
    return this.model;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
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

    const payload = {
      provider: 'openrouter' as const,
      model: request.model || this.model,
      messages,
      temperature: request.temperature ?? 0.7,
      maxTokens: request.maxTokens ?? 1024,
      appName: this.appName || 'Vela Japanese Learning App',
      referer: typeof window !== 'undefined' ? window.location.origin : 'http://localhost',
      apiKey: request.apiKey,
    };

    const res = await fetch('/api/llm-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const textBody = await res.text();
    type BridgeResponse = { text?: string; raw?: unknown; error?: string };
    let data: BridgeResponse | null = null;
    try {
      data = textBody ? (JSON.parse(textBody) as BridgeResponse) : null;
    } catch {
      data = { raw: textBody };
    }

    if (!res.ok) {
      const msg = data?.error || res.statusText;
      throw new Error(`OpenRouter bridge error: ${msg}`);
    }

    const text: string = data?.text ?? '';
    return { text, raw: data };
  }
}

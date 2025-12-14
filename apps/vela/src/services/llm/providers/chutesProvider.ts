import type { LLMProvider, LLMProviderName, LLMRequest, LLMResponse, ChatMessage } from '../types';
import { getApiUrl } from 'src/utils/api';

interface ChutesProviderOptions {
  apiKey?: string;
  model?: string;
}

/**
 * Chutes.ai provider (OpenAI-compatible Chat Completions)
 * Docs: https://chutes.ai
 *
 * API calls are routed through the server which handles API keys.
 * User-provided API keys are required for this provider.
 */
export class ChutesProvider implements LLMProvider {
  readonly name: LLMProviderName = 'chutes';
  private model: string;
  private apiKey?: string;

  constructor(options?: ChutesProviderOptions) {
    this.model = options?.model || 'openai/gpt-oss-120b';
    this.apiKey = options?.apiKey ?? undefined;
  }

  setModel(model: string): void {
    this.model = model;
  }

  getModel(): string {
    return this.model;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
    const pushMsg = (m: ChatMessage) => messages.push({ role: m.role, content: m.content });

    if (request.system) messages.push({ role: 'system', content: request.system });
    if (request.messages && request.messages.length > 0) {
      for (const m of request.messages) pushMsg(m);
    } else if (request.prompt) {
      messages.push({ role: 'user', content: request.prompt });
    } else {
      throw new Error('ChutesProvider.generate requires prompt or messages');
    }

    const payload = {
      provider: 'chutes' as const,
      model: request.model || this.model,
      messages,
      temperature: request.temperature ?? 0.7,
      maxTokens: request.maxTokens ?? 1024,
      apiKey: request.apiKey ?? this.apiKey,
    };

    const res = await fetch(getApiUrl('llm-chat'), {
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
      throw new Error(`Chutes bridge error: ${msg}`);
    }

    const text: string = data?.text ?? '';
    return { text, raw: data };
  }
}

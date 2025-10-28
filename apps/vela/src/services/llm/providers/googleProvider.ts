import type { LLMProvider, LLMProviderName, LLMRequest, LLMResponse } from '../types';
import { getApiUrl } from 'src/utils/api';

interface GoogleProviderOptions {
  apiKey?: string;
  model?: string;
}

/**
 * Google AI Studio (Generative Language API - Gemini) provider
 * Docs: https://ai.google.dev/gemini-api/docs
 */
export class GoogleProvider implements LLMProvider {
  readonly name: LLMProviderName = 'google';
  private model: string;

  constructor(options?: GoogleProviderOptions) {
    // API calls are proxied via AWS Lambda API; no client-side API key
    this.model = options?.model || 'gemini-2.5-flash-lite';
  }

  setModel(model: string): void {
    this.model = model;
  }

  getModel(): string {
    return this.model;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    const modelForCall = request.model || this.model;

    const payload = {
      provider: 'google' as const,
      model: modelForCall,
      messages: request.messages,
      prompt: request.prompt,
      system: request.system,
      temperature: request.temperature ?? 0.7,
      maxTokens: request.maxTokens ?? 1024,
      apiKey: request.apiKey,
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
      // keep raw text if not JSON
      data = { raw: textBody };
    }

    if (!res.ok) {
      const msg = data && data.error ? data.error : res.statusText;
      throw new Error(`GoogleProvider bridge error: ${msg}`);
    }

    const text: string = data?.text ?? '';
    return { text, raw: data };
  }
}

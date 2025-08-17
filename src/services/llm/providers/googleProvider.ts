import type { LLMProvider, LLMProviderName, LLMRequest, LLMResponse } from '../types';

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
  private apiKey: string | undefined;
  private model: string;

  constructor(options?: GoogleProviderOptions) {
    this.apiKey = options?.apiKey;
    this.model = options?.model || 'gemini-2.5-flash-lite';
  }

  setModel(model: string): void {
    this.model = model;
  }

  getModel(): string {
    return this.model;
  }

  async generate(request: LLMRequest): Promise<LLMResponse> {
    if (!this.apiKey) {
      // Leave placeholder behavior per requirement
      console.warn('[GoogleProvider] Missing API key. Set VITE_GOOGLE_AI_API_KEY');
    }

    const modelForCall = request.model || this.model;
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelForCall}:generateContent?key=${this.apiKey || 'YOUR_GOOGLE_AI_API_KEY'}`;

    // Build contents array from messages/prompt
    type Part = { text: string };
    type Content = { role?: 'user' | 'model'; parts: Part[] };
    type GenerateBody = {
      contents: Content[];
      generationConfig?: { temperature?: number; maxOutputTokens?: number };
      systemInstruction?: { role?: 'system'; parts: Part[] };
    };

    const contents: Content[] = [];
    let systemInstruction: GenerateBody['systemInstruction'];

    if (request.messages && request.messages.length > 0) {
      for (const m of request.messages) {
        if (m.role === 'system') {
          systemInstruction = { role: 'system', parts: [{ text: m.content }] };
        } else {
          contents.push({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          });
        }
      }
    } else if (request.prompt) {
      contents.push({ role: 'user', parts: [{ text: request.prompt }] });
    } else {
      throw new Error('GoogleProvider.generate requires prompt or messages');
    }

    const body: GenerateBody = {
      contents,
      generationConfig: {
        temperature: request.temperature ?? 0.7,
        maxOutputTokens: request.maxTokens ?? 1024,
      },
    };

    if (request.system) {
      body.systemInstruction = {
        role: 'system',
        parts: [{ text: request.system }],
      };
    } else if (systemInstruction) {
      body.systemInstruction = systemInstruction;
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`GoogleProvider error ${res.status}: ${txt}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    return { text, raw: data };
  }
}

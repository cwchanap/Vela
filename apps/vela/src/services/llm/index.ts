import { getApiUrl } from '../../utils/api';
import { getAuthHeaders, httpJsonAuth } from '../../utils/httpClient';
import type { LlmMessage, LlmProvider, LlmResponse } from '@vela/common';

/** One non-stream chat generation against the authenticated /llm-chat route. */
export interface GenerateInput {
  provider: LlmProvider;
  model?: string | undefined;
  apiKey?: string | undefined;
  system?: string | undefined;
  /** Native effort/thinking level; registry defaults apply when omitted. The HPA-754 UI never sends it. */
  thinking?: string | undefined;
  messages: LlmMessage[];
}

export interface LlmCapabilities {
  serverKeyProviders: LlmProvider[];
}

/** Provider/model/key snapshot sent with every dictionary analysis request. */
export interface AnalyzeSentenceInput {
  sentence: string;
  provider: LlmProvider;
  model?: string | undefined;
  apiKey?: string | undefined;
  thinking?: string | undefined;
  /** Cancels the upstream stream; superseded asks abort the previous one. */
  signal?: AbortSignal | undefined;
}

/** Frames a dictionary analysis consumer observes; `error` rejects and `done` resolves the promise instead. */
export type AnalysisFrame =
  | { type: 'metadata'; sentence: string; provider: string; model: string }
  | { type: 'chunk'; text: string };

/**
 * Stateless browser LLM transport: every call carries its own
 * provider/model/apiKey snapshot — there is no mutable global provider.
 */
export const llmClient = {
  async capabilities(): Promise<LlmCapabilities> {
    return httpJsonAuth<LlmCapabilities>(getApiUrl('llm-chat/capabilities'));
  },

  async generate(input: GenerateInput): Promise<LlmResponse> {
    return httpJsonAuth<LlmResponse>(getApiUrl('llm-chat'), {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  /**
   * Stream a sentence analysis over the authenticated SSE route. Resolves only
   * after a `done` frame; an `error` frame, a non-ok response, or a body that
   * ends without `done` rejects. Malformed JSON lines are logged and skipped
   * without swallowing later valid frames.
   */
  async analyzeSentenceStream(
    input: AnalyzeSentenceInput,
    onEvent: (_frame: AnalysisFrame) => void,
  ): Promise<void> {
    const headers = await getAuthHeaders();
    const { signal, ...body } = input;
    const response = await fetch(getApiUrl('my-dictionaries/analyze'), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: signal ?? null,
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      throw Object.assign(new Error(data?.error || 'Failed to analyze sentence'), {
        status: response.status,
      });
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let sawDone = false;

    // Process complete `data:` lines from the buffer; on flush the trailing
    // line without a final newline is processed too. Returns once `done` is seen.
    const consumeBuffer = (flush: boolean) => {
      const lines = buffer.split('\n');
      buffer = flush ? '' : lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;

        let data: {
          type?: string;
          sentence?: string;
          provider?: string;
          model?: string;
          text?: string;
          error?: string;
        };
        try {
          data = JSON.parse(jsonStr);
        } catch (e) {
          console.error('Error parsing SSE data:', e);
          continue;
        }

        if (data.type === 'metadata') {
          onEvent({
            type: 'metadata',
            sentence: String(data.sentence ?? ''),
            provider: String(data.provider ?? ''),
            model: String(data.model ?? ''),
          });
        } else if (data.type === 'chunk') {
          onEvent({ type: 'chunk', text: String(data.text ?? '') });
        } else if (data.type === 'error') {
          throw new Error(data.error || 'Analysis failed');
        } else if (data.type === 'done') {
          sawDone = true;
          return;
        }
      }
    };

    try {
      while (!sawDone) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        consumeBuffer(false);
      }
      if (!sawDone) {
        // Flush the decoder's trailing bytes and any final pending line.
        buffer += decoder.decode();
        consumeBuffer(true);
      }
    } finally {
      void reader.cancel().catch(() => {});
    }

    if (!sawDone) {
      throw new Error('Analysis stream ended without completion');
    }
  },
};

const GATEWAY_TIMEOUT_MESSAGE =
  'The AI provider timed out before responding. Try a shorter request or a lighter model.';

/**
 * Map transport errors to a user-facing message. Provider deadline failures
 * never surface as a gateway 504 — they arrive as a 502 or an SSE error frame
 * carrying the API's fixed '<provider> request timed out' suffix
 * (sanitizeProviderError contract), so match that suffix too.
 */
export function describeLlmError(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const isTimeout =
      (error as Error & { status?: number }).status === 504 ||
      error.message.endsWith('request timed out');
    return isTimeout ? GATEWAY_TIMEOUT_MESSAGE : error.message || fallback;
  }
  return fallback;
}

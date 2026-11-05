import {
  LLM_PROVIDER_REGISTRY,
  LLM_PROVIDERS,
  type LlmEffort,
  type LlmMessage,
  type LlmProvider,
} from '@vela/common/contracts/llm';

export interface NormalizeLlmInput {
  provider: string;
  model?: string;
  /** Requested native effort/thinking level; validated against the model registry. */
  thinking?: string;
  system?: string;
  prompt?: string;
  messages?: Array<{ role: string; content: string }>;
}

export interface NormalizedLlmRequest {
  provider: LlmProvider;
  model: string;
  /** Resolved native effort; null when the provider has no effort concept (OpenRouter). */
  effort: LlmEffort | null;
  /** Single combined system instruction, or null when none was supplied. */
  system: string | null;
  /** Ordered user/assistant turns with leading non-user turns removed. */
  messages: LlmMessage[];
}

export type NormalizeLlmResult =
  { ok: true; value: NormalizedLlmRequest } | { ok: false; status: 400; error: string };

/**
 * Normalize an LLM request once, before any provider adapter runs: resolve
 * provider/model/thinking against the shared registry, combine every system
 * instruction into one, strip leading non-user turns (the web chat's fake
 * greeting), and map the remaining history to ordered text-only messages.
 */
export function normalizeLlmRequest(input: NormalizeLlmInput): NormalizeLlmResult {
  const provider = LLM_PROVIDERS.find((candidate) => candidate === input.provider);
  if (!provider) {
    return {
      ok: false,
      status: 400,
      error: `Unsupported provider '${input.provider}'. Supported providers: ${LLM_PROVIDERS.join(', ')}.`,
    };
  }

  const config = LLM_PROVIDER_REGISTRY[provider];
  const modelId = input.model?.trim() || config.defaultModel;
  const model = config.models?.find((entry) => entry.id === modelId) ?? null;
  if (config.models && !model) {
    return {
      ok: false,
      status: 400,
      error: `Unsupported model '${modelId}' for provider '${provider}'. Supported models: ${config.models.map((entry) => entry.id).join(', ')}.`,
    };
  }

  let effort: LlmEffort | null = null;
  if (model) {
    const thinking = input.thinking?.trim();
    if (!thinking) {
      effort = model.defaultEffort;
    } else if (!(model.efforts as readonly string[]).includes(thinking)) {
      return {
        ok: false,
        status: 400,
        error: `Unsupported thinking '${thinking}' for model '${model.id}'. Supported values: ${model.efforts.join(', ')}.`,
      };
    } else {
      effort = thinking as LlmEffort;
    }
  }

  const rawMessages = input.messages ?? [];

  // Combine every system instruction into one, deterministically: the request
  // `system` field first, then system-role history messages in order.
  const systemParts = [
    ...(input.system?.trim() ? [input.system.trim()] : []),
    ...rawMessages
      .filter((message) => message.role === 'system' && message.content.trim())
      .map((message) => message.content),
  ];

  let turns: LlmMessage[] = rawMessages
    .filter(
      (message): message is LlmMessage => message.role === 'user' || message.role === 'assistant',
    )
    .map((message) => ({ role: message.role, content: message.content }));

  if (turns.length === 0) {
    const prompt = input.prompt?.trim();
    if (!prompt) {
      return { ok: false, status: 400, error: 'Missing prompt or messages' };
    }
    turns = [{ role: 'user', content: prompt }];
  }

  // Drop leading non-user turns: the web chat prepends a decorative greeting
  // as the first assistant message, and it is not real model output.
  const firstUser = turns.findIndex((message) => message.role === 'user');
  if (firstUser === -1) {
    return { ok: false, status: 400, error: 'No user message found after normalization' };
  }

  return {
    ok: true,
    value: {
      provider,
      model: modelId,
      effort,
      system: systemParts.length > 0 ? systemParts.join('\n\n') : null,
      messages: turns.slice(firstUser),
    },
  };
}

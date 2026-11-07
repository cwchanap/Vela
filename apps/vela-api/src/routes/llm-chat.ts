import { Hono } from 'hono';
import { LLM_PROVIDER_REGISTRY, type LlmProvider } from '@vela/common/contracts/llm';
import { collectStream, createLlmProvider } from '../llm/factory';
import { normalizeLlmRequest } from '../llm/normalize';
import { CHAT_MAX_TOKENS } from '../llm/types';
import { requireAuth, type AuthContext } from '../middleware/auth';
import type { Env } from '../types';
import { LLMBridgeRequestSchema } from '../validation';

const llmChat = new Hono<{ Bindings: Env } & AuthContext>();

// Authentication precedes validation and every upstream call: this endpoint
// spends real provider quota, so anonymous requests must never reach a vendor.
llmChat.use('*', requireAuth);

/** Providers whose authenticated chat may fall back to a server-side key. OpenAI/Anthropic are deliberately absent: no server secret can ever supply them. */
const SERVER_KEY_ENV: Partial<Record<LlmProvider, keyof Env>> = {
  google: 'GOOGLE_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

llmChat.post('/', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const parsed = LLMBridgeRequestSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return c.json(
      { error: issue ? `${issue.path.join('.')}: ${issue.message}` : 'Invalid request' },
      400,
    );
  }

  const normalized = normalizeLlmRequest(parsed.data);
  if (!normalized.ok) {
    return c.json({ error: normalized.error }, 400);
  }
  const { provider, model, effort, system, messages } = normalized.value;

  // User key takes precedence; only Google/OpenRouter may fall back to a
  // server key, and only for authenticated chat (requireAuth above).
  const serverKeyEnv = SERVER_KEY_ENV[provider];
  const apiKey = parsed.data.apiKey || (serverKeyEnv ? c.env[serverKeyEnv] : undefined);
  if (!apiKey) {
    const label = LLM_PROVIDER_REGISTRY[provider].label;
    return c.json(
      {
        error: serverKeyEnv
          ? `Missing API key for ${label} provider. Configure ${String(serverKeyEnv)} on server or provide your own API key.`
          : `Missing API key for ${label} provider. Please provide your own API key.`,
      },
      400,
    );
  }

  try {
    const response = await collectStream(
      createLlmProvider(provider).stream({
        model,
        effort,
        system,
        messages,
        apiKey,
        // Caller values above the chat budget are capped, never forwarded.
        maxTokens: Math.min(parsed.data.maxTokens ?? CHAT_MAX_TOKENS, CHAT_MAX_TOKENS),
        signal: c.req.raw.signal,
        // Previous OpenRouter attribution defaults preserved: request URL and
        // the deployed APP_NAME when the caller omits them.
        referer: parsed.data.referer || c.req.url,
        appName: parsed.data.appName || c.env.APP_NAME,
      }),
    );
    return c.json(response);
  } catch (error) {
    // Adapters sanitize every failure to provider + status before it becomes
    // an error event, so this message carries no vendor data or keys.
    return c.json({ error: error instanceof Error ? error.message : 'LLM request failed' }, 502);
  }
});

llmChat.get('/capabilities', (c) => {
  const serverKeyProviders = (Object.entries(SERVER_KEY_ENV) as [LlmProvider, keyof Env][])
    .filter(([, envKey]) => Boolean(c.env[envKey]))
    .map(([provider]) => provider);
  return c.json({ serverKeyProviders });
});

export { llmChat };

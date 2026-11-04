# HPA-754: Shared LLM Provider Foundation

**Date:** 2026-11-03  
**Linear:** https://linear.app/cwchanap/issue/HPA-754/llm-providers-add-openai-and-anthropic-drop-chutes-update-gemini  
**Status:** Design proposal — implementation not started  
**PR policy:** One HPA-754 branch and one draft PR for this design, plan, runtime changes, tests, and review fixes.

## Goal

Users can chat and ask AI to analyze saved Japanese sentences using Google Gemini, OpenAI, Anthropic, or OpenRouter. Both features use one small frontend transport and the same backend provider adapters. Remove Chutes. Model capabilities and cache lifetime metadata have one source of truth, so later Settings (HPA-755) and chat-picker/cache-chip (HPA-758) work does not duplicate provider rules.

## Existing behavior and actual seams (main, 2026-11-03)

- `apps/vela-api/src/routes/llm-chat.ts` is an 8K-linearly-structured (approximately 8 KB) Hono route with direct Google, OpenRouter, and Chutes branches; it returns `{text,raw}`.
- `apps/vela-api/src/routes/my-dictionaries.ts` has **another**, authenticated LLM implementation: `POST /my-dictionaries/analyze` streams Google and OpenRouter responses as SSE events (`metadata`, `chunk`, `done`, `error`). This cannot be ignored when replacing the chat bridge.
- `apps/vela-api/src/validation.ts` already defines `LLMBridgeRequestSchema` but the chat route does not use it. Its provider enum does not currently match every route.
- `apps/vela/src/services/llm/index.ts` is a stateful `LLMService` with three browser-side provider wrappers, even though all three just call the backend.
- `apps/vela/src/stores/llmSettings.ts` mutates that singleton on provider, model, and key changes. `AIChatPage.vue` re-syncs it before every request.
- `MyDictionariesPage.vue` bypasses `LLMService` and reads the same settings directly to POST/parse its streaming analysis. The streaming analysis dialog is visible product behavior.
- `SettingsPage.vue` still exposes an active-provider selector and free-form model input. `apps/vela/e2e/llm-settings.spec.ts` explicitly tests Chutes and will need updating.
- Existing API and web unit tests are tied to the prior bridge shape and implementations.

## Scope and ownership

1. Add a **pure shared model registry** in `packages/common/src/llm/models.ts`, with provider ID, exact model ID, display label, provider-native supported thinking levels, default thinking level, and `cacheTtlSec`. Export lightweight types/helpers through `@vela/common`; no query, service, or plugin framework.
2. Add thin provider adapters in `apps/vela-api/src/llm/` and route both ordinary chat and dictionary SSE analysis through them.
3. Add a small **stateless** frontend `llmClient` for text generation and dictionary analysis streaming. Provider, model, thinking, and API key are supplied explicitly for each call; no mutable singleton.
4. Support the requested fixed model choices for Google, OpenAI, Anthropic; retain OpenRouter's user-specified model behavior.
5. Replace Chutes references in runtime, settings, types, tests, and relevant E2E expectations. Keep other features unchanged.

**Out of scope:** Chat-sidebar/thread metadata/table (HPA-756), per-provider Settings cards and per-model preference UI (HPA-755), thread model picker and cache countdown (HPA-758), TTS changes (HPA-757), infrastructure, database schema, secrets manager, new backend credential store, generic provider/plugin architecture, streaming chat UI, or compatibility/migration scaffolding for obsolete user preferences.

The existing Settings page remains usable with one active provider. Its persisted preference shape may remain until HPA-755 refactors it; this is a sequencing boundary, **not** a backward-compatibility layer. Do not add old-Chutes fallbacks. No live users need migrations.

## Model registry

| Provider | Model IDs | Default/allowed thinking | Cache TTL metadata |
| --- | --- | --- | --- |
| Google | `gemini-3.8-flash` (default), `gemini-4-argon` | medium; low/medium/high | `null` (unknown lifetime) |
| OpenAI | `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-luna`, `gpt-6-astra`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` | model-native; medium where supported, with `none` only on eligible models | `1800` |
| Anthropic | `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` | model-native adaptive; no `none` for Opus; respect other per-model allowed values | `300` |
| OpenRouter | Preserve user-entered model IDs, initial `openai/gpt-oss-20b:free` | No new thinking policy; existing Chat Completions behavior | `null` |

The registry represents **available UI choices and validation**, not runtime model discovery or price data. For OpenRouter, permit arbitrary model IDs as today. For the other providers, reject an invalid provider/model or thinking pairing with a useful 400 error rather than silently selecting another provider. Check exact 5.6 Sol reasoning options and model SDK parameter support against current provider docs before hardcoding the per-model matrix.

Keep default output sufficiently large for models that spend output tokens on reasoning (target 8192 for thinking models; OpenRouter retains its existing default unless changed intentionally). Do not set `temperature`, `top_p` or `top_k` on Gemini 3.8/4, OpenAI Responses, or Claude 5.5. OpenRouter keeps its existing sampling behavior.

## Request and response contract

Use an intentionally small common TypeScript contract (shared validation can remain Zod in the backend):

~~~ts
type ProviderId = 'google' | 'openai' | 'anthropic' | 'openrouter';
type ChatRole = 'system' | 'user' | 'assistant';
type LlmMessage = { role: ChatRole; content: string };
type LlmRequest = {
  provider: ProviderId;
  model: string;
  thinking?: string; // checked against the model registry; provider-native value
  apiKey?: string;
  prompt?: string;
  messages?: LlmMessage[];
  system?: string;
  maxTokens?: number;
  // Existing OpenRouter-only metadata may remain optional.
};
type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
};
type LlmResponse = { text: string; usage: LlmUsage };
~~~

- Require one nonempty `prompt` or nonempty `messages`; keep system instruction deterministic and avoid sending duplicate system messages.
- Make the frontend pass provider/model explicitly (the store remains the source for current user selection, not transport-global state).
- Normalize missing provider usage fields to zero; never claim cache hits from absence. Do not return large vendor `raw` payloads, provider thinking traces, or credentials to the browser.
- Continue to accept a user key for Google/OpenRouter with existing `GOOGLE_API_KEY` / `OPENROUTER_API_KEY` server fallbacks. **OpenAI and Anthropic require user-provided keys**; do not add server-side secrets for them.
- Preserve the existing auth gate and same-origin/CORS behavior on `/my-dictionaries/analyze`; do not add auth or a proxy to the existing chat bridge as part of this feature.
- Return actionable but sanitized provider errors. Never log user keys or copy entire upstream error bodies into frontend errors.

## Backend shape

~~~text
apps/vela-api/src/llm/
  types.ts
  factory.ts
  providers/
    google.ts
    openai.ts
    anthropic.ts
    openrouter.ts
~~~

`createLlmProvider(provider)` uses a closed switch (like the existing TTS factory). Each thin adapter accepts normalized inputs and offers `generate` and `stream`. Keep only one provider-specific request/response mapping in that adapter. Do not introduce adapter registries, transports, queues, background jobs, or a generic event framework.

- `POST /llm-chat/`: validate with the existing `LLMBridgeRequestSchema` (updated to the registry's providers), resolve credentials/model/thinking once, call `generate`, return `{text,usage}`.
- `POST /my-dictionaries/analyze`: retain existing sentence prompt and authenticated route, validate provider/model/key through the same shared helpers, call the adapter's `stream`, and retain the current four SSE event names and response metadata. Keep the route's sentence persistence/CORS logic unchanged.
- **Google**: `@google/genai` Interactions API, provider-native `generation_config.thinking_level`, no sampling temperature. Plain text from model-output steps only. Be deliberate about interaction storage and multi-turn reasoning signatures (see validation gate).
- **OpenAI**: official `openai` SDK Responses API, `reasoning.effort` from supported model values, text-only outputs, normalize input/output/cache usage. No temperature.
- **Anthropic**: `@anthropic-ai/sdk` Messages API with adaptive thinking and `output_config.effort` where supported; 5-minute ephemeral prompt caching, text blocks only, and no temperature.
- **OpenRouter**: existing Chat Completions REST behavior including referer/app name metadata and streaming deltas, moved into one adapter; no forced SDK migration.

Both endpoints use the same credential/model resolution rules and provider adapters. Dictionary SSE does **not** have to use the `/llm-chat` URL; route ownership and existing authentication remain where they are.

## Gemini multi-turn integration gate

The Gemini Interactions API recommends `previous_interaction_id` and preservation of thought signatures for full reasoning continuity. Today's Vela chat history saves only visible user/assistant text, and HPA-756 (thread metadata) is deliberately separate.

Before implementation proceeds, exercise a **real two-turn Japanese chat** with the proposed stateless full-text-history request, checking for signature errors, retained context, and actual text output. Keep the current full-history persistence contract; do not add chat thread state or a new DynamoDB table in HPA-754. If Gemini's Interactions API requires state/signatures for this flow, resolve it with the smallest correct adapter-level representation or explicitly revise the plan on the same PR before claiming the round-trip works. Do not silently ship broken multi-turn support or assume `store:false` preserves model reasoning.

For single-turn dictionary analysis, no cross-turn state is required. Default away from unnecessary provider-side storage where supported, after verifying the SDK behavior.

## Frontend behavior

- Replace `LLMService` and the three browser-side provider classes with a single `llmClient.generate(request)` plus `llmClient.analyzeSentenceStream(request, onEvent)`. The latter owns the already-existing SSE parsing, not new UI state.
- Chat passes current provider/model/key and registry default thinking for each request. Keep chat history persistence and markdown rendering unchanged.
- My Dictionaries continues progressive text display and the same Ask AI dialog; source the model/credential from the current settings, and make the API call through `llmClient`. Do not replace streaming with a blocking request.
- Settings temporarily keeps one active provider selector with four providers, registry-backed models for fixed providers, and OpenRouter custom input. Persist existing per-provider keys while this interim UI exists; HPA-755 owns the multiple simultaneous provider cards, default model, and per-model thinking preferences.
- Remove Chutes classes/tests/E2E cases; replace tests with supported-provider and key isolation assertions. Do not accidentally change TTS settings.

## Required tests and acceptance

1. Registry: exact provider/model membership, default Gemini Flash, valid/invalid thinking, OpenRouter free-form, cache TTL metadata.
2. API: invalid JSON and input, missing or wrong keys, provider/model mismatch, Google/OpenRouter server-key fallback, no OpenAI/Anthropic server fallback, correct SDK request construction, text/usage mapping, no raw leakage, truncated/incomplete/empty upstream responses.
3. Streaming: dictionary SSE metadata/chunks/done/error, no thinking-block exposure, streamed completion on all four adapters, and preserved auth/CORS. Mock upstream SDK events; no real keys in CI.
4. Web: stateless client call payload/error handling, chat model/key passed per invocation, per-provider Settings selection, and dictionary progressive text/cleanup; update old Chutes-specific E2E fixtures.
5. Live manual smoke (requires user-owned API keys): at least one successful text round-trip on **each** provider, Gemini two-turn continuity, and Japanese sentence streaming analysis. Document any unverified provider as **not verified** rather than claiming success.
6. Gates: install/lockfile update for the three official SDKs, `bun run test`, `bun run lint`, `bun --filter vela-api compile`, and relevant web build/typecheck; address baseline failures without widening scope.

No runtime test or provider credential smoke has been run on this docs-only branch.

## References

- Gemini Interactions API: https://ai.google.dev/gemini-api/docs/interactions-overview
- Gemini streaming: https://ai.google.dev/gemini-api/docs/streaming
- Gemini 3.8 model guide: https://ai.google.dev/gemini-api/docs/latest-model
- Claude Opus 5.5: https://platform.claude.com/docs/en/models/opus-5-5/overview
- Claude Sonnet 5.5: https://platform.claude.com/docs/en/models/sonnet-5-5/overview
- Claude Haiku 5.5: https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide
- OpenAI model/API catalog: https://platform.openai.com/docs/models

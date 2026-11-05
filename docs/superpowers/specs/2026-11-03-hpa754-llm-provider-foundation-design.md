# HPA-754: Shared LLM Provider Foundation

**Date:** 2026-11-03 · **Revised after PR #80 and Linear alignment review:** 2026-11-04  
**Linear:** https://linear.app/cwchanap/issue/HPA-754/llm-providers-add-openai-and-anthropic-drop-chutes-update-gemini  
**Status:** Design proposal — implementation not started  
**PR policy:** One HPA-754 branch and **one draft PR** for spec, plan, implementation, tests, and review fixes.

## Goal

Support Google Gemini, OpenAI, Anthropic, and OpenRouter for Vela chat and Japanese sentence analysis, using one stateless browser client and one small backend adapter per provider. Remove Chutes. Centralize model IDs, native thinking capabilities and cache TTL metadata so HPA-755/758 need no duplicate provider rules.

## Linear ticket alignment (reconciled 2026-11-04)

[HPA-754](https://linear.app/cwchanap/issue/HPA-754/llm-providers-add-openai-and-anthropic-drop-chutes-update-gemini) now matches this reviewed design: use existing **Gemini GenerateContent REST**, put the pure registry in `packages/common/src/contracts/llm.ts`, and use one `stream()` per provider with a shared `generate()` collector. The ticket retains the same four providers, requested model IDs, normalized usage, and Anthropic default refusal fallback. These are **approved technical simplifications**, not a change to product acceptance.

**Gemini rationale:** Vela persists only visible text. Google's Interactions API is recommended for new systems, but stateless multi-turn thinking requires replaying previous model thought steps; stateful Interactions require retaining interaction IDs. `generateContent` remains fully supported and preserves the current text-only history flow without new state. Thought signatures may improve reasoning fidelity, but ordinary text-only chat without function calls does not require the full function-calling signature validation. This PR deliberately does not retain reasoning state and must pass a deployed two-turn chat smoke test before runtime acceptance.

`llmClient.generate({provider,model,thinking?,messages})` keeps an **optional** thinking field in the contract, while the HPA-754 UI does not select effort until HPA-755; backend registry defaults apply. No new SDK or hidden migration is introduced.

## Existing code and deployment constraints

- `apps/vela-api/src/routes/llm-chat.ts` is a Hono Google/OpenRouter/Chutes bridge returning `{text,raw}`. The existing `LLMBridgeRequestSchema` in `src/validation.ts` is unused and the provider unions differ between code locations.
- `apps/vela-api/src/routes/my-dictionaries.ts` independently implements Google/OpenRouter SSE under authenticated `POST /my-dictionaries/analyze`, including auth/CORS and `metadata`/`chunk`/`done`/`error` frames. `createSSEStream` currently extracts **only text**, swallowing malformed/error upstream events.
- The dictionary page currently catches its own thrown `error` frame inside a JSON parsing `try/catch`; errors can be swallowed and leave `analyzing` true indefinitely. The new client must fix this, not copy it.
- `AIChatPage.vue` adds a display-only `GREETING_MESSAGE` as its first assistant turn, then passes **all** chat messages to the model; normalize before calling any provider to avoid injecting a fake assistant reply into prompts.
- `LLMService` keeps a mutable global provider/model/key and three browser wrappers; settings and chat both mutate it. The dictionary page instead calls its own endpoint directly.
- The deployed handler is `handle(app)` from `hono/aws-lambda`, behind the CDK `RestApi` + regular `LambdaIntegration` in `api-stack.ts` and CloudFront `RestApiOrigin`. **Production is buffered**, even when the route returns an SSE body. Local Bun can progressively stream, but do not promise streaming UI on the deployed stack.
- The configured API Gateway REST integration has an approximately **29-second default timeout** and CloudFront an approximately 30-second origin timeout; the Lambda's own 60-second timeout does not increase the client-facing budget. Exact behavior must be checked against the deployed stack. Raising max output or thinking can make timeouts frequent.
- `/api/llm-chat` is currently unauthenticated but has server-key fallbacks for Google/OpenRouter. `/my-dictionaries/analyze` is authenticated and **does not** have server-key fallbacks today. Those are separate existing credential policies.

## Scope and non-goals

1. Single pure `@vela/common` provider/model contract and registry, following `contracts/tts.ts`.
2. Closed server factory and four thin adapters using **one stream path** each. Shared `generate` drains the stream for the non-stream chat endpoint.
3. Central request/history normalization, provider/model validation and credential policy. Remove Chutes.
4. Stateless frontend transport for authenticated chat generation and the existing dictionary SSE analysis.
5. Preserve the existing Settings screen with minimal provider/model changes only. HPA-755 owns per-provider cards, keys UX, persisted preference redesign, and per-model thinking controls.

**Not this PR:** new CDK/CloudFront/API Gateway response streaming; chat sidebar/thread table (HPA-756); chat model picker/cache countdown (HPA-758); TTS (HPA-757); shared plugin framework, general error infrastructure, migration shims, prompt-store / interaction-ID persistence, or live pricing calculations.

Real production streaming requires a separate deliberately scoped infrastructure change (Hono's streaming Lambda adapter + API Gateway response streaming + origin timeout review). **Do not conflate accepting buffered SSE with true progressive delivery.** No follow-up ticket is created automatically by this planning PR.

## Registry and shared contract

File: `packages/common/src/contracts/llm.ts`, exported through a dedicated `@vela/common/contracts/llm` subpath, using one `LLM_PROVIDERS = ['google','openai','anthropic','openrouter'] as const` source, derived `LlmProvider` type, and registry data. It may also be re-exported through `packages/common/src/index.ts` for web callers, but the **API uses the pure subpath** to avoid importing query-client/Vue code from the root barrel. Backend Zod uses `z.enum(LLM_PROVIDERS)` and web `UserPreferences` / store use the derived type, not separately maintained literal unions. OpenRouter remains a valid provider with free-form model selection.

| Provider | Model IDs | Supported effort/thinking | Cache TTL |
| --- | --- | --- | --- |
| Google | `gemini-3.8-flash` (default), `gemini-4-argon` | `low`/`medium` (default)/`high`, provider `thinkingLevel` | `null` |
| OpenAI | `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-luna`, `gpt-6-astra`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` | per-model native `reasoning.effort`; verify 5.6 Sol and `none` support before implementation | `1800` |
| Anthropic | `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` | effort `low`/`medium`/`high`/`xhigh`/`max`; defaults Opus/Haiku `medium`, Sonnet `high`; no `none` level | `300` |
| OpenRouter | user-specified model, initial `openai/gpt-oss-20b:free` | leave existing behavior unchanged | `null` |

Anthropic's thinking on/off modes are separate model-specific settings, **not** effort values. Do not add an artificial `none` option. HPA-755 may introduce UI controls later.

~~~ts
export const LLM_PROVIDERS = ['google','openai','anthropic','openrouter'] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];
export type LlmMessage = {role: 'system'|'user'|'assistant'; content: string};
export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
};
export type LlmEvent =
  | {type: 'text'; text: string}
  | {type: 'usage'; usage: LlmUsage}
  | {type: 'error'; message: string};
export type LlmResponse = {text: string; usage: LlmUsage};
~~~

**Usage semantics (non-negotiable):**

- `inputTokens` = all input/prompt tokens **including cache reads and cache writes**. `cachedInputTokens` is a subset of `inputTokens`; `cacheWriteTokens` is another subset (avoid double-counting).
- Anthropic: add `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`; set cached-read and cache-write from their separate fields. OpenAI: `input_tokens` already includes `input_tokens_details.cached_tokens`, so do not add again. Gemini: `promptTokenCount` includes `cachedContentTokenCount`, so do not add again.
- `outputTokens` represents total reported generated tokens including thinking where separately reported (e.g. Gemini visible candidate tokens plus thoughts tokens; OpenAI/Anthropic counters already include their reasoning where provided). Absent provider counters become 0, **not** speculative cache hits or estimates.
- Test each provider with at least one nonzero cache fixture and one missing usage fixture. Do not expose raw vendor payloads or thinking blocks to the browser.

## Single backend pipeline

~~~text
packages/common/src/contracts/llm.ts    constants, types, model registry
apps/vela-api/src/llm/
  normalize.ts                         normalize system/history; validate model/thinking; choose defaults
  types.ts                             private adapter input and stream interface
  factory.ts                           closed provider switch; collectStream() → text/usage for chat
  providers/
    google.ts                          REST generateContent:streamGenerateContent
    openai.ts                          official SDK Responses streaming
    anthropic.ts                       official SDK Messages streaming
    openrouter.ts                       existing fetch Chat Completions streaming
apps/vela-api/src/routes/
  llm-chat.ts                          Zod + requireAuth → normalize → collectStream → JSON
  my-dictionaries.ts                   existing auth/CORS + normalize → stream → existing SSE frames
~~~

**CI packaging:** `@vela/common` currently publishes runtime JS through its gitignored `dist/`, while API code imports it only as erased TypeScript types. The new API runtime registry import requires: (a) exporting `./contracts/llm` in `packages/common/package.json`, (b) building common in `api-tests`, and (c) prepending the common build to the existing CDK `lambda:build` script so CDK tests and deployment bundle it consistently. Validate a clean CI checkout and Lambda bundle without accidental Vue/`@tanstack/vue-query` dependency.

**One vendor stream per adapter:** `stream(input): AsyncIterable<LlmEvent>`, using tiny vendor-event → `LlmEvent` mappers testable with recorded fixtures. Factory-level `collectStream` concatenates text, retains the latest usage, and throws on `error`/failure/incomplete termination. Do not duplicate `generate` code inside four adapters. For dictionary, translate `text` to `chunk`, surface `error` and keep existing `metadata`/`done` frames; emit `done` **only on successful terminal completion**. Initial provider failures from a lazy async-generator stream are reported as **HTTP 200 with an SSE `error` frame**, not an old JSON 500; update route tests. Local auth/validation failures before streaming remain JSON 4xx. Never silently reclassify **unresolved** refusals, `MAX_TOKENS`, `SAFETY`, `response.failed` or `response.incomplete` as success. A successful Anthropic fallback may complete with a non-refusal stop reason. Distinguish harmless empty output from explicit refusal using the provider's terminal status.

**Normalize once before any adapter:** choose the single system instruction from `system` and system-role messages deterministically; do not duplicate it. Drop leading non-user messages including Vela's decorative greeting (not real LLM output), then map the remaining user/assistant turns as text-only conversation. Test a first-send history that begins with the greeting. This is correct prompt hygiene regardless of whether a provider rejects assistant-first input. Current storage still saves only visible text; no thinking/signatures/tool calls are saved.

**Shared SSE reader:** extract a tiny upstream `readSseDataLines(body)` generator from the old dictionary route for Google/OpenRouter fetch streams; do not repeat the UTF-8 decoder/line buffering. The browser dictionary SSE parser also flushes trailing data at EOF so no final event is lost if an upstream line lacks a newline.

**Gemini:** Use the existing REST `:streamGenerateContent?alt=sse` endpoint for `gemini-3.8-flash`/`gemini-4-argon`, not the stateful Interactions API. REST `generationConfig.thinkingConfig.thinkingLevel` sets native `low|medium|high` (not Interactions' `generation_config.thinking_level`); do not set `temperature/top_p/top_k`. Use REST because the repo already does and a new SDK is unnecessary for text-only generation. GenerateContent text-only history **works without** resending thought signatures (they are recommended for reasoning fidelity but strictly required for in-turn function calling, which Vela does not perform). Preserve this explicit quality trade-off; verify a real two-turn chat on the deployed stack and do not claim thought-state continuity. Revisit signature persistence or Interactions only if a future feature actually needs it, not automatically as part of HPA-756.

**OpenAI:** Use official `openai` SDK Responses streaming and model-native reasoning effort. Never send temperature. Normalize terminal usage, failures and incomplete responses.

**Anthropic:** Use `@anthropic-ai/sdk` Messages streaming with adaptive thinking and explicit `output_config.effort`, top-level 5-minute `cache_control`. Enable Anthropic's native **`fallbacks: 'default'` with `server-side-fallback-2026-07-01` beta header** for supported Opus/Sonnet 5.5 calls (verify streaming SDK support). This honors the ticket without an application-level retry framework. **Haiku 5.5 has no server-side fallback**; report its unresolved refusal rather than inventing a retry policy. If a fallback succeeds, omit the `fallback` control blocks from user-visible text and use final-response usage as reported, without claiming it includes every billed attempt. Do not send temperature or thinking blocks to UI. Only use supported thinking-on/off modes in future Settings work.

**OpenRouter:** Retain free-form model/REST Chat Completions behavior and request metadata. For provider-specific completion errors, map to `LlmEvent.error`.

**Thinking defaults and budget:** Backend applies registry default if `thinking` is absent; browser **does not send thinking in HPA-754**. Dictionary analysis deliberately requests `low` effort server-side where that model supports it. Start with approximately 3,072 output tokens for dictionary analysis and 4,096 for chat, including reasoning; measure real latency and adjust conservative limits if required. Do not set 8,192 as the default just because a thinking model accepts it. Limit caller `maxTokens` so the endpoint cannot silently exceed the deployed time/cost budget; provider request timeout should be below gateway timeout.

**Credential and route policy:** Apply existing `requireAuth` middleware to `/api/llm-chat` and use existing `httpJsonAuth` on its browser client. This is a narrow safety/cost boundary, not a new auth system. Retain Google/OpenRouter server-key fallbacks **only for authenticated chat**, with the user key taking precedence. Dictionary analysis **still requires a user-provided key on every provider**, preserving its current policy; OpenAI/Anthropic user key required everywhere. Add auth regression tests and update `apps/vela/e2e/api.spec.ts` to send a token for valid chat requests. If gateway returns 504 or a buffered response exceeds the budget, client shows a clear timeout/error message; the Lambda cannot rewrite a timeout response the gateway already generated.

**Request validation:** Reuse `LLMBridgeRequestSchema`; provider comes from the constant tuple; reject unsupported provider/model/thinking with specific 400 errors including **rejected model ID**. Require nonempty prompt or messages. Remove `temperature` from schema and callers so old `0.7` cannot reach these adapters. No Chutes fallback and no migration layer. Keep existing active-provider Settings until HPA-755. Old saved model IDs may fail 400 with an actionable message, intentionally.

## Frontend and UX

- Replace `LLMService` and the browser provider wrappers with stateless `llmClient.generate({provider,model,apiKey,...})` and `llmClient.analyzeSentenceStream({sentence,provider,model,apiKey},onEvent)`. Do not pass thinking in this ticket.
- Chat uses an authenticated JSON request and explicitly passes current store provider/model/key on **every** send; remove global syncing. Greeting remains visible but is stripped from LLM history; no DB/thread changes.
- Dictionary retains its modal and SSE frame contract. The SSE parser distinguishes malformed JSON (log/skip one line) from a valid `error` frame (reject), requires a `done` before reporting success, handles end-of-stream/abort/error cleanly, and clears the analyzing spinner on every outcome. Local Bun may progressively render chunks; the deployed buffered response is still parsed with the same event semantics.
- Keep single-provider Settings selector with registry-backed choices for Google/OpenAI/Anthropic and existing OpenRouter free-form input. Keep temporary preferences only for HPA-755's later redesign; remove Chutes everywhere. No TTS settings changes.
- Small client-side feedback for upstream timeout (e.g. 504) and context-specific error, without a generic retry service.

## Acceptance and tests

1. **Registry and validation:** tuple-derived provider types, exact model IDs, native thinking defaults/options and cache lifetimes; OpenRouter free-form; stale `gemini-2.5-flash-lite` returns an explicit model error.
2. **Backend:** pure event-mapper fixtures for four providers, normalizer strips greeting and merges system, no thought/tool blocks in output, final usage semantics (including Anthropic cache arithmetic), abort/refusal/incomplete/`MAX_TOKENS`/`SAFETY` handling, Anthropic default fallback success/unresolved refusal and Haiku no-fallback case, missing keys and no leaked vendor raw payloads.
3. **Auth/credentials:** chat requires auth; server key fallback only on authenticated chat; dictionary requires user key; CORS and auth tests still pass; all browser chat requests carry bearer token.
4. **Dictionary SSE and UI:** locally progressive frames in order; explicit upstream errors and missing-`done` are errors, never a false success or stuck spinner. Include initial upstream 401/429/500 producing SSE error frames (HTTP 200 after stream start), and a trailing `data:` line without newline. On production, assert **correct buffered final result**, not progressive chunks.
5. **Deployed smoke:** deploy current branch to supported stack/environment, test one chat and one Japanese dictionary analysis for each of four providers (with user-owned keys), 2-turn Gemini text context, record HTTP status, elapsed time/TTFB, 504s, cache usage availability, and buffering. No real credentials in CI. Missing credentials are reported **not verified**.
6. **Repo gates:** `bun run test`, `bun run lint`, API compile, common build, web build/typechecks and `bun --cwd packages/cdk run lambda:build && bun --cwd packages/cdk run test:unit`; run targeted tests at **every** implementation task checkpoint before its commit. `api-tests` must succeed from a clean checkout. E2E `apps/vela/e2e/api.spec.ts` and `llm-settings.spec.ts` are updated for auth/provider changes.

**Risks:** buffered production SSE; ~29-second default API budget (especially new thinking models); decorative assistant greeting in history; normalized cache arithmetic; SDK/model parameter drift; intentionally dropped old model settings. Do not claim live performance or test completion in this planning-only PR.

## References

- Gemini GenerateContent thinking/`thinkingLevel`: https://ai.google.dev/gemini-api/docs/generate-content/thinking
- Gemini text generation and REST: https://ai.google.dev/gemini-api/docs/generate-content/text-generation
- Gemini signatures (non-function text-only signatures recommended, not mandatory): https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures
- Anthropic effort: https://platform.claude.com/docs/en/build-with-claude/effort
- Anthropic thinking modes: https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting
- Anthropic refusal fallback: https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback
- OpenAI API/model catalog: https://platform.openai.com/docs/models
- AWS REST API response buffering/streaming: https://docs.aws.amazon.com/apigateway/latest/developerguide/response-transfer-mode.html

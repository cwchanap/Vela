# HPA-754: Shared LLM Provider Foundation Implementation Plan

> **Implementation status:** Planning only. Every task is unchecked: no product code, test execution, credentials smoke, or deployment is claimed.
>
> **Agent handoff:** Implement **on existing draft PR #80**, commit at each task boundary, and handle review fixes there. **One ticket / one PR.**

**Linear:** https://linear.app/cwchanap/issue/HPA-754/llm-providers-add-openai-and-anthropic-drop-chutes-update-gemini  
**Spec:** [2026-11-03-hpa754-llm-provider-foundation-design.md](../specs/2026-11-03-hpa754-llm-provider-foundation-design.md)

**Goal:** Four supported providers with one small backend streaming adapter each; single source for model/effort/usage contracts; chat and the existing authenticated dictionary analysis use the same mapping. Remove Chutes and mutable frontend service. Preserve the existing infrastructure and single-provider Settings UI.

**Tech:** Bun, Hono, Zod, TypeScript, Vue/Pinia, Vitest, Bun test, Google/OpenRouter REST, official OpenAI and Anthropic SDKs.

## Ticket alignment note (Linear updated 2026-11-04)

The latest [HPA-754 issue](https://linear.app/cwchanap/issue/HPA-754/llm-providers-add-openai-and-anthropic-drop-chutes-update-gemini) still specifies **Gemini Interactions API via `@google/genai`**, `packages/common/src/llm/models.ts`, and `generate()` on each provider adapter. This reviewed PR plan deliberately uses **GenerateContent REST**, `packages/common/src/contracts/llm.ts`, and one `stream()` per provider plus a public `generate()` collector. These are **intentional deviations, not yet reflected in Linear**; do not claim exact ticket/design alignment. The Interactions conflict is substantive because Vela stores only visible chat text while stateless thinking-based Interactions require preserving thought steps. The location/interface differences are internal implementation choices; all user-facing functionality stays in scope. Recommend synchronizing the Linear implementation notes to the reviewed PR design before implementing rather than silently replacing the review-approved plan.

The ticket also calls for `llmClient.generate({provider,model,thinking,messages})`. Keep `thinking?: string` supported in the request **contract** and forwarded if provided, but the current UI does not select it until HPA-755; the backend supplies the registry default when absent. The ticket's Anthropic **default server-side refusal fallback** is explicitly included for supported Opus/Sonnet 5.5 models; Haiku 5.5 has no server-side fallback and remains an exception per Anthropic documentation.

## Constraints and accepted review decisions

- Keep one HPA-754 draft PR for implementation, tests, review fixes and acceptance. Do not open a second PR or mark Linear Done after docs alone.
- Closed `createLlmProvider` switch with an exhaustive `never` check; no DI or plugin registry. Registry is pure in `@vela/common`.
- The **only** provider execution method is `stream(input): AsyncIterable<LlmEvent>`. A factory utility drains it for chat JSON generation. Dictionary keeps its existing SSE event names, auth and CORS.
- **Production is buffered:** current `hono/aws-lambda` `handle(app)` + API Gateway `RestApi` `LambdaIntegration` do **not** stream SSE progressively to the client. Promise local incremental SSE only. This ticket does not add API Gateway response streaming or change CDK; deployed acceptance checks the final buffered result and elapsed time.
- Current deployed API Gateway integration is subject to an approximately **29-second default** client-facing timeout; CloudFront is approximately 30 seconds. Configure provider timeout below the gateway budget, keep lower-cost output defaults (chat ~4096; dictionary ~3072, include thinking), use dictionary `low` effort, and display a client-level timeout message for 504/network timeout. Do not promise the Lambda can rewrite a gateway-generated 504.
- Drop Google Interactions and its smoke spike. Use existing REST `generateContent`/`streamGenerateContent` with `generationConfig.thinkingConfig.thinkingLevel`, preserving text-only chat history. Signatures on ordinary text turns are recommended for fidelity, not required for validation; no tool/function calling here. Verify real two-turn Gemini context on deployment.
- Normalize system/history **once** before adapters, including removing Vela's decorative assistant greeting before the first user turn. No stale assistant prefill on any provider.
- Chat `/api/llm-chat` gains existing `requireAuth`, and browser uses `httpJsonAuth`. Keep server key fallback **only for authenticated chat** Google/OpenRouter. Dictionary `/analyze` remains user-key-only for all providers. Add focused auth regression tests and E2E adjustment.
- Server chooses per-model native thinking **defaults** (registry) when omitted; **frontend does not send thinking** in this ticket. Dictionary applies low effort when supported. No temperature/sampling parameters for new models; OpenRouter behavior unchanged. Anthropic effort ≠ disable-thinking; do not create `none`.
- Derive `LlmProvider` from a single `LLM_PROVIDERS` tuple; derive Zod enum, profile types, store types from it. Do not maintain repeated copies. Registry location is `packages/common/src/contracts/llm.ts`.
- **Clean-checkout CI/runtime build:** `vela-api` currently imports only types from `@vela/common`; new runtime imports require a built `dist`. Add a dedicated `@vela/common/contracts/llm` subpath so the API/Lambda avoids the root barrel's `@tanstack/vue-query`/Vue imports. Build common before `api-tests` and inside the existing CDK `lambda:build` script, covering `cdk-tests`, `build-lint.yml`, and `deploy.yml`. A blanket `sideEffects:false` alone is not a substitute for using the light subpath and clean CI checks.
- Define `inputTokens` as **including cached-read and cache-write tokens**; cachedInputTokens subset. Normalize Anthropic's sum, do not double-add cached tokens to OpenAI/Gemini. `outputTokens` includes reported reasoning when counted separately. Zero for absent metadata, never infer hits.
- Preserve authenticated dictionary CRUD, chat history, TTS, and profile loading. Minimal Settings selector update; HPA-755 owns redesign/keys preference format, HPA-756 owns threads, HPA-758 owns picker/cache chip, HPA-757 owns TTS.
- Chutes and stale model IDs get clear errors with the **rejected model** value; no old-provider/model migrations or compatibility shims.
- No keys, sessions, real prompt transcripts or other secrets in code, tests, PR or deploy logs.

## File map (minimal actual touch set)

### Add

~~~text
packages/common/src/contracts/llm.ts
packages/common/src/contracts/llm.test.ts

apps/vela-api/src/llm/normalize.ts
apps/vela-api/src/llm/types.ts
apps/vela-api/src/llm/factory.ts
apps/vela-api/src/llm/readSseDataLines.ts  # one upstream SSE/UTF-8 reader for Google + OpenRouter
apps/vela-api/src/llm/providers/{google,openai,anthropic,openrouter}.ts
apps/vela-api/test/llm/*                    # few focused mapper/normalization/factory tests

apps/vela/src/services/llm/llmClient.ts
apps/vela/src/services/llm/llmClient.test.ts
~~~

### Modify

~~~text
packages/common/src/index.ts
packages/common/package.json             # export pure ./contracts/llm subpath; avoid root barrel in API
packages/cdk/package.json                # lambda:build first builds @vela/common
.github/workflows/unit-test.yml          # api-tests builds @vela/common before test
apps/vela-api/package.json                 # openai + @anthropic-ai/sdk; no @google/genai
bun.lock
apps/vela-api/src/validation.ts
apps/vela-api/src/routes/llm-chat.ts       # add requireAuth
apps/vela-api/src/routes/my-dictionaries.ts
apps/vela-api/test/validation.test.ts
apps/vela-api/test/routes/{llm-chat,my-dictionaries}.test.ts
apps/vela-api/README.md                    # update endpoint/usage/auth docs
apps/vela/src/types/shared.ts
apps/vela/src/stores/llmSettings.ts
apps/vela/src/stores/llmSettings.test.ts
apps/vela/src/pages/settings/SettingsPage.vue
apps/vela/src/pages/settings/SettingsPage.test.ts
apps/vela/src/pages/chat/AIChatPage.vue
apps/vela/src/pages/chat/AIChatPage.test.ts
apps/vela/src/pages/dictionary/MyDictionariesPage.vue
apps/vela/src/pages/dictionary/MyDictionariesPage.test.ts
apps/vela/e2e/api.spec.ts                  # authenticated LLM request contract
apps/vela/e2e/llm-settings.spec.ts         # remove Chutes cases
~~~

### Remove or replace

~~~text
apps/vela/src/services/llm/index.ts             # re-export stateless client only if needed
apps/vela/src/services/llm/types.ts             # obsolete browser-provider class interface
apps/vela/src/services/llm/index.test.ts        # replace singleton tests
apps/vela/src/services/llm/providers/*          # remove all three bridge wrappers/tests
~~~

Do not manufacture files that the compiler and tests show unnecessary; avoid opportunistic refactors. Keep `@vela/common` dependency light and frontend SDK-free.

## Risks (check during implementation)

1. **Deployed buffering/timeout:** Local SSE tests cannot prove deployed behavior; use deployed 4-provider smoke with elapsed time and report buffering. Do not add new API infra in this ticket.
2. **Greeting as model context:** UI inserts fake assistant-first turn; test that shared normalizer removes it while retaining actual subsequent turns.
3. **Cache arithmetic:** Anthropic separates cached reads/writes from ordinary input; fixtures must show exact totals.
4. **Gemini text-only signature trade-off:** Text-only replay on GenerateContent works without strict signature validation but may lose reasoning fidelity; verify two-turn context and document limitation.
5. **Provider SDK/model drift:** Confirm current model IDs, field names, stream terminal events, default thinking/effort, Anthropic beta server-side fallback behavior and API limits before shipping.
6. **Stale saved models:** No migrations. Specific model-not-supported 400 is intentional; avoid silent fallback.
7. **Cost exposure:** Protect chat with existing auth before enabling costly models; dictionary must not accidentally inherit server-key fallback.

---

## Task 0 — Baseline, provider API verification, and deployment budget

**Files:** No code changes, spec/plan amendments on this PR only if provider docs contradict assumptions.

- [ ] Re-read live `main` of chat and dictionary routes, chat page, dictionary page, settings store, auth middleware, CDK API stack, existing unit/E2E fixtures, and `apps/vela-api/README.md`.
- [ ] Bootstrap `bun install --frozen-lockfile`, `bun --filter @vela/common build`. Record before-change results for targeted tests (no baseline claims in this planning-only commit).
- [ ] Confirm `gemini-3.8-flash`/`gemini-4-argon` native `generationConfig.thinkingConfig.thinkingLevel`, GenerateContent streaming REST event shape, text-only history, Google finish reasons and usage metadata. No Interactions state or `@google/genai`.
- [ ] Confirm SDK event formats and terminal error signals for OpenAI Responses and Anthropic Messages, Anthropic Opus/Sonnet/Haiku 5.5 native efforts, Anthropic streaming `fallbacks: 'default'` beta support (Haiku exception), model-specific OpenAI 5.6 Sol effort values, cache fields, and model availability. Update the model matrix on this PR if provider docs differ.
- [ ] Verify actual staging/production API URL, HTTP status on a gateway timeout, and deployed integration/origin timeouts. Credentials can be supplied privately later for the live smoke.
- [ ] Record exact commands, baseline failures, and feasibility conclusions on PR #80.

**Test gate before Task 0 checkpoint:** `bun --filter @vela/common test`, `bun --filter vela-api test`, and `bun --filter @vela/app test` (record baseline rather than claiming green). **Commit** only if findings change tracked documents.

## Task 1 — One shared provider contract, registry, and normalization

**Files:** `packages/common/src/contracts/llm.ts`/`llm.test.ts`, `packages/common/src/index.ts`, `apps/vela-api/src/llm/normalize.ts`, relevant tests.

- [ ] Start with failing tests for exactly 2 Gemini, 7 OpenAI and 3 Anthropic models, OpenRouter free-form ID, provider tuple derivation, native effort defaults, TTL (Google `null`, OpenAI `1800`, Anthropic `300`).
- [ ] Define `LlmMessage`, `LlmUsage`, `LlmEvent` (text / usage / error), `LlmResponse` in the existing `contracts/` style; no SDK imports or runtime provider discovery.
- [ ] Implement normalizer: combine system instructions once, strip leading non-user turns (especially fake `GREETING_MESSAGE`), map history to ordered actual messages, reject unsupported model/effort with specific 400 including model ID, choose registry default if thinking absent.
- [ ] Include unit fixtures for assistant-first history, multiple system messages, no prompt, mismatched provider/model, stale model, and normal user-assistant-user history.
- [ ] Make backend Zod enum derive from `LLM_PROVIDERS`. Avoid handwritten provider union in validation.
- [ ] Export `./contracts/llm` directly from `packages/common/package.json`; API runtime imports use that pure subpath rather than `@vela/common` root barrel. Add a common build step to `unit-test.yml` `api-tests` and prepend it in `packages/cdk/package.json` `lambda:build`; verify the resulting Lambda bundle does not include Vue/query-client dependencies.

**Gate:** `bun --filter @vela/common test`; `bun --filter @vela/common build`; `bun --filter @vela/common lint`; `bun --filter vela-api test`; `bun --filter vela-api compile`. **Commit Task 1 on PR #80.**

## Task 2 — Four streaming adapters and one shared collector

**Files:** `apps/vela-api/src/llm/{types,factory}.ts`, `providers/*`, `test/llm/*`, `apps/vela-api/package.json`, `bun.lock`.

- [ ] Add only `openai` and `@anthropic-ai/sdk` backend dependencies; keep Gemini and OpenRouter on existing native REST/fetch.
- [ ] Implement closed `createLlmProvider(provider)` factory and **one** `stream(input): AsyncIterable<LlmEvent>` per provider, using pure vendor event mapper functions that can be tested from fixtures.
- [ ] Implement a single `collectStream` utility: aggregate text, remember last usage, fail on `error`, refusal, incomplete or missing terminal finish; default missing usage to zeros. No duplicated non-stream adapters.
- [ ] Gemini: REST `:streamGenerateContent?alt=sse` with `generationConfig.thinkingConfig.thinkingLevel`; filter thought output, handle `finishReason: SAFETY/MAX_TOKENS` and usage. No sampling params. No function calling.
- [ ] OpenAI: Responses streaming SDK; catch `response.failed`, `response.incomplete` and API exceptions; extract text deltas and correct usage.
- [ ] Anthropic: Messages stream SDK, adaptive thinking + `output_config.effort`, top-level `cache_control: {type:'ephemeral'}`; text only; normalize `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` exactly. Enable native default **server-side refusal fallback** (`fallbacks: 'default'`, beta `server-side-fallback-2026-07-01`) for Opus/Sonnet 5.5 where supported; test streaming and serving-model identification. Haiku 5.5 has **no server-side fallback**; do not add a hand-coded fallback registry just for it. Surface unresolved refusals as errors. A successful fallback may include non-text control blocks and per-attempt billing metadata; do not display those blocks or falsely add final usage across attempts.
- [ ] OpenRouter: existing Chat Completions REST stream and referer/app name headers, user-defined model IDs, current sampling behavior; convert finish/errors to normalized events.
- [ ] Extract `readSseDataLines(body)` as one minimal async generator for the upstream fetch-based Google and OpenRouter adapters, reusing the UTF-8 `TextDecoder` buffering/flush logic from the existing dictionary route; ensure trailing data at EOF is processed. Do **not** duplicate the ~50-line reader in two adapters.
- [ ] Write a small fixture test per adapter for: one text chunk, final usage, error/aborted/refused/incomplete terminal, empty results, missing usage; include nonzero cached tokens to lock `inputTokens` math. Add Anthropic streamed fallback success, no-supported-fallback refusal, and Haiku 5.5 no-fallback cases.
- [ ] Keep limits conservative: chat default ~4096, dictionary ~3072, low dictionary effort if supported; time-bound requests below gateway's ~29-second default. Never leak SDK errors containing keys or unfiltered `raw`.

**Gate:** `bun --filter vela-api test`; `bun --filter vela-api compile`; `bun --filter @vela/common test`; `bun --filter @vela/common build`. **Commit Task 2 on PR #80.**

## Task 3 — Validated and authenticated chat endpoint

**Files:** `apps/vela-api/src/routes/llm-chat.ts`, `src/validation.ts`, `test/routes/llm-chat.test.ts`, `test/validation.test.ts`, `apps/vela-api/README.md`.

- [ ] Reuse `LLMBridgeRequestSchema` with `z.enum(LLM_PROVIDERS)`; remove `temperature` from schema; require nonempty prompt or messages; reject Chutes and unsupported model IDs with 400 naming rejected model.
- [ ] Add the existing `requireAuth` middleware to `/api/llm-chat`; reject anonymous requests (401) *before* calling upstream. Update the API README route description.
- [ ] Select user-key over server-key for authenticated chat on Google/OpenRouter. OpenAI/Anthropic require user-provided key; server secrets never supply those.
- [ ] Route: parse/validate → normalize → credential resolution → factory's `collectStream` → `{text,usage}`. No `raw` or thinking traces.
- [ ] Test 401 anonymous; 400 missing/invalid keys, provider/model/thinking/prompt; Google/OpenRouter server fallback only with auth; user-key priority; default 4 usage fields; missing/upstream errors and no vendor data leakage.
- [ ] Keep centralized CORS unchanged; enforce existing auth convention without adding a new library.

**Gate:** `bun --filter vela-api test`; `bun --filter vela-api compile`; `bun --filter @vela/common test`. **Commit Task 3 on PR #80.**

## Task 4 — Dictionary analysis route with truthful SSE/error semantics

**Files:** `apps/vela-api/src/routes/my-dictionaries.ts`, `test/routes/my-dictionaries.test.ts`.

- [ ] Keep dictionary CRUD, authenticated user-ID ownership, current origin/CORS checks and the existing Japanese analysis prompt unchanged.
- [ ] Use the **same** shared normalizer and adapter stream as chat, but keep dictionary `user key required` (no new fallback). Apply low native effort when the model supports it, without browser-sent `thinking`.
- [ ] Map internal `LlmEvent` to existing `metadata`/`chunk`/`error`/`done` SSE contract; preserve metadata `{provider,model,sentence}`. Keep only the outgoing SSE serializer here; move upstream byte/line splitting to the shared Google/OpenRouter reader.
- [ ] **Pick one upstream error HTTP policy:** use **HTTP 200 with an SSE `error` frame** for failures after the SSE response begins (including initial provider 401/429 returned by lazy async generators), and reserve pre-stream JSON 4xx for local authentication/validation errors. Explicitly update old `my-dictionaries.test.ts` assertions that expected JSON 500 for initial upstream 4xx/5xx. Avoid pre-priming the generator solely to preserve old transport status.
- [ ] Emit `done` only after provider successfully completes, not after malformed upstream data, refusal, canceled stream, `SAFETY`, `MAX_TOKENS` or failed/incomplete generation.
- [ ] Test valid streaming (under local Bun), upstream errors, stream end without successful finish, cache usage, authentication, and all four providers. Avoid replacing the existing SSE contract with a new protocol.
- [ ] Document **deployed buffering** and do not claim browser progress until API Gateway response streaming is explicitly delivered outside this ticket.

**Gate:** `bun --filter vela-api test`; `bun --filter vela-api compile`. **Commit Task 4 on PR #80.**

## Task 5 — Stateless browser client, chat, dictionary and minimal Settings

**Files:** `apps/vela/src/services/llm/*`, chat page/tests, dictionary page/tests, Settings page/tests, `llmSettings` store/tests, `types/shared.ts`, `apps/vela/e2e/{api,llm-settings}.spec.ts`.

- [ ] Replace `LLMService` and three old browser providers with one stateless `llmClient`:
  - `generate({provider,model,apiKey,messages,system,...})` uses existing authenticated `httpJsonAuth`.
  - `analyzeSentenceStream({sentence,provider,model,apiKey},onEvent)` preserves authenticated SSE frames and uses a reusable minimal auth header helper or the same current session pattern. Do not use JSON-only helpers for a stream.
- [ ] Move dictionary SSE decoding once. Skip/log malformed lines without swallowing valid `error`; reject on error, **flush the final pending UTF-8/line buffer at EOF**, reject if EOF without `done`, and terminate loading on every outcome. Test split chunks, trailing `data:` without final newline, and body end without done. Buffered deployed SSE is still parsed correctly.
- [ ] Chat passes provider/model/key snapshot explicitly per request, removes `syncLLMFromSettings` and stops sending `temperature:0.7`; greeting remains in UI but normalizer strips it from upstream history. Do not send `thinking` from the web yet.
- [ ] Keep current single active-provider Settings UX, update registry-backed Google/OpenAI/Anthropic choices and OpenRouter custom model input, preserve per-provider keys and the old preference layout pending HPA-755. Remove Chutes references and tests without migration code.
- [ ] Derive profile/store/provider type unions from `LLM_PROVIDERS`; delete browser provider class tests. Update chat page/service mocks and dictionary streaming tests.
- [ ] Update `e2e/api.spec.ts` LLM calls to send auth token where intended; replace Chutes-centric `e2e/llm-settings.spec.ts` with supported-provider behavior and key-isolation checks.
- [ ] If a provider request returns a gateway 504 or comparable timeout, surface a helpful error. Do not add a retry queue or global timeout middleware.

**Gate:** `bun --filter @vela/app test`; `bun --filter @vela/app lint`; `bun --filter @vela/app build`; `bun --filter vela-api test`; `bun --filter vela-api compile`. **Commit Task 5 on PR #80.**

## Task 6 — Deploy and acceptance on **this** PR

- [ ] Run complete project gates: `bun run test`; `bun run lint`; `bun --filter @vela/common build`; `bun --filter vela-api compile`; `bun --filter @vela/app build`; `bun --cwd packages/cdk run lambda:build && bun --cwd packages/cdk run test:unit`. Validate `api-tests`/Lambda builds from a clean checkout without a preexisting `packages/common/dist`. Capture exact commands, failures and fixes in PR notes.
- [ ] **Deploy the branch to an appropriate development/staging stack** (never assume production). Check that API and CloudFront URLs point at the tested deployment, no real API keys are logged, and the tested commit SHA is recorded.
- [ ] With private user-owned provider keys, run a chat completion **and** Japanese dictionary analysis for each of Google, OpenAI, Anthropic, OpenRouter. Record HTTP response, elapsed time and TTFB (if measurable), normalized usage where returned, gateway 504s, dictionary result, and whether chunks arrived progressively (they are expected to be buffered on this stack).
- [ ] Test Gemini 2-turn text conversation and at least one empty/timeout/error case. Explicitly record reasoning-signature preservation as **not implemented**; text-only history acceptance is based on correct user-visible context, not retained internal thoughts.
- [ ] Verify chat auth (401 anonymous, authenticated works), existing dictionary authenticated access/no server-key fallback, chat restoration, dictionary CRUD, and TTS unaffected.
- [ ] Missing key/access or unavailable models = **not verified**, not PASS. Provider failed = report defect and fix/adjust spec on same PR. No fabricated smoke evidence.
- [ ] Confirm no Chutes references in runtime/E2E except historical docs; no `raw` responses, no temperature in new-model upstream requests, no provider thinking blocks in UI, no spinner stuck after dictionary error.
- [ ] Update HPA-754 Linear status only when implementation actually delivered. Keep PR in draft until evidence and review gates complete, then mark ready on the **same** PR.

## Acceptance matrix

| Scenario | Expected |
| --- | --- |
| Shared provider list | Exactly one tuple-derived union, correct model registry/native effort/cache TTL |
| Browser generation | Stateless per-call model/key, authenticated, response `{text,usage}` |
| Auth | Anonymous chat 401, authenticated chat server fallback only Google/OpenRouter; dictionary always user key |
| History | Display greeting omitted from model request; user/assistant context preserved |
| Provider execution | One streaming adapter each, collector for JSON response; correct termination/error/usage |
| Token usage | `inputTokens` includes cached read/write tokens, no double count on Google/OpenAI |
| Dictionary UX | Local SSE progressively parsed, 4 existing frame types; errors/EOF clear spinner; **production buffered** |
| Deployment | Four-provider deployed smoke with latency / timeout record, no false progressive streaming claims |
| Gemini | GenerateContent REST native thinking config and two-turn text history verified |
| Tests | Focused tests at each task; full Bun test/lint and API compile/web build |
| Process | One HPA-754 PR, all changes/review fixes there, no premature Done |

## Deferred concerns

- Real deployed response streaming would require separate API/Lambda integration work and a considered CloudFront timeout, **not part of HPA-754**.
- HPA-755: Settings redesign, simultaneous provider key cards, preference shape and per-model thinking UI.
- HPA-756: chat sidebar/thread metadata (no forced Gemini Interactions migration).
- HPA-758: chat model picker/cache expiry chip, using correctly normalized usage.
- HPA-757: TTS changes.

Do not create extra tickets or PRs as a side effect of executing this plan. 

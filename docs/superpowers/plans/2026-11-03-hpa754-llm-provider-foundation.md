# HPA-754: Shared LLM Provider Foundation Implementation Plan

> **Implementation status:** Planning only. All checkboxes start unchecked; no code change, live-model test, or runtime gate is claimed.
>
> **Agent handoff:** Implement this spec and plan on the **existing HPA-754 draft PR**. Do not open a second PR for this ticket.

**Linear:** https://linear.app/cwchanap/issue/HPA-754/llm-providers-add-openai-and-anthropic-drop-chutes-update-gemini

**Spec:** [2026-11-03-hpa754-llm-provider-foundation-design.md](../specs/2026-11-03-hpa754-llm-provider-foundation-design.md)

**Goal:** Replace the duplicated Google/OpenRouter/Chutes bridges with simple provider-specific backend adapters for Google, OpenAI, Anthropic and OpenRouter. Use one stateless frontend client for chat and the already-streaming My Dictionaries analyzer, backed by a shared typed model registry.

**Stack:** Bun, Hono, Zod, TypeScript, Vue 3, Pinia, Vitest, Bun test, `@google/genai`, `openai`, `@anthropic-ai/sdk`, existing OpenRouter REST API.

## Guardrails

- **One HPA-754 ticket, one draft PR throughout implementation, review fixes, and acceptance.** The planning PR should not be merged until implementation and tests are finished.
- Prioritize a closed switch and four small adapters, not a framework, dependency-injection container, runtime discovery mechanism, generic streaming event bus, or additional package.
- Use the existing `@vela/common` package and backend `src/tts` as architectural examples; no infrastructure/CDK/database work.
- **Both** `/api/llm-chat` and `/api/my-dictionaries/analyze` must use the backend adapters. The dictionary route is authenticated and currently streams SSE; keep it streamed, authenticated, and with the current four UI event types.
- Chat and dictionary requests must choose provider, model, key, thinking on **each** call. Do not retain shared mutable `llmService` state.
- Keep the current active-provider Settings screen operational during this PR. The multi-provider cards, new profile format, default model preferences, and thinking dropdown belong to **HPA-755**; do not pre-implement them.
- Keep full chat-history storage unchanged. Thread metadata belongs to **HPA-756**; model picker and cache countdown belong to **HPA-758**; TTS belongs to **HPA-757**.
- Drop Chutes without a migration or fallback. Other legacy preference fields can remain as a temporary UI boundary for HPA-755, but never add a compatibility layer.
- Preserve current server-key fallback **only** for Google/OpenRouter. Require user keys for OpenAI/Anthropic. Never echo/log credentials.
- Provider-native thinking levels, no temperature on OpenAI/Anthropic/new Gemini APIs, and no provider-agnostic reasoning-mapping abstraction.
- No real provider credentials in code, docs, PR comments, mocks, or committed smoke-test transcripts.

## File map

### Add

~~~text
packages/common/src/llm/models.ts
packages/common/src/llm/models.test.ts

apps/vela-api/src/llm/types.ts
apps/vela-api/src/llm/factory.ts
apps/vela-api/src/llm/providers/google.ts
apps/vela-api/src/llm/providers/openai.ts
apps/vela-api/src/llm/providers/anthropic.ts
apps/vela-api/src/llm/providers/openrouter.ts
apps/vela-api/test/llm/*                  # Focused adapter/factory tests; use a few files, not a scaffold

apps/vela/src/services/llm/llmClient.ts
apps/vela/src/services/llm/llmClient.test.ts
~~~

### Modify

~~~text
packages/common/src/index.ts
apps/vela-api/package.json
bun.lock
apps/vela-api/src/validation.ts
apps/vela-api/src/routes/llm-chat.ts
apps/vela-api/src/routes/my-dictionaries.ts
apps/vela-api/test/validation.test.ts
apps/vela-api/test/routes/llm-chat.test.ts
apps/vela-api/test/routes/my-dictionaries.test.ts
apps/vela/src/stores/llmSettings.ts
apps/vela/src/stores/llmSettings.test.ts
apps/vela/src/types/shared.ts
apps/vela/src/pages/settings/SettingsPage.vue
apps/vela/src/pages/settings/SettingsPage.test.ts
apps/vela/src/pages/chat/AIChatPage.vue
apps/vela/src/pages/chat/AIChatPage.test.ts
apps/vela/src/pages/dictionary/MyDictionariesPage.vue
apps/vela/src/pages/dictionary/MyDictionariesPage.test.ts
apps/vela/e2e/llm-settings.spec.ts
~~~

### Remove or replace

~~~text
apps/vela/src/services/llm/index.ts           # Replace its stateful exports with stateless client exports
apps/vela/src/services/llm/types.ts           # Delete obsolete provider-class interfaces; re-export shared types if needed
apps/vela/src/services/llm/index.test.ts      # Replace singleton tests with client tests
apps/vela/src/services/llm/providers/*        # All three browser-side wrappers and their tests
~~~

Avoid deleting files until tests and repository-wide references have been updated. If the compiler proves some file-map items unnecessary, prefer leaving them untouched over busywork.

---

## Task 0 — Baseline and provider API feasibility

- [ ] Read current `main` of `llm-chat.ts`, `my-dictionaries.ts`, `llmSettings.ts`, `AIChatPage.vue`, `MyDictionariesPage.vue` and related test files before editing; note if main changed since planning.
- [ ] `bun install --frozen-lockfile` and `bun --filter @vela/common build`; run and record targeted existing tests from both apps so environmental failures are not misattributed.
- [ ] Check provider SDK **current** docs and use only supported model IDs/parameters. Verify OpenAI 5.6 Sol thinking options, Anthropic adaptive effort and cache-control settings, Gemini 3.8/4 thinking levels, all SDK streaming event shapes, and token usage fields.
- [ ] Spike the **Gemini Interactions two-turn case** with a private test key. Vela stores only visible text history; ensure passing it to the Interactions API yields both valid request and expected memory of the first turn. Inspect handling of thought signatures and storage options. Do not implement a database-backed interaction ID in this ticket. If stateless multi-turn cannot work, revise this spec/plan **on this PR** to describe the smallest correct solution before implementing adapters.
- [ ] Note all API parameters verified or rejected by the actual SDK, especially non-supported `temperature`. Do not promise provider live success until manually demonstrated.

**Checkpoint:** A supported minimal adapter strategy exists for non-stream chat, streaming dictionary, and two-turn Gemini. If not, update the draft PR's design and ask for review on the same PR, not new tickets or layers.

## Task 1 — Pure registry and shared contracts

**Files:** `packages/common/src/llm/models.ts`, `models.test.ts`, `packages/common/src/index.ts`.

- [ ] Write tests for the exact 2 Google / 7 OpenAI / 3 Anthropic model IDs, default `gemini-3.8-flash`, per-model supported thinking values, defaults, and cache TTL metadata (Google `null` / OpenAI `1800` / Anthropic `300`).
- [ ] Model registry stores literal values and tiny lookup/validation helpers only. Keep `openrouter` as an explicit provider with free-form model IDs and no fake finite model enumeration.
- [ ] Define typed `ProviderId`, messages, call inputs, normalized usage and response. Provider-specific SDK wire types remain in adapter files.
- [ ] Export the registry/types from `@vela/common`; do not load SDKs into the shared/browser package.
- [ ] Run targeted common tests and compile/build.

**Checkpoint:** No UI, networking, or persistence dependency enters the shared registry.

## Task 2 — Four thin server adapters and one factory

**Files:** `apps/vela-api/src/llm/*`, `apps/vela-api/test/llm/*`, `apps/vela-api/package.json`, `bun.lock`.

- [ ] Add only required server-side SDK dependencies: `@google/genai`, `openai`, `@anthropic-ai/sdk`. Keep OpenRouter on its existing fetch + Chat Completions wire protocol.
- [ ] Define one interface with `generate` (ordinary text) and `stream` (async text chunks or equivalent minimal adapter callback). Share input normalization and text-only extraction *inside* each adapter so both routes use the same provider mapping.
- [ ] Add a closed `createLlmProvider(provider)` factory switch similar to TTS, without plugin registration.
- [ ] Map system/user/assistant messages correctly for each API and prevent duplicate system instructions when both `system` and a system message exist.
- [ ] Google: Interactions API, correct output extraction and event streaming, supported thinking, correct usage. Treat absent usage as zero rather than guessing.
- [ ] OpenAI: Responses API, `reasoning.effort` and correct output text/stream deltas. Map `input_tokens`/`output_tokens`/`input_tokens_details.cached_tokens` where available.
- [ ] Anthropic: Messages API, model-native adaptive thinking with supported effort, prompt cache control, text blocks only; never show thinking blocks as user output.
- [ ] OpenRouter: retain HTTP headers and model freedom, full message format and streaming chunk extraction; no temperature changes unless tests demand a correctness fix.
- [ ] Default max output tokens must be sufficient when output includes reasoning. Preserve OpenRouter's effective behavior.
- [ ] Test with mocked SDK/client dependencies: provider dispatch, key handling, prompts and history, thinking, text extraction, normalized cached-input/cache-write usage, streaming chunks, empty/malformed responses, and errors.
- [ ] Errors should not expose API key values or raw entire upstream error bodies.

**Checkpoint:** Both text generation and streaming are usable from each adapter without any route-specific provider if/else logic.

## Task 3 — Refactor chat bridge

**Files:** `apps/vela-api/src/routes/llm-chat.ts`, `src/validation.ts`, their API tests.

- [ ] Extend/wire the existing `LLMBridgeRequestSchema` so invalid JSON, missing prompt/messages, provider/model mismatches and invalid native-thinking levels produce deterministic 400s. Reject Chutes.
- [ ] Resolve model and API key once, using Google/OpenRouter configured server fallbacks but strictly user keys for OpenAI/Anthropic.
- [ ] Route becomes: parse → validate → credential resolution → factory/adaptor `generate` → `{text,usage}`. No `raw` payload.
- [ ] Update existing tests to mock adapter/SDK boundary instead of hardcoding old Google REST responses; retain meaningful 400/500 and CORS tests.
- [ ] Test OpenAI/Anthropic missing user keys, Google/OpenRouter key override, missing cache usage defaulting to zero, correct response contract, and upstream failure.

**Checkpoint:** Chat with each provider uses the same endpoint and a normalized response, with legacy Chutes gone.

## Task 4 — Preserve dictionary analysis streaming

**Files:** `apps/vela-api/src/routes/my-dictionaries.ts` and `test/routes/my-dictionaries.test.ts`.

- [ ] Keep dictionary CRUD/auth untouched. Retain the same `POST /analyze` request shape and the same Japanese grammar-analysis prompt.
- [ ] Replace duplicate Google/OpenRouter upstream branches with `createLlmProvider` `stream`, enabling all four supported providers and the same validation/key rules as chat. Preserve existing CORS checks.
- [ ] Preserve these client-observed SSE events, in order: `metadata`, zero or more `chunk` events, `done`; use `error` on failures, with stream terminal state closed. Metadata includes `provider`, `model`, `sentence`.
- [ ] Test authenticated access, invalid inputs, unconfigured key, stream chunk boundaries, terminal completion, upstream failure, and missing output; do not expose reasoning/thinking.
- [ ] Keep SSE parsing and stream cleanup simple. Do not invent a shared transport protocol or generic event-bus layer.

**Checkpoint:** Existing My Dictionaries Ask AI modal continues displaying incremental text; Google/OpenRouter behavior is not regressed.

## Task 5 — Stateless client, chat, dictionary and minimum settings changes

**Files:** `apps/vela/src/services/llm/*`, `src/pages/{chat,dictionary,settings}/*`, `src/stores/llmSettings.ts`, `src/types/shared.ts`, tests and `e2e/llm-settings.spec.ts`.

- [ ] Create one stateless `llmClient.generate({provider,model,thinking,messages,system,prompt,apiKey,maxTokens})`, which POSTs to the existing backend and returns `{text,usage}`.
- [ ] Add `llmClient.analyzeSentenceStream({sentence,provider,model,thinking,apiKey},onEvent)`, reusing dictionary SSE parsing and passing through `metadata`/`chunk`/`done`/`error`. Do not buffer whole response before displaying it. Ensure the modal finishes loading on both success and error.
- [ ] Update chat to pass settings snapshot explicitly on each send; remove `syncLLMFromSettings` / global singleton mutation. Keep existing chat UI/history and sanitized markdown rendering unchanged.
- [ ] Update My Dictionaries to call `llmClient.analyzeSentenceStream`, removing direct fetch/decoding without rewriting unrelated dictionary or pronunciation logic.
- [ ] Keep temporary single selected provider/model/key settings store and UI; add Google/OpenAI/Anthropic/OpenRouter; use fixed registry choices for the first three, preserve free-form OpenRouter input; pass default thinking from registry. HPA-755 will implement per-provider cards, all-key saving UX, per-model thinking preferences, and new preference schema.
- [ ] Remove Chutes references, browser-side provider wrappers, stateful `LLMService` and obsolete tests. Search all web/API/E2E files for `chutes` and `llmService` before completing.
- [ ] Replace Chutes-specific E2E flows with supported-provider switching/key-isolation coverage and update unit mocks of the service.

**Checkpoint:** Two sequential requests can explicitly use different providers/keys without any persisted transport-global selection, and dictionary analysis still streams.

## Task 6 — Verification and close-out (same PR)

- [ ] Run `bun run test`, `bun run lint`, `bun --filter @vela/common build`, `bun --filter vela-api compile`, `bun --filter @vela/app build` (or the applicable app build command) and relevant targeted tests. Fix failures caused by this PR.
- [ ] Verify that API responses contain normalized usage fields with zero defaults and do **not** include `raw` responses or credentials.
- [ ] Real user-key smoke: one chat reply on Google, OpenAI, Anthropic, OpenRouter; a **two-turn Gemini Japanese chat** with context retained; one Japanese dictionary analysis streamed on each provider, or record precisely which provider could not be verified due to credentials/availability.
- [ ] Review provider model availability and SDK API changes against current docs; if a promised ID is unavailable, revise the plan and issue scope explicitly, do not silently replace a model.
- [ ] Confirm unchanged chat history restoration, dictionary CRUD, signed-in access, and TTS.
- [ ] Record exact commands/results and relevant manual observations in the PR. Leave the PR draft until all required evidence exists, then mark ready for review **on that same PR**.
- [ ] Link the single PR to HPA-754 and update Linear when implementation and acceptance actually complete. Do not mark the ticket Done for a planning-only commit.

## Acceptance matrix

| Scenario | Acceptance |
| --- | --- |
| Registry | Exact provider/model choices, supported native thinking and TTL metadata |
| Chat generation | One provider per call; text + four usage fields; correct key/model chosen |
| Key fallback | Google/OpenRouter server fallback, OpenAI/Anthropic user key required |
| Bad input | Invalid provider/model/thinking/prompt rejected with a useful 400 |
| Caching usage | Correctly reported when present; zero when unknown; no inferred cache hit |
| My Dictionaries | Authenticated Japanese sentence analysis visibly streams on every supported provider |
| Gemini history | Two-turn history maintains context without untracked provider state |
| Chutes removal | No functional path to Chutes; updated unit/E2E tests |
| Code quality | Tests, lint, API compile and web build green |
| Process | One HPA-754 draft PR containing design, plan, implementation and review fixes |

## Handoff / non-goals

This PR creates the provider foundation and leaves the Settings redesign, per-thread model persistence, thread metadata, cache countdown and TTS model refresh to **HPA-755, HPA-756, HPA-758, HPA-757** respectively. Do not split HPA-754 into multiple PRs, introduce a new ticket for these existing dependencies, or implement later tickets preemptively.

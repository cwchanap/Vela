# HPA-755 — LLM Settings Redesign (Single-PR Implementation Plan)

**Ticket:** https://linear.app/cwchanap/issue/HPA-755/redesign-settings-page-with-per-provider-llm-keys-and-thinking  
**Design:** [2026-11-06-hpa755-llm-settings-redesign-design.md](../specs/2026-11-06-hpa755-llm-settings-redesign-design.md)  
**Based on:** `main` after HPA-754 (completed).  
**Status:** Draft implementation plan. **Do not mark the issue Done or mark this PR ready until implementation and acceptance are complete.**

## Delivery and scope guard

**Exactly one HPA-755 PR.** This documentation starts the draft; implementation, tests, review corrections, and sign-off continue on the **same branch and PR**. Each task below is an internal commit/checkpoint, **not a separate ticket/PR**. HPA-757, HPA-756 and HPA-758 remain separate future work. Prefer local helpers in existing files; do not add an abstraction unless a second real consumer needs it. No legacy preference migration or user-data backfill.

Current checked code: `apps/vela/src/pages/settings/SettingsPage.vue`, `src/stores/llmSettings.ts`, `src/types/shared.ts`, `pages/chat/AIChatPage.vue`, `pages/dictionary/MyDictionariesPage.vue`, `services/llm/index.ts`, `apps/vela-api/src/routes/{profiles,my-dictionaries,llm-chat}.ts`, `src/validation.ts`, `packages/common/src/contracts/llm.ts`. Registry is already complete. Do not reimplement HPA-754.

## Minimal file map

**Add**
```text
apps/vela/src/pages/settings/components/ThemeSection.vue
apps/vela/src/pages/settings/components/LlmProvidersSection.vue
apps/vela/src/pages/settings/components/TtsSection.vue
apps/vela/src/pages/settings/components/LlmProvidersSection.test.ts
```

**Modify (only as necessary)**
```text
apps/vela/src/pages/settings/SettingsPage.vue
apps/vela/src/pages/settings/SettingsPage.test.ts
apps/vela/src/stores/llmSettings.ts
apps/vela/src/stores/llmSettings.test.ts
apps/vela/src/types/shared.ts
apps/vela/src/services/llm/index.ts
apps/vela/src/pages/chat/AIChatPage.vue
apps/vela/src/pages/chat/AIChatPage.test.ts
apps/vela/src/pages/dictionary/MyDictionariesPage.vue
apps/vela/src/pages/dictionary/MyDictionariesPage.test.ts
apps/vela-api/src/routes/profiles.ts
apps/vela-api/test/routes/profiles.test.ts
apps/vela-api/src/routes/llm-chat.ts
apps/vela-api/test/routes/llm-chat.test.ts
apps/vela-api/src/routes/my-dictionaries.ts
apps/vela-api/test/routes/my-dictionaries.test.ts
apps/vela-api/src/validation.ts
apps/vela-api/test/validation.test.ts
apps/vela/e2e/llm-settings.spec.ts
```

Avoid modifying the pure model registry or any provider adapter unless a failing focused test proves it necessary. No new CDK resources, database schema, separate package, or backend key service.

## Task 0 — Baseline and design reconciliation (no implementation yet)

1. Verify HPA-754 registry exists on target branch; check actual `LLM_PROVIDER_REGISTRY` efforts and provider defaults, particularly `openrouter.models === null`.
2. Confirm HPA-755 latest Linear description and dependencies before coding. Its scope is per-provider keys + per-model thinking + global default + Settings sections. Use the design file above as the technical contract; flag any future ticket change in this PR.
3. Capture baseline for focused app/API tests; do not describe baseline failures as introduced by this task. No vendor API calls or secrets required.

## Task 1 — Fix profile preference round-trip before UI work

**Files:** `apps/vela-api/src/routes/profiles.ts`, its tests; `apps/vela/src/types/shared.ts`.

1. Add optional `llm` preference validation to the existing `PreferencesShape` used by both GET and PUT: `keys` keyed only by `LLM_PROVIDERS`, `thinking` string map, `defaultModel` string. Keep this a nested Zod object in the existing route, not a new profile validation framework. Also recognize existing `darkMode?: boolean` so theme preferences are not stripped during LLM saves.
2. Update frontend `UserPreferences` with exactly the nested `llm` shape. Remove old `llm_provider`, `llm_models`, `llm_keys` references as part of replacing store and tests; no compatibility aliases.
3. Write API tests: PUT keeps `llm` + `darkMode` + learning prefs, strips unknown fields, GET from the updated profile returns the exact nested settings, GET does not write; malformed `llm` input is a 400.

**Gate:** `bun --filter vela-api test`, `bun --filter vela-api compile`; target the profiles route test first.

## Task 2 — One store, isolated save semantics

**Files:** `apps/vela/src/stores/llmSettings.ts`, `llmSettings.test.ts`, `types/shared.ts`.

1. Replace old `provider/models/keys` state with `keys/thinking/defaultModel`; derive the provider from the single shared registry using a small local pure helper. Preserve only the current custom OpenRouter model ID when it is the global default, not another per-provider model map.
2. Use `llm_settings_v2` local mirror and the new `preferences.llm` profile shape, never load legacy keys. On a successful authenticated save, merge the complete `llm` value into `auth.user.preferences` and update local mirror. Profile replaces local state when available; keep auth-user changes from mixing key maps. A failed save returns failure (or throws) and retains the editing buffer; no false success toast.
3. Expose provider-explicit actions. Card Save updates only that provider's key and its models' effort overrides, keeping the rest of the committed snapshot; default-model save is independent. Resolve effort by override or registry default. No stateful singleton or new store.
4. Test independent saves/deletes, unsaved provider drafts (component later), per-model effort valid/invalid defaults, free-form OpenRouter resolution, local mirror/profile priority, account/profile refresh and save failures.

**Gate:** targeted Vitest store tests, then `bun --filter @vela/app test`.

## Task 3 — Present three Settings sections and truthful availability

**Files:** `pages/settings/SettingsPage.vue`, new section components and tests, `apps/vela-api/src/routes/llm-chat.ts` and its route test, `apps/vela/e2e/llm-settings.spec.ts`.

1. Extract `ThemeSection` and `TtsSection` from the existing Settings page with behavior unchanged and no TTS voice/model upgrade. Keep the top-level page as a simple composition.
2. In `LlmProvidersSection`, show four expandable provider cards. Each owns a `draftKey[provider]` and `draftEffort[modelId]` buffer; switching/expanding a different card never discards pending edits. Save commits only the target card, provides visible loading/error/success state, and renders “Key saved” from committed state. Key clearing is local to that card.
3. Populate fixed model rows + native effort options directly from `LLM_PROVIDER_REGISTRY`. No arbitrary model text for Google/OpenAI/Anthropic. OpenRouter has a free-form model ID input seeded with its registry default or current custom default; never show an effort selector for it.
4. Add a small authenticated `GET /api/llm-chat/capabilities` handler returning only `googleServerKeyAvailable`, based on already-injected `c.env.GOOGLE_API_KEY`. Test auth and true/false cases. Fetch it once on the Settings page (simple existing HTTP helper; no new global cache subsystem). On unavailable/failed lookup, only show user-keyed providers.
5. Default select lists eligible models; selecting one persists the global model independently. When removing the current provider key, choose a deterministic remaining available default or show “configure a key” if none. A server-key-backed Google default is explicitly marked **chat only** unless the user also supplied a Google key for dictionary analysis.
6. Update old Settings unit and Playwright selectors/expectations; **do not leave old component tests asserting removed `selectedProvider`, `model`, or `apiKeyHint` view-model fields**. Test four cards, Save per card, preserved other draft, effort rows, fallback condition and unchanged theme/TTS.

**Gate:** focused Settings component tests, route tests, `bun --filter @vela/app test`.

## Task 4 — Wire actual LLM requests, including dictionary thinking

**Files:** `pages/chat/AIChatPage.vue`, `pages/dictionary/MyDictionariesPage.vue`, `services/llm/index.ts`, `apps/vela-api/src/{validation.ts,routes/my-dictionaries.ts}` and focused tests.

1. Chat uses `llmSettings`' resolved global default on each send (including existing threads until HPA-758), deriving provider, model, matching key and effective effort. Pass `thinking` to the existing `llmClient.generate`; the bridge already validates it. No thread schema or history changes.
2. Dictionary builds the same snapshot. Add `thinking?: string` to `AnalyzeSentenceInput` and `AnalyzeSentenceRequestSchema`; forward `thinking` into `normalizeLlmRequest` and provider stream. **When supplied**, it overrides dictionary's current forced-low rule. **When omitted**, preserve the existing low-when-supported dictionary behavior; this is only a backend default for callers that do not supply a choice, not a new migration. Preserve user-key-only auth, fixed output token budget and SSE frame/abort/error/done semantics.
3. In dictionary UI, if global Google default depends solely on chat's server key, show a precise missing-user-key message; do not pass the server key to the browser or add dictionary fallback. Avoid silently substituting another provider.
4. Test request snapshots on both pages and validation of allowed/disallowed effort at API boundary, plus dictionary SSE completion and missing-key regression. Use mocks, not billed live provider requests.

**Gate:** `bun --filter vela-api test`, `bun --filter vela-api compile`, `bun --filter @vela/app test`.

## Task 5 — End-to-end regression and acceptance on this same PR

- Update `apps/vela/e2e/llm-settings.spec.ts` to the four-card UI. Assert one provider's unsaved input survives expanding another; save/reload each provider's key; effort/default selections survive a profile round-trip; chat POST contains `thinking`; dictionary POST contains `thinking`; OpenRouter remains free-form. Mock provider responses and use non-secret test strings. Do not rely on the external vendor responding.
- Run root `bun run test` and `bun run lint`, app build (`bun --filter @vela/app build`), API compile (`bun --filter vela-api compile`) and affected E2E tests where credentials/fixtures are available. Report any skipped gated E2E honestly.
- Manual browser smoke: all four cards; provider-key save, reset, reload; default model chat, dictionary with a user key; Google server fallback indication; unchanged theme/TTS. Never put real keys/screenshots of keys into PR text.
- Verify all HPA-755 acceptance criteria in the design and **latest** Linear ticket, including its explicit dependencies and non-goals. Keep PR draft if implementation or acceptance is incomplete; no second PR for review fixes.

## Acceptance checklist

- [ ] Profile PUT/GET retains nested `llm` and current `darkMode` while retaining other preferences.
- [ ] Four per-provider keys are independently saved, loaded and deleted; unrelated card drafts remain.
- [ ] Every fixed model exposes registry-native effort values; effective effort sent in chat + dictionary.
- [ ] Global default model persists and drives chat + dictionary; valid free-form OpenRouter default works.
- [ ] Google server key availability is truthful; dictionary still requires its user-owned key.
- [ ] Theme/TTS untouched functionally; existing Chat and Dictionary error/SSE tests remain green.
- [ ] Unit, API, lint/build and available E2E gates recorded, with failures explained.
- [ ] One PR only; move out of draft and mark HPA-755 Done **after**, not before, acceptance.

## Deliberate deferrals

HPA-756 chat sidebar/thread table; HPA-757 TTS model/realtime API upgrade; HPA-758 chat picker/cache timer and per-thread model. Keys remain in existing profile/localStorage for this hobby-stage feature; stronger key storage is deferred per ticket. No backward compatibility or migration and no further package abstraction.

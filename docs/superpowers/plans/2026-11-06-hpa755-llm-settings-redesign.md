# HPA-755 — LLM Settings Redesign (Single-PR Implementation Plan)

**Ticket:** https://linear.app/cwchanap/issue/HPA-755/redesign-settings-page-with-per-provider-llm-keys-and-thinking  
**Spec:** [2026-11-06-hpa755-llm-settings-redesign-design.md](../specs/2026-11-06-hpa755-llm-settings-redesign-design.md)  
**Design review:** https://github.com/cwchanap/Vela/pull/81#issuecomment-6690108759  
**Base:** `main` with completed HPA-754.

**Delivery rule: exactly one HPA-755 draft PR.** These checkpoints are tasks _within this PR_, not separate tickets or PRs. Documentation-only commits do not complete the issue. Keep any review corrections and implementation on this same branch/PR; do not prematurely mark the PR ready or the ticket Done.

## Decisions incorporated from the review

1. The **client sends only explicit per-model `thinking` overrides**, not registry defaults. Chat's backend uses default efforts and dictionary analysis keeps its latency-safe low default if omitted. A model row's “Default” choice removes its override; high+ effort may exceed dictionary's ~25-second provider deadline with deployed buffered SSE.
2. `llm.defaultModel` is `{provider,model}`, matching the existing request contract. Remove any model-ID-to-provider resolver and avoid OpenRouter misrouting.
3. Profile validation is strict and bounded on PUT (400). GET sanitizes invalid entries, falls back within a known provider, and omits an unreadable subtree; unrelated writes preserve the unreadable stored subtree. Include existing `darkMode`.
4. No localStorage mirror or account-crossing fallback; leave the legacy key untouched. Profile preference saves are serialized within a tab and use a server-generated version across clients. On conflict, reload and retry the updater once. Existing acknowledgment reconciliation protects in-flight profile reads and account transitions.
5. Capability GET returns `{serverKeyProviders: LlmProvider[]}` derived from the existing `SERVER_KEY_ENV` (Google and OpenRouter), not a hard-coded Google boolean. Consume through a conventional query composable. Dictionary remains user-key-only.
6. Removing a provider key does not auto-select another model. Keep the default pair visible and show a warning; reuse the backend's actionable error. No dictionary-specific model rewrite or pre-check.
7. The free-form OpenRouter ID belongs beside the global Default model selector, not in the provider card. Its card manages only the key; no OpenRouter effort dropdown.
8. Render `LlmProviderCard.vue` four times; each component owns its own draft refs. No keyed parent-level draft map.
9. Store and all dependent components must change **in one green checkpoint**; merely removing `provider/currentModel/currentApiKey` from the store breaks Settings, Chat, Dictionary and their tests.
10. Reuse existing normalizer effort-validation tests. Add only dictionary-specific request forwarding and omitted-low tests, plus end-to-end request assertions.

## Minimal file map

**Add**

```text
apps/vela/src/pages/settings/components/ThemeSection.vue
apps/vela/src/pages/settings/components/TtsSection.vue
apps/vela/src/pages/settings/components/LlmProvidersSection.vue
apps/vela/src/pages/settings/components/LlmProviderCard.vue
apps/vela/src/pages/settings/components/LlmProvidersSection.test.ts
apps/vela/src/pages/settings/components/LlmProviderCard.test.ts
apps/vela/src/composables/queries/useLlmCapabilitiesQuery.ts
```

**Modify if required**

```text
apps/vela/src/pages/settings/SettingsPage.vue
apps/vela/src/pages/settings/SettingsPage.test.ts
apps/vela/src/stores/llmSettings.ts
apps/vela/src/stores/llmSettings.test.ts
apps/vela/src/types/shared.ts
apps/vela/src/pages/chat/AIChatPage.vue
apps/vela/src/pages/chat/AIChatPage.test.ts
apps/vela/src/pages/dictionary/MyDictionariesPage.vue
apps/vela/src/pages/dictionary/MyDictionariesPage.test.ts
apps/vela/src/services/llm/index.ts
apps/vela/e2e/llm-settings.spec.ts
apps/vela-api/src/routes/profiles.ts
apps/vela-api/test/routes/profiles.test.ts
apps/vela-api/src/routes/llm-chat.ts
apps/vela-api/test/routes/llm-chat.test.ts
apps/vela-api/src/routes/my-dictionaries.ts
apps/vela-api/test/routes/my-dictionaries.test.ts
apps/vela-api/src/validation.ts
```

No registry change, new DB, CDK table, backend provider adapter, key vault or new general settings service. Avoid opportunistic unrelated refactors.

## Task 0 — Confirm baseline and ticket alignment

- Confirm HPA-754 registry, native `LlmEffort` and the provider fallback policy are on the current base revision. Confirm HPA-755's **latest** description and review-approved amendments.
- Run focused existing store, Settings, Chat, Dictionary, API profile and dictionary route tests before altering files, and record failures. Do not assume a passing baseline.
- Observe the actual `LLM_PROVIDER_REGISTRY.openrouter.models === null` and existing Settings `q-select`/TTS components for direct reuse.

**Gate:** Record baseline, no incomplete compatibility layer or unrelated changes.

## Task 1 — Profile write/read contract (green, independently testable)

**Files:** `apps/vela-api/src/routes/profiles.ts`, `test/routes/profiles.test.ts`; optionally add the **new** frontend `UserPreferences.llm` type while temporarily retaining old type fields until Task 2.

1. Add the nested schema to the existing `PreferencesShape`: `keys` via `z.partialRecord(z.enum(LLM_PROVIDERS), z.string())`; `thinking` values typed from the native effort values; `defaultModel` as an explicit `{provider,model}` object. Also add `darkMode`.
2. Writes: reject invalid nested settings (400) and stale preferences versions (409). Reads: sanitize invalid entries and omit unreadable LLM settings without writing. Preserve unrelated preferences and an unreadable stored LLM subtree during unrelated saves.
3. Tests: PUT→GET round trip of all keys, effort overrides, explicit model pair, darkMode and learning prefs; partial provider key map; invalid write 400; malformed read `llm` omitted without 500; authenticated ownership unchanged. Keep existing legacy-field stripping test.

**Gate:** `bun --filter vela-api test` and `bun --filter vela-api compile` (target the profile test first).

## Task 2 — Atomic store + consumers + Settings UI migration (one green checkpoint)

**Files:** Store, type, Settings page and section/card components/tests; Chat and Dictionary pages/tests, and the existing LLM client as needed.

**Do not commit a half-refactor that removes store getters while their consumers still use them.** Prepare the following as one coherent checkpoint, then run the full app suite:

1. Replace the store's old state with a single authenticated `llm` snapshot and derived `selection = {provider,model,apiKey,thinking?:LlmEffort}`. Never infer provider from model ID, load old localStorage fields or add a new mirror. **Unconditionally replace state on any `auth.user`/profile change**, including `null` on sign-out and a newly signed-in user whose `preferences.llm` is absent; those cases must reset to fresh empty keys/overrides and the registry Google default instead of returning early. Watch both user identity and preference hydration rather than only changed IDs.
2. For `saveProvider(provider,key,thinkingPatch)` and `saveDefault(pair)`, construct the updated snapshot from the latest authenticated preferences, call existing `auth.updatePreferences({llm:next})`, and commit only on `true`. Preserve other cards, other preferences and global selection. No false success toast. Clearing a key does **not** change the model. Test failed saves and account switches.
3. Move current theme UI and current TTS UI into `ThemeSection` and `TtsSection` without behavior changes. Make `SettingsPage.vue` compose those plus `LlmProvidersSection`.
4. Render four `LlmProviderCard` instances keyed by provider with **per-instance draft refs** for key and model overrides. Each card's Save affects only itself; the “Default” effort option deletes the override. Other native effort options are drawn from the shared registry. Display the dictionary-timeout note. OpenRouter's card has key only, no effort/model input.
5. Place Default model picker atop `LlmProvidersSection`. Fixed models are registry IDs; selecting “OpenRouter (custom ID)” shows free-form text **at the global selector**. Persist a `{provider,model}` pair. Do not reselect on key deletion; show missing-key status. Until Task 3, base eligible choices only on user keys and keep existing selection visible (capability-backed models are added next).
6. Switch **both** Chat and Dictionary read paths to the store's single `selection` getter. Chat sends explicit `thinking` override to the existing `llmClient.generate`. Dictionary switches its provider/model/key read to the selection but does not yet send `thinking` until Task 4 adds backend support. Preserve chat history and dictionary SSE behavior.
7. Update all old Settings/store/Chat/Dictionary tests that used `selectedProvider`, `currentModel`, `currentApiKey`, `setApiKey` etc. Add **two regression cases**: sign-out clears in-memory keys, and a second user with no `preferences.llm` gets fresh defaults (never the first user's keys). Write isolated provider-card tests: draft never disappears on another card expansion, save only one, failed save stays editable, registry choices and “Default” remove overrides.

**Gate:** `bun --filter @vela/app test`, `bun --filter @vela/app build`, and `bun --filter @vela/app lint`. No intentionally red suite between committed checkpoints.

## Task 3 — Server-key capability discovery (green)

**Files:** `apps/vela-api/src/routes/llm-chat.ts` and its tests; `useLlmCapabilitiesQuery.ts` with a **local query key**; `LlmProvidersSection.vue` and focused tests. No `packages/common` changes for a single Settings-only query.

1. Add authenticated `GET /llm-chat/capabilities` using existing `SERVER_KEY_ENV` as the single source for `serverKeyProviders`; return provider IDs, not secrets. Google and OpenRouter are eligible when their env keys are truly configured.
2. Use a small TanStack Query hook under `src/composables/queries/`, following current project conventions, with a **module-local stable query key** (e.g. `['llm-capabilities']`). Avoid adding a shared key in `packages/common/src/keys.ts` for this one consumer. If a shared key is later necessary, re-export it from `packages/common/src/index.ts` and run `bun run build --filter=@vela/common` before the web build so Vitest's source alias and production `dist` remain consistent. A failed/missing response means no assumed server fallback.
3. Allow server-fallback providers in the **chat** Default selector, including OpenRouter's custom model. Label server-key availability and the dictionary user-key-only limitation; do not expose server keys to the browser. Preserve the selected model on key deletion.

**Gate:** targeted capability endpoint auth/availability tests and Settings UI tests; `bun --filter vela-api test` and `bun --filter @vela/app test`.

## Task 4 — Optional dictionary thinking override with low fallback (green)

**Files:** `apps/vela/src/services/llm/index.ts`, `pages/dictionary/MyDictionariesPage.vue` and tests; `apps/vela-api/src/validation.ts`, `routes/my-dictionaries.ts` and route tests.

1. Extend `AnalyzeSentenceInput` and `AnalyzeSentenceRequestSchema` with optional `thinking`. The page forwards **only** `selection.thinking`, so ordinary users still omit it.
2. Pass the explicit value to `normalizeLlmRequest`. When provided, use its validated native effort; when absent, keep the current low-if-supported choice, falling back to the registry default. No client-side effort-default computation, cross-provider mapper or new provider adapter work.
3. Preserve dictionary user-key requirement, unchanged SSE metadata/chunk/error/done frames, fixed output budget, abort handling and existing timeout semantics. Rely on existing missing-key UI rather than adding a duplicate dictionary-only key check.
4. Add **two specific route tests**: explicit supported override forwarded; omitted effort runs at low. Reuse existing `normalize.test.ts` for invalid thinking/unsupported-model validation; do not duplicate the same normalizer unit matrix.

**Gate:** `bun --filter vela-api test`, `bun --filter vela-api compile`, `bun --filter @vela/app test` and `bun --filter @vela/app build`.

## Task 5 — End-to-end acceptance on this PR (not a new PR)

- Update `apps/vela/e2e/llm-settings.spec.ts` for the new cards, provider-key isolation, unsaved drafts, an explicit “Default” thinking reset, model pair persistence and default selection that **stays put when a key is removed**.
- Assert Chat POST sends the correct provider/model/key with **only** explicit thinking. Assert Dictionary POST sends the chosen override only when configured; without override backend low remains. Mock LLM responses; do not bill real providers in tests.
- Verify authenticated GET capabilities (Google/OpenRouter), lack of fallback on failed lookup, and truthful missing-key messages. Profile round-trip includes theme/TTS regression observation.
- Run `bun run test`, `bun run lint`, `bun --filter @vela/app build`, `bun --filter vela-api compile`, and affected Playwright E2E where fixtures/credentials exist. Note skipped E2E explicitly; do not claim they passed.
- Manually confirm four cards, Save/clear/reload, default model, Chat and My Dictionaries, TTS and Theme. Never include real keys in logs, tests, screenshots or PR text.
- Check the **latest** HPA-755 ticket description before final acceptance. Stay on **this** PR for all fixes and leave draft/Todo until all requirements are met.

## Acceptance checklist

- [ ] Profile PUT/GET round-trip of `llm`, `darkMode`, and unrelated fields; a bad LLM read cannot make profile GET fail.
- [ ] Per-provider cards isolate saved keys and unsaved drafts; “Default” removes a model's thinking override. Sign-out or a new user without LLM preferences clears in-memory keys and resets the model.
- [ ] Single explicit `{provider,model}` default drives Chat and Dictionary; no ambiguous OpenRouter resolution and no silent auto-reselection.
- [ ] Chat backend uses registry effort if override absent; dictionary defaults low unless explicitly overridden, respecting its ~25-second budget.
- [ ] Capability API accurately advertises **both** server-key providers, but no server key is used in dictionary analysis.
- [ ] Full affected tests/build/lint and available E2E results recorded; Theme/TTS behavior unchanged.
- [ ] All changes and review fixes belong to **this one HPA-755 PR**; do not mark ticket Done for documentation alone.

## Deliberate exclusions and risks

No persistence migration, localStorage mirror, server-key vault, new database, provider SDK changes, new generic settings framework, chat-thread picker/sidebar/cache reminder, TTS model update or speculative error handling. Main risks to verify are **buffered dictionary SSE with 25-second provider deadline** under user-selected high effort, and **global profile GET lockout** if LLM read parsing is not tolerant. Both receive direct tests/checks.

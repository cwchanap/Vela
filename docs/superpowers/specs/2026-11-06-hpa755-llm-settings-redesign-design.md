# HPA-755 — Per-provider LLM Settings and Thinking Defaults (Design)

**Status:** Draft for review; planning only (2026-11-06)  
**Linear:** https://linear.app/cwchanap/issue/HPA-755/redesign-settings-page-with-per-provider-llm-keys-and-thinking  
**Dependency:** HPA-754 is Done; registry/provider adapters landed on `main`.  
**Delivery rule:** one HPA-755 PR for these documents, future implementation, tests, and review fixes. Do not treat the documentation commit as completed functionality.

## Goal and user journey

Users configure Google, OpenAI, Anthropic, and OpenRouter independently from one Settings page. Entering or editing an API key in one card must not alter an unsaved key in any other card. A configured badge makes saved state clear. Every registered model can have a saved native thinking-effort default. A single default model is used for **new** chat messages and My Dictionaries analysis, until a later ticket adds per-thread model selection.

The page has three focused, feature-owned sections: `ThemeSection`, `LlmProvidersSection`, and `TtsSection`. Keep theme and existing TTS behavior unchanged. HPA-757 owns TTS model/voice updates; HPA-756 owns chat sidebar/thread metadata; HPA-758 owns the in-chat picker and cache timer.

## Current code and actual gaps

- `packages/common/src/contracts/llm.ts` already owns `LLM_PROVIDERS` and `LLM_PROVIDER_REGISTRY`. Fixed-model providers have `models: LlmModelInfo[]` with `efforts`/`defaultEffort`; OpenRouter intentionally has `models: null`, a free-form model ID, and no thinking control.
- `apps/vela/src/pages/settings/SettingsPage.vue` has a provider-switching form with one draft key. Its watcher overwrites unsaved input on provider switch.
- `apps/vela/src/stores/llmSettings.ts` already holds a per-provider key map, but persists the old `provider/models/keys` shape (`llm_settings_v1`, `llm_provider`, `llm_models`, `llm_keys`).
- **Blocking bug:** `apps/vela-api/src/routes/profiles.ts` has a `PreferencesShape` whose read/write Zod schemas `.strip()` unrecognized fields. It does not include `llm` (nor the existing `darkMode` field); a frontend-only change would appear to save but lose profile-backed settings on GET. Extend the same read/write shape and test the actual round trip.
- Chat in `apps/vela/src/pages/chat/AIChatPage.vue` currently sends `provider/currentModel/currentApiKey`. The stateless `llmClient.generate` and authenticated `/llm-chat` route **already accept optional `thinking`**; only the caller needs to supply it.
- Dictionary in `apps/vela/src/pages/dictionary/MyDictionariesPage.vue` and `llmClient.analyzeSentenceStream` lacks a thinking parameter; `apps/vela-api/src/routes/my-dictionaries.ts` forces `low` when supported. Add optional `thinking` through the existing request schema and shared normalizer to honor the user default, without changing SSE frames or its required user API key.
- `/llm-chat` allows an authenticated Google server-key fallback; dictionary analysis **does not**. The UI cannot currently detect whether the Google server key is configured.

## State and persistence contract

Use exactly one new optional profile preference:

```ts
interface UserPreferences {
  // existing non-LLM fields remain
  llm?: {
    keys: Partial<Record<LlmProvider, string>>;
    thinking: Record<string, string>; // modelId -> native effort override
    defaultModel: string;              // exact registry ID or OpenRouter ID
  };
}
```

- Retire `llm_provider`, `llm_models`, and `llm_keys` from the application type and save/read code; do not migrate them. Use a new `llm_settings_v2` localStorage mirror (do not consume v1).
- A shared `llmSettings` Pinia store owns only `keys`, `thinking`, `defaultModel`, and derived selectors. No duplicate provider/model registry or general-purpose settings framework.
- Persist the complete `llm` object by merging it into existing profile preferences (do not drop theme/learning preferences). The API's **read and write** Zod preference schemas must accept this nested object and `darkMode`; continue stripping unrelated fields.
- Authenticated profile data is authoritative on load; localStorage is a fast local mirror and bootstrap fallback, not a second independent source of truth. On profile change/account switch, replace the LLM snapshot instead of merging stale keys from another account. Do not leak keys in logs or test fixtures.
- Implement store methods that target a **provider ID** rather than a mutable active-provider field: e.g. `saveProviderSettings(provider, key, modelEfforts)`, `saveDefaultModel(modelId)`, `getModelSelection(modelId)`, `getThinking(modelId)`. Commit a card's buffer only on Save. Return success/failure and do not show “saved” when the profile request fails. Keep the key deletion action explicit (clearing and saving that card removes that provider's key only).
- The `thinking` map stores only **overrides**; absent entries use `model.defaultEffort` from the registry. Ignore invalid/unknown persisted overrides in-memory and let dropdowns select valid native `model.efforts`; do not invent a universal thinking-level mapper. OpenRouter has no thinking dropdown.
- For registered model IDs, resolve their provider from the fixed registry. Otherwise resolve to OpenRouter only when the user configured OpenRouter and supplied a nonempty free-form ID. Do not introduce a model catalog API. Only the current custom OpenRouter **defaultModel** needs to be retained; no per-provider “last model” map.

## Settings UI

1. `ThemeSection.vue`: existing dark-mode toggle and profile-save UI, moved without a redesign.
2. `LlmProvidersSection.vue`: top “Default model” select, then four expandable Quasar cards in `LLM_PROVIDERS` order. Each card keeps its own unsaved key draft, show/hide control, Save, saved-key badge, and fixed provider model rows with native thinking dropdowns. A Save on that card commits **only** that provider's key and effort overrides; another card's drafts and persisted keys are untouched. Render a useful failure message and preserve drafts on an unsuccessful save. The top default selection saves through an explicit store action, with failure feedback.
3. `TtsSection.vue`: extract existing TTS selection, voice, key and mutation behavior verbatim. Do not update voice lists or TTS models in HPA-755.

The default-model selector lists fixed registered models only for providers with saved user keys, plus the Google models when an authenticated server Google key is actually available. OpenRouter is special: show a free-text ID (seeded by the registry default or the current custom default), and allow setting that ID as the global default only when OpenRouter has a saved key. Avoid a new OpenRouter model-list service.

To detect Google chat fallback **without assuming client env state**, add a tiny authenticated `GET /api/llm-chat/capabilities` returning `{ googleServerKeyAvailable: boolean }` from `c.env.GOOGLE_API_KEY`. Return no key value and reuse existing auth. If this check fails, show only locally keyed models, with no speculative server availability. Google chosen via server fallback can work in **chat**, but dictionary analysis still requires a **user-provided** Google key; display an actionable “add a Google key” message rather than introducing dictionary server-key fallback or silently switching models.

If the configured default model is no longer usable after removing a key, choose a valid available registry default in deterministic provider order during that save. If none is usable, keep a registry default as the initial placeholder but surface “configure an API key” to the user; never silently send a different provider than the visible selection.

## Request behavior

- New chat sends a request-time snapshot of `{provider, model, apiKey, thinking}` derived from `defaultModel` and `thinking[modelId] ?? registryDefault`. The backend keeps its own model/effort validation. Do not change history storage, thread table, or chat navigation.
- My Dictionaries uses that same model/provider/key/effort snapshot. Add optional `thinking` to `AnalyzeSentenceInput`, `AnalyzeSentenceRequestSchema`, and the call to `normalizeLlmRequest`; remove the dictionary route's unconditional forced-low override **when thinking is provided**. Keep low as a compatibility-free internal default only for clients that omit thinking if needed, otherwise use the model's registry default; document and test the chosen fallback. Keep its SSE schema, auth, input budget and **user-key-only** rule.
- `/llm-chat` already accepts `thinking`; no new provider SDK work or backend adapter refactor.

## Acceptance criteria

- Four cards render with isolated drafts; saving/clearing one key never overwrites another, including a temporarily unsaved draft.
- Keys, per-model effort, and global default survive profile PUT → GET, browser reload, and provider-card switching. Save failures never report success; existing theme preferences remain intact.
- Dropdowns come from `LLM_PROVIDER_REGISTRY`; unsupported efforts cannot be selected; OpenRouter remains free-form without an invented effort control.
- Chat and dictionary requests include the selected provider/model/key/native thinking effort; dictionary preserves its user-key requirement and SSE completion/error semantics.
- Google fallback is only advertised when the authenticated capability check succeeds. In the no-user-key Google case, chat may use the server key, while dictionary shows a clear setup error.
- Existing TTS interactions and theme behavior remain unchanged; focused store, page, profile-route, dictionary-route, chat/dictionary and E2E tests pass.

## Explicit non-goals and trade-offs

No server-side encrypted key vault, key sharing with TTS, provider registry rework, new DB tables, general settings schema service, legacy preference migration, backwards compatibility layer, chat thread model persistence, cache reminder, in-chat picker or TTS model upgrade. Do not make unrelated CORS or infrastructure changes.

**Risk watch:** profile schema stripping; asynchronous profile load overwriting local drafts; one provider save accidentally replacing other provider keys; Google-only chat fallback vs user-key-only dictionary; OpenRouter `models: null`. These are covered by focused tests, not extra abstractions.

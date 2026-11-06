# HPA-755 — Per-provider LLM Settings and Thinking Defaults (Design)

**Status:** Draft for review; planning only (reconciled 2026-11-06 after [review](https://github.com/cwchanap/Vela/pull/81#issuecomment-6690108759))  
**Linear:** https://linear.app/cwchanap/issue/HPA-755/redesign-settings-page-with-per-provider-llm-keys-and-thinking  
**Dependency:** HPA-754 is Done; reuse the provider registry and backend adapters already on `main`.  
**Delivery:** One HPA-755 draft PR for design, implementation, tests and review fixes. No feature is implemented by this documentation commit.

## Objective and scope

Configure Google, OpenAI, Anthropic and OpenRouter independently on the Settings page. Every provider card holds a local unsaved API key draft and a Save button; committing one card cannot change another's saved key, thinking defaults or unfinished draft. Render registry-native thinking choices per fixed model and one global **Default model** selection for new chat requests and My Dictionaries. Keep theme/TTS functionality the same.

Section components are `ThemeSection`, `LlmProvidersSection` and `TtsSection`. Use a tiny reusable `LlmProviderCard` for the four card instances. HPA-757 owns TTS model updates; HPA-756 owns chat sidebar/thread state; HPA-758 owns per-thread switching and cache reminders.

## Verified implementation seams

- `packages/common/src/contracts/llm.ts` defines `LLM_PROVIDERS`, `LLM_PROVIDER_REGISTRY` and `LlmEffort`; each fixed-model entry already includes `efforts` and `defaultEffort`. OpenRouter has `models: null` and accepts a custom model ID with **no** thinking dropdown.
- `apps/vela/src/pages/settings/SettingsPage.vue` currently overwrites an unsaved API-key draft on provider switch.
- `apps/vela/src/stores/llmSettings.ts` currently persists `provider/models/keys` and merges profile key maps across account changes.
- `apps/vela-api/src/routes/profiles.ts` has GET and PUT preference Zod schemas that strip `llm` **and existing `darkMode`**. A front-end-only Settings change cannot persist them to the profile.
- `apps/vela/src/stores/auth.ts` already has `updatePreferences(partial)`, which merges into existing preferences and updates the local auth user when the write succeeds. Authenticated Settings/Chat/Dictionary routes load a profile: a separate localStorage mirror provides no useful second source of truth and risks keys leaking across account changes.
- Chat's `llmClient.generate` and `/llm-chat` already support optional `thinking`; `normalizeLlmRequest` already validates it and applies the registry default if absent.
- Dictionary's `/my-dictionaries/analyze` requires a **user key** and defaults to `low` effort where supported. It buffers SSE when deployed and has a ~25-second provider deadline; do not silently replace low with a more expensive/slower registry default.
- The authenticated chat route's `SERVER_KEY_ENV` allows server key fallback for **Google and OpenRouter** only; dictionary does not share either fallback.

## Profile contract and validation

Store exactly one optional LLM preference, with an explicit provider/model pair (no runtime model-ID-to-provider resolver):

```ts
interface LlmPreferences {
  keys: Partial<Record<LlmProvider, string>>;
  thinking: Record<string /* modelId */, LlmEffort>; // overrides only
  defaultModel: { provider: LlmProvider; model: string };
}
interface UserPreferences {
  // unchanged learning and theme fields
  llm?: LlmPreferences;
}
```

- The pair is required because OpenRouter's free-form ID can collide with a fixed registry model ID, and a removed fixed model should not accidentally resolve to OpenRouter. Wire requests already carry provider+model together.
- Remove all legacy `llm_provider`, `llm_models`, `llm_keys` usage. No migration or backwards-compatibility branch. **No `llm_settings_v2` localStorage mirror**; do not read the old `llm_settings_v1`.
- Extend the existing profile `PreferencesShape` with `darkMode?: boolean` and an optional nested `llm`. Strictly validate writes so malformed data returns 400, preserving other preference fields. Use Zod 4 `z.partialRecord(z.enum(LLM_PROVIDERS), z.string())` for partial provider keys (not exhaustive `z.record(z.enum(...))`). Use the existing native `LlmEffort` values for the thinking map; define the small Zod enum alongside the profile schema rather than adding another registry.
- **Reads must be resilient:** configure `llm: LlmPreferencesSchema.optional().catch(undefined)` in the read shape. A stale/malformed `llm` subtree is ignored rather than returning profile GET 500 and locking the user out of Settings. This is not a legacy preference migration. Keep the current handling of other preference fields unchanged.
- On sign-in/profile load or user-ID change, **replace** the LLM state with that user's validated profile snapshot or a fresh registry-backed default; never merge previous users' keys.
- Keep keys in the existing profile preference mechanism (security hardening and a server key vault are explicitly outside this hobby-stage ticket). Avoid logging secrets.

## Store and save behavior

One `llm` ref in `useLLMSettingsStore` and one derived `selection`, shaped as:

```ts
selection: {
  provider: LlmProvider;
  model: string;
  apiKey?: string;
  thinking?: LlmEffort; // explicitly saved override only
}
```

- Default selection starts from the registry's Google default model; do not infer provider from model ID or maintain redundant per-provider model selections.
- `saveProvider(provider, key, thinkingPatch)` updates just that provider's key and its fixed models' explicit effort overrides; `saveDefault({provider,model})` updates only the global default. Both reuse `auth.updatePreferences({ llm: next })` and commit locally **only if it returns true**. Failures preserve the UI drafts and never toast “saved.”
- `thinking` is an **overrides-only** map. A row has an explicit “Default” option (no override) plus only its model's allowed native `efforts`. Choosing Default deletes that entry. Initial draft rows must not be filled with registry values and then all persisted on Save. Use registry values for *display* and the backend for default execution.
- `selection.thinking` is just `llm.thinking[selection.model]` (or undefined); no client-side default resolution/getThinking helper. Chat's backend uses the registry default on omission; dictionary's backend keeps low on omission.
- Removing a key **never auto-selects another model or rewrites the default pair**. Keep the selection visible with a “No key for <Provider>” warning; the existing routes also return actionable missing-key errors.
- Only the global default selection persists an OpenRouter custom ID. There is no separate per-provider last-model map.

## Settings UI and capability query

- `SettingsPage.vue` becomes a small composition of `ThemeSection`, `LlmProvidersSection` and `TtsSection`. Extract the existing theme toggle/save UI and TTS provider/voice/key/mutation behavior verbatim, including their tests.
- `LlmProvidersSection` hosts the global Default model select and four permanently mounted (collapsed/expanded) `LlmProviderCard.vue` instances in `LLM_PROVIDERS` order. Every card owns its own `draftKey` and `draftEfforts` local refs, so opening another card cannot discard edits. Each has key show/hide, Save, “Key saved” badge and clear-key behavior. Do not instantiate a generic settings framework.
- Fixed-model cards render each `model.efforts` directly from the shared registry with a “Default” option that clears the stored override. Add a small note: **“High and above may time out in My Dictionaries.”** OpenRouter's card contains **only** its key with “Free-form model IDs; no thinking controls.”
- The Default model selector lists models whose provider has a user key or an available authenticated **chat** server fallback. For OpenRouter choose “OpenRouter (custom ID)” and show the reusable free-text model input **beside the Default select**, not inside the provider card. Validate a nonempty ID on save. An existing default pair remains visible even if it is no longer eligible; show the missing-key warning and do not silently switch it.
- Add `GET /llm-chat/capabilities` under existing authentication, returning `{ serverKeyProviders: LlmProvider[] }`. Derive the array by iterating existing `SERVER_KEY_ENV` and checking whether each corresponding env key is configured. Do not hard-code “Google only,” expose the keys, or add a new credential path. Both Google and OpenRouter server-key-backed models may appear as eligible **chat** defaults.
- Read capabilities through a small TanStack Query composable under `src/composables/queries/`, following the existing query/key conventions. If the request fails, do not assume server availability. **My Dictionaries still requires the user's own key** for both providers: let its existing explicit missing-key error surface, preferably with a Settings hint. Do not add a separate dictionary-only client pre-check or a silent fallback.
- Existing request-time snapshots continue to include `provider`/`model`/`apiKey`. Saving one card does not change other cards, global selection or their unsaved drafts.

## LLM request semantics

| Consumer | `thinking` provided? | Server behavior |
| --- | --- | --- |
| Chat | Explicit saved override | Validate with the existing normalizer, run the chosen native effort |
| Chat | Missing/undefined | Existing normalizer chooses registry `defaultEffort` |
| My Dictionaries | Explicit saved override | New optional `thinking` schema field passed to the normalizer; honor it |
| My Dictionaries | Missing/undefined | Preserve current `low` effort if supported, otherwise registry default |

- Chat only needs to switch to the store's `selection` getter (existing client/bridge accept optional thinking).
- Extend `AnalyzeSentenceInput`, `AnalyzeSentenceRequestSchema`, and `normalizeLlmRequest` call in `routes/my-dictionaries.ts` with optional `thinking`. When provided, use the normalizer's validated effort; when omitted, preserve existing low-effort fallback. Do not touch SSE frame names, authentication, usage normalization, response budgets or provider adapters.
- No client-side mapping of provider effort vocabularies. No chat thread database or cache timer.

## Acceptance

1. Strict PUT then GET retains `llm`, `darkMode` and unrelated preferences; malformed `llm` write returns 400, malformed/stale `llm` read does not 500 the profile; no user account can inherit another's stored keys.
2. All four provider cards preserve other cards' pending drafts while saving only their own key/effort overrides. “Default” clears overrides; a save failure does not show a success state.
3. Global `{provider,model}` persists across reload, including a custom OpenRouter ID, and does not auto-change when a key is cleared. Missing-key state is visible.
4. Chat/dictionary send only explicit stored effort overrides; absent thinking means registry default for chat and low for dictionary. Dictionary preserves its user-key requirement and SSE completion/error semantics.
5. Capabilities show **only** authenticated configured server-key provider identifiers (Google/OpenRouter), and their absence/fetch failure never fabricates availability.
6. Existing theme and TTS behaviors remain unchanged; store, profile route, capability route, chat/dictionary, Settings component and affected E2E tests pass.

## Risks and exclusions

**Primary risks:** ~25-second dictionary provider deadline with buffered SSE (especially explicit high effort); malformed LLM profile data causing a global authenticated-page lockout if `.catch(undefined)` is forgotten; profile update result ignored and keys from another user retained on switch. Test these directly.

Out of scope: server-side vault/encryption, TTS key sharing, migrations, localStorage mirror, hidden model auto-selection, new data services, provider adapters, chat sidebar/per-thread picker/cache reminder, TTS model/voice changes and unrelated API infrastructure work. Keep all implementation/review changes on this one draft PR.

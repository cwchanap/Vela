# HPA-833 — Explicit LLM clears survive preference recovery (design)

**Date:** 2026-11-19  
**Linear:** https://linear.app/cwchanap/issue/HPA-833/carry-explicit-clear-tombstones-in-the-llm-preferences-write-contract  
**Related:** HPA-755 (merged foundation); HPA-824 (separate cross-client reconciliation follow-up)  
**Delivery:** Design, implementation, regressions, and review fixes on **one** draft PR. This first commit is documentation only.

## Goal

A user clearing a saved provider API key or choosing **Default** for a saved model thinking override must not see that value reappear after a successful Settings save—even when a stored `llm.defaultModel.provider` is unreadable and the API's recovery merge preserves recoverable entries.

Preserve untouched recoverable values and the selected default model. Keep normal saves and existing 409 retries working. No new API endpoint, storage table, migration, broad profile rewrite, or change to the visible Settings layout.

## Current behavior verified on `main`

- `apps/vela-api/src/profile-preferences.ts` defines a canonical strict `LlmPreferencesSchema`, tolerant `LlmPreferencesReadSchema`, and `preserveStoredLlm(next, stored)`. When the stored default provider is invalid, it recovers otherwise-valid keys and thinking entries and unions them into the replacement. Absence of a key or override does not reveal whether the user intentionally removed it.
- `apps/vela-api/src/routes/profiles.ts` handles authenticated `PUT /profiles/update`; it validates full preference replacements, reads the existing profile, invokes recovery, then persists via `profilesDB.update`.
- `apps/vela-api/src/dynamodb.ts` **already** enforces `preferences_version` CAS on preference saves; `apps/vela/src/stores/auth.ts` serializes local writes and retries a 409 once by refetching and reevaluating the updater. Do not reimplement HPA-824 in this ticket.
- `apps/vela/src/stores/llmSettings.ts` handles provider saves; empty key deletes `keys[provider]`, while a null/Default effort deletes `thinking[modelId]`. `LlmProviderCard.vue` submits the key and all of its provider's effort drafts. `auth.updatePreferences` sends the resulting `llm` replacement through the existing profile path.
- `apps/vela/e2e/fixtures/syntheticAuth.ts` reuses the API's validators/recovery helper; `apps/vela/e2e/llm-settings.spec.ts` covers Settings UI, 409 retries, and key/thinking saves. `apps/vela-api/test/routes/profiles.test.ts` already tests invalid-default recovery without clears.

## Minimal contract

Use **optional write-only fields inside** `preferences.llm`, not new persisted fields:

```ts
// Existing required fields remain unchanged.
preferences: {
  llm: {
    keys: { google: 'new-key' },
    thinking: {},
    defaultModel: { provider: 'google', model: 'gemini-3.8-flash' },
    removedKeys?: ['openai'],
    removedThinking?: ['gpt-6.1-sol']
  }
}
```

1. Keep `LlmPreferences` in `@vela/common` and canonical `LlmPreferencesSchema` **unchanged**. Introduce a small API-only `LlmPreferencesWriteSchema` extending the canonical shape with optional `removedKeys` (known `LLM_PROVIDERS`) and `removedThinking` (nonempty model IDs of at most 512 characters). Bound the arrays by the existing four-provider count and `MAX_LLM_THINKING_OVERRIDES`; invalid markers return 400. These are one-shot clear instructions, not state.
2. Use a `PreferencesWriteSchema` for `PUT` so parsing does **not strip markers before recovery**. Extract the markers before converting the request back to canonical `PreferencesSchema`. After resolution, `GET`, `PUT` responses, DynamoDB and client Pinia state expose **only** `{ keys, thinking, defaultModel }`. No tombstone persistence.
3. The canonical replacement remains authoritative. If a marker and a value for the same key/model conflict, **clear wins**: delete it from the replacement and the recovered result. If no marker is provided, preserve current recovery behavior.
4. Extend `preserveStoredLlm` with an optional clear-intent argument. On an unreadable stored default provider, recover otherwise-valid entries except explicitly removed keys/model overrides, then apply the replacement and the clear intent. Apply clears even when recovery is skipped (stored record valid, absent, or not an object). Keep the existing 128-entry thinking cap; excluded entries must not consume recovery slots. Unrelated preference writes with `llm` omitted still preserve the raw unreadable subtree untouched.
5. Keep `expected_preferences_version` validation, single-record conditional update, and existing 409 response unchanged. Never bypass CAS to make a clear succeed.

## Client ownership and retry semantics

Capture removals **once, before** calling `auth.updatePreferences` from `llmSettings.saveProvider`:

- If the submitted trimmed key is empty and the authenticated, rendered LLM snapshot has that provider key, set `removedKeys: [provider]`; otherwise omit it.
- For the provider's allowed model IDs, mark a model in `removedThinking` only when the submitted patch says Default/null **and** the rendered snapshot contains a saved override. This matters because `LlmProviderCard` submits all effort rows on every Save; an already-Default row must not count as an explicit clear.
- Hold that intent outside the updater closure and attach it to every generated write snapshot. The updater itself still starts from the latest `current.preferences.llm`, so a 409 refresh/retry can preserve other fields without losing the user's original deletion intent.
- Keep the frontend's canonical `LlmPreferences` snapshot free of marker fields; use a small local write-payload type if needed. No change to `LlmProviderCard` controls or generic dirty-field tracker is required. `saveDefault`, Theme, TTS and unrelated profile saves emit no removal markers.

**Critical retry case:** tab A loads a valid Google key/overridden thinking; tab B changes the stored default provider into an unreadable value and advances `preferences_version`; tab A clears the key and selects Default. First PUT returns 409; retry refetch loses the unreadable `llm` from the *read* view. The stored raw LLM data is still recovered on the server, but must exclude tab A's two explicit removals. Capture the removals before the retry, not by comparing against that refreshed, empty view.

## Visible behavior and failure semantics

- After Save, the cleared provider card displays **No key saved**, the changed model row displays **Default**, and a reload retains those states.
- Valid untouched keys and thinking overrides from other providers/models survive recovery.
- The current default provider/model remains unchanged when clearing an API key.
- A 400 validation error or a final 409 leaves the normal save-failure UI/error path in place; do not show a false success. Existing session-generation cancellation still applies.
- The UI cannot explicitly clear a value that is already invisible because the original GET hid an unreadable LLM subtree. This ticket covers clear actions against values the client actually displayed; do not introduce a recovery-management UI.

## Out of scope

HPA-824's residual cross-tab timestamp/cache reconciliation, an additional conflict-resolution dialog, changing global default selection on key removal, shared preferences redesign, API-key storage migration, mobile-specific UI, and backcompat/migration layers. The existing version CAS and one retry are sufficient for this change.

## Acceptance contract

1. A user clearing a previously visible provider key saves successfully, retains unrelated keys, and sees the key absent after a fresh authenticated GET and page reload.
2. Choosing Default for a previously saved override removes **only** that override; Default rows never edited and untouched overrides survive.
3. The unreadable-stored-default recovery scenario, including one 409 refetch/retry, does not resurrect either explicit clear.
4. `removedKeys` and `removedThinking` never appear in stored profiles, profile GET/PUT responses or the hydrated client store.
5. No-intent saves retain current recovery semantics; malformed clear markers produce HTTP 400 with no update; stale versions still produce 409.
6. Automated API/client unit coverage plus real browser E2E via MCP proves the save → API → reload flow. Since the ticket provides no UI mockup, use MCP screenshots to visually check provider-card key badge and thinking selection at standard desktop and narrow mobile-web widths, with no layout regression. No human acceptance gate.

# HPA-833 — Preserve LLM settings and explicit clears with an invalid stored default provider (design)

**Date:** 2026-11-19; revised 2026-11-20 after [design review](https://github.com/cwchanap/Vela/pull/102#pullrequestreview-5987968921)  
**Linear:** https://linear.app/cwchanap/issue/HPA-833  
**Related:** HPA-755 (merged settings foundation); HPA-824 (separate residual cross-client reconciliation)  
**Delivery:** One [draft PR #102](https://github.com/cwchanap/Vela/pull/102) for design, implementation, tests, and review corrections. This revision is planning only.

## Goal and review decision

A user clearing a saved provider API key or choosing **Default** for a saved model thinking override must not see that value silently reappear after a successful Settings save. Untouched valid values must survive even if the stored `llm.defaultModel.provider` is no longer recognized.

**Accepted reviewer simplification:** do not introduce `removedKeys`, `removedThinking`, or any new wire protocol. The root cause is the **read schema hiding the entire LLM subtree**, which forced a lossy recovery union on the next LLM write. Make reads tolerant of an unknown/missing default provider, so valid keys and thinking entries reach the existing client updater; remove the recovery union entirely. This is smaller, makes previously hidden values accessible, and automatically preserves normal deletion semantics.

## Verified existing seams

- `apps/vela-api/src/profile-preferences.ts` first sanitizes valid `keys` and `thinking`. Today `LlmPreferencesReadSchema` returns `undefined` when `defaultModel.provider` is invalid. `preserveStoredLlm(next, stored)` later unions recoverable saved values into an LLM replacement, reintroducing entries the user intentionally omitted.
- The same read schema already substitutes a registry default **model** when the provider is known but the stored model is invalid.
- `apps/vela/src/stores/llmSettings.ts` defaults to Google when LLM preferences are absent, clones the current LLM snapshot on Save, deletes a blank provider key, and deletes thinking overrides submitted as Default. `LlmProviderCard.vue` submits the current provider's model rows. These behaviors need **no change** once reads expose the valid saved values.
- `apps/vela-api/src/routes/profiles.ts` already validates writes with the strict schema and delegates to `preserveStoredLlm`; `apps/vela-api/src/dynamodb.ts` enforces the `preferences_version` CAS. `apps/vela/src/stores/auth.ts` retries a 409 exactly once after refetch and re-evaluates the updater. Keep these unchanged.
- `apps/vela/e2e/fixtures/syntheticAuth.ts` already imports the API's `PreferencesReadSchema` and `preserveStoredLlm` rather than reimplementing them; retain this reuse.

## Read and write behavior

1. In `LlmPreferencesReadSchema`, if `llm` itself is not a plain object, retain `undefined` (no recoverable object). For an object with a missing, malformed, or unknown `defaultModel.provider`, **return a sanitized LLM subtree** with the valid known-provider keys and valid bounded thinking overrides; set `defaultModel` to `{ provider: 'google', model: LLM_PROVIDER_REGISTRY.google.defaultModel }`. Warn with a field name but never credential contents.
2. For a known default provider, retain the existing model validation and registry-default substitution when the stored model is invalid. Do not use an unrecognized provider's stored model string as the Google default—even if that string passes generic model-ID validation.
3. Reduce `preserveStoredLlm` to the existing `next.llm === undefined` passthrough that keeps the raw stored `llm` on writes that **omit** the `llm` field. Remove the invalid-provider recovery union. A write that **explicitly supplies** valid `llm` is authoritative, with no server-side merging of omitted keys or model overrides.
4. Keep `LlmPreferencesSchema`, `PreferencesSchema`, `PUT /profiles/update`, `GET /profiles`, shared `LlmPreferences`, and the strict validation rules unchanged. No tombstones, data migrations, new API fields, endpoints, database updates on GET, or extra client state.
5. Keep the existing strict `PUT` provider validation. An already-open old-version tab whose `defaultModel.provider` is now unsupported may still receive HTTP 400 **until it reloads**. A fresh GET then supplies a usable Google fallback and its valid keys. Do not add a stale-client compatibility protocol.

### Representative flow

- A profile contains `keys: { google: 'saved-google', openai: 'saved-openai' }`, thinking entries for two valid model IDs, and `defaultModel: { provider: 'retired-provider', model: 'retired-model' }`. Such a record can arise after a provider is removed in a newer release, rollback across differing provider sets, or a direct data edit; **the current API cannot write it**, because PUT rejects unknown providers.
- A fresh **GET** returns both valid known-provider keys and both valid thinking entries, with the default pair substituted to the registry's Google default. GET does not rewrite DynamoDB.
- Settings displays the saved key and applicable thinking choices. Clearing Google and resetting one model's effort to Default removes those entries from the client replacement. **PUT** persists that replacement as sent, preserving untouched OpenAI key/other thinking entry. A subsequent **GET/reload** shows the cleared entries absent and untouched entries still present.
- If a version conflict occurs between otherwise valid clients, the existing 409/refetch/retry flow recomputes the update from the latest, now-complete LLM snapshot. No special marker protocol is necessary. Keep the existing two-tab retry E2E green; do not fabricate an unknown provider through another tab's currently-valid PUT.

**Trade-off:** A future LLM preference write may replace a stored unknown default provider with Google. This matches what the client already displays in that state and does not discard valid recognized keys/overrides. A write omitting `llm` continues to preserve the raw stored subtree unchanged, including an unrecognized default.

## Scope and implementation

The implementation requires changes to `apps/vela-api/src/profile-preferences.ts`, its route tests at `apps/vela-api/test/routes/profiles.test.ts`, and one targeted regression in `apps/vela/e2e/llm-settings.spec.ts`. Update the historical HPA-755 design note so its formerly correct unknown-provider read behavior no longer contradicts HPA-833. No client store, auth store, route, shared registry, fixture, or UI layout refactoring.

## Acceptance contract

1. API GET of a plain-object LLM subtree with an unknown/missing default provider preserves known, valid provider keys and bounded thinking entries while substituting **Google plus its registry default model**. Invalid individual key/thinking entries are still sanitized. A non-object LLM still reads as absent. GET performs no DB update.
2. Explicit LLM PUT after reading the sanitized profile does not merge back any intentionally omitted provider key or model override; untouched values survive, and the default remains Google when clearing a key.
3. A preference PUT without `llm` continues to retain the raw stored LLM subtree; strict invalid-provider PUT validation and existing CAS 409 behavior stay intact. The separate existing 409 retry regression remains green.
4. MCP-driven browser E2E using the existing mocked Playwright setup exercises **seed invalid default → fresh Settings load → clear one key and choose Default for a saved override → Save → reload** and checks both the cleared and preserved values. This is one E2E acceptance flow, not a duplicate standalone MCP test.
5. The ticket has no UI mockup. Capture **one screenshot during that same MCP E2E** showing the expanded provider card, **No key saved**, and the **Default** thinking value at a narrow viewport (e.g. 375px); visually check readability and no clipping. No separate visual-testing suite or human approval gate.

## Deliberate exclusions

Tombstones/write-contract extension, changing `preferences_version` CAS or cross-client timestamp reconciliation (HPA-824), extra mocks or Playwright fixtures, generic recovery framework, new UI, migrations, mobile-only checks, artwork, and an additional PR.

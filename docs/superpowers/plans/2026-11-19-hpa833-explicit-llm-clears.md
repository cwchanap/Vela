# HPA-833 — Explicit LLM clear intent (single-PR implementation plan)

**Date:** 2026-11-19  
**Linear:** https://linear.app/cwchanap/issue/HPA-833/carry-explicit-clear-tombstones-in-the-llm-preferences-write-contract  
**Design:** [HPA-833 design spec](../specs/2026-11-19-hpa833-explicit-llm-clears-design.md)  
**Base:** `main`, inspected at `a103cef92f454da999ad24a8f967100262922eea`  
**Delivery:** This **same draft PR** holds the design now, and implementation/tests/review fixes later. No second PR or intermediate ticket for implementation. Do not mark HPA-833 Done for a docs-only submission.

## Why this is next

HPA-833 is an unblocked Vela backlog child of completed HPA-755. It is a narrow correctness bug in the existing recovery merge. HPA-824 is a separate, broader cross-client reconciliation backlog item; its original description predates the already-merged `preferences_version` DynamoDB CAS, so re-evaluate that item separately rather than rebuilding locking here.

## Planned file map

**Current documentation-only PR adds**

- `docs/superpowers/specs/2026-11-19-hpa833-explicit-llm-clears-design.md`
- `docs/superpowers/plans/2026-11-19-hpa833-explicit-llm-clears.md`

**Implementation changes on this same PR**

- `apps/vela-api/src/profile-preferences.ts` — optional write-only schema/clear intent and recovery filtering
- `apps/vela-api/src/routes/profiles.ts` — accept markers, apply recovery, persist canonical preferences only
- `apps/vela-api/test/routes/profiles.test.ts` — API integration regressions with existing mocked DynamoDB
- `apps/vela/src/stores/llmSettings.ts` and `apps/vela/src/stores/llmSettings.test.ts` — capture/emit explicit intent once
- `apps/vela/src/stores/auth.test.ts` — verify 409 retry preserves intent without contaminating saved profile state
- `apps/vela/e2e/fixtures/syntheticAuth.ts` — mirror the API write contract and stripping rule
- `apps/vela/e2e/llm-settings.spec.ts` — browser end-to-end and visual checks

Modify `LlmProviderCard.vue` or its tests **only if** current card submission proves insufficient for intent capture. Do not change `packages/common/src/contracts/llm.ts`, backend DynamoDB table/CDK, routing, mobile app, or unrelated settings.

## Task 0 — Baseline and repro (no product changes)

1. Recheck the current Linear description/status, the `main` head, and whether this ticket already has an implementation PR. HPA-833 is still Backlog and no dedicated branch/PR was found when preparing this plan.
2. Read `preserveStoredLlm`, `UpdateProfileSchema`, `llmSettings.saveProvider`, `auth.updatePreferences` 409 retry, `LlmProviderCard.save`, and the synthetic E2E profile mock. Keep the existing CAS and session-generation fencing.
3. Record a failing API regression: stored `defaultModel.provider='unknown'` with recoverable Google/OpenAI keys and two recoverable thinking overrides; client sends a valid replacement omitting one key and override plus matching explicit removal markers. The current merge would restore them.
4. Run focused existing API, LLM store/auth, and Settings E2E tests and record baseline results. Do not treat a docs-only branch as implementation verification.

**Gate:** Repro fails for the intended resurrection, while the existing no-marker recovery test still documents the desired preservation behavior.

## Task 1 — Strict transient write contract and recovery

**Files:** `apps/vela-api/src/profile-preferences.ts`, `apps/vela-api/src/routes/profiles.ts`, `apps/vela-api/test/routes/profiles.test.ts`

1. Keep persisted `LlmPreferencesSchema` and `@vela/common` `LlmPreferences` unchanged. Add `LlmPreferencesWriteSchema` and `PreferencesWriteSchema` to accept optional `removedKeys: LlmProvider[]` and `removedThinking: string[]`. Validate against known providers, model-ID bounds, and existing provider/override caps. Reject malformed markers with 400 before any database update.
2. Update `PUT /profiles/update` to parse the *write* schema first. Extract the clear markers, convert to canonical `PreferencesSchema`, then call `preserveStoredLlm(next, stored, clearIntent)`. Do not run canonical `PreferencesSchema` first and silently strip clear intent. Keep `expected_preferences_version`, 428/409 behavior and the single DynamoDB conditional update unchanged.
3. Apply requested clears to the replacement even with a valid/no stored LLM, and exclude those entries from recovery when stored default provider is unreadable. Clear wins over an accidentally simultaneous positive value. Retain untargeted recoverable keys/model overrides and the current 128-item cap; preserve raw unreadable `llm` for unrelated preference writes.
4. Persist and return **only canonical LLM fields**; the request-only `removedKeys`/`removedThinking` must never reach DynamoDB or GET/PUT responses. Do not log key values.
5. API tests: key removal; thinking reset; both together; untouched recoverable entries; contradictory marker/value clear-wins; omitted markers preserve existing behavior; unrelated preference update preserves raw unreadable LLM; ordinary stored-valid case; marker validation; CAS 409 remains enforced. Assert full saved object to prove no metadata persistence.

**Gate:** Focused `bun test test/routes/profiles.test.ts` from `apps/vela-api`, then `bun --filter vela-api compile` and `bun --filter vela-api test` are green.

## Task 2 — Capture client clear intent exactly once per Save

**Files:** `apps/vela/src/stores/llmSettings.ts`, `apps/vela/src/stores/llmSettings.test.ts`, `apps/vela/src/stores/auth.test.ts`

1. In `saveProvider`, snapshot the current rendered `llm.value` and submitted trimmed key/allowed-model thinking patch **before** invoking `auth.updatePreferences`. Mark a key cleared only when an existing visible key becomes blank; mark an override removed only when a present saved override is submitted as Default/null. Do not mark every already-empty key or Default row.
2. Compute immutable `removedKeys`/`removedThinking` once outside the updater closure. In each updater invocation, continue to rebuild the canonical replacement from the latest profile to keep unrelated changes, then attach the same transient intent to the write payload. Do not put markers into Pinia `llm.value` or shared `LlmPreferences`.
3. Keep `saveDefault` and other preference saves free of removal markers. Leave the UI draft editing, save buttons/toasts, and default model selection unchanged.
4. Test: clearing one provider key has exactly one marker; resetting one override to Default has exactly that model ID; saving another provider/untouched Default rows has no markers; a 409 refetch where the newly fetched `llm` is omitted still resends original markers on the retry. Test successful acknowledgment, account/session switch, and failure do not leak marker fields into the client state.

**Gate:** Focused `llmSettings.test.ts` and `auth.test.ts` pass; `bun --filter @vela/app test` and `bun --filter @vela/app build` pass.

## Task 3 — Browser E2E through MCP and regression screenshots

**Files:** `apps/vela/e2e/fixtures/syntheticAuth.ts`, `apps/vela/e2e/llm-settings.spec.ts`

1. Make synthetic profile PUT use the **same** write-schema + recovery + marker-stripping helpers as the API; its captured `lastPut()` retains the raw *request* for assertions, but the profile map stores only canonical preferences. Preserve synthetic 400/409/428 behavior.
2. Add a deterministic browser scenario: seed visible Google key plus a registered model's high thinking override and an unrelated Anthropic key/override; load Settings; mutate the mock stored default provider to `unknown` and advance its `preferences_version` before user Save. Clear Google key and choose Default thinking. Assert the first PUT gets 409, the retry is successful and still carries both markers, and the resulting mock stored profile excludes only the cleared values.
3. Reload the Settings page, assert **No key saved** and **Default** for cleared entries, while unrelated key/override and default pair remain intact. Check a normal provider Save and a Default-only save emit no unintended markers. Assert profile GET/read and Pinia snapshot contain no tombstone fields.
4. Run the existing Playwright mocked suite for this file. For **end-to-end acceptance**, use the connected browser/Playwright MCP against the runnable web app with synthetic auth to drive the actual click → PUT → retry → GET → reload flow; inspect network payload/status and saved state. The single web client is sufficient because this change has no platform-specific mobile UI.
5. The ticket has **no UI mockup**. Capture MCP screenshots at **1280 × 800** and **375 × 812**, with the affected provider card expanded and cleared/Default state visible. Visually inspect screenshots alongside the prechange Settings layout: badge and effort state must be readable; no clipped controls, overlapping elements or horizontal page overflow. Record screenshot evidence on this PR. Tests assert the intended state; this is not a human sign-off criterion.

**Gate:** Mocked Playwright `llm-settings.spec.ts` green, plus MCP browser end-to-end scenario and screenshot check green. Do not claim this gate during docs-only planning.

## Task 4 — Complete all checks and review in this PR

1. Run `bun --filter vela-api test`, `bun --filter vela-api compile`, `bun --filter @vela/app test`, `bun --filter @vela/app lint`, `bun --filter @vela/app build`, and targeted `cd apps/vela && bunx playwright test --config playwright.mocked.config.ts e2e/llm-settings.spec.ts`. Re-run affected CI gates as needed.
2. Review actual changed files for accidental marker persistence, 409 retry loss, overwrite of unrelated provider settings, and extra infrastructure. Check that the implementation still matches the latest HPA-833 description and these docs.
3. Address valid review findings **in the same PR**, keep draft until code/tests/screenshots are actually complete, then report completed gates with evidence. No implementation split PR, manual acceptance requirement, or speculative compatibility layer.

## End-to-end acceptance checklist

- [ ] **User behavior:** Clearing a saved key and resetting a saved effort to Default succeeds and survives reload; unrelated settings survive, the default model pair does not change, and the correct Settings labels are displayed.
- [ ] **API integration:** `PUT /profiles/update` honors explicit markers during unreadable-default recovery, persists no markers, and `GET /profiles` returns the canonical cleared state.
- [ ] **Concurrency:** 409 → refetch → retry preserves the original clear intent; stale-version writes never bypass the existing CAS, and terminal failures do not toast success.
- [ ] **Validation:** Missing markers retain existing behavior; malformed markers get 400 without writes; no-intent saves do not erase hidden entries.
- [ ] **Automated tests:** API unit/integration, store/auth tests, mocked Playwright E2E, app build/lint, and API compile pass.
- [ ] **MCP E2E:** A browser MCP run verifies the full Settings → profile PUT/409 retry → subsequent GET → reload journey. No stubbed-only unit test substitutes for this gate.
- [ ] **Visual check:** MCP screenshots at desktop and 375px verify the unchanged Settings layout, the **No key saved** badge, the **Default** selection, and no clipping/overflow, with PR evidence linked. No human approval is an acceptance criterion.

## Deliberate exclusions

No change to DynamoDB versioning, extra endpoint, migration, new state-management layer, generic field tombstone framework, recovery-management UI, new artwork, or mobile platform changes. HPA-824 remains a separate backlog decision.

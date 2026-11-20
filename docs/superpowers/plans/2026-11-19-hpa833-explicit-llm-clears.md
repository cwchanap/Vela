# HPA-833 — Preserve LLM clears by fixing invalid-provider reads (single-PR plan)

**Date:** 2026-11-19; revised 2026-11-20  
**Linear:** https://linear.app/cwchanap/issue/HPA-833  
**Design:** [Revised design](../specs/2026-11-19-hpa833-explicit-llm-clears-design.md)  
**Review:** https://github.com/cwchanap/Vela/pull/102#pullrequestreview-5987968921  
**Base inspected:** `main` at `a103cef92f454da999ad24a8f967100262922eea`  
**Delivery rule:** Design, implementation, test evidence, and review fixes on **this one draft PR #102**. Do not open a second implementation PR or mark the ticket Done while docs-only.

## Decision after review

**Accept the review's root-cause simplification.** No `removedKeys` / `removedThinking` fields or write-contract change. A read of a plain-object `llm` with unknown default provider must still return the valid saved key and thinking maps. Substitute the existing Google default pair; delete the obsolete union-based recovery path. The existing `llmSettings.saveProvider` already deletes clear keys and Default overrides from a cloned snapshot; once GET exposes that snapshot, normal PUT replacement handles explicit removal.

Keep the DynamoDB `preferences_version` CAS, current single 409 retry, strict PUT validation, untouched raw LLM passthrough on writes omitting `llm`, and shared synthetic-API helpers. HPA-824 stays separate.

**Realistic trigger:** A stored unknown provider can result from provider removal between releases, rollback across different provider sets, or direct DB edits. It **cannot** be written by a second tab through today's PUT schema. An old open tab may still receive 400 until it reloads; this is not solved by tombstones and remains out of scope. Seed an invalid stored provider **before a fresh GET** in tests, rather than manufacturing a mid-session 409 from a currently-valid PUT.

## Minimal change map

**Existing planning docs revised on this PR:**
- `docs/superpowers/specs/2026-11-19-hpa833-explicit-llm-clears-design.md`
- `docs/superpowers/plans/2026-11-19-hpa833-explicit-llm-clears.md`

**Implementation work in this same PR:**
- `apps/vela-api/src/profile-preferences.ts`: known-valid entries survive a malformed/unknown default provider on GET; remove the recovery union
- `apps/vela-api/test/routes/profiles.test.ts`: update old recovery expectations and add the clear/regression test
- `apps/vela/e2e/llm-settings.spec.ts`: one fresh-load Settings save/reload regression, alongside existing two-tab retry case
- `docs/superpowers/specs/2026-11-06-hpa755-llm-settings-redesign-design.md`: amend the previous read-policy statement to link to this later correction

**Unchanged:** `apps/vela-api/src/routes/profiles.ts`, `apps/vela-api/src/dynamodb.ts`, `apps/vela/src/stores/llmSettings.ts`, `apps/vela/src/stores/auth.ts`, `apps/vela/e2e/fixtures/syntheticAuth.ts`, common contracts, Settings components, API/DB schema. Expand only if implementation reveals an actual blocker.

## Task 0 — Baseline and precise reproduction

1. Confirm latest HPA-833 ticket and the active PR base; use `main` source to verify the read schema's invalid-default `return undefined`, the later recovery union, and the client's existing clone-and-delete behavior.
2. Create a test fixture with stored `llm.keys` containing Google and OpenAI (both valid) and `llm.thinking` containing two valid model overrides, but `defaultModel.provider='retired-provider'`. This is a legacy/unknown stored record, **not** a successful PUT from a current client.
3. Show that current GET hides the entire `llm` subtree. Record the existing test expectations at `apps/vela-api/test/routes/profiles.test.ts` around the unreadable-default and recovery cases. Run focused existing profile route and Settings E2E tests where feasible before changing runtime code.

**Gate:** Repro shows hidden valid keys on fresh GET; baseline tests and existing 409 behavior are documented. No implementation is implied by this design-only commit.

## Task 1 — Tolerant GET, no recovery merge

**Files:** `apps/vela-api/src/profile-preferences.ts`, `apps/vela-api/test/routes/profiles.test.ts`

1. In `LlmPreferencesReadSchema`, keep non-object `llm` returning `undefined`. If `defaultModel` is missing/not an object, or its `provider` is unknown, warn without values and substitute the **whole** default pair `{provider:'google', model:LLM_PROVIDER_REGISTRY.google.defaultModel}`.
2. For a known provider, leave the current fallback for a malformed `defaultModel.model` intact. Preserve the existing per-entry key/effort sanitization and 128-entry thinking cap; do not preserve an unknown provider's model string as Google's default.
3. Reduce `preserveStoredLlm(next, stored)` to: if the stored preferences contains `llm` and the next replacement **omits** `llm`, carry the raw stored value forward. Otherwise, never union raw/recovered keys or thinking entries into an explicit replacement. Keep the function exported so the route and synthetic fixture continue using it unchanged.
4. API tests:
   - Flip the old invalid-provider GET case: instead of `llm===undefined`, assert sanitized keys/efforts remain and the default pair is Google. Also test a **missing defaultModel** object. GET must not write.
   - Keep the existing **non-object** `llm` case reading absent; invalid entries still sanitize.
   - Replace the old test asserting a recovered union with an explicit LLM PUT that stores the replacement **exactly as sent**; absent keys/overrides stay absent, untouched values remain.
   - Add end-to-end route-level GET → replacement PUT regression using a stored unknown provider: confirm Google key and a model effort deliberately omitted after read stay deleted, OpenAI key and another override stay present, and the selected Google default pair remains stable.
   - Preserve raw unreadable `llm` when `PUT` omits the entire `llm` field; current strict unknown-provider request still returns 400; stale `preferences_version` still returns 409.

**Gate:** `cd apps/vela-api && bun test test/routes/profiles.test.ts`, `bun --filter vela-api compile`, and relevant API CI checks pass.

## Task 2 — One browser E2E plus one screenshot check

**File:** `apps/vela/e2e/llm-settings.spec.ts`

1. Add **one** Playwright scenario to the existing mocked settings spec: seed a user profile with an unknown stored default provider, visible recoverable Google/OpenAI keys, and two valid thinking overrides. Stage the authenticated session and **freshly load** Settings. This must show the Google key (not an empty card) and the model's saved effort.
2. Clear the Google key, choose Default for one saved model override, press Save, and assert a successful `PUT /profiles/update` with a canonical `llm` replacement **without** those entries and **without tombstones**. Confirm the mock profile uses the API's imported read/recovery helper, not a copy. Do not modify the mock to generate a 409 by injecting an invalid provider during a live tab's save.
3. Reload Settings and check **No key saved**, the affected thinking row **Default**, the untouched OpenAI key, an untouched thinking override, and the chosen Google fallback default. The existing two-tab 409/refetch/retry E2E must remain green; no new special retry test is needed.
4. **MCP acceptance:** use a Playwright/browser MCP run of this actual UI E2E as the single end-to-end gate (seed → Settings GET → clear → PUT → reload/GET), with API payload/status and persisted mock state asserted. No second, duplicate manual browser walkthrough or native/mobile acceptance.
5. No UI mockup exists and no UI component changes are planned. During this **same MCP run**, capture **one screenshot** of the expanded card at ~375px showing **No key saved** and **Default**. Visually check legibility, no clipped selector, and no horizontal overflow. Record the screenshot result in the PR; no separate visual regression suite or human sign-off.

**Gate:** The new Playwright E2E plus the existing two-tab case pass through MCP, and the same run's screenshot visual check passes. Do not claim this gate on the current docs-only PR.

## Task 3 — Final quality gates and review

1. Execute `bun --filter vela-api test`, `bun --filter vela-api compile`, `bun --filter @vela/app test`, `bun --filter @vela/app lint`, and `bun --filter @vela/app build` (or the repository's affected CI gates). Run targeted Settings E2E with `cd apps/vela && bunx playwright test --config playwright.mocked.config.ts e2e/llm-settings.spec.ts` via MCP if the MCP adapter executes the test runner.
2. Check that no runtime write-schema, storage, UI, fixture or auth changes crept in; confirm the read warning contains only field names, the explicit PUT no longer recovers deleted entries, and no old HPA-755 documentation claim conflicts with the corrected behavior.
3. Address any new valid GitHub comments in **this same PR**. Keep it draft until implementation, all automated/MCP gates and screenshot evidence are actually complete.

## End-to-end acceptance checklist

- [ ] **API GET:** An unknown/missing stored default provider on a plain-object `llm` produces the Google registry default **without losing recognized valid keys or thinking entries**; a non-object LLM remains absent and GET has no DB writes.
- [ ] **API PUT:** After a fresh GET, clearing one visible key and resetting one override persists their absence without resurrecting either; untouched keys/efforts remain; explicit `llm` replacement is authoritative.
- [ ] **Other preference behavior:** A PUT omitting `llm` retains the raw stored subtree, strict invalid-provider PUT validation remains 400, and existing `preferences_version` CAS/409 retry continues working.
- [ ] **MCP E2E:** An authenticated Playwright MCP flow drives Settings load → edits → PUT → reload/GET, asserting the cleared and retained fields and the UI labels, plus the existing two-tab 409 regression.
- [ ] **Visual check:** A narrow-viewport screenshot captured within that E2E is checked against the current Settings layout for readable **No key saved**/**Default** state and absence of clipping/overflow; no ticket mockup and no human acceptance.
- [ ] **Automated gates:** Profile route tests, API compile/tests, app test/lint/build and the targeted mocked Settings E2E pass. Record exact commands/results on PR #102.

## Deliberate deferrals

No tombstones, write-schema changes, migration, generic recovery framework, new API endpoint, extra client state, cross-client optimistic-lock redesign (HPA-824), duplicate browser tests, new UI, or art/SFX work. All changes in one PR.

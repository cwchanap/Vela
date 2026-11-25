# HPA-824 — Single-PR implementation plan

**Date:** 2026-11-21  
**Linear:** https://linear.app/cwchanap/issue/HPA-824  
**Design:** [HPA-824 cross-client reconciliation design](../specs/2026-11-21-hpa824-cross-client-profile-reconciliation-design.md)  
**Base:** `main` as inspected 2026-11-21, including the HPA-833 LLM read/write fence.  
**Delivery:** **One PR for this entire ticket.** This draft starts with the two planning documents; add the implementation, tests, screenshots and review fixes to this *same* branch/PR. Do not create a second PR or mark Done while docs-only.

## Scope correction from current main

The original issue text predates the current implementation. **Do not add a `version` counter, new CAS, new 409 route, or another retry mechanism.** Current code already uses `preferences_version` UUID CAS, 428/409 handling, serialized same-session mutations and one conflict refetch/replay. The remaining work is client-side correctness for overlapping writes, newer deletes, and stale cached profile reads.

## Task 0 — Preserve and reproduce the baseline

- Inspect the current `apps/vela/src/stores/auth.ts` store paths: `diffToFingerprint`, `registerAcknowledgedProfile`, `loadUserProfile`, `updateProfile`, and `updatePreferences`.
- Preserve `apps/vela-api/src/dynamodb.ts`'s conditional `UpdateCommand`, `ConsistentRead: true` and the `apps/vela-api/src/routes/profiles.ts` 428/409 contract unchanged.
- Read the existing tests in `apps/vela/src/stores/auth.test.ts` around 409 replay, superseded versions, delayed reads and same-version handling, and `apps/vela/e2e/llm-settings.spec.ts`'s first two-tab test. Reuse, do not duplicate, the passing disjoint-key E2E.
- Add **failing unit tests first**, using existing mock service responses: (a) another client overwrites the same leaf before the retry; (b) another client clears an acknowledged key with a new version but equal/older timestamp; (c) a cached same-fingerprint profile carries stale unrelated preference values.
- Record the expected baseline failures in the PR body; do not call the tests passing during planning.

**Gate:** Each new test fails for the intended existing behavior, without changes to the backend mock contract.

## Task 1 — Avoid a silent overwrite on 409

**Files:** `apps/vela/src/stores/auth.ts`, `apps/vela/src/stores/auth.test.ts`.

1. At the start of a queued `updateProfile` preference mutation, capture the version, current preference baseline and intended outcome. Reuse `diffToFingerprint` / JSON-equality and deletion semantics to identify exactly the changed preference leaves; `llm.defaultModel` remains atomic.
2. On a 409, use the already-existing direct `authService.getUserProfile` refetch. Compare only the attempted leaves against their baseline values in the fetched profile. If the other client modified any attempted leaf to a different value, **do not retry PUT**. Synchronize the store/cache to the fetched profile, set the conflict message, return `false`, and leave component-local unsaved drafts intact.
3. For disjoint changes, re-run the existing functional updater on the refreshed snapshot and retry **at most once**. Snapshot-style nested replacements must not replay stale fields; if safe changed-leaf rebasing is not possible, fail clearly rather than merging a stale subtree.
4. Continue to reject unsafe LLM replays without the response's `preferences_read_contract`. Preserve session-generation guards, invalidation and no-cross-account writes.
5. Unit tests: same provider key edit/edit and edit/delete; different provider keys; different thinking model IDs; atomic default-model collision; same remote desired value; final 409 on the only retry; sign-out/account switch during the conflict.

**Gate:** No second PUT on overlap; disjoint path still gets one 409 then 200; user never sees a positive "Saved" toast on failure.

## Task 2 — Reconcile acknowledged saves against authoritative reads

**Files:** `apps/vela/src/stores/auth.ts`, `apps/vela/src/stores/auth.test.ts`.

1. Isolate reconciliation from unproven TanStack Query cached data: when verifying a tracked local acknowledgment or recovering after a save/conflict, use a direct API GET; keep the ordinary initial-load cache path where no cross-client freshness decision is being made.
2. Capture acknowledgment identity/epoch at the start of a GET. A late response that started before a newer local acknowledgment cannot undo that acknowledged state. Preserve existing session-generation checks and `supersededPreferencesVersions`.
3. Compare `preferences_version` first: reject known superseded versions, never allow a same-version response that lacks an acknowledged change, and accept a different unseen version from an authoritative **post-ack** network GET even if `updated_at` is equal/older and it clears a tracked leaf. No ordering of UUID strings.
4. Continue to preserve the `preferences_read_contract` belonging to whichever *actual profile* wins reconciliation; do not copy metadata from a discarded response or reauthorize incomplete LLM snapshots.
5. Unit tests with deterministic request completion order: newer remote delete with timestamp tie/skew; stale cached profile that covers the fingerprint but has an old unrelated field; delayed old-version response after local save; unrelated progress timestamp advancing before an acknowledged preference save; newer remote version preserving unrelated changes.

**Gate:** Every accepted remote profile is demonstrably authoritative or an acknowledged local version; neither stale cache nor timestamp ordering can suppress a newer clear.

## Task 3 — Browser-level acceptance through the existing runner

**Files:** `apps/vela/e2e/llm-settings.spec.ts`, optionally `apps/vela/e2e/fixtures/syntheticAuth.ts` for a narrowly scoped deterministic response hook.

1. Reuse `apiMock`'s existing in-memory profile map, `preferences_version` CAS and two-tab fixture. Keep the existing "rebases a stale tab save without losing another tab's provider key" test passing.
2. Add **one overlapping-edit Playwright scenario**: both tabs load the same account; tab A changes/saves Google; tab B edits/saves Google from stale state; assert B receives 409, does **not** issue a retry PUT, shows a negative conflict notification, retains its unsaved key draft, and the server still has A's value. A deliberate subsequent Save from B's freshly loaded state may now succeed, proving no permanent lockout.
3. Add a remote-clear regression either to this test or the smallest existing E2E flow where the client reloads and the cleared key stays absent. Do not manufacture a second test framework.
4. With no UI mockup, run the Settings view at approximately **375px** wide and capture **one evidence screenshot** while the conflict notification and unsaved draft are visible. Store under the existing Playwright `.artifacts/pw-mocked-*/results/` upload directory, not a new checked-in visual fixture.
5. Run `cd apps/vela && bun run test:e2e:mocked -- e2e/llm-settings.spec.ts`. This is the actual Playwright Test process hosting the synthetic auth fixture. A separate interactive browser MCP session cannot attach to that in-process mock; **verify the GitHub Actions `mocked-settings` job and uploaded result/screenshot artifact via GitHub MCP** after the implementation push.

**Gate:** Both disjoint and overlapping two-tab E2E cases pass; the screenshot is inspected via MCP for visible error text, editable unsaved draft, readable layout and no clipping or horizontal overflow. One web platform is enough; no native acceptance or human sign-off.

## Task 4 — Quality and completion

- Run `cd apps/vela && bun run test:unit -- src/stores/auth.test.ts` (or the repo's equivalent Vitest filter), followed by `bun --cwd=apps/vela run test:unit`, `bun run lint`, and `bun run build` on the implementation branch.
- Run the existing API route and DynamoDB regression tests: `cd apps/vela-api && bun test test/routes/profiles.test.ts test/dynamodb.test.ts`. No API changes are expected; this guards against cross-layer drift.
- Run the full targeted mocked Settings Playwright E2E above. On the PR, use GitHub MCP to inspect CI `mocked-settings` completion, logs and artifacts; **the code and the uploaded screenshot must be checked, not merely a green summary badge**.
- Confirm LLM complete-snapshot/write-fence behavior (HPA-833), no leaked API keys in logs, no API or DB migrations, and correct session/account isolation.
- Review latest GitHub comments and address valid findings on **the same PR**. Update this plan if review changes the design. Only after implementation, automated tests, GitHub MCP E2E + screenshot inspection pass should the PR be marked ready and HPA-824 be moved to Done.

## End-to-end acceptance checklist

- [ ] **Concurrent distinct settings:** two tabs' non-overlapping provider/model edits both persist after exactly one 409/refetch/retry for the stale tab.
- [ ] **Concurrent overlapping settings:** second tab's different same-leaf edit cannot silently overwrite first tab's committed edit; it receives a visible conflict, keeps the draft, and can explicitly resubmit against the current state.
- [ ] **Delete/timestamp:** a newer, strongly consistent server profile removing a key/override replaces the local acknowledged state even with equal or earlier `updated_at`. Known superseded or delayed reads cannot restore the cleared value.
- [ ] **Cache lag:** a stale cached profile that covers a local fingerprint but has older unrelated preference values is never preferred over a confirmed current server profile.
- [ ] **Backend/contract regression:** `preferences_version` conditional PUT, 409/428, no unsafe LLM replay, and existing API unit/route tests remain green; no new schema, endpoint or compatibility handling.
- [ ] **MCP-verified browser E2E:** real Playwright runs inside CI with the synthetic-auth fixture, and GitHub MCP confirms passing tests, the expected two-tab request sequence, and uploaded artifacts.
- [ ] **Visual evidence:** one inspected ~375px Settings screenshot from that E2E shows readable conflict feedback and the preserved draft without clipping/overflow.
- [ ] **Delivery:** one PR only; implementation, tests, review fixes, automated gates and evidence complete before ready-for-review/Done.

## Explicitly deferred

No timestamp-to-sequence migration, extra DynamoDB version field, multi-field transactional merge engine, realtime cross-tab broadcast, websocket syncing, conflict-resolution modal, network state machine, generic profile repository, new visual assets, or native device check.

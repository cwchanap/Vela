# HPA-824 — Cross-client preference reconciliation (design)

**Date:** 2026-11-21  
**Linear:** https://linear.app/cwchanap/issue/HPA-824  
**Parent:** HPA-755 (Done); HPA-833 is also Done.  
**Base:** Current `main` inspected 2026-11-21.  
**Delivery:** One draft PR containing this design, the implementation plan, and later all code/tests/review fixes. No follow-up implementation PR.

## Problem and current baseline

The issue's original "add DynamoDB optimistic locking" request is **already implemented** on `main`; do not implement it twice:

- `apps/vela-api/src/dynamodb.ts` uses a `preferences_version` UUID and conditional `UpdateCommand` for preference replacements, with a strongly consistent profile GET.
- `apps/vela-api/src/routes/profiles.ts` requires `expected_preferences_version`, returns 428 for unversioned preference writes and 409 for failed conditions.
- `apps/vela/src/stores/auth.ts` queues same-session preference writes, refetches after 409 and retries once. The `llmSettings.saveProvider/saveDefault` updaters derive changes from the refreshed state.
- `apps/vela/e2e/llm-settings.spec.ts` already proves two tabs can save **different** provider keys using one 409/refetch/retry.

Remaining risk is the client **reconciliation policy**, not missing storage CAS:

1. After 409, replaying an edit to a setting that another client also changed may silently overwrite that other client's value.
2. `loadUserProfile` uses `updated_at` and an acknowledged fingerprint to classify reads. A newer preference version that **clears** a tracked key can be discarded when `updated_at` ties or is earlier (e.g. near-simultaneous requests). A changed preference version must not be treated as older merely because the API-generated timestamp is lower.
3. A TanStack Query cached profile that happens to cover the fingerprint can still contain old values for unrelated fields. Coverage is not proof that this is a newly read server snapshot.

## Desired behavior

- **Disjoint concurrent edits:** Keep the existing one-time 409 retry. For example, tab A saves Google and tab B saves OpenAI; the final server profile contains both. Evaluate functional updaters against the newly fetched profile.
- **Overlapping concurrent edits:** If another client changed one of the exact preference leaves this save intended to modify, do not silently replay a different value over it. Refetch the current profile, return a failed save, and show the existing negative Settings notification with a concise "Settings changed in another tab. Review the latest values and save again." message. Keep the user's unsaved form draft so a deliberate second Save can override.
- **Clears and timestamp skew:** A strongly consistent GET started after the last acknowledged save is authoritative for any previously unseen, non-superseded preference version, **even when** it removes a previously saved key or has an older/equal `updated_at`. Known superseded versions and reads started before a later acknowledgment cannot roll the store backward.
- **Cache lag:** Never use a potentially cached profile as proof of cross-client freshness in a reconciliation refresh. Keep TanStack Query for ordinary initial/profile reads, but fetch directly from the API for post-save/conflict reconciliation and when checking a tracked acknowledgment against a new read.
- **Identity and LLM fences:** Preserve session-generation checks and the `preferences_read_contract` / `llm_write_contract` checks from HPA-833. An unsafe/unmarked LLM snapshot must never be replayed as an authorized replacement.

### Conflict granularity

Treat `llm.keys[provider]`, `llm.thinking[modelId]`, ordinary preference fields (e.g. `darkMode`) as individual leaves. Treat the entire `llm.defaultModel` pair as one atomic selection, matching the existing `diffToFingerprint` semantics in `auth.ts`.

For a 409, compare the initial save's changed leaves with the same leaves in the server refetch. If a changed leaf also moved remotely from its original value to a different value, abort the automatic replay. A removed leaf is a change, not "unknown"; reuse the existing `REMOVED_VALUE` semantics. A server value equal to the user's requested value is harmless and need not be treated as an overlap.

Do not infer intent from an entire `llm` subtree just because PUT transports a full snapshot. Derive changed leaves from the original baseline and requested outcome. Prefer a small pure helper in `auth.ts` leveraging the current value comparison/fingerprint utilities, **not** a generic merge framework.

For non-functional, snapshot-style patches that cannot safely be rebased at changed-leaf granularity, conservatively report a conflict instead of replaying a stale whole-subtree replacement. Keep the currently working functional provider updaters.

### Authoritative refresh rule

When beginning a network profile read, record the current acknowledgment/session generation. On completion:

1. Reject results from a changed account or superseded in-flight read (a local acknowledgment occurred after this read began).
2. Reject a `preferences_version` explicitly recorded in `supersededPreferencesVersions`.
3. For the **same** version as a tracked acknowledgment, reject a snapshot that fails the tracked fingerprint check, regardless of a later `updated_at`.
4. For a **different, not-superseded** version from a strongly consistent GET started after the last local acknowledgment, accept it as authoritative for preferences, even when it clears a key or has an older/equal timestamp. Clear or retain fingerprints based on what the new actual snapshot covers; do not copy a write-contract marker from a discarded snapshot.
5. Retain the existing `updated_at` comparison only where preference-version ordering does not establish freshness (e.g. non-preference-only updates). Never order UUID version tokens lexically.

Keep this local to `useAuthStore`; no new API response field or database migration.

## Implementation boundaries

**Change:** `apps/vela/src/stores/auth.ts`, `apps/vela/src/stores/auth.test.ts`, and a focused addition to `apps/vela/e2e/llm-settings.spec.ts`. Adjust the synthetic auth fixture only if a deterministic server response hook is required; reuse its existing in-memory profile map and preference CAS rather than implement another mock layer.

**Do not change:** DynamoDB item schema, preference-version generation/condition, profile route contract, shared provider registry, backend auth, Settings card layout, TTS, game progress, or native mobile code. No generic state machine, event sourcing, websocket sync, cache invalidation bus, migration, separate PR, or new UI artwork/SFX.

The existing `LlmProviderCard` already retains an actively edited draft and surfaces `authStore.error` in a negative Quasar Notify toast. Reuse those behaviors; no new dialog or conflict-resolution screen.

## Acceptance and evidence

1. **Unit:** same-path edit vs edit and edit vs delete produce a conflict without a second PUT; disjoint fields still replay once; same desired remote value is not considered a conflicting overwrite; the failed attempt preserves the latest server profile and the user's draft.
2. **Reconciliation:** a fetched newer version that clears a tracked key wins despite equal/older `updated_at`; a known superseded version, delayed read, or cached snapshot with stale unrelated values never replaces a newer acknowledgment. A newer server version with unrelated preference changes remains visible.
3. **Backend regression:** current DynamoDB conditional write and route-level 409/428 tests remain green; no API contract changes.
4. **E2E:** use the existing mocked Playwright Test runner to exercise two browser tabs editing the **same** provider key: tab A saves, tab B gets 409 and a visible conflict notice, no silent second PUT, final stored key is tab A's. The existing **disjoint-key** two-tab test must still pass, as must a reloaded successful key clear.
5. **Visual:** no mockup exists. Capture one roughly 375px-wide screenshot of Settings with the conflict toast and unsaved draft during the Playwright evidence run, verify readability/no clipped controls or overflow by inspecting the CI artifact through GitHub MCP.
6. **MCP-verified:** inspect the real `mocked-settings` GitHub Actions job, its Playwright outcome and screenshot artifact through GitHub MCP. The fixture lives inside the Playwright Test process; do not substitute a browser MCP script for the tested flow. No native acceptance and no human sign-off.

Do not mark HPA-824 Done or make the PR ready until implementation, tests, CI/artifact inspection, and review fixes have actually passed.

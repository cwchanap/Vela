# HPA-538 Physical iPhone Foundation Verification Design

**Ticket:** HPA-538 — `[Mobile MVP][M1] Complete HPA-210 physical-device verification`

**Parent:** HPA-210 — `[Mobile MVP][M1] Complete the iOS foundation-spike verification and architecture record`

**Delivery:** One branch and one PR for HPA-538. Planning, physical verification, any narrow defect fix, reruns, evidence reconciliation, review fixes, and final ticket closeout stay on this PR.

## Context

HPA-538 is verification debt, not a new product feature. The repository already contains the HPA-210 verification runner, deployed-config check, production-diagnostic scan, physical-device setup instructions, interaction diagnostics, stable architecture record, and canonical milestone verification record.

`apps/vela-mobile/docs/m1-ios-foundation-verification.md` currently records `NO-GO`: the automated phase passed on the older cleanup-head revision, but production smoke, diagnostic observation, and current-revision physical acceptance were deferred. `apps/vela-mobile/docs/ios-foundation-architecture.md` therefore still leaves the audio adapter decision as `Pending physical HPA-210 evidence`.

Mystery Messenger release PR #65 has since merged. HPA-538 is the remaining explicit physical foundation task. Its job is to make actual observations on a tester-controlled iPhone and reconcile the existing HPA-210 records without inventing another verification subsystem.

The planning branch starts from `aeea0f68cc2dde19e372ea8917b7a66cc0948057`. That SHA is only the planning baseline. Execution records the exact tested behavior SHA after the branch is refreshed and before physical evidence is collected.

## Approaches considered

### 1. Reuse the existing HPA-210 verification surfaces — selected

Use the checked-in runner and docs exactly where they already own the facts:

- `verify:m1-foundation` for the automated freeze gates and local receipt;
- `verify:deployed-config` for deployed public-identifier consistency;
- Xcode plus the documented physical-device flow for signed install/launch;
- the existing development diagnostics for TTS, IME, keyboard, safe-area, and navigation observations;
- `m1-ios-foundation-verification.md` as the final result record;
- `ios-foundation-architecture.md` only for the evidence-gated audio conclusion or a real contract change.

This has the least code and the least long-term maintenance. It also preserves the original HPA-210 rule that physical behavior must be observed rather than inferred.

### 2. Add device/UI automation — rejected

Adding Maestro, Appium, Playwright-mobile, a `devicectl` orchestration layer, or another native E2E harness would increase setup and maintenance while still not proving speaker audibility, Silent Mode behavior, Japanese IME usability, or native gesture quality. HPA-538 is too small to justify that infrastructure.

### 3. Create an HPA-538-specific evidence schema or verification document — rejected

The existing HPA-210 verification record is already the canonical milestone record. A second schema or parallel evidence document would create two owners for the same facts and make later closeout harder.

## Goals

1. Re-establish a same-revision automated baseline before relying on physical results.
2. Verify a signed production-shaped build on one tester-controlled physical iPhone.
3. Verify the existing development diagnostics on the same device and deployed backend.
4. Record only actual, sanitized observations in the canonical HPA-210 verification record.
5. Resolve the pending audio-adapter decision when the physical TTS evidence is conclusive.
6. Produce a clear `GO` or `NO-GO` and keep tracker state aligned with the observed result.

## Non-goals

- No new E2E/device automation framework.
- No new verification runner, manifest schema, evidence directory format, or committed device-artifact store.
- No backend/API/CDK/DynamoDB feature work unless a physical run exposes a concrete defect owned there.
- No new mobile architecture abstraction merely to make testing easier.
- No fake-auth mode, diagnostic production route, or production-only test seam.
- No permanent signing team, device identifier, or provisioning material in the repository.
- No reopening or refactoring unrelated completed Mystery Messenger work.
- No weakening physical acceptance into Simulator or unit-test evidence.

## Canonical fact ownership

### Automated evidence

Run the existing `apps/vela-mobile/scripts/verify-m1-foundation.mjs` through the package script. Its receipt remains local under `.artifacts/hpa-210/` and is not committed.

The physical run must not rely solely on the historical `97f018c...` automated evidence because executable mobile behavior has changed since that revision. A fresh HPA-538 automated run pins the physical work to the current tested behavior SHA.

### Physical observations

Actual production and diagnostic observations are written into:

`apps/vela-mobile/docs/m1-ios-foundation-verification.md`

Do not resurrect the superseded committed manifest/evidence-store design. Manual evidence is a sanitized observation in the canonical table plus a concise PR/Linear summary.

### Stable architecture

`apps/vela-mobile/docs/ios-foundation-architecture.md` changes only when physical evidence resolves the existing audio decision or when a defect fix changes an implementation contract. It is not a second run log.

### Developer instructions

`apps/vela-mobile/README.md` changes only if executing the documented commands proves an instruction is stale or incorrect. HPA-538 does not rewrite working setup documentation for style.

## Tested-revision rule

Before the first load-bearing physical observation, record the full behavior SHA. Planning-only markdown commits do not change executable behavior, but any change to application source, native configuration, dependencies, generated build inputs, or verification tooling creates a new tested behavior revision.

When an executable change occurs:

1. record the new SHA;
2. rerun the existing automated freeze and deployed-config checks;
3. rerun every physical row that the change could affect;
4. do not aggregate old and new rows into a `GO`.

This keeps the existing HPA-210 one-behavior-revision rule without adding machinery.

## Execution flow

### 1. Automated freeze and deployed configuration

Prepare the current deployed public configuration using the existing CDK output/injection workflow, then run:

```bash
cd apps/vela-mobile
bun run verify:deployed-config -- --cdk-outputs ../../packages/cdk/cdk-outputs.json
bun run verify:m1-foundation
```

Both must pass for the tested behavior SHA before physical acceptance is considered load-bearing. `MOBILE_SKIP_ENV_VALIDATION=true`, localhost, placeholders, or a mismatched Cognito/API environment cannot satisfy HPA-538.

A failing automated gate is fixed before device testing. Existing verification tooling is changed only when the tooling itself is demonstrably wrong.

### 2. Physical prerequisite and signed production build

Use the existing physical-device flow:

```bash
cd apps/vela-mobile
bun run build:ios:ide
```

The operator configures the development team locally in Xcode, confirms trust and Developer Mode, selects the tester-controlled device, and runs the production-shaped assets against the deployed configuration.

Record only generic environment facts useful for reproduction, such as iPhone model class, iOS version, Xcode version, tested SHA, build class, and outcome. Never record UDID, account email, token, OAuth code/verifier/state, provisioning identity, complete callback URL, or raw credential-bearing logs.

### 3. Production smoke observations

The production build must establish all of the HPA-538 product-surface requirements on the physical device:

- signed install and clean launch;
- fresh Google sign-in through Cognito;
- successful warm callback delivery;
- successful cold-start callback delivery;
- force-close/relaunch restoration of the authenticated session;
- authenticated Home due-review state and manual refresh;
- user/session isolation across sign-out and a subsequent session;
- sign-out returning to an unauthenticated surface;
- expected auth/network recovery without protected-content or credential exposure.

Rows are observations, not inferred claims from source or tests. A prerequisite that prevents the row from running is recorded as such and cannot count as pass.

### 4. Diagnostic observations

Run the existing development diagnostics on the same device and deployed backend using the documented development flow. Cover:

- TTS preparation, playback, replay, and audible Japanese pronunciation;
- Silent Mode behavior;
- interruption/inactive-state stop and explicit recovery/replay;
- Japanese Kana IME composition from `にほんご` to `日本語` without premature submission;
- keyboard avoidance and focused-control reachability;
- top/bottom/horizontal safe-area behavior;
- visible back navigation and native swipe-back;
- tab navigation;
- deep entry and cold entry;
- resume behavior;
- scroll restoration;
- no navigation trap at depth zero.

The physical TTS observations select one existing audio conclusion when justified:

- `HTML-only accepted`;
- `native audio-session integration required`;
- `native player adapter required`.

If the observations are incomplete, leave the conclusion pending and the overall result `NO-GO`.

## Failure handling

Distinguish prerequisites from product defects.

A missing device, trust, Developer Mode, signing/provisioning, deployed configuration, or other operator prerequisite blocks the run but is not a fabricated product failure. Record the blocker and leave HPA-538 open.

For a reproducible product defect:

1. add the narrowest automated regression test that can own the logic, when the behavior is automatable;
2. make the smallest correction in the existing owner module;
3. avoid creating a new abstraction unless the defect demonstrates a real missing boundary;
4. rerun the focused test and normal mobile gates;
5. establish a new tested behavior SHA;
6. rerun the automated freeze and all affected physical observations.

The fix stays on the HPA-538 PR unless the discovered problem is genuinely independent of this ticket's acceptance scope.

## Evidence and privacy policy

The repository records sanitized results, not raw device evidence.

Allowed in committed/posted results:

- full tested Git SHA;
- generic device model/class;
- iOS and Xcode versions;
- build/config class;
- scenario ID or short name;
- observed behavior;
- pass/fail/prerequisite outcome;
- non-sensitive follow-up issue reference.

Do not commit or post:

- UDID or device serial;
- account email or personal identifier;
- Cognito tokens, OAuth state/code/verifier/nonce;
- full presigned URLs or authorization headers;
- provisioning profiles, certificates, signing identity details;
- raw device logs containing session/network payloads.

Screenshots or logs are unnecessary unless a defect requires them; if used, sanitize them and keep them out of the repository.

## Decision and tracker policy

`GO` requires:

- fresh automated freeze gates passing for the tested behavior revision;
- deployed-config consistency passing;
- every required production-smoke observation passing on the physical iPhone;
- every required diagnostic observation passing on the physical iPhone;
- a conclusive audio-adapter decision;
- no unresolved credential/protected-content exposure.

Any required failed, unrun, invalidated, placeholder-config, or prerequisite-blocked row produces `NO-GO` for this run.

On `GO`, update the canonical HPA-210 verification/architecture records and complete HPA-538. Source Mobile M1 tickets whose only remaining gate was this physical evidence can then be reconciled against the new record.

On `NO-GO`, record the minimum corrective work, keep HPA-538 open, and reopen an owning ticket only when the observed defect proves that completed work is not actually acceptable. Existing ticket status is never used as evidence that a physical criterion passed.

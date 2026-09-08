# HPA-538 Physical iPhone Foundation Verification Design

**Ticket:** HPA-538 — `[Mobile MVP][M1] Complete HPA-210 physical-device verification`

**Parent:** HPA-210 — `[Mobile MVP][M1] Complete the iOS foundation-spike verification and architecture record`

**Delivery:** One branch and one PR for HPA-538. Planning, physical verification, any narrow defect fix, reruns, evidence reconciliation, review fixes, and final ticket closeout stay on this PR.

## Context

HPA-538 is verification debt, not a new product feature. The repository already contains the HPA-210 verification runner, deployed-config check, production-diagnostic scan, physical-device setup instructions, development diagnostics, stable architecture record, and canonical milestone verification record.

`apps/vela-mobile/docs/m1-ios-foundation-verification.md` currently records `NO-GO`: the automated phase passed on an older cleanup-head revision, while production smoke, diagnostic observation, and current-revision physical acceptance were deferred. `apps/vela-mobile/docs/ios-foundation-architecture.md` therefore still leaves the audio adapter decision as `Pending physical HPA-210 evidence`.

Mystery Messenger PR #65 is merged. HPA-538 owns only the generic mobile-foundation physical gate. It does not absorb Mystery Messenger scene/playthrough acceptance, and it does not revive the superseded HPA-210 committed-manifest design.

The planning branch starts from `aeea0f68cc2dde19e372ea8917b7a66cc0948057`. That SHA is only the planning baseline. Execution records the exact tested behavior SHA after the branch is refreshed and before load-bearing device evidence is collected.

## Selected approach

Reuse the existing HPA-210 surfaces:

- `verify:m1-foundation` for the automated freeze gates and local receipt;
- `verify:deployed-config` for deployed public-identifier consistency;
- `build:ios:ide` plus Xcode for the production-shaped physical build;
- `dev:ios` for development diagnostics, but with the already-verified production public identifiers explicitly overlaid into the DEV process;
- `m1-ios-foundation-verification.md` as the canonical result record;
- `ios-foundation-architecture.md` only for the evidence-gated audio conclusion or a real implementation-contract change;
- `CLAUDE.md` and `AGENTS.md` only when final physical evidence changes their current “unconfirmed” guidance.

Do not add Maestro, Appium, Playwright-mobile, another native E2E harness, a new evidence schema/store, `--record-manual`, fake auth, or a production diagnostic route. The existing manual physical observations are the source of truth for speaker audibility, Silent Mode, Japanese IME, keyboard/safe areas, and native gestures.

## Goals

1. Re-establish same-revision automated and deployed-config evidence before relying on physical results.
2. Verify a signed production-shaped build on one tester-controlled physical iPhone.
3. Verify the existing development diagnostics on the same device against the same deployed API/Cognito identity as the production smoke.
4. Record the required physical observations as named rows so a missing criterion cannot disappear inside an umbrella paragraph.
5. Resolve the pending audio decision using the original HPA-210 Silent Mode decision rule.
6. Produce a clear `GO` or `NO-GO` and synchronize repository guidance and tracker state with that observed result.

## Non-goals

- No new device/UI automation framework.
- No new HPA-538 verification runner, manifest schema, evidence directory format, or committed device-artifact store.
- No backend/API/CDK/DynamoDB feature work unless a physical run exposes a concrete defect owned there.
- No new mobile architecture abstraction merely to make testing easier.
- No permanent signing team, device identifier, or provisioning material in the repository.
- No Mystery Messenger scene matrix or pilot replay in HPA-538.
- No new landscape requirement; use the already-selected HPA-209 inset policy unless a physical defect appears.
- No Simulator rerun as a substitute for the physical gate. Leave `HPA-210-SIMULATOR-BUILD-INSTALL-LAUNCH` deferred in this ticket.

## Canonical fact ownership

### Automated evidence

Run the existing `verify:m1-foundation` package script. Its receipt remains local under `.artifacts/hpa-210/` and is not committed.

The physical run must not rely only on the historical `97f018c...` automated evidence because executable mobile behavior has changed since that revision. A fresh HPA-538 run pins the device work to the current tested behavior SHA.

### Physical observations

Actual production and diagnostic observations are written into:

`apps/vela-mobile/docs/m1-ios-foundation-verification.md`

Do not resurrect committed manual manifests or a second verification document. The canonical record stores sanitized observation text plus the tested SHA and run identifiers.

### Stable architecture

`apps/vela-mobile/docs/ios-foundation-architecture.md` changes only when physical evidence resolves the current audio decision or a defect fix changes a real implementation contract. It is not a second run log.

### Developer guidance

`CLAUDE.md` and `AGENTS.md` currently state that HPA-210 physical evidence, Japanese IME candidate selection, and native edge-swipe back are unconfirmed.

- On `GO`, remove the deferred-physical paragraph and the physical HPA-210 diagnostics closure-gate section after the corresponding rows are recorded.
- On `NO-GO`, keep those warnings and point the canonical verification record at the failed/prerequisite rows.
- `apps/vela-mobile/README.md` changes only if executing a documented command proves the instruction stale or incorrect.

## Tested-revision rule

Before the first load-bearing physical observation, record the full behavior SHA. Planning-only markdown commits do not change executable behavior, but any change to application source, native configuration, dependencies, generated build inputs, or verification tooling creates a new tested behavior revision.

When an executable change occurs:

1. record the new SHA;
2. rerun deployed-config consistency and the automated freeze;
3. rerun every physical row that the change could affect;
4. do not aggregate old and new physical rows into a `GO`.

## Execution flow

### 1. Freeze deployed configuration and automated gates

Use the repository’s existing production-env sequence explicitly rather than relying on an ambiguous “follow the README” step:

```bash
cd packages/cdk
bun cdk:deploy
bun scripts/inject-env.ts

cd ../../apps/vela-mobile
bun run verify:deployed-config -- --cdk-outputs ../../packages/cdk/cdk-outputs.json
bun run verify:m1-foundation
```

If the deployed backend was already deployed and `packages/cdk/cdk-outputs.json` is known-current, execution may skip the deploy itself, but `inject-env.ts`, `verify:deployed-config`, and `verify:m1-foundation` still run before physical evidence.

`MOBILE_SKIP_ENV_VALIDATION=true`, localhost, placeholders, or mismatched API/Cognito identifiers cannot satisfy HPA-538.

### 2. Production-shaped physical build

Use the existing physical-device flow:

```bash
cd apps/vela-mobile
bun run build:ios:ide
```

The operator configures the development team locally in Xcode, confirms trust and Developer Mode, selects the tester-controlled device, and runs the production-shaped assets against the deployed configuration.

Record only generic environment facts useful for reproduction: device model/class, iOS version, Xcode version, tested SHA, build/config class, and outcome. Never record UDID, account email, token, OAuth code/verifier/state/nonce, signing identity, provisioning data, full callback URL, or raw credential-bearing logs.

### 3. Required production-smoke rows

Use these named rows in the canonical record:

| ID | Pass criterion |
| --- | --- |
| `HPA-210-PROD-INSTALL-LAUNCH` | Signed production-shaped app installs and cleanly launches; production More page exposes no DEV diagnostic entries. |
| `HPA-210-PROD-AUTH-WARM-CALLBACK` | Fresh Google/Cognito sign-in returns to an already-running app, establishes the verified session once, shows no token/callback material, and does not expose protected content before verification. |
| `HPA-210-PROD-AUTH-COLD-CALLBACK` | Completing sign-in with Vela terminated cold-launches the app, consumes the launch URL once, establishes the verified session, and avoids duplicate/stuck callback state. |
| `HPA-210-PROD-RELAUNCH-RESTORATION` | Force-close/relaunch restores the authenticated session without interactive sign-in and does not flash protected content before restoration is verified. |
| `HPA-210-PROD-DUE-COUNT-ISOLATION` | Due count loads/refreshes; sign-out removes the old authenticated state; signing in again does not surface the prior session’s cached protected state. The same Google account is sufficient; no second account is required. |
| `HPA-210-PROD-SIGNOUT-RELAUNCH` | After sign-out and relaunch, no authenticated session or protected due-review content reappears. |

Product-surface security is part of those rows, not a vague extra row: no protected-content flash, no token/provider/callback payload in visible UI, no stale due-count state after sign-out, and no production diagnostic entries.

If a concrete network-recovery observation is useful during diagnosis, use Home’s existing `Retry` control after temporarily disabling connectivity, but do not create a separate required HPA-538 row unless a failure exposes a real acceptance gap.

### 4. Pin the DEV diagnostics to the deployed backend

`dev:ios` runs Quasar in development mode, and normal development env can point at localhost. Therefore running plain `bun run dev:ios` is not sufficient HPA-538 evidence.

Keep DEV mode so diagnostic routes remain compiled, but overlay the five public values from the already-verified `.env.production` into the process:

```bash
cd apps/vela-mobile
set -a
source .env.production
set +a
bun run dev:ios
```

The overlaid values are:

- `VITE_MOBILE_API_URL`
- `VITE_COGNITO_USER_POOL_ID`
- `VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID`
- `VITE_COGNITO_OAUTH_DOMAIN`
- `VITE_AWS_REGION`

Record the diagnostic run as `prerequisite_missing` rather than pass if it used localhost, a LAN API, placeholder Cognito values, or any backend identity that does not match Task 1.

### 5. Required diagnostic rows

Use these named rows:

| ID | Pass criterion |
| --- | --- |
| `HPA-210-DIAG-TTS-CORE` | Using the checked-in diagnostic word `水` (`みず`): authenticated preparation succeeds; first user-gesture playback is correct/audible with Silent Mode off; explicit replay succeeds without overlap/unwanted auto-resume. |
| `HPA-210-DIAG-AUDIO-SILENT-MODE` | Repeat `水` playback with actual system Silent Mode enabled and record the observed policy. Ring/Silent switch may be used; on Action Button devices configure/use Silent Mode and confirm the system indicator. Focus Mode is not Silent Mode. |
| `HPA-210-DIAG-AUDIO-INTERRUPTION` | An external/system interruption or inactive transition leaves audio stopped/settled and explicitly replayable after return; it does not unexpectedly auto-resume. |
| `HPA-210-DIAG-IME` | Enter `にほんご`, select `日本語`, no early submit occurs, and draft/committed/model/post-render-native/submitted values all equal `日本語`. |
| `HPA-210-DIAG-KEYBOARD-SAFE-AREA` | In portrait, focused controls remain reachable and keyboard dismissal leaves no permanent overlap/offset or unsafe inset regression. |
| `HPA-210-DIAG-NATIVE-SWIPE-BACK` | A real physical edge-swipe exercises native back and decrements/settles the app-owned mobile-depth path rather than acting as a no-op or trapping navigation. |
| `HPA-210-DIAG-NAVIGATION` | Visible back, tab switching, deep entry, cold entry, resume, scroll restoration, and depth-zero fallback/no-trap behave as the existing diagnostics specify. |

The current umbrella `HPA-210-PHYSICAL-ACCEPTANCE` row becomes a rollup that references these production and diagnostic rows. It must not replace them with one prose pass. Update `HPA-210-DEPLOYED-CONFIG-CONSISTENCY` to the new tested SHA. Leave the Simulator row deferred.

## Audio decision procedure

Use the checked-in `DIAGNOSTIC_WORD`: `水`, reading `みず`, translation `water`.

After `HPA-210-DIAG-TTS-CORE`, `HPA-210-DIAG-AUDIO-SILENT-MODE`, and `HPA-210-DIAG-AUDIO-INTERRUPTION` are observed, select according to this rule:

- **`HTML-only accepted`** — core preparation/playback/audibility/replay and interruption recovery pass, and the physical Silent Mode behavior satisfies the foreground pronunciation product rule.
- **`native audio-session integration required`** — core preparation/playback/audibility/replay and interruption recovery all pass, and Silent Mode policy is the sole audio failure. This is the one permitted High reclassification: create/retain a High pre-M2 audio-session gate that blocks the first audio-dependent M2 work.
- **`native player adapter required`** — the physical evidence demonstrates that the current `HtmlAudioPlayer` cannot satisfy core player behavior and requires replacement rather than only audio-session policy. This is hard `NO-GO`.

Do not select `HTML-only accepted` after a Silent-Mode-only failure, and do not select `native player adapter required` merely because Silent Mode policy needs native audio-session configuration.

If the audio evidence is incomplete or the failure cause is not yet attributable to one of the three outcomes, leave `Pending physical HPA-210 evidence` and record `NO-GO`.

## Failure handling

Distinguish operator prerequisites from product defects.

A missing eligible phone, trust, Developer Mode, signing/provisioning, deployed configuration, or deployed-env DEV overlay blocks the relevant row but is not a fabricated product failure. Record `prerequisite_missing` and leave HPA-538 open.

For a reproducible product defect:

1. record the failed physical row and `NO-GO` first;
2. add the narrowest automated regression test that can own the logic, when automatable;
3. make the smallest correction in the existing owner module;
4. avoid new abstractions unless the defect demonstrates a missing boundary;
5. establish a new tested behavior SHA;
6. rerun deployed-config consistency, the automated freeze, and every affected physical row.

The fix stays on the HPA-538 PR unless the discovered problem is genuinely independent of this acceptance scope.

## Evidence and privacy policy

Allowed in committed/posted results:

- full tested Git SHA;
- generic device model/class;
- iOS and Xcode versions;
- build/config class;
- named scenario ID;
- sanitized observed behavior;
- pass/fail/`prerequisite_missing` outcome;
- non-sensitive follow-up issue reference.

Do not commit or post:

- UDID or device serial;
- account email or personal identifier;
- Cognito tokens, OAuth state/code/verifier/nonce;
- full presigned URLs or authorization headers;
- provisioning profiles, certificates, signing identity details;
- raw device logs containing session/network payloads.

Screenshots or logs are unnecessary unless a defect requires them; if used, sanitize them and keep them out of the repository.

## Execution risks

The plan should explicitly stop rather than infer evidence when any of these occurs:

- no tester-controlled eligible iPhone or unresolved signing/trust/Developer Mode;
- cold-start callback does not return cleanly to Vela;
- DEV diagnostics still resolve to localhost/LAN/placeholder configuration instead of the Task 1 deployed identity;
- Action Button/Focus Mode is mistaken for actual Silent Mode;
- a runtime defect changes executable behavior after some rows were already recorded.

## Decision and tracker policy

`GO` requires:

- fresh automated freeze gates passing for the tested behavior revision;
- deployed-config consistency passing and `HPA-210-DEPLOYED-CONFIG-CONSISTENCY` updated to that revision;
- every named production row passing on the physical iPhone;
- every named diagnostic row passing, except the original narrow Silent-Mode-only High exception described above;
- a conclusive audio-adapter decision;
- no Critical finding or unresolved credential/protected-content exposure;
- the physical acceptance rollup referencing the named rows rather than replacing them.

Any required failed, unrun, invalidated, placeholder/local-backend, or prerequisite-blocked row produces `NO-GO` unless it is exactly the permitted Silent-Mode-only audio-session exception after all core audio rows pass.

On `GO`, update the canonical HPA-210 verification/architecture records, synchronize `CLAUDE.md` and `AGENTS.md`, and complete HPA-538. Source Mobile M1 tickets whose only remaining gate was this physical evidence can then be reconciled against the new record.

On `NO-GO`, record the minimum corrective work, keep HPA-538 open, leave the unresolved-physical guidance in `CLAUDE.md`/`AGENTS.md`, and reopen an owning ticket only when the observed defect proves that implementation is not acceptable. Existing tracker status is never evidence that a physical criterion passed.

# HPA-538 Physical iPhone Foundation Verification Design

**Ticket:** HPA-538 — `[Mobile MVP][M1] Complete HPA-210 physical-device verification`

**Parent:** HPA-210 — `[Mobile MVP][M1] Complete the iOS foundation-spike verification and architecture record`

**Delivery:** One branch and one PR for HPA-538. Planning, physical verification, any narrow defect fix, reruns, evidence reconciliation, review fixes, and final ticket closeout stay on PR #66.

## Context

HPA-538 is verification debt, not a new product subsystem. The repository already owns the HPA-210 automated runner, deployed-config verifier, production-diagnostic scan, physical-device checklist, development diagnostics, architecture record, and canonical verification record.

`apps/vela-mobile/docs/m1-ios-foundation-verification.md` recorded `NO-GO`: the automated phase passed on an older cleanup revision, while production smoke, diagnostic observation, and current-revision physical acceptance were deferred. `apps/vela-mobile/docs/ios-foundation-architecture.md` therefore still leaves the audio decision as `Pending physical HPA-210 evidence`.

HPA-538 owns only the generic mobile-foundation physical gate. It does not absorb Mystery Messenger acceptance, add device automation, or revive the superseded committed-manifest design.

## Selected approach

Reuse the existing seams:

- `verify:m1-foundation` for the same-revision automated freeze and local receipt;
- `verify:deployed-config` for deployed public API/Cognito identity;
- `build:ios:ide` plus the canonical physical-run checklist for production-shaped device smoke;
- `dev:ios` for development diagnostics, with production public identifiers overlaid and a temporary deployed CORS allowance for the physical Mac-hosted DEV origin;
- `m1-ios-foundation-verification.md` as the only canonical result record;
- `ios-foundation-architecture.md` only for the evidence-backed audio conclusion or a real contract change;
- `CLAUDE.md` and `AGENTS.md` only when final physical evidence changes their current “unconfirmed” guidance.

Do not add Maestro, Appium, Playwright-mobile, another native E2E harness, a new evidence schema/store, `--record-manual`, fake auth, or a production diagnostic route. Physical observations remain the source of truth for speaker audibility, Silent Mode, Japanese IME, keyboard/safe areas, and native gestures.

## Non-goals

- No new verification runner or manual-recording CLI.
- No backend feature work; the only planned infrastructure mutation is a temporary CORS allowance needed to reach the existing deployed API from physical `dev:ios`, followed by rollback.
- No new mobile architecture abstraction merely to make testing easier.
- No permanent signing team, device identifier, LAN origin, or provisioning material in the repository/infrastructure.
- No Mystery Messenger scene matrix or pilot replay.
- No new landscape requirement; keep the selected HPA-209 inset policy unless a physical defect appears.
- No Simulator rerun as a substitute for this physical gate. `HPA-210-SIMULATOR-BUILD-INSTALL-LAUNCH` passed in the simulator class only (see the operator amendment); physical rows remain waived.

## Canonical ownership

- **Automated evidence:** existing `verify:m1-foundation`; receipt remains local under `.artifacts/hpa-210/`.
- **Physical evidence:** named rows in `apps/vela-mobile/docs/m1-ios-foundation-verification.md`.
- **Audio architecture:** `apps/vela-mobile/docs/ios-foundation-architecture.md` after the physical audio mapping is conclusive.
- **Operator guidance:** existing `Manual Physical-Run Checklist` in the canonical verification record; the plan references it rather than maintaining a second signing checklist.
- **Repository guidance:** `CLAUDE.md` / `AGENTS.md` are synchronized only from the final decision.

## Load-bearing prerequisites

All prerequisites below must be satisfied before their dependent physical rows can pass. Missing prerequisites are `prerequisite_missing`, not inferred failures or passes.

### Fresh deployed outputs

`packages/cdk/package.json` separates deployment from output refresh: `cdk:deploy` does not write `cdk-outputs.json`; `get-outputs` does. Therefore `.env.production` must be generated only after a fresh `bun run get-outputs` against `VelaStack`.

After any HPA-538 CDK deployment, run `get-outputs` again before `inject-env.ts` and `verify:deployed-config`. Comparing an env file to the same stale outputs that generated it is not evidence.

### Physical DEV CORS origin

Physical `dev:ios` serves the Quasar DEV page from the development Mac’s LAN host, so the WebView origin is `http://<current-mac-lan-ip>:9100`. The deployed API’s default CORS list allows the production website, localhost/127.0.0.1 development origins, and `capacitor://localhost`, but not an arbitrary LAN host.

Before authenticated diagnostic rows:

1. determine the current Mac LAN origin;
2. temporarily redeploy `ApiStack` with the **full existing default origin list plus that one LAN origin**;
3. preserve `capacitor://localhost` and every existing default origin because `CORS_ALLOWED_ORIGINS` replaces rather than appends;
4. record the temporary LAN origin as non-secret diagnostic environment context;
5. after the final diagnostic session, redeploy `ApiStack` with the normal default CORS configuration so the LAN origin does not remain deployed.

This is a verification prerequisite, not a permanent product change. `verify:deployed-config` does not compare CORS; the diagnostic rows still use the same deployed API/Cognito identity as production smoke, with a temporary transport allowance for DEV.

### Tester-account TTS state

`MobileTtsService` returns `not_configured` when `GET tts/settings` reports no user-scoped provider key. The mobile app has no TTS settings editor. Before the phone run, the tester must use the deployed web app with the same Google account to save working TTS settings for the deployed environment.

A missing/invalid provider configuration is `prerequisite_missing` for the authenticated TTS/audio rows; it is not evidence about `HtmlAudioPlayer`.

### Non-zero due-review state

`HPA-210-PROD-DUE-COUNT-ISOLATION` must begin with at least one due item (`due_today >= 1`). A visible non-zero protected value is necessary to observe that sign-out removes prior-session due-review state; a 0 → sign-out → 0 sequence is not sufficient isolation evidence.

Prepare the tester account through existing product data/learning flows before the run and confirm Home shows a non-zero due count.

## Tested-revision rule

Before the first load-bearing physical observation, record the full behavior SHA. Planning/evidence markdown does not change executable behavior. Any application source, native configuration, dependency, build input, or verification-tooling change creates a new tested behavior revision.

If a physical defect is discovered on PR #66:

1. record the failed observation and provisional `NO-GO` in PR/Linear notes;
2. do **not** finalize that failed row into the canonical current-run matrix if a fix will be attempted on this PR;
3. add the narrowest regression test when automatable and the smallest owner-module fix;
4. freeze a new tested SHA and rerun deployed-config, automated gates, and every affected physical row;
5. finalize canonical rows only for the final tested SHA; never aggregate pre-fix and post-fix rows into `GO`.

This keeps the project’s one-ticket/one-PR rule without weakening same-revision evidence. A genuinely independent defect may be tracked separately, but HPA-538 is not split merely because its acceptance run found a fixable defect.

## Build ordering

Production and DEV builds share bundle id `com.vela.app`; the DEV install replaces the production-shaped app on the physical device.

Therefore:

1. complete all production-smoke rows first;
2. install/run DEV diagnostics only after production smoke is complete;
3. do not interleave the two build classes;
4. after DEV has been installed, any production-row rerun requires a fresh `build:ios:ide` plus physical Run/install, not a simple relaunch.

## Required production rows

| ID | Pass criterion |
| --- | --- |
| `HPA-210-PROD-INSTALL-LAUNCH` | Signed production-shaped app installs and cleanly launches; production More page exposes no DEV diagnostic entries. |
| `HPA-210-PROD-AUTH-WARM-CALLBACK` | Fresh Google/Cognito sign-in returns to an already-running app, establishes the verified session once, shows no token/callback material, and exposes no protected content before verification. |
| `HPA-210-PROD-AUTH-COLD-CALLBACK` | Completing sign-in with Vela terminated cold-launches the app, consumes the launch URL once, establishes the verified session, and avoids duplicate/stuck callback state. |
| `HPA-210-PROD-RELAUNCH-RESTORATION` | Force-close/relaunch restores the authenticated session without interactive sign-in and does not flash protected content before restoration is verified. |
| `HPA-210-PROD-DUE-COUNT-ISOLATION` | Starts with `due_today >= 1`; due count loads/refreshes; sign-out removes the visible protected count; subsequent sign-in does not expose prior-session state before the current session settles. The same Google account is sufficient. |
| `HPA-210-PROD-SIGNOUT-RELAUNCH` | After sign-out and relaunch, no authenticated session or protected due-review content reappears. |

Product-surface security is owned by those rows: no protected-content flash, no token/provider/callback payload in visible UI, no stale due-count state after sign-out, and no DEV diagnostic entries in production. There is no vague extra “security/recovery” row.

## Required diagnostic rows

All diagnostic rows use the checked-in `DIAGNOSTIC_WORD`: `水`, reading `みず`, translation `water`.

| ID | Pass criterion |
| --- | --- |
| `HPA-210-DIAG-TTS-CORE` | With Silent Mode off and non-zero media volume: authenticated preparation succeeds; first user-gesture playback audibly says `水`; explicit replay succeeds without overlap or unwanted auto-resume. |
| `HPA-210-DIAG-AUDIO-SILENT-MODE` | With actual system Silent Mode on and non-zero media volume, a foreground user-initiated prepared pronunciation remains audible. Ring/Silent switch or the system Silent Mode control may be used; Focus Mode is not Silent Mode. |
| `HPA-210-DIAG-AUDIO-INTERRUPTION` | External/system interruption or inactive transition leaves audio stopped/settled, does not auto-resume unexpectedly, and remains explicitly replayable. |
| `HPA-210-DIAG-IME` | Enter `にほんご`, select `日本語`, no early submit occurs, and draft/committed/model/post-render-native/submitted values all equal `日本語`. |
| `HPA-210-DIAG-KEYBOARD-SAFE-AREA` | In portrait, focused controls remain reachable and keyboard dismissal leaves no permanent overlap/offset or unsafe inset regression. |
| `HPA-210-DIAG-NATIVE-SWIPE-BACK` | A real physical edge-swipe executes chronological back and settles/decrements the app-owned mobile-depth path rather than acting as a no-op or navigation trap. |
| `HPA-210-DIAG-NAV-VISIBLE-BACK` | Existing visible-back diagnostic follows chronological back behavior. |
| `HPA-210-DIAG-NAV-TABS` | Repeated tab navigation stays usable and preserves the expected app-owned history policy. |
| `HPA-210-DIAG-NAV-DEEP-ENTRY` | In-session deep entry settles to the expected route/depth without blank frame, exit, or trap. |
| `HPA-210-DIAG-NAV-COLD-ENTRY` | Cold entry establishes the expected route/depth and remains escapable. |
| `HPA-210-DIAG-NAV-RESUME` | Resume does not fabricate navigation and leaves the current route usable. |
| `HPA-210-DIAG-NAV-SCROLL-RESTORATION` | Returning through the existing diagnostic flow restores the expected scroll behavior without trapping input/navigation. |
| `HPA-210-DIAG-NAV-DEPTH-ZERO` | Depth-zero back fallback remains safe; no blank frame, app exit, or navigation trap occurs. |

The current `HPA-210-PHYSICAL-ACCEPTANCE` row becomes a rollup referencing the named production and diagnostic rows. It never replaces them with an umbrella pass. Update `HPA-210-DEPLOYED-CONFIG-CONSISTENCY` to the final tested SHA. The Simulator row passed in the simulator class only (see the operator amendment); leave only physical rows waived.

## Silent Mode product rule and audio decision

The product rule is precommitted by `docs/superpowers/specs/2026-07-31-mobile-authenticated-tts-pronunciation-design.md` (HPA-208) and is restated here for closure:

> A prepared, user-initiated pronunciation tap while Vela is foregrounded must remain audible when system Silent Mode is ON and media volume is non-zero.

The operator confirms this rule; the device run does not invent it.

After the three audio rows are complete:

- **`HTML-only accepted`** — TTS core, interruption/replay, and the Silent Mode audibility rule all pass.
- **`native audio-session integration required`** — TTS core and interruption/replay pass, and Silent Mode audibility is the sole audio failure. This is the one permitted High reclassification: track a High pre-M2 audio-session gate that blocks the first audio-dependent M2 work.
- **`native player adapter required`** — core playback/player behavior fails in a way that requires replacing `HtmlAudioPlayer`, not merely configuring native audio-session policy. This is hard `NO-GO`.

If evidence is incomplete or failure attribution is unclear, leave `Pending physical HPA-210 evidence` and record `NO-GO` (superseded for HPA-538 by the operator amendment: the ticket closed `GO` with the audio decision still pending).

## Decision policy

> **Superseded for HPA-538 closure by the operator amendment (2026-09-09)
> below.** HPA-538 closed `GO` on the amended simulator-class basis with the
> physical rows waived and the audio decision still pending. This section
> remains the decision standard for any future run of the waived physical
> rows under their own evidence class.

`GO` requires:

- fresh deployed outputs and `verify:deployed-config` for the final tested SHA;
- fresh `verify:m1-foundation` on a tracked-clean checkout;
- all named production rows passing;
- all named diagnostic rows passing, except the exact Silent-Mode-only High audio-session exception above;
- a conclusive audio decision;
- no Critical finding or unresolved credential/protected-content exposure;
- the physical rollup referencing the named rows rather than replacing them;
- the temporary physical-DEV LAN CORS origin removed after diagnostics.

Any required failed, unrun, invalidated, local/placeholder-backed, stale-output-backed, or prerequisite-blocked row is `NO-GO` unless it is exactly the permitted Silent-Mode-only audio-session exception after core audio passes.

On `GO`, update the canonical verification/architecture records, synchronize `CLAUDE.md` and `AGENTS.md`, and complete HPA-538. On `NO-GO`, keep HPA-538 open, retain unresolved-physical guidance, and record only the minimum corrective work supported by the failed row.

## Privacy

Record only full tested Git SHA, generic device model/class, iOS/Xcode versions, build/config class, named scenario ID, sanitized observation, outcome, temporary LAN **origin** (not device identifiers), and non-sensitive follow-up references.

Do not commit or post UDID/serial, account email, tokens, OAuth state/code/verifier/nonce, authorization headers, full presigned URLs, provisioning profiles/certificates/signing identities, provider API keys, or raw credential-bearing logs/screenshots.

## Operator amendment (2026-09-09): simulator-class closure

The operator accepted simulator-class evidence as sufficient for HPA-538
closure and waived the physical rows for this ticket. This amendment changes
the acceptance basis as follows:

- The `GO` basis is now: the tested-SHA automated freeze
  (`verify:m1-foundation`), `verify:deployed-config` against fresh
  `VelaStack` outputs, and the simulator-class build/install/launch row — all
  on one tested behavior SHA
  (`97d702d322ce8f35aa0cc5915c9cb0d5e2dc62b6`).
- All named production-smoke rows, all diagnostic rows, and the temporary
  physical-DEV CORS prerequisite are **waived by operator decision** — not
  passed, and never recorded as physical observations.
- The audio adapter decision remains **pending**: no audio row ran in any
  evidence class, so no audio conclusion (HTML-only, audio-session
  integration, or native player adapter) is recorded, and
  `ios-foundation-architecture.md` keeps its pending audio mapping. The first
  audio-dependent M2 work still needs that mapping.
- The same-PR defect rule is unchanged and did not trigger: no defect was
  observed and no fix was made.
- No temporary CORS origin was ever deployed, so there is no infrastructure
  rollback to perform.

Everything else in this spec (privacy rules, evidence discipline,
one-ticket/one-PR delivery) stands unchanged. The physical rows may be
executed later under their own evidence class; until then they must not be
claimed.

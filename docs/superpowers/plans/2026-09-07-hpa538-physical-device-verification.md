# HPA-538 Physical iPhone Foundation Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for this plan. Tasks 1, 4, and 5 can be agent-assisted; Tasks 2 and 3 are explicitly operator-owned because they require Xcode signing, real Google OAuth, a physical speaker, actual Silent Mode, Japanese IME candidate selection, and native edge-swipe observation. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the deferred HPA-210 physical-device gate on one tester-controlled iPhone, record a same-revision GO/NO-GO, and resolve the pending iOS audio decision without adding a verification subsystem.

**Architecture:** Reuse the existing HPA-210 runner, deployed-config verifier, Quasar/Capacitor/Xcode flows, development diagnostics, and canonical verification/architecture docs. Physical observations are the source of truth; local automated receipts support them but are not committed. If a physical run exposes a concrete defect, record `NO-GO` first and amend this same HPA-538 PR with the exact regression/fix steps instead of pre-planning speculative product code.

**Tech Stack:** Bun, Turborepo, Quasar 2, Vue 3, Capacitor iOS, Xcode, Cognito/Google OAuth, existing Vela mobile diagnostics.

**Spec:** `docs/superpowers/specs/2026-09-07-hpa538-physical-device-verification-design.md`

## Global Constraints

- One HPA-538 branch and one PR; do not split production smoke, diagnostics, fixes, or closeout into separate PRs.
- No Appium/Maestro/Playwright-mobile/native E2E framework.
- No new HPA-538 verification runner, manual-recording CLI, manifest schema/store, fake-auth mode, or production diagnostic route.
- Use one tested behavior revision for load-bearing automated and physical evidence. Executable changes require a new SHA and affected reruns.
- `MOBILE_SKIP_ENV_VALIDATION=true`, localhost, LAN-only dev API, placeholders, or mismatched API/Cognito identity cannot satisfy acceptance.
- Keep the existing HPA-210 Simulator build/install/launch row deferred; HPA-538 is the physical gate.
- Do not absorb Mystery Messenger-specific scene/playthrough acceptance.
- Do not commit UDIDs, serials, account identifiers, OAuth/token material, signing identities, provisioning artifacts, presigned URLs, or raw sensitive logs.
- Keep automated receipts local under `.artifacts/hpa-210/`.
- Do not infer speaker audibility, Silent Mode, IME, keyboard/safe-area, or native-navigation behavior from automated/Simulator results.
- A discovered defect produces a concrete failed row and `NO-GO` first; only then add its exact regression/fix steps to this same PR.

## Required row IDs

Production rows:

```text
HPA-210-PROD-INSTALL-LAUNCH
HPA-210-PROD-AUTH-WARM-CALLBACK
HPA-210-PROD-AUTH-COLD-CALLBACK
HPA-210-PROD-RELAUNCH-RESTORATION
HPA-210-PROD-DUE-COUNT-ISOLATION
HPA-210-PROD-SIGNOUT-RELAUNCH
```

Diagnostic rows:

```text
HPA-210-DIAG-TTS-CORE
HPA-210-DIAG-AUDIO-SILENT-MODE
HPA-210-DIAG-AUDIO-INTERRUPTION
HPA-210-DIAG-IME
HPA-210-DIAG-KEYBOARD-SAFE-AREA
HPA-210-DIAG-NATIVE-SWIPE-BACK
HPA-210-DIAG-NAVIGATION
```

The existing `HPA-210-PHYSICAL-ACCEPTANCE` entry becomes a rollup referencing these rows; it never replaces them with one umbrella pass. `HPA-210-DEPLOYED-CONFIG-CONSISTENCY` is updated to the current tested SHA. `HPA-210-SIMULATOR-BUILD-INSTALL-LAUNCH` remains deferred.

## Execution risks

Stop and record the real blocker rather than inventing evidence when:

- there is no tester-controlled eligible iPhone or signing/trust/Developer Mode is unresolved;
- cold-start OAuth callback does not cleanly return to Vela;
- the DEV diagnostic process still uses localhost/LAN/placeholder configuration instead of the Task 1 deployed identity;
- an Action Button/Focus configuration is mistaken for actual system Silent Mode;
- an executable fix lands after some rows were already observed, invalidating those rows.

---

### Task 1: Freeze deployed configuration and the tested behavior revision

**Owner:** Agent-assisted; operator supplies deployment/signing environment as needed.

**Files:**
- Read: `apps/vela-mobile/README.md`
- Read: `apps/vela-mobile/package.json`
- Read: `apps/vela-mobile/docs/m1-ios-foundation-verification.md`
- Generated local only: `.artifacts/hpa-210/**`

**Produces:** one exact tested behavior SHA, verified deployed public identifiers, and passing HPA-210 automated gates for Tasks 2–4.

- [ ] **Step 1: Refresh and bootstrap the branch**

```bash
git fetch origin
git switch codex/hpa-538-physical-device-verification
git status --short
bun install --frozen-lockfile
bun --filter @vela/common build
```

Expected: clean branch; install and common build exit `0`.

- [ ] **Step 2: Prepare the deployed mobile environment using the repository sequence**

From the repository root:

```bash
cd packages/cdk
bun cdk:deploy
bun scripts/inject-env.ts
```

If the backend is already deployed and `packages/cdk/cdk-outputs.json` is confirmed current, the deploy command may be skipped. `inject-env.ts` must still regenerate `apps/vela-mobile/.env.production` from those outputs before verification.

- [ ] **Step 3: Verify the deployed public identifiers**

```bash
cd ../../apps/vela-mobile
bun run verify:deployed-config -- --cdk-outputs ../../packages/cdk/cdk-outputs.json
```

Expected: exit `0`; API URL, user-pool id, mobile client id, OAuth domain, and region match the deployed outputs.

Stop on placeholder, localhost, or mismatched configuration.

- [ ] **Step 4: Record the exact tested behavior SHA**

```bash
git rev-parse HEAD
```

Copy the full SHA into PR execution notes. Planning-only markdown commits do not change executable behavior; any later executable/native/config/dependency/tooling change creates a new tested behavior SHA.

- [ ] **Step 5: Run the existing HPA-210 automated freeze**

```bash
bun run verify:m1-foundation
```

Expected: exit `0`; install, lint, typecheck, compile, build, test, production-diagnostics, and mobile-secret-scan pass in order. Receipt remains local under `.artifacts/hpa-210/`.

- [ ] **Step 6: Confirm verification produced no tracked artifacts**

```bash
cd ../..
git status --short
```

Expected: no tracked verification artifacts.

**Stop condition:** If deployed-config or automated freeze fails, do not start load-bearing device acceptance. Record the failure and fix only the demonstrated problem on this same PR, then restart Task 1 from the new SHA.

---

### Task 2: Run the physical production-smoke rows

**Owner:** Operator. Do not delegate these observations to a subagent.

**Files:**
- Read: `apps/vela-mobile/README.md`
- Later modify in Task 4: `apps/vela-mobile/docs/m1-ios-foundation-verification.md`

**Consumes:** Task 1 tested SHA/config, tester-controlled iPhone, local Xcode signing.

- [ ] **Step 1: Build production-shaped assets and open Xcode**

```bash
cd apps/vela-mobile
bun run build:ios:ide
```

In Xcode:

1. confirm device trust and Developer Mode;
2. select the local development team without committing it;
3. confirm bundle id `com.vela.app` and automatic signing resolve;
4. select the physical iPhone;
5. Run.

Record only generic device model/class, iOS version, Xcode version, tested SHA, build class, and outcome.

- [ ] **Step 2: Record `HPA-210-PROD-INSTALL-LAUNCH`**

Pass only when:

- the signed production-shaped app installs and launches cleanly;
- **More** contains no iOS interaction or TTS diagnostic entries;
- no token/provider/callback payload is exposed in visible product UI.

- [ ] **Step 3: Record `HPA-210-PROD-AUTH-WARM-CALLBACK`**

Starting signed out with Vela already running:

1. start Google sign-in;
2. complete Cognito/Google authentication in the system browser;
3. return through the callback while Vela remains warm.

Pass only when the callback establishes the verified session once, reaches authenticated Home, shows no protected content before verification completes, and exposes no OAuth/token material.

- [ ] **Step 4: Record `HPA-210-PROD-AUTH-COLD-CALLBACK`**

Start a fresh sign-in, leave the browser flow active, terminate Vela, then complete authentication so the callback cold-launches Vela.

Pass only when the launch URL is consumed once, the verified session is established, Home becomes usable, and there is no duplicate/stuck callback state.

- [ ] **Step 5: Record `HPA-210-PROD-RELAUNCH-RESTORATION`**

With a verified session:

1. force-close Vela;
2. relaunch from the Home screen;
3. wait for restoration.

Pass only when interactive sign-in is not required and protected content is not rendered before restoration is verified.

- [ ] **Step 6: Record `HPA-210-PROD-DUE-COUNT-ISOLATION`**

1. observe the authenticated due-review count;
2. trigger its normal refresh;
3. sign out;
4. confirm old protected due-count state disappears;
5. sign in again using the same Google account;
6. confirm stale state from the prior session is not presented as the current session’s state.

A second Google account is not required.

If a concrete network-recovery observation is needed while diagnosing this row, disable connectivity until Home shows its existing retry state, restore connectivity, and use **Retry**. Do not create a separate required row solely for that observation.

- [ ] **Step 7: Record `HPA-210-PROD-SIGNOUT-RELAUNCH`**

Sign out, terminate/relaunch Vela, and confirm no authenticated session or protected due-review content reappears.

**Stop condition:** Any failed or unrun required production row is `NO-GO`. Automated or Simulator evidence cannot substitute for it.

---

### Task 3: Run the physical diagnostic rows against the deployed identity

**Owner:** Operator. Do not delegate these observations to a subagent.

**Files:**
- Read: `apps/vela-mobile/docs/ios-interaction-baseline.md`
- Read: `apps/vela-mobile/docs/ios-foundation-architecture.md`
- Read: `apps/vela-mobile/src/diagnostics/tts-pronunciation-contract.ts`
- Later modify in Task 4: `apps/vela-mobile/docs/m1-ios-foundation-verification.md`

**Consumes:** same tested SHA and deployed API/Cognito identity verified in Task 1.

- [ ] **Step 1: Start DEV diagnostics with Task 1’s production public identifiers overlaid**

Plain `bun run dev:ios` is insufficient because development env normally defaults to localhost/LAN values. Keep DEV mode so diagnostics compile, but overlay `.env.production` into the process:

```bash
cd apps/vela-mobile
set -a
source .env.production
set +a
bun run dev:ios
```

The inherited values must be the Task 1-verified:

```text
VITE_MOBILE_API_URL
VITE_COGNITO_USER_POOL_ID
VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID
VITE_COGNITO_OAUTH_DOMAIN
VITE_AWS_REGION
```

Expected: DEV diagnostic entries are available, while the API/Cognito identity matches Task 1. If the run uses localhost, a LAN API, placeholder IDs, or a different deployed environment, record `prerequisite_missing` and rerun after correcting the overlay.

- [ ] **Step 2: Record `HPA-210-DIAG-TTS-CORE` using the pinned word `水`**

Use the checked-in `DIAGNOSTIC_WORD` (`水`, reading `みず`, translation `water`) and the built-in iPhone speaker at nonzero media volume with Silent Mode off.

Pass only when:

1. authenticated preparation succeeds;
2. first user-gesture playback audibly says the expected Japanese word;
3. explicit replay succeeds;
4. replay does not overlap or auto-resume unexpectedly.

- [ ] **Step 3: Record `HPA-210-DIAG-AUDIO-SILENT-MODE`**

Repeat `水` playback with actual system Silent Mode enabled.

- On devices with a Ring/Silent switch, use it.
- On Action Button devices, configure/use the Action Button for Silent Mode or use the system Silent Mode control and confirm the system indicator.
- Focus Mode is **not** the Silent Mode control.

Record the observed audible/silent policy exactly; do not infer it from browser media events or Simulator behavior.

- [ ] **Step 4: Record `HPA-210-DIAG-AUDIO-INTERRUPTION`**

Start `水` playback, trigger an external/system interruption or app-inactive transition, return to Vela, then explicitly replay.

Pass only when active audio stops/settles safely, does not unexpectedly auto-resume, and remains explicitly replayable.

- [ ] **Step 5: Select the audio conclusion using the HPA-210 rule**

Select exactly one only when evidence is attributable:

```text
HTML-only accepted
native audio-session integration required
native player adapter required
```

Mapping:

- `HTML-only accepted`: TTS core and interruption pass, and Silent Mode behavior satisfies the foreground pronunciation rule.
- `native audio-session integration required`: TTS core and interruption pass; Silent Mode policy is the **sole** audio failure. This is the one permitted High reclassification and must block the first audio-dependent M2 work.
- `native player adapter required`: physical evidence shows the current `HtmlAudioPlayer` cannot satisfy core player behavior and needs replacement. This is hard `NO-GO`.

If evidence is incomplete or the failure cause is not attributable, keep `Pending physical HPA-210 evidence` and record `NO-GO`.

- [ ] **Step 6: Record `HPA-210-DIAG-IME`**

Install/use the Japanese Kana keyboard:

1. type `にほんご`;
2. select `日本語` from IME conversion;
3. confirm composition does not submit early;
4. complete and submit.

Pass only when draft, committed value, bound model, post-render native input, and submitted value are all exactly `日本語`.

- [ ] **Step 7: Record `HPA-210-DIAG-KEYBOARD-SAFE-AREA`**

In portrait:

1. focus controls near the lower viewport;
2. show/hide the software keyboard repeatedly;
3. confirm the focused control remains reachable;
4. inspect top, footer/tab, and horizontal inset behavior;
5. confirm keyboard dismissal leaves no permanent overlap/offset.

Pass only with no clipped interactive control, permanent keyboard obstruction, or unsafe inset regression.

- [ ] **Step 8: Record `HPA-210-DIAG-NATIVE-SWIPE-BACK`**

Perform a real physical edge-swipe from a route with positive app-owned mobile depth.

Pass only when the native gesture executes the expected chronological back path and the depth settles/decrements rather than remaining a no-op or trapping navigation.

- [ ] **Step 9: Record `HPA-210-DIAG-NAVIGATION`**

Exercise the existing diagnostic controls for:

- visible back;
- tab switching;
- deep entry;
- cold entry;
- resume;
- scroll restoration;
- depth-zero fallback/no trap.

Pass only when the documented chronological policy remains usable and has a safe escape/fallback path.

**Stop condition:** Any required failed/unrun/localhost-backed/prerequisite-blocked diagnostic row is `NO-GO`, except the exact Silent-Mode-only High exception after TTS core and interruption have passed.

---

### Task 4: Reconcile the canonical records and repository guidance

**Owner:** Agent-assisted from the operator’s recorded observations.

**Files:**
- Modify: `apps/vela-mobile/docs/m1-ios-foundation-verification.md`
- Modify when audio evidence supports it: `apps/vela-mobile/docs/ios-foundation-architecture.md`
- Modify on `GO`: `CLAUDE.md`
- Modify on `GO`: `AGENTS.md`
- Modify only if execution proves it wrong: `apps/vela-mobile/README.md`

**Consumes:** Task 1 tested SHA plus actual Task 2/3 observations.

- [ ] **Step 1: Update deployed-config and named physical rows**

In `m1-ios-foundation-verification.md`:

- update `HPA-210-DEPLOYED-CONFIG-CONSISTENCY` to the new tested SHA/result;
- preserve `HPA-210-SIMULATOR-BUILD-INSTALL-LAUNCH` as deferred;
- add every named production and diagnostic row from this plan;
- record a UTC run ID, build/config class, generic environment, sanitized observation, outcome, and follow-up;
- never turn an unrun row into prose implying pass.

- [ ] **Step 2: Convert `HPA-210-PHYSICAL-ACCEPTANCE` into a rollup**

The umbrella row should reference the named production/diagnostic rows and summarize their aggregate result. It must not bundle OAuth, audio, IME, keyboard, and navigation into one uncheckable observation.

- [ ] **Step 3: Update Final Decision and Tested Behavior Commit**

For `GO`, state that fresh automated/config evidence and the named physical rows use the same tested behavior revision and deployed backend identity.

For `NO-GO`, name the minimum failed/unrun/`prerequisite_missing` rows and keep unobserved claims out of the record.

The narrow Silent-Mode-only High exception may still support HPA-210 `GO` only when TTS core and interruption pass, the conclusion is `native audio-session integration required`, and a High issue blocks the first audio-dependent M2 work.

- [ ] **Step 4: Update the audio architecture decision**

If Task 3 produced a conclusive mapping, replace:

```text
Pending physical HPA-210 evidence
```

with exactly one of:

```text
HTML-only accepted
native audio-session integration required
native player adapter required
```

and add a short rationale pointing to the named physical audio rows.

If the result remains unattributable/incomplete, leave it pending and keep the run `NO-GO`.

- [ ] **Step 5: Synchronize `CLAUDE.md` and `AGENTS.md` only on GO**

On `GO`:

- remove the paragraph saying HPA-210 physical acceptance is deferred/unclaimed;
- remove the `iOS interaction diagnostics — physical HPA-210 closure gate` section after the IME and native-swipe rows pass;
- replace with a concise pointer to the canonical verification/architecture records only if one is useful.

On `NO-GO`, leave the warnings in place and ensure the canonical record identifies the failed rows.

- [ ] **Step 6: Reconcile findings/source tickets/milestone recommendation**

In the verification record:

- remove deferred-physical findings only when the named row actually passed;
- list concrete corrective work for `NO-GO`;
- reconcile source-ticket closure only from evidence;
- set the M2 recommendation from the same decision, including any permitted High Silent Mode gate.

- [ ] **Step 7: Privacy/scope review**

```bash
git diff -- \
  apps/vela-mobile/docs/m1-ios-foundation-verification.md \
  apps/vela-mobile/docs/ios-foundation-architecture.md \
  CLAUDE.md AGENTS.md apps/vela-mobile/README.md
git diff --check
git status --short
```

Expected: only HPA-538-relevant docs plus any separately justified concrete defect fix; no local artifacts, personal identifiers, secrets, signing data, or generated native/web assets.

---

### Task 5: Final verification and tracker closeout

**Owner:** Agent-assisted; tracker changes follow the recorded physical result.

**Files:**
- Verify: all PR changes
- External: GitHub PR #66 and Linear HPA-538/HPA-210/source Mobile M1 issues

- [ ] **Step 1: Confirm the final evidence still matches executable behavior**

```bash
git diff origin/main...HEAD --name-only
git log --oneline --decorate origin/main..HEAD
git diff --check origin/main...HEAD
git status --short
```

If a commit after the recorded tested SHA touches executable source, native config, dependencies, build inputs, or verification tooling, repeat Task 1 and all affected physical rows before claiming `GO`.

- [ ] **Step 2: If a defect was fixed, verify its exact regression and reruns**

A product fix must have:

1. the failed physical row recorded first;
2. the narrow regression test when automatable;
3. the smallest implementation fix;
4. focused tests plus normal mobile gates;
5. a new tested SHA;
6. repeated deployed-config/automated freeze;
7. all affected physical rows rerun.

Do not add speculative fixes to satisfy the plan.

- [ ] **Step 3: Update PR #66 with actual outcomes**

Record only:

- final tested behavior SHA;
- deployed-config + automated result;
- named production-row result;
- named diagnostic-row result;
- audio conclusion;
- GO/NO-GO;
- any narrow follow-up issue references.

Keep sensitive device/account/session/signing data out of GitHub.

- [ ] **Step 4: Reconcile Linear from the observed decision**

For `GO`:

- mark HPA-538 `Done`;
- link PR #66/canonical verification record;
- reconcile HPA-210/source Mobile M1 tickets whose only remaining closure gate is now satisfied;
- if the Silent-Mode-only exception fired, ensure the High audio-session follow-up blocks the first audio-dependent M2 work.

For `NO-GO`:

- keep HPA-538 open/In Progress;
- record the exact failed/unrun/`prerequisite_missing` row and minimum corrective work;
- reopen an owning completed ticket only when the physical observation proves that implementation is defective.

- [ ] **Step 5: Mark the PR ready only when record and tracker agree**

Expected: PR #66 is no longer planning-only, the canonical record contains actual sanitized physical observations, required reruns are complete, repository guidance matches the physical status, and Linear carries the same GO/NO-GO decision.

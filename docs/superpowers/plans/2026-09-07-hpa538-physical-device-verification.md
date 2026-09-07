# HPA-538 Physical iPhone Foundation Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the deferred HPA-210 physical-device gate on one tester-controlled iPhone, record a same-revision GO/NO-GO, and resolve the pending iOS audio decision without adding a new verification subsystem.

**Architecture:** Reuse the existing HPA-210 runner, deployed-config verifier, Quasar/Capacitor/Xcode flows, development diagnostics, and canonical verification/architecture docs. Manual device observations are the source of truth; local automated receipts support them but are not committed. If a physical run exposes a concrete defect, record `NO-GO` first and amend this same HPA-538 PR/plan with the specific regression test and fix rather than guessing at a repair in advance.

**Tech Stack:** Bun, Turborepo, Quasar 2, Vue 3, Capacitor iOS, Xcode, Cognito/Google OAuth, existing Vela mobile diagnostics.

**Spec:** `docs/superpowers/specs/2026-09-07-hpa538-physical-device-verification-design.md`

## Global Constraints

- One HPA-538 branch and one PR; do not split production smoke, diagnostics, fixes, or closeout into separate PRs.
- No new Appium/Maestro/Playwright-mobile/native E2E framework.
- No new HPA-538 verification runner, manifest schema, evidence directory, fake-auth mode, or production diagnostic route.
- Use one tested behavior revision for load-bearing automated and physical evidence. An executable change requires a new SHA and rerun of affected gates/rows.
- `MOBILE_SKIP_ENV_VALIDATION=true`, localhost, placeholders, or a mismatched deployed environment cannot satisfy acceptance.
- Do not commit UDIDs, serials, account identifiers, OAuth/token material, signing identities, provisioning artifacts, presigned URLs, or raw sensitive logs.
- Keep automated receipts local under `.artifacts/hpa-210/`.
- Do not infer physical speaker, Silent Mode, IME, safe-area, keyboard, or native-navigation behavior from automated/Simulator results.
- Do not pre-plan speculative defect code. A discovered defect produces a concrete `NO-GO` finding first; then add the exact regression/fix steps to this same plan and PR.

---

### Task 1: Freeze the current behavior revision and rerun HPA-210 automated gates

**Files:**
- Read: `apps/vela-mobile/README.md`
- Read: `apps/vela-mobile/docs/m1-ios-foundation-verification.md`
- Read: `apps/vela-mobile/docs/ios-foundation-architecture.md`
- Read: `apps/vela-mobile/package.json`
- Generated local only: `.artifacts/hpa-210/**`

**Interfaces:**
- Consumes: existing `verify:deployed-config` and `verify:m1-foundation` package scripts.
- Produces: one exact tested behavior SHA plus passing local automated/deployed-config evidence for Tasks 2–4.

- [ ] **Step 1: Refresh the HPA-538 branch before evidence collection**

From the repository root:

```bash
git fetch origin
git switch codex/hpa-538-physical-device-verification
git status --short
git log -1 --oneline
```

Expected: the branch is clean. If `main` advanced with executable mobile/shared/backend changes that affect HPA-538, update the branch before continuing. Planning-only markdown commits do not themselves change runtime behavior.

- [ ] **Step 2: Bootstrap the checkout with the committed lockfiles**

```bash
bun install --frozen-lockfile
bun --filter @vela/common build
```

Expected: both commands exit `0`; mobile postinstall installs the committed Capacitor dependency tree under `apps/vela-mobile/src-capacitor/node_modules`.

- [ ] **Step 3: Prepare deployed mobile configuration using the existing CDK workflow**

Follow the repository README so `packages/cdk/cdk-outputs.json` reflects the deployed backend and `apps/vela-mobile/.env.production` is injected from those outputs. Then run:

```bash
cd apps/vela-mobile
bun run verify:deployed-config -- --cdk-outputs ../../packages/cdk/cdk-outputs.json
```

Expected: exit `0`; all five public mobile identifiers match the deployed outputs. Do not continue on placeholder or mismatched configuration.

- [ ] **Step 4: Record the exact tested behavior SHA**

```bash
git rev-parse HEAD
```

Copy the full SHA into the PR execution notes. This is the initial HPA-538 `testedBehaviorCommit` unless an executable file changes later.

- [ ] **Step 5: Run the existing HPA-210 automated freeze**

From `apps/vela-mobile`:

```bash
bun run verify:m1-foundation
```

Expected: exit `0`; install, lint, typecheck, compile, build, test, production-diagnostics, and mobile-secret-scan pass in order. The local receipt is written under `.artifacts/hpa-210/` and remains untracked.

- [ ] **Step 6: Verify the evidence run did not dirty tracked files**

```bash
cd ../..
git status --short
```

Expected: no tracked changes produced by the verification command.

**Stop condition:** If Steps 3 or 5 fail, do not begin physical acceptance. Record the concrete gate failure in the PR. Fix only a demonstrated verification/product problem on this same PR, then restart Task 1 from the new behavior SHA.

---

### Task 2: Run the physical production-smoke matrix

**Files:**
- Read: `apps/vela-mobile/README.md`
- Later modify in Task 4: `apps/vela-mobile/docs/m1-ios-foundation-verification.md`

**Interfaces:**
- Consumes: Task 1 tested SHA, passing deployed configuration, tester-controlled iPhone, local Xcode signing.
- Produces: sanitized observations for signed production install/launch, auth callbacks, restoration, due-review isolation, sign-out, and product-surface recovery.

- [ ] **Step 1: Prepare production Capacitor assets and open the native project**

```bash
cd apps/vela-mobile
bun run build:ios:ide
```

Expected: production web assets are built/synced and Xcode opens the `App` workspace without committing a development team.

- [ ] **Step 2: Complete local device/signing prerequisites in Xcode**

On the tester-controlled Mac/iPhone:

1. Confirm the iPhone is trusted and Developer Mode is enabled.
2. Select the local development team under **Signing & Capabilities** without committing that setting.
3. Confirm bundle id `com.vela.app` and automatic signing resolve.
4. Select the physical iPhone as the run destination.
5. Run the production-shaped app on the device.

Record only generic model class, iOS version, Xcode version, tested SHA, and build class. Do not copy the UDID, serial, signing identity, profile, or account data into the PR/repository.

Expected: the app installs and launches on the physical iPhone.

- [ ] **Step 3: Verify fresh Google sign-in and warm callback**

Starting signed out with Vela already running:

1. Start Google sign-in from the product UI.
2. Complete Cognito/Google authentication in the system browser.
3. Return through the app callback while the app process remains warm.
4. Confirm the authenticated Home surface appears and no protected content is shown before session verification completes.

Expected: PASS only when the real physical callback returns to the correct signed-in session without exposing credential material.

- [ ] **Step 4: Verify cold-start callback**

Start another fresh sign-in, leave the browser flow active, terminate the Vela app process, then complete authentication so the callback cold-launches Vela.

Expected: the app consumes the launch URL once, establishes the authenticated session, reaches Home, and does not become stuck or duplicate the callback.

- [ ] **Step 5: Verify relaunch restoration**

With a verified signed-in session:

1. Force-close Vela.
2. Relaunch from the Home screen icon.
3. Confirm restoration completes without another interactive sign-in.
4. Confirm protected content is not rendered while restoration is still unverified.

Expected: the session restores through the existing secure refresh-token path and the authenticated Home surface becomes usable.

- [ ] **Step 6: Verify due-review refresh and user/session isolation**

1. Observe the authenticated due-review count.
2. Trigger the normal refresh path and confirm it settles correctly.
3. Sign out.
4. Confirm the authenticated due count disappears with the old session.
5. Start a subsequent authenticated session and confirm no prior-user due-count state is presented as the new session's state.

Expected: PASS with no stale protected state crossing the sign-out/session boundary.

- [ ] **Step 7: Verify product-surface recovery/security behavior**

Exercise one normal user-recoverable authentication or network interruption available through the product flow, then recover through the supported action.

Expected: the UI remains non-sensitive, does not expose raw token/provider/network payloads, and recovery returns to a coherent signed-out or verified signed-in state.

- [ ] **Step 8: Verify final sign-out**

Sign out from an authenticated state and relaunch once.

Expected: no authenticated session or protected due-review content reappears after sign-out.

**Stop condition:** Any failed or unrun required row is `NO-GO`; do not reinterpret unit tests or Simulator behavior as a pass. Record the observation and continue only when doing so is safe/useful for diagnosis.

---

### Task 3: Run the physical diagnostic-observation matrix

**Files:**
- Read: `apps/vela-mobile/README.md`
- Read: `apps/vela-mobile/docs/ios-interaction-baseline.md`
- Read: `apps/vela-mobile/docs/ios-foundation-architecture.md`
- Later modify in Task 4: `apps/vela-mobile/docs/m1-ios-foundation-verification.md`
- Conditionally modify in Task 4: `apps/vela-mobile/docs/ios-foundation-architecture.md`

**Interfaces:**
- Consumes: same tested behavior SHA/deployed backend from Task 1 and the same physical iPhone used in Task 2.
- Produces: observed TTS/audio, Japanese IME, keyboard/safe-area, and navigation results plus one evidence-backed audio-adapter conclusion when possible.

- [ ] **Step 1: Start the existing development diagnostics**

```bash
cd apps/vela-mobile
bun run dev:ios
```

Keep the development server running while Xcode launches the development build. Use the same deployed API/Cognito environment verified in Task 1. Do not add a new diagnostic route or production test flag.

Expected: **More → iOS Interaction Diagnostics** and the pronunciation diagnostic are available only in the development build.

- [ ] **Step 2: Verify TTS preparation, playback, replay, and audible output**

Using a known Japanese vocabulary item:

1. Trigger authenticated TTS preparation.
2. Play the result through the physical iPhone speaker.
3. Confirm the expected Japanese pronunciation is audible.
4. Replay explicitly.

Expected: preparation reaches a usable audio state, initial playback is audible/correct, and explicit replay works without an automatic unwanted resume.

- [ ] **Step 3: Verify Silent Mode behavior**

Repeat pronunciation playback with the hardware Silent Mode state enabled, then return it to the normal state and replay.

Expected: record the actual audible/silent behavior exactly as observed. Do not infer the result from `HtmlAudioPlayer`, browser media events, or Simulator behavior.

- [ ] **Step 4: Verify interruption and explicit recovery**

Start playback, trigger a normal app inactive/interruption event available on the device, return to Vela, then replay explicitly.

Expected: active audio stops/settles safely; returning to the app does not unexpectedly auto-resume; explicit replay recovers.

- [ ] **Step 5: Verify Japanese IME composition**

Ensure the Japanese Kana keyboard is installed. In the diagnostics input:

1. type `にほんご`;
2. choose `日本語` from IME conversion;
3. confirm composition does not submit early;
4. complete and submit.

Expected: draft, committed value, bound model, post-render native input, and submitted value are all exactly `日本語`.

- [ ] **Step 6: Verify keyboard and safe-area behavior**

With the diagnostic page in normal portrait usage:

1. focus controls near the lower viewport;
2. show/hide the software keyboard repeatedly;
3. confirm the focused control remains reachable;
4. inspect headerless top inset, footer/tab inset, and horizontal insets;
5. confirm keyboard dismissal does not leave permanent obscuring/offset state.

Expected: no clipped interactive control, permanent keyboard overlap, or unsafe inset regression.

- [ ] **Step 7: Verify chronological/native navigation behavior**

Exercise the existing diagnostic scenarios for:

- visible back navigation;
- native swipe-back;
- tab switching;
- deep entry;
- cold entry;
- resume;
- scroll restoration;
- depth-zero fallback/no trap.

Expected: navigation follows the documented chronological policy and always retains a usable escape/fallback path.

- [ ] **Step 8: Select the audio-adapter conclusion from the physical evidence**

Choose exactly one when the TTS/Silent Mode/interruption observations are complete:

```text
HTML-only accepted
native audio-session integration required
native player adapter required
```

If the evidence is incomplete, retain `Pending physical HPA-210 evidence` and classify the run `NO-GO`.

---

### Task 4: Reconcile the canonical verification/architecture records

**Files:**
- Modify: `apps/vela-mobile/docs/m1-ios-foundation-verification.md`
- Modify only when evidence supports it: `apps/vela-mobile/docs/ios-foundation-architecture.md`
- Modify only if execution disproves an instruction: `apps/vela-mobile/README.md`

**Interfaces:**
- Consumes: Task 1 tested SHA and actual Task 2/3 observations.
- Produces: repository-level GO/NO-GO record and the final evidence-backed audio decision.

- [ ] **Step 1: Replace stale HPA-210 final-decision prose with the actual HPA-538 run result**

In `m1-ios-foundation-verification.md`, update **Final Decision** and **Tested Behavior Commit** to the actual current run. Preserve historical cleanup-head evidence as history rather than presenting it as current physical evidence.

For `GO`, state that the fresh automated gates, production smoke, diagnostic observations, and physical acceptance all refer to the same tested behavior revision/deployed backend.

For `NO-GO`, state the minimum failed/prerequisite rows and keep unobserved claims out of the record.

- [ ] **Step 2: Populate production-smoke and physical rows from Task 2**

For each load-bearing row record only:

```text
ID | Commit | Run ID | Matrix class | Build/config | Environment | Precondition | Observation | Status | Evidence | Follow-up
```

Use a UTC run ID such as `YYYYMMDDTHHMMSSZ-production-smoke`. Evidence text is a sanitized operator observation or local receipt reference; do not add raw logs/screenshots to the repository.

- [ ] **Step 3: Populate diagnostic rows from Task 3**

Record separate sanitized rows for TTS/playback, Silent Mode, interruption recovery, IME composition, keyboard/safe area, and navigation. Do not collapse missing observations into a generic pass.

- [ ] **Step 4: Update the audio architecture decision when conclusive**

If Task 3 selected an audio outcome, replace:

```text
Pending physical HPA-210 evidence
```

in `ios-foundation-architecture.md` with the exact selected conclusion and a short rationale referring to the physical HPA-538 observations in the verification record.

If Task 3 was incomplete, leave the architecture decision pending.

- [ ] **Step 5: Reconcile findings, source-issue mapping, and milestone recommendation**

In `m1-ios-foundation-verification.md`:

- remove deferred-physical findings only when the corresponding observation actually passed;
- list any concrete corrective issue for a `NO-GO`;
- set the Milestone 2 recommendation to `GO` only when every required criterion passed;
- keep source-ticket closure statements tied to the new evidence, not to historical status values.

- [ ] **Step 6: Review privacy and scope before committing**

```bash
git diff -- apps/vela-mobile/docs/m1-ios-foundation-verification.md apps/vela-mobile/docs/ios-foundation-architecture.md apps/vela-mobile/README.md
git diff --check
git status --short
```

Expected: only HPA-538-relevant docs (plus any separately planned concrete defect fix) changed; no local artifacts, personal identifiers, secrets, signing data, or generated native/web assets are tracked.

- [ ] **Step 7: Commit the physical verification record**

When the evidence is complete and sanitized:

```bash
git add apps/vela-mobile/docs/m1-ios-foundation-verification.md
```

Add `apps/vela-mobile/docs/ios-foundation-architecture.md` only if its audio/contract text legitimately changed, and add `apps/vela-mobile/README.md` only if a documented command was proven wrong.

```bash
git commit -m "test(mobile): record HPA-538 physical verification"
```

Expected: the commit contains the final evidence record, not raw device artifacts.

---

### Task 5: Final verification and tracker closeout

**Files:**
- Verify: all HPA-538 PR changes
- External: GitHub draft PR and Linear HPA-538/HPA-210 source tickets

**Interfaces:**
- Consumes: completed Task 4 record and any concrete fix/rerun amendments made on this same PR.
- Produces: final PR state and accurate Linear closeout.

- [ ] **Step 1: Confirm the final tested behavior SHA still matches the evidence**

```bash
git diff origin/main...HEAD --name-only
git log --oneline --decorate origin/main..HEAD
```

If commits after the recorded behavior SHA touched executable source, native config, dependencies, build inputs, or verification tooling, repeat Task 1 and every affected physical row before claiming `GO`.

- [ ] **Step 2: Re-run the lightweight repository hygiene check**

```bash
git diff --check origin/main...HEAD
git status --short
```

Expected: clean working tree and no whitespace errors.

If executable code was changed to fix an observed defect, also rerun the exact automated gates from Task 1; the canonical record must already point at that new tested SHA.

- [ ] **Step 3: Update the PR summary with actual outcomes**

Record:

- final tested behavior SHA;
- automated/deployed-config result;
- physical production-smoke result;
- physical diagnostic result;
- audio-adapter decision;
- GO/NO-GO;
- any narrow follow-up issue references.

Keep all sensitive device/account/session data out of the PR body/comments.

- [ ] **Step 4: Reconcile Linear only from the observed decision**

For `GO`:

- mark HPA-538 `Done`;
- link the final PR/verification record;
- reconcile HPA-210/source Mobile M1 tickets whose only remaining closure requirement was this physical evidence.

For `NO-GO`:

- keep HPA-538 open/in progress;
- record the exact failed/prerequisite scenario and minimum corrective work;
- reopen a completed owning ticket only when the physical observation proves that owner's implementation is defective.

- [ ] **Step 5: Mark the PR ready only after the record and tracker agree**

Expected: the PR is no longer planning-only, the canonical docs contain actual observations, all required reruns are complete, and Linear reflects the same GO/NO-GO decision.

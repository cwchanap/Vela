# HPA-538 Physical iPhone Foundation Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Tasks 2–3 are operator-owned because they require Xcode signing, real Google OAuth, physical audio/Silent Mode, Japanese IME, and native gestures.

**Goal:** Complete the deferred HPA-210 physical-device gate on one tester-controlled iPhone and record one final same-revision GO/NO-GO.

**Architecture:** The spec owns row criteria, Silent Mode policy, evidence rules, and GO/NO-GO semantics. This plan owns commands, ordering, operator handoffs, rerun rules, and closeout. Reuse the existing HPA-210 runner/config verifier/checklist/diagnostics; add no verification subsystem.

**Tech Stack:** Bun, Quasar/Capacitor iOS, Xcode, AWS CDK, Cognito/Google OAuth.

**Spec:** `docs/superpowers/specs/2026-09-07-hpa538-physical-device-verification-design.md`

## Global Constraints

- One HPA-538 ticket / one PR (#66), including any narrow defect fix discovered by this acceptance work.
- No Appium/Maestro/Playwright-mobile, new runner, manual-recording CLI, evidence schema, fake auth, or production diagnostic route.
- Final canonical evidence uses one tested behavior SHA. Pre-fix failures may be noted in PR/Linear but are not mixed with post-fix rows.
- Production smoke runs before DEV diagnostics because both installs use `com.vela.app`.
- Missing/stale outputs, local/placeholder config, CORS, TTS settings, due data, device/signing, or other prerequisites are `prerequisite_missing`, never inferred passes.
- Simulator acceptance passed in the simulator class only (see the operator amendment); receipts remain local under `.artifacts/hpa-210/`.
- Never record UDIDs, account identity, tokens, provider keys, signing material, presigned URLs, or raw sensitive logs.
- Every shell block below starts from the repository root unless it explicitly changes directory inside that block. Treat blocks as independent.
- Task 1 Steps 3, 7, and Task 3 Step 1 intentionally share `DEV_ORIGIN`; run those steps in one operator shell/session, or re-run Task 1 Step 3 before a later block that needs it.

---

### Task 1: Establish prerequisites and freeze the tested revision

**Owner:** Agent-assisted; operator supplies AWS credentials and tester-account state.

**Produces:** fresh deployed outputs/config, temporary physical-DEV CORS access, account prerequisites, tested SHA, passing automated freeze.

- [ ] **Step 1: Refresh branch and prove tracked tree is clean**

```bash
git fetch origin
git switch codex/hpa-538-physical-device-verification
git status --porcelain=v1 -uno
```

Expected: final command prints nothing. Otherwise stop; `verify:m1-foundation` will reject the tracked-dirty checkout.

- [ ] **Step 2: Bootstrap**

```bash
bun install --frozen-lockfile
bun --filter @vela/common build
```

Expected: both exit `0`.

- [ ] **Step 3: Resolve the physical DEV origin**

```bash
set -euo pipefail
DEV_IFACE="$(route get default | awk '/interface:/{print $2}')"
[ -n "$DEV_IFACE" ] || { echo "No default interface found" >&2; exit 1; }
DEV_LAN_IP="$(ipconfig getifaddr "$DEV_IFACE")"
[ -n "$DEV_LAN_IP" ] || { echo "No LAN IP for interface $DEV_IFACE" >&2; exit 1; }
case "$DEV_LAN_IP" in 127.*) echo "LAN IP is loopback" >&2; exit 1 ;; esac
DEV_ORIGIN="http://${DEV_LAN_IP}:9100"
printf '%s\n' "$DEV_ORIGIN"
```

Expected: a real Mac LAN origin, not localhost/127.0.0.1. Preserve the value for later Task 1/3 commands and sanitized run context.

- [ ] **Step 4: Refresh CloudFormation outputs before env injection**

```bash
cd packages/cdk
bun run get-outputs
bun scripts/inject-env.ts
cd ../../apps/vela-mobile
bun run verify:deployed-config -- --cdk-outputs ../../packages/cdk/cdk-outputs.json
```

Expected: exit `0`. `cdk:deploy` is not a substitute for `get-outputs`; only `get-outputs` refreshes `cdk-outputs.json`.

- [ ] **Step 5: Prepare the tester account**

Using the deployed Vela web app with the same Google account as the iPhone run:

1. **Settings → Text-to-Speech:** save a working provider/API key for the deployed environment.
2. Confirm the setting saves successfully; never copy the key into evidence.
3. Prepare existing product/SRS data until Home reports a visible non-zero due count (`due_today >= 1`).

Expected: TTS is configured server-side and due-count isolation has a visible protected value. Otherwise stop with `prerequisite_missing`.

- [ ] **Step 6: Build assets required for an ApiStack deployment**

```bash
cd apps/vela
bun run build
cd ../../packages/cdk
bun run build
```

Expected: SPA assets and Lambda bundle exist so CDK synthesis/deploy does not fail on missing asset paths.

- [ ] **Step 7: Temporarily add the physical DEV origin to deployed CORS**

Run this in the same shell where `DEV_ORIGIN` from Step 3 is defined; if that shell was closed, repeat Step 3 first.

```bash
cd packages/cdk
PROD_DOMAIN="${VELA_DOMAIN_NAME:-vela.cwchanap.dev}"
TEMP_CORS_ALLOWED_ORIGINS="https://${PROD_DOMAIN},http://localhost:9000,http://127.0.0.1:9000,http://localhost:9100,http://127.0.0.1:9100,capacitor://localhost,${DEV_ORIGIN}"
CORS_ALLOWED_ORIGINS="$TEMP_CORS_ALLOWED_ORIGINS" bunx aws-cdk deploy ApiStack
```

Expected: `ApiStack` deploy succeeds, preserving all default origins including `capacitor://localhost` and adding only the current Mac `DEV_ORIGIN`.

If the normal production deployment requires environment values missing from the operator shell, stop rather than deploy a partially configured stack.

- [ ] **Step 8: Refresh outputs again after deployment, then freeze config/SHA**

```bash
cd packages/cdk
bun run get-outputs
bun scripts/inject-env.ts
cd ../../apps/vela-mobile
bun run verify:deployed-config -- --cdk-outputs ../../packages/cdk/cdk-outputs.json
cd ../..
git status --porcelain=v1 -uno
git rev-parse HEAD
```

Expected: config verifier exits `0`, tracked status prints nothing, and the final command gives the full tested behavior SHA. Record that SHA in PR execution notes.

- [ ] **Step 9: Run the existing automated freeze**

```bash
cd apps/vela-mobile
bun run verify:m1-foundation
```

Expected: exit `0` for install, lint, typecheck, compile, build, test, production-diagnostics, and mobile-secret-scan; local receipt remains under `.artifacts/hpa-210/`.

**Stop condition:** Do not start physical rows if any Task 1 gate fails. If executable code/tooling changes to fix a failure, repeat Task 1 from the new SHA.

---

### Task 2: Run production-smoke rows

**Owner:** Operator only.

- [ ] **Step 1: Follow the existing physical preflight, then install production-shaped Vela**

Use **Manual Physical-Run Checklist** in `apps/vela-mobile/docs/m1-ios-foundation-verification.md`, then:

```bash
cd apps/vela-mobile
bun run build:ios:ide
```

In Xcode select the local development team and tester-controlled iPhone, then Run. Do not persist signing/device identifiers.

- [ ] **Step 2: Execute all production row IDs from the spec in order**

```text
HPA-210-PROD-INSTALL-LAUNCH
HPA-210-PROD-AUTH-WARM-CALLBACK
HPA-210-PROD-AUTH-COLD-CALLBACK
HPA-210-PROD-RELAUNCH-RESTORATION
HPA-210-PROD-DUE-COUNT-ISOLATION
HPA-210-PROD-SIGNOUT-RELAUNCH
```

Use the spec’s exact pass criteria. Record sanitized PASS/FAIL/`prerequisite_missing` notes. Verify the due count is non-zero before the isolation row.

- [ ] **Step 3: Finish production rows before DEV install**

Do not start Task 3 with an unrun production row. Installing DEV replaces the production-shaped app.

**Stop condition:** A failed/unrun production row is provisional `NO-GO`. If a fix is attempted on PR #66, do not finalize canonical rows until the fix, new Task-1 SHA, and affected reruns are complete.

---

### Task 3: Run DEV diagnostic rows against the deployed identity

**Owner:** Operator only.

- [ ] **Step 1: Start DEV with production public config overlaid**

Run in the same operator shell where `DEV_ORIGIN` from Task 1 is available; if needed, repeat Task 1 Step 3 before this block.

```bash
cd apps/vela-mobile
set -a
source .env.production
set +a
bun run verify:deployed-config -- --cdk-outputs ../../packages/cdk/cdk-outputs.json
printf 'DEV origin: %s\n' "$DEV_ORIGIN"
bun run dev:ios
```

Expected: config verification passes; `DEV_ORIGIN` is the temporary allowed LAN origin; DEV diagnostic entries are present; authenticated requests use the Task-1 deployed API/Cognito identity.

If authenticated requests are CORS-blocked or use local/placeholder/different identity, record `prerequisite_missing`, not an audio/product failure.

- [ ] **Step 2: Run audio rows and apply the spec’s fixed decision rule**

```text
HPA-210-DIAG-TTS-CORE
HPA-210-DIAG-AUDIO-SILENT-MODE
HPA-210-DIAG-AUDIO-INTERRUPTION
```

Use the checked-in `水` / `みず` diagnostic word, built-in speaker, non-zero media volume, and actual system Silent Mode. Focus Mode is not Silent Mode.

After all three observations, select exactly the spec-mapped outcome:

```text
HTML-only accepted
native audio-session integration required
native player adapter required
```

If attribution is incomplete, leave the architecture decision pending and keep provisional `NO-GO`.

- [ ] **Step 3: Run IME/layout rows**

```text
HPA-210-DIAG-IME
HPA-210-DIAG-KEYBOARD-SAFE-AREA
```

Use the spec criteria; IME input is exactly `にほんご` → candidate `日本語`.

- [ ] **Step 4: Run native swipe and each navigation behavior separately**

```text
HPA-210-DIAG-NATIVE-SWIPE-BACK
HPA-210-DIAG-NAV-VISIBLE-BACK
HPA-210-DIAG-NAV-TABS
HPA-210-DIAG-NAV-DEEP-ENTRY
HPA-210-DIAG-NAV-COLD-ENTRY
HPA-210-DIAG-NAV-RESUME
HPA-210-DIAG-NAV-SCROLL-RESTORATION
HPA-210-DIAG-NAV-DEPTH-ZERO
```

Every row needs its own physical observation; no navigation umbrella pass.

- [ ] **Step 5: If a real defect appears, keep revisions isolated on this PR**

1. Record the failed observation as provisional `NO-GO` in PR #66 / HPA-538.
2. Add the narrow regression test when automatable and the smallest owner-module fix.
3. Commit the fix.
4. Repeat Task 1 for the new SHA.
5. Rerun every affected physical row.
6. Finalize canonical rows only for the final SHA.

If a production row must be rerun after DEV was installed, run `bun run build:ios:ide` and reinstall production-shaped Vela first; a DEV relaunch is not production evidence.

---

### Task 4: Restore infrastructure and write final canonical evidence

**Owner:** Agent-assisted from operator observations.

**Files:**

- Modify: `apps/vela-mobile/docs/m1-ios-foundation-verification.md`
- Modify (verification-status sync is required regardless of the audio outcome; record the audio conclusion only if the mapping is conclusive): `apps/vela-mobile/docs/ios-foundation-architecture.md`
- Modify on `GO`: `CLAUDE.md`, `AGENTS.md`
- Modify only if proven stale: `apps/vela-mobile/README.md`

- [ ] **Step 1: Remove the temporary LAN CORS allowance after the final diagnostic session**

```bash
cd packages/cdk
unset CORS_ALLOWED_ORIGINS
bunx aws-cdk deploy ApiStack
```

Expected: normal repo-default CORS is redeployed. Do this on both GO and NO-GO once no more diagnostic rerun is pending. HPA-538 cannot close `GO` while the LAN origin remains intentionally deployed.

- [ ] **Step 2: Refresh/verify config after CORS cleanup**

```bash
cd packages/cdk
bun run get-outputs
bun scripts/inject-env.ts
cd ../../apps/vela-mobile
bun run verify:deployed-config -- --cdk-outputs ../../packages/cdk/cdk-outputs.json
```

Expected: exit `0` for the same final deployed public identity.

- [ ] **Step 3: Update the canonical HPA-210 verification record from the final SHA only**

In `apps/vela-mobile/docs/m1-ios-foundation-verification.md`:

- repin `HPA-210-DEPLOYED-CONFIG-CONSISTENCY` to the final SHA/result;
- record `HPA-210-SIMULATOR-BUILD-INSTALL-LAUNCH` as passed in the simulator class only (already done per the operator amendment);
- add every named spec row with its actual sanitized observation;
- convert `HPA-210-PHYSICAL-ACCEPTANCE` to a rollup referencing those rows;
- update **Final Decision** and **Tested Behavior Commit** from the same revision.

Pre-fix observations may remain only as clearly historical notes, never as part of the final pass set.

- [ ] **Step 4: Reconcile architecture record and repository guidance**

Update `ios-foundation-architecture.md` verification-status assertions to match the canonical record (simulator-class pass, waived physical rows, amended decision) regardless of the audio outcome. If audio mapping is conclusive, also record the exact selected outcome and reference the three named audio rows; otherwise the audio decision stays pending.

On `GO`, update both `CLAUDE.md` and `AGENTS.md` to reconcile the physical-guidance wording/status with the canonical record, retaining the physical warnings while any physical row remains unrun. Remove the deferred-physical paragraph and the physical HPA-210 IME/swipe section only once the rows they describe have actually run; when `GO` rests on waived physical rows (as under the operator amendment), keep the warnings worded as unverified on physical hardware rather than deleting them. On `NO-GO`, leave those warnings intact.

- [ ] **Step 5: Scope/privacy check**

```bash
git diff -- \
  apps/vela-mobile/docs/m1-ios-foundation-verification.md \
  apps/vela-mobile/docs/ios-foundation-architecture.md \
  CLAUDE.md AGENTS.md apps/vela-mobile/README.md
git diff --check
git status --short
```

Expected: only HPA-538-relevant source/docs plus any demonstrated same-PR defect fix; no generated artifacts, personal identifiers, provider keys, signing material, or raw sensitive logs.

---

### Task 5: Final integrity check and tracker closeout

**Owner:** Agent-assisted; tracker state follows the canonical record.

- [ ] **Step 1: Confirm no later executable commit invalidated evidence**

```bash
TESTED_SHA="97d702d322ce8f35aa0cc5915c9cb0d5e2dc62b6"  # recorded tested behavior SHA
git diff --name-only "$TESTED_SHA"..HEAD
git log --oneline --decorate "$TESTED_SHA"..HEAD
git diff --check "$TESTED_SHA"..HEAD
git status --short
```

If executable source/native config/dependencies/build inputs/verification tooling changed after the recorded SHA, repeat Task 1 and affected physical rows.

- [ ] **Step 2: Update PR #66 with final outcomes**

Record final SHA, config/automated result, named production/diagnostic results, audio conclusion, CORS cleanup result, GO/NO-GO, and narrow follow-up references. Keep sensitive information out.

- [ ] **Step 3: Reconcile Linear**

For `GO`, mark HPA-538 Done and reconcile HPA-210/source M1 tickets supported by the new evidence. If the Silent-Mode-only exception fired, reuse/create the appropriate High audio-session follow-up and block the first audio-dependent M2 work.

For `NO-GO`, keep HPA-538 In Progress and record the exact failed/unrun/`prerequisite_missing` row plus minimum corrective work.

- [ ] **Step 4: Mark PR ready only when evidence, CORS cleanup, repository guidance, and Linear all agree**

---

### Operator amendment (2026-09-09): simulator-class closure

The operator accepted simulator-class evidence for HPA-538 closure (see the
spec's operator amendment). Execution state under that basis: Task 1
completed (tested SHA `97d702d322ce8f35aa0cc5915c9cb0d5e2dc62b6`, automated
freeze and deployed-config both green); Task 2 and Task 3 waived — never run;
Task 4 completed without the audio architecture change (audio mapping stays
pending) and without any CORS rollback (no temporary origin was deployed);
Task 5 executed against PR #66 and Linear.

# HPA-538 Physical iPhone Foundation Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Tasks 2–3 are operator-owned because they require Xcode signing, real Google OAuth, a physical speaker, actual Silent Mode, Japanese IME candidate selection, and native edge-swipe observation. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the deferred HPA-210 physical-device gate on one tester-controlled iPhone, record a same-revision GO/NO-GO, and resolve the pending iOS audio decision without adding a verification subsystem.

**Architecture:** The spec owns acceptance criteria and decision rules. This plan owns only execution order, commands, operator handoffs, stop conditions, and closeout. Reuse the existing HPA-210 runner, config verifier, physical checklist, Quasar/Capacitor/Xcode flows, diagnostics, and canonical records.

**Tech Stack:** Bun, Turborepo, Quasar 2, Vue 3, Capacitor iOS, Xcode, AWS CDK, Cognito/Google OAuth, existing Vela mobile diagnostics.

**Spec:** `docs/superpowers/specs/2026-09-07-hpa538-physical-device-verification-design.md`

## Global Constraints

- One HPA-538 ticket and one PR (#66). Do not split a fix into a second PR merely because physical acceptance found it.
- No Appium/Maestro/Playwright-mobile/native E2E framework, new runner, manual-recording CLI, manifest/evidence schema, fake auth, or production diagnostic route.
- The spec’s named rows and Silent Mode rule are authoritative; do not invent criteria during the phone session.
- Final canonical evidence must refer to one tested behavior SHA. A runtime/native/dependency/verification-tooling fix invalidates affected earlier observations.
- Failed pre-fix observations are recorded provisionally in PR/Linear; canonical current-run rows are finalized only after the final SHA and required reruns.
- `MOBILE_SKIP_ENV_VALIDATION=true`, stale outputs, localhost/LAN-only API, placeholder identity, or missing account prerequisites cannot satisfy acceptance.
- Production smoke runs before DEV diagnostics. Both use bundle id `com.vela.app`, so DEV replaces the production install.
- Keep HPA-210 Simulator build/install/launch deferred; it is not this ticket’s gate.
- Keep automated receipts local under `.artifacts/hpa-210/`.
- Do not commit device/account/session/signing/provider-key data or raw sensitive logs.

---

### Task 1: Establish all prerequisites and freeze the tested revision

**Owner:** Agent-assisted. Operator supplies AWS credentials and tester-account state.

**Files:**
- Read: `apps/vela-mobile/docs/m1-ios-foundation-verification.md`
- Read: `apps/vela-mobile/README.md`
- Generated/ignored: `packages/cdk/cdk-outputs.json`, `apps/vela-mobile/.env.production`, `.artifacts/hpa-210/**`

**Produces:** current deployed outputs, verified mobile public config, temporary physical-DEV CORS access, tester-account prerequisites, one tested behavior SHA, and passing automated HPA-210 gates.

- [ ] **Step 1: Refresh the branch and prove tracked files are clean**

```bash
git fetch origin
git switch codex/hpa-538-physical-device-verification
git status --porcelain=v1 -uno
```

Expected: no output from the final command. `verify:m1-foundation` rejects a tracked-dirty tree with:

```text
Working tree has tracked staged/unstaged changes; commit or stash them before running verification. Ignored files are allowed.
```

Do not continue with tracked changes.

- [ ] **Step 2: Bootstrap the checkout**

```bash
bun install --frozen-lockfile
bun --filter @vela/common build
```

Expected: both exit `0`.

- [ ] **Step 3: Resolve the Mac LAN origin used by physical `dev:ios`**

On the development Mac:

```bash
DEV_IFACE="$(route get default | awk '/interface:/{print $2}')"
DEV_LAN_IP="$(ipconfig getifaddr "$DEV_IFACE")"
DEV_ORIGIN="http://${DEV_LAN_IP}:9100"
printf '%s\n' "$DEV_ORIGIN"
```

Expected: a real LAN origin such as `http://192.168.x.x:9100`, not localhost/127.0.0.1. Keep it only as non-secret run context.

- [ ] **Step 4: Refresh CloudFormation outputs before generating mobile env**

```bash
cd packages/cdk
bun run get-outputs
bun scripts/inject-env.ts

cd ../../apps/vela-mobile
bun run verify:deployed-config -- --cdk-outputs ../../packages/cdk/cdk-outputs.json
```

Expected: `get-outputs` refreshes `cdk-outputs.json` from deployed `VelaStack`; `inject-env.ts` writes the current mobile `.env.production`; deployed-config verification exits `0` for API URL, user-pool id, mobile client id, OAuth domain, and region.

Do not substitute `cdk:deploy` for `get-outputs`: the deploy script does not write `cdk-outputs.json`.

- [ ] **Step 5: Prepare the tester account before touching the phone**

Using the same Google account that will be used on the iPhone and the deployed Vela web app:

1. Open **Settings → Text-to-Speech**.
2. Save a working TTS provider/API key for that account and deployed environment.
3. Confirm the setting is saved successfully; do not copy the key into PR/Linear/docs.
4. Ensure the account has at least one due review item and confirm Home reports `due_today >= 1` / a visible non-zero due count.

Expected: TTS is configured server-side and due-review isolation has a visible protected value to clear. If either condition is missing, record `prerequisite_missing` and resolve it before Tasks 2–3.

- [ ] **Step 6: Temporarily allow the physical DEV WebView origin on the deployed API**

`CORS_ALLOWED_ORIGINS` replaces the default list, so preserve every default and add only `DEV_ORIGIN`.

First build the existing assets CDK synthesis requires:

```bash
cd apps/vela
bun run build

cd ../../packages/cdk
bun run build
```

Then deploy only `ApiStack` with the temporary origin:

```bash
TEMP_CORS_ALLOWED_ORIGINS="https://vela.cwchanap.dev,http://localhost:9000,http://127.0.0.1:9000,http://localhost:9100,http://127.0.0.1:9100,capacitor://localhost,${DEV_ORIGIN}"
CORS_ALLOWED_ORIGINS="$TEMP_CORS_ALLOWED_ORIGINS" bunx aws-cdk deploy ApiStack
```

Expected: `ApiStack` deploy succeeds. `capacitor://localhost` remains allowed for production-shaped Task 2; `${DEV_ORIGIN}` allows the physical `dev:ios` WebView to reach authenticated deployed endpoints.

If the normal production deployment requires environment values not present in the operator shell, stop instead of deploying a partially configured stack.

- [ ] **Step 7: Refresh outputs again after deployment and re-verify mobile identity**

```bash
cd packages/cdk
bun run get-outputs
bun scripts/inject-env.ts

cd ../../apps/vela-mobile
bun run verify:deployed-config -- --cdk-outputs ../../packages/cdk/cdk-outputs.json
```

Expected: exit `0`. CORS is not part of this verifier, but all public API/Cognito identifiers are freshly tied to the deployed environment that Tasks 2–3 will use.

- [ ] **Step 8: Record the SHA and re-check the tracked-clean prerequisite**

```bash
cd ../..
git status --porcelain=v1 -uno
git rev-parse HEAD
```

Expected: status produces no output; record the full SHA in PR execution notes as the tested behavior revision.

- [ ] **Step 9: Run the existing HPA-210 automated freeze**

```bash
cd apps/vela-mobile
bun run verify:m1-foundation
```

Expected: exit `0`; install, lint, typecheck, compile, build, test, production-diagnostics, and mobile-secret-scan pass. Receipt stays under `.artifacts/hpa-210/`.

**Stop condition:** Do not start physical acceptance if Steps 4–9 fail. Fix only the demonstrated prerequisite/tooling/product problem, then restart Task 1 from the new final behavior SHA when executable files changed.

---

### Task 2: Execute production-smoke rows on the physical iPhone

**Owner:** Operator only.

**Consumes:** Task 1 SHA/config, tester account, eligible iPhone, local Xcode signing.

- [ ] **Step 1: Use the canonical physical preflight and install the production-shaped app**

Read and follow **Manual Physical-Run Checklist** in:

`apps/vela-mobile/docs/m1-ios-foundation-verification.md`

Then:

```bash
cd apps/vela-mobile
bun run build:ios:ide
```

In Xcode, select the local development team and tester-controlled iPhone, then Run. Do not commit signing settings or record UDID/account identity.

- [ ] **Step 2: Run the named production rows in this order**

Use the exact pass criteria from the spec and record sanitized PASS/FAIL/`prerequisite_missing` notes for:

```text
HPA-210-PROD-INSTALL-LAUNCH
HPA-210-PROD-AUTH-WARM-CALLBACK
HPA-210-PROD-AUTH-COLD-CALLBACK
HPA-210-PROD-RELAUNCH-RESTORATION
HPA-210-PROD-DUE-COUNT-ISOLATION
HPA-210-PROD-SIGNOUT-RELAUNCH
```

For `HPA-210-PROD-DUE-COUNT-ISOLATION`, confirm the starting due count is non-zero before testing sign-out/isolation.

- [ ] **Step 3: Finish production evidence before installing DEV**

Do not start Task 3 while a required production row is still unrun. The DEV build uses the same bundle id and replaces this installation.

**Stop condition:** A failed/unrun required production row is provisional `NO-GO`. If a same-PR fix is attempted, keep canonical current-run rows unresolved until the fix lands, Task 1 is repeated on the new SHA, and affected production rows are rerun.

---

### Task 3: Execute DEV diagnostic rows against the deployed identity

**Owner:** Operator only.

**Consumes:** same final SHA/API/Cognito identity from Task 1; temporary `${DEV_ORIGIN}` CORS allowance is still deployed.

- [ ] **Step 1: Start DEV diagnostics with the verified production public values overlaid**

```bash
cd apps/vela-mobile
set -a
source .env.production
set +a
bun run verify:deployed-config -- --cdk-outputs ../../packages/cdk/cdk-outputs.json
bun run dev:ios
```

Expected: config verification passes immediately before launch; DEV diagnostic entries exist; authenticated requests use the deployed API/Cognito identity. Record `${DEV_ORIGIN}` as environment context.

If TTS/auth requests are CORS-blocked, or the runtime resolves to localhost/placeholder/different identity, record `prerequisite_missing`; do not convert it into an audio/app failure.

- [ ] **Step 2: Run the audio rows using the spec’s fixed `水` probe and Silent Mode rule**

Run and record:

```text
HPA-210-DIAG-TTS-CORE
HPA-210-DIAG-AUDIO-SILENT-MODE
HPA-210-DIAG-AUDIO-INTERRUPTION
```

Use the built-in speaker and non-zero media volume. For Silent Mode, use the Ring/Silent switch or actual system Silent Mode control; Focus Mode is not equivalent.

After all three are observed, apply the spec’s deterministic mapping to exactly one of:

```text
HTML-only accepted
native audio-session integration required
native player adapter required
```

If attribution is incomplete, leave the architecture decision pending and record provisional `NO-GO`.

- [ ] **Step 3: Run IME and layout rows**

Run and record the spec criteria for:

```text
HPA-210-DIAG-IME
HPA-210-DIAG-KEYBOARD-SAFE-AREA
```

The IME scenario is exactly `にほんご` → candidate `日本語`; do not substitute simulator keyboard behavior.

- [ ] **Step 4: Run native swipe and each navigation behavior as its own row**

Run and record:

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

No umbrella navigation pass is allowed; each row must have an actual observation.

- [ ] **Step 5: Handle a discovered runtime defect without mixing revisions**

If a row exposes a reproducible product defect:

1. post the failed observation as provisional `NO-GO` on PR #66 / HPA-538;
2. add a focused regression test when automatable;
3. make the smallest owner-module fix on this same PR;
4. commit it;
5. repeat Task 1 to establish a new tested SHA;
6. rerun every affected production/diagnostic row.

Do not finalize pre-fix and post-fix rows together in the canonical matrix.

If a production row must be rerun after DEV has been installed, run `bun run build:ios:ide` and reinstall the production-shaped app first; a relaunch of the DEV install is not production evidence.

**Stop condition:** Any required failed/unrun/local-backend/`prerequisite_missing` diagnostic row is provisional `NO-GO`, except the spec’s exact Silent-Mode-only High audio-session exception after core audio passes.

---

### Task 4: Restore infrastructure and write the canonical final record

**Owner:** Agent-assisted from operator observations.

**Files:**
- Modify: `apps/vela-mobile/docs/m1-ios-foundation-verification.md`
- Modify when audio mapping is conclusive: `apps/vela-mobile/docs/ios-foundation-architecture.md`
- Modify on `GO`: `CLAUDE.md`, `AGENTS.md`
- Modify only if proven stale: `apps/vela-mobile/README.md`

- [ ] **Step 1: Remove the temporary LAN CORS origin after the final diagnostic session**

Reuse the already-built CDK assets from Task 1 and restore the repo-default ApiStack configuration:

```bash
cd packages/cdk
unset CORS_ALLOWED_ORIGINS
bunx aws-cdk deploy ApiStack
```

Expected: deployment succeeds with the normal default CORS list; `${DEV_ORIGIN}` is no longer intentionally allowed. Do this for both GO and NO-GO once no further diagnostic rerun is pending.

A run cannot close `GO` while the temporary LAN origin remains deployed.

- [ ] **Step 2: Refresh outputs/config after cleanup**

```bash
bun run get-outputs
bun scripts/inject-env.ts

cd ../../apps/vela-mobile
bun run verify:deployed-config -- --cdk-outputs ../../packages/cdk/cdk-outputs.json
```

Expected: deployed public identifiers still match the final tested environment.

- [ ] **Step 3: Populate the canonical verification record only from the final SHA**

In `apps/vela-mobile/docs/m1-ios-foundation-verification.md`:

- update `HPA-210-DEPLOYED-CONFIG-CONSISTENCY` to the final SHA/result;
- leave `HPA-210-SIMULATOR-BUILD-INSTALL-LAUNCH` deferred;
- add every named production/diagnostic row from the spec with actual sanitized observations;
- convert `HPA-210-PHYSICAL-ACCEPTANCE` into a rollup that references those rows;
- set **Final Decision** / **Tested Behavior Commit** from the same final revision.

Do not copy provisional pre-fix observations into the final pass set. If useful, preserve them only as clearly historical failed-run prose/PR notes.

- [ ] **Step 4: Reconcile the audio architecture decision**

If the audio mapping is conclusive, update `apps/vela-mobile/docs/ios-foundation-architecture.md` with exactly the spec-selected outcome and a short pointer to the named physical audio rows.

If attribution remains incomplete, leave `Pending physical HPA-210 evidence` and the run `NO-GO`.

- [ ] **Step 5: Synchronize repository guidance only on GO**

On `GO`, update both `CLAUDE.md` and `AGENTS.md`:

- remove the paragraph that says HPA-210 physical acceptance is still deferred;
- remove the `iOS interaction diagnostics — physical HPA-210 closure gate` section after physical IME and native swipe-back pass;
- keep only a concise pointer to the canonical verification/architecture records if useful.

On `NO-GO`, leave those warnings and make the canonical record name the failed/prerequisite rows.

- [ ] **Step 6: Review privacy, scope, and formatting**

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

### Task 5: Final rerun check and tracker closeout

**Owner:** Agent-assisted; tracker state follows the canonical record.

- [ ] **Step 1: Confirm no executable commit invalidated the final evidence**

```bash
git diff origin/main...HEAD --name-only
git log --oneline --decorate origin/main..HEAD
git diff --check origin/main...HEAD
git status --short
```

If a commit after the recorded tested SHA changed executable source, native config, dependencies, build inputs, or verification tooling, repeat Task 1 and every affected physical row before `GO`.

- [ ] **Step 2: Update PR #66 with actual final outcomes**

Record only:

- final tested behavior SHA;
- deployed-config + automated result;
- named production-row result;
- named diagnostic-row result;
- audio conclusion;
- CORS cleanup result;
- GO/NO-GO and narrow follow-up references.

- [ ] **Step 3: Reconcile Linear from the same decision**

For `GO`:

- mark HPA-538 `Done`;
- link PR #66/canonical verification record;
- reconcile HPA-210/source Mobile M1 tickets whose only remaining gate is satisfied;
- if the Silent-Mode-only exception fired, reuse/create the appropriate High follow-up work and block the first audio-dependent M2 task.

For `NO-GO`:

- keep HPA-538 open/In Progress;
- record the exact failed/unrun/`prerequisite_missing` row and minimum corrective work;
- reopen an owning completed ticket only when the physical observation proves that implementation defective.

- [ ] **Step 4: Mark PR #66 ready only when record, infrastructure, and tracker agree**

Expected: canonical rows are based on one final SHA, the temporary LAN CORS allowance is removed, required reruns are complete, repository guidance matches the physical status, and Linear carries the same GO/NO-GO decision.
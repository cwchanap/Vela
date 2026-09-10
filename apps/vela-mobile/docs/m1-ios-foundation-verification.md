# M1 iOS Foundation Verification

## Final Decision

**Decision:** GO (operator-amended basis, 2026-09-09)

The automated phase passed on tested behavior SHA
`97d702d322ce8f35aa0cc5915c9cb0d5e2dc62b6`: the eight automated gates ran in
order (install, lint, typecheck, compile, build, test, production-diagnostics,
mobile-secret-scan) on a tracked-clean checkout; `verify:deployed-config`
matched all five public identifiers against fresh `VelaStack` outputs for the
same SHA; and the simulator-class build/install/launch row passed on that SHA
(see the Production Smoke Matrix below).

This GO rests on the operator amendment recorded in
`docs/superpowers/specs/2026-09-07-hpa538-physical-device-verification-design.md`:
the operator accepted simulator-class evidence as sufficient for HPA-538
closure and waived the physical rows. The physical production-smoke,
diagnostic-observation, and physical-acceptance rows were **waived by
operator decision, not passed** — no physical observation was made on this
revision. Follow-ups: run the waived physical rows under their own evidence
class before relying on physical-device behavior, and resolve the audio
adapter mapping before the first audio-dependent M2 work.

## Tested Behavior Commit

`testedBehaviorCommit`: `97d702d322ce8f35aa0cc5915c9cb0d5e2dc62b6`

This is the frozen behavior revision for the automated freeze, the
deployed-config comparison, and the simulator-class build/install/launch row;
documentation-only commits after this SHA do not change executable behavior.

Historical note: the prior frozen revision was
`97f018c48436b383bd36c81d9eb9a3abd90e4d54` (not an ancestor of this branch).
That revision included the app, native project, configuration, dependencies,
the minimal verification runner, the deployed-config verifier fix (full-URL
comparison, process.env precedence, build-time env validation), the portable
ESM main-module check, the clean-working-tree gate in the M1 harness, and the
harness manifest-persistence fix with its regression test.

## Automated Phase Evidence

The canonical automated-phase pass for the current tested behavior SHA
`97d702d322ce8f35aa0cc5915c9cb0d5e2dc62b6` (HPA-538) is the clean re-run
noted below. Historically, the automated phase first passed on commit
`97f018c48436b383bd36c81d9eb9a3abd90e4d54`: the eight gates ran in order
(install, lint, typecheck, compile, build, test, production-diagnostics,
mobile-secret-scan), and that passing receipt was a local artifact under
`.artifacts/hpa-210/` (not committed). Receipts are local and ephemeral; this
document is the committed verification record.

HPA-209 retains its historical flat evidence layout under
`docs/evidence/hpa-209/`; do not migrate or reinterpret those files as
HPA-210 receipts. The automated freeze was re-run clean on
`97d702d322ce8f35aa0cc5915c9cb0d5e2dc62b6` (HPA-538); its receipt is a local
artifact under `.artifacts/hpa-210/97d702d322ce8f35aa0cc5915c9cb0d5e2dc62b6/`.

## Production Smoke Matrix

No physical production-smoke row is recorded — the physical production-smoke
work was waived by operator decision on 2026-09-09 (see the spec's operator
amendment); the automated and Simulator manifests did not substitute for it.
The two rows below are the cleanup-design additions: the Simulator
build/install/launch row (run, passed on
`97d702d322ce8f35aa0cc5915c9cb0d5e2dc62b6`, simulator class only) and the
deployed-config-consistency row (run, passed on the same SHA).

| ID                                     | Commit                                     | Run ID | Matrix class                   | Build/config                                                                                                                                                                                                              | Environment                                                                                 | Precondition                                           | Observation                                                                                                                                                                                                                    | Status   | Evidence                                                                                                                                                | Follow-up                                                                         |
| -------------------------------------- | ------------------------------------------ | ------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| HPA-210-SIMULATOR-BUILD-INSTALL-LAUNCH | `97d702d322ce8f35aa0cc5915c9cb0d5e2dc62b6` | —      | Simulator build/install/launch | XcodeBuildMCP build + install + launch; Debug native configuration with production-shaped web bundle (production env, no DEV diagnostic entries; `verify:production-diagnostics` passed in the same-SHA automated freeze) | iOS Simulator, iPhone 16 (simulator class), iOS 26.5, Xcode 26.6                            | Clean cold launch: no stored session and no launch URL | App process launched, `WebView loaded` at `capacitor://localhost`; routed to guest sign-in screen (Vela wordmark + "Continue with Google"); `verify:deployed-config` exit 0 for the same SHA against fresh `VelaStack` outputs | `passed` | Local XcodeBuildMCP build/run logs (not committed); automated-freeze receipt local under `.artifacts/hpa-210/97d702d322ce8f35aa0cc5915c9cb0d5e2dc62b6/` | Simulator class only; physical rows remain deferred pending operator physical run |
| HPA-210-DEPLOYED-CONFIG-CONSISTENCY    | `97d702d322ce8f35aa0cc5915c9cb0d5e2dc62b6` | —      | Deployed-config consistency    | `bun run --cwd apps/vela-mobile verify:deployed-config -- --cdk-outputs ../../packages/cdk/cdk-outputs.json`                                                                                                              | Local shell; shipping `apps/vela-mobile/.env.production` vs `packages/cdk/cdk-outputs.json` | cdk-outputs.json present from the deployed backend     | All five public identifiers (full MobileApiURL with path, user-pool id, mobile client id, oauth domain, region) match; strict parsing rejects unknown flags; build-time env contract validated before comparison               | `passed` | CLI exit 0 (local run, no manifest)                                                                                                                     | Re-run after any CDK output or `.env.production` change                           |

## Diagnostic Observation Matrix

No row is recorded. Physical diagnostic observations were waived by operator
decision (2026-09-09, simulator-class closure); they were not run in any
evidence class, and machine checks do not establish human-observed native
behavior.

| ID  | Commit | Run ID | Matrix class | Build/config | Environment | Precondition | Observation | Status | Evidence | Follow-up |
| --- | ------ | ------ | ------------ | ------------ | ----------- | ------------ | ----------- | ------ | -------- | --------- |

## Physical iPhone Matrix

The recorded physical preflight below is historical only. The physical matrix
rows were never run to completion; the acceptance row was waived by operator
decision (2026-09-09 simulator-class closure) rather than passed, so this
matrix cannot establish physical readiness or acceptance for any revision.

| ID                          | Commit                                     | Run ID                                | Matrix class         | Build/config                             | Environment                          | Precondition                                                     | Observation                                                                                                                                                      | Status                 | Evidence                   | Follow-up                                                                           |
| --------------------------- | ------------------------------------------ | ------------------------------------- | -------------------- | ---------------------------------------- | ------------------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | -------------------------- | ----------------------------------------------------------------------------------- |
| HPA-210-PHYSICAL-PREFLIGHT  | `f0c6fe9d5282c3f5f34e6e5453ed3c23c0808f65` | `20260803T042801Z-physical-preflight` | Historical preflight | Manifest-recorded deployed configuration | Physical iPhone, not safely eligible | Safe availability, trust, and generic alias were not established | No signing or interaction step ran                                                                                                                               | `prerequisite_missing` | Local receipt (untracked)  | Rerun via the manual physical-run checklist                                         |
| HPA-210-PHYSICAL-ACCEPTANCE | —                                          | —                                     | Physical acceptance  | Not run                                  | Physical iPhone                      | Waived by operator decision (2026-09-09 simulator-class closure) | OAuth, restoration, due count, audio, Japanese IME, keyboard/safe-area, and navigation were not observed; waived, not passed — see the spec's operator amendment | `waived`               | No receipt; unrun (waived) | Run under its own evidence class when physical-device behavior becomes load-bearing |

## Manual Physical-Run Checklist

Owner: operator. Run these steps on the physical iPhone before recording any
physical matrix row.

- Device trust + Developer Mode enabled.
- Signing: team/identity correlation, profile expiry, `get-task-allow`,
  certificate availability (confirm via Xcode).
- Bundle id (`com.vela.app`) matches the Capacitor/Xcode signing config
  (`src-capacitor/capacitor.config.json` `appId`), not `.env.production` —
  `.env.production` carries no bundle identifier.
- Device eligibility: safe availability, generic non-identifying alias —
  **no UDID/email persistence**.
- Deployed-config consistency: `bun run --cwd apps/vela-mobile verify:deployed-config -- --cdk-outputs ../../packages/cdk/cdk-outputs.json` (run from the repository root; the `--cwd` flag makes the `../../packages/cdk/cdk-outputs.json` path resolve relative to `apps/vela-mobile`).

## Security and Secret Scan

The automated freeze records a passing `mobile-secret-scan` gate on the
current tested behavior SHA `97d702d322ce8f35aa0cc5915c9cb0d5e2dc62b6`
(historically first passed on `97f018c48436b383bd36c81d9eb9a3abd90e4d54`).
Machine evidence does not substitute a source inspection or a physical
acceptance observation.

## Architecture Decision Summary

The current source contract is maintained in
[iOS Foundation Architecture](ios-foundation-architecture.md). Its
implementation boundaries are source-level facts, not physical acceptance
observations.

## Findings and Follow-up Issues

- The physical-device prerequisite and all physical acceptance observations
  were waived by operator decision (2026-09-09); run them under their own
  evidence class before relying on physical-device behavior.
- The audio adapter decision is **pending audio evidence**; no audio row ran
  in any class (waived with the physical rows), so no audio conclusion is
  recorded.
- Linear was reconciled for HPA-538 and HPA-210 during the 2026-09-09
  operator-amended closeout.

## Source-Issue Closure Mapping

No source issue is marked closed by this verification. HPA-202 and HPA-205
through HPA-209 remain pending their own closure evidence; HPA-538 was closed
in Linear during the operator-amended closeout.

## Milestone 2 Recommendation

Milestone 2 may progress on the operator-amended simulator-class basis; the
first audio-dependent M2 work is still gated on the pending audio adapter
mapping (no audio row ran in any evidence class).

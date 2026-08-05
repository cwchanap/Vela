# M1 iOS Foundation Verification

## Final Decision

**Decision:** NO-GO

HPA-210 remains open. The automated phase passed on the cleanup-head commit
`663a3a158d882a12654b76345dbb0f03a811ba24`: the eight automated gates ran in
order (install, lint, typecheck, compile, build, test,
production-diagnostics, mobile-secret-scan) on a clean detached worktree of
that commit. The receipt is a local artifact under `.artifacts/hpa-210/` and
is not committed. No manual production-smoke, diagnostic-observation, or
physical-acceptance evidence was created.

Minimum corrective issues:

- Establish a tester-controlled physical iPhone that satisfies the manual
  physical-run checklist below, then run that checklist against the
  cleanup-head behavior revision and the same deployed backend.
- After the manual physical run passes, record both deferred physical matrix
  classes on that frozen behavior revision and the same deployed backend:
  - Production-smoke rows: Release/production asset install and launch; fresh
    direct-Google sign-in with warm and cold callbacks; relaunch restoration;
    authenticated Home due-count states and refresh/sign-out isolation; and
    product-security recovery without protected-content or credential exposure.
  - Diagnostic-observation rows: TTS preparation, playback, replay, audible
    pronunciation, silent-mode, and interruption observations; Japanese IME
    composition; keyboard and safe-area layout; and visible back, native-swipe,
    tab, deep-entry, cold-entry, resume, scroll-restoration, and no-trap
    navigation observations.
- Keep the audio adapter decision pending until those physical HPA-210
  observations exist.

## Tested Behavior Commit

`testedBehaviorCommit`: `663a3a158d882a12654b76345dbb0f03a811ba24`

This is the frozen behavior revision for the automated phase: the cleanup
head containing the app, native project, configuration, dependencies, and
the minimal verification runner.

## Automated Phase Evidence

The automated phase passed on the cleanup-head commit
`663a3a158d882a12654b76345dbb0f03a811ba24`: the eight gates ran in order (install, lint, typecheck,
compile, build, test, production-diagnostics, mobile-secret-scan), and the
passing receipt is a local artifact under `.artifacts/hpa-210/` (not
committed). Receipts are local and ephemeral; this document is the committed
verification record.

HPA-209 retains its historical flat evidence layout under
`docs/evidence/hpa-209/`; do not migrate or reinterpret those files as
HPA-210 receipts.

## Production Smoke Matrix

No production-smoke row is recorded — physical production-smoke work was
explicitly deferred; the automated and Simulator manifests are not a
substitute for it. The two rows below are the cleanup-design additions: the
Simulator build/install/launch row (deferred, unrun) and the
deployed-config-consistency row (run, passed).

| ID                                     | Commit                                     | Run ID | Matrix class                   | Build/config                                                                                                 | Environment                                                                                 | Precondition                                       | Observation                                                                                                                                | Status     | Evidence                            | Follow-up                                               |
| -------------------------------------- | ------------------------------------------ | ------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ----------------------------------- | ------------------------------------------------------- |
| HPA-210-SIMULATOR-BUILD-INSTALL-LAUNCH | —                                          | —      | Simulator build/install/launch | Xcode Simulator build/install/launch                                                                         | iOS Simulator                                                                               | Explicitly deferred by the user                    | Build, install, and launch were not re-run on the cleanup head                                                                             | `deferred` | No receipt; unrun                   | Resume when physical HPA-210 work resumes               |
| HPA-210-DEPLOYED-CONFIG-CONSISTENCY    | `663a3a158d882a12654b76345dbb0f03a811ba24` | —      | Deployed-config consistency    | `bun run --cwd apps/vela-mobile verify:deployed-config -- --cdk-outputs ../../packages/cdk/cdk-outputs.json` | Local shell; shipping `apps/vela-mobile/.env.production` vs `packages/cdk/cdk-outputs.json` | cdk-outputs.json present from the deployed backend | All five public identifiers (api origin, user-pool id, mobile client id, oauth domain, region) match; strict parsing rejects unknown flags | `passed`   | CLI exit 0 (local run, no manifest) | Re-run after any CDK output or `.env.production` change |

## Diagnostic Observation Matrix

No row is recorded. Physical diagnostic observations were explicitly deferred;
machine checks do not establish human-observed native behavior.

| ID  | Commit | Run ID | Matrix class | Build/config | Environment | Precondition | Observation | Status | Evidence | Follow-up |
| --- | ------ | ------ | ------------ | ------------ | ----------- | ------------ | ----------- | ------ | -------- | --------- |

## Physical iPhone Matrix

The recorded physical preflight below is historical only. Physical testing was
deferred after the current behavior revision was frozen, so it cannot establish
physical readiness or acceptance for that revision.

| ID                          | Commit                                     | Run ID                                | Matrix class         | Build/config                             | Environment                          | Precondition                                                     | Observation                                                                                              | Status                 | Evidence                  | Follow-up                                   |
| --------------------------- | ------------------------------------------ | ------------------------------------- | -------------------- | ---------------------------------------- | ------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------- | ------------------------------------------- |
| HPA-210-PHYSICAL-PREFLIGHT  | `f0c6fe9d5282c3f5f34e6e5453ed3c23c0808f65` | `20260803T042801Z-physical-preflight` | Historical preflight | Manifest-recorded deployed configuration | Physical iPhone, not safely eligible | Safe availability, trust, and generic alias were not established | No signing or interaction step ran                                                                       | `prerequisite_missing` | Local receipt (untracked) | Rerun via the manual physical-run checklist |
| HPA-210-PHYSICAL-ACCEPTANCE | —                                          | —                                     | Physical acceptance  | Not run                                  | Physical iPhone                      | Explicitly deferred by the user                                  | OAuth, restoration, due count, audio, Japanese IME, keyboard/safe-area, and navigation were not observed | `deferred`             | No receipt; unrun         | Resume HPA-210 physical validation          |

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
- Deployed-config consistency: `bun run verify:deployed-config -- --cdk-outputs ../../packages/cdk/cdk-outputs.json`.

## Security and Secret Scan

The automated phase records a passing `mobile-secret-scan` gate on the
cleanup-head commit `663a3a158d882a12654b76345dbb0f03a811ba24`. Machine
evidence does not substitute a source
inspection or a physical acceptance observation.

## Architecture Decision Summary

The current source contract is maintained in
[iOS Foundation Architecture](ios-foundation-architecture.md). Its
implementation boundaries are source-level facts, not physical acceptance
observations.

## Findings and Follow-up Issues

- HPA-210 is open for the physical-device prerequisite (see the manual
  physical-run checklist above) and all deferred physical acceptance
  observations.
- The audio adapter decision is **Pending physical HPA-210 evidence**; no
  audio conclusion is recorded.
- No external ticket was updated during this local documentation-only
  closeout. Ticket synchronization remains pending until physical evidence is
  available to support it.

## Source-Issue Closure Mapping

No source issue is marked closed. HPA-202 and HPA-205 through HPA-209 remain
pending their HPA-210 native closure evidence; no external tracker update was
performed in this closeout.

## Milestone 2 Recommendation

No Milestone 2 recommendation is recorded while HPA-210 is `NO-GO`. Resume the
physical closure gate before making a milestone progression recommendation.

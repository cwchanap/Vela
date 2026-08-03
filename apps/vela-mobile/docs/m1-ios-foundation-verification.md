# M1 iOS Foundation Verification

## Final Decision

**Decision:** NO-GO

HPA-210 remains open. The selected automated and iOS Simulator machine
evidence passed on
`de276f372c7973e2fb49c81e9a78e50df95266c0`, including the Simulator's
sanitized Xcode, Bun, Quasar, and Capacitor provenance. The physical-device
preflight on `f0c6fe9d5282c3f5f34e6e5453ed3c23c0808f65` is historical only:
because physical work remains deferred, it is not evidence for the current
behavior revision. No manual production-smoke, diagnostic-observation, or
physical-acceptance evidence was created.

Minimum corrective issues:

- Establish a tester-controlled physical iPhone that satisfies the harness's
  safe availability, trust, and non-identifying alias requirements, then rerun
  physical preflight for `de276f372c7973e2fb49c81e9a78e50df95266c0`.
- After physical preflight passes, record both deferred physical matrix classes
  on that frozen behavior revision and the same deployed backend:
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

`testedBehaviorCommit`:
`de276f372c7973e2fb49c81e9a78e50df95266c0`

This is the frozen behavior revision for the selected automated and Simulator
machine evidence. The physical-device preflight remains historical evidence
under `f0c6fe9d5282c3f5f34e6e5453ed3c23c0808f65`; it is not a physical
verification result for this behavior revision because the user deferred
physical work.

## Selected Run Manifests

All selected manifests are committed under
`docs/evidence/hpa-210/<testedBehaviorCommit>/<run-id>/manifest.json` and use
the manifest-recorded deployed configuration.

| Run ID                                     | Tested behavior commit                     | Phase and outcome                                      | Manifest                                                                                                                          |
| ------------------------------------------ | ------------------------------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `20260803T071503Z-automated`               | `de276f372c7973e2fb49c81e9a78e50df95266c0` | Automated machine phase — `passed`                     | [manifest.json](evidence/hpa-210/de276f372c7973e2fb49c81e9a78e50df95266c0/20260803T071503Z-automated/manifest.json)               |
| `20260803T071701Z-automated-ios-simulator` | `de276f372c7973e2fb49c81e9a78e50df95266c0` | iOS Simulator machine phase — `passed`                 | [manifest.json](evidence/hpa-210/de276f372c7973e2fb49c81e9a78e50df95266c0/20260803T071701Z-automated-ios-simulator/manifest.json) |
| `20260803T042801Z-physical-preflight`      | `f0c6fe9d5282c3f5f34e6e5453ed3c23c0808f65` | Historical physical preflight — `prerequisite_missing` | [manifest.json](evidence/hpa-210/f0c6fe9d5282c3f5f34e6e5453ed3c23c0808f65/20260803T042801Z-physical-preflight/manifest.json)      |

The historical physical-preflight manifest is retained for auditability, but
is not selected evidence for `de276f372c7973e2fb49c81e9a78e50df95266c0`.

HPA-209 retains its historical flat evidence layout under
`docs/evidence/hpa-209/`; do not migrate or reinterpret those files as
HPA-210 manifests.

## Production Smoke Matrix

No row is recorded. Physical production-smoke work was explicitly deferred;
the automated and Simulator manifests are not a substitute for it.

| ID  | Commit | Run ID | Matrix class | Build/config | Environment | Precondition | Observation | Status | Evidence | Follow-up |
| --- | ------ | ------ | ------------ | ------------ | ----------- | ------------ | ----------- | ------ | -------- | --------- |

## Diagnostic Observation Matrix

No row is recorded. Physical diagnostic observations were explicitly deferred;
machine checks do not establish human-observed native behavior.

| ID  | Commit | Run ID | Matrix class | Build/config | Environment | Precondition | Observation | Status | Evidence | Follow-up |
| --- | ------ | ------ | ------------ | ------------ | ----------- | ------------ | ----------- | ------ | -------- | --------- |

## Physical iPhone Matrix

The recorded physical preflight below is historical only. Physical testing was
deferred after the current behavior revision was frozen, so it cannot establish
physical readiness or acceptance for that revision.

| ID                          | Commit                                     | Run ID                                | Matrix class         | Build/config                             | Environment                          | Precondition                                                     | Observation                                                                                              | Status                 | Evidence                                                                                                                     | Follow-up                           |
| --------------------------- | ------------------------------------------ | ------------------------------------- | -------------------- | ---------------------------------------- | ------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| HPA-210-PHYSICAL-PREFLIGHT  | `f0c6fe9d5282c3f5f34e6e5453ed3c23c0808f65` | `20260803T042801Z-physical-preflight` | Historical preflight | Manifest-recorded deployed configuration | Physical iPhone, not safely eligible | Safe availability, trust, and generic alias were not established | No signing or interaction step ran                                                                       | `prerequisite_missing` | [manifest.json](evidence/hpa-210/f0c6fe9d5282c3f5f34e6e5453ed3c23c0808f65/20260803T042801Z-physical-preflight/manifest.json) | Rerun for current behavior revision |
| HPA-210-PHYSICAL-ACCEPTANCE | —                                          | —                                     | Physical acceptance  | Not run                                  | Physical iPhone                      | Explicitly deferred by the user                                  | OAuth, restoration, due count, audio, Japanese IME, keyboard/safe-area, and navigation were not observed | `deferred`             | No manifest; unrun                                                                                                           | Resume HPA-210 physical validation  |

## Security and Secret Scan

The selected automated manifest records a passing `mobile-secret-scan` command
on `de276f372c7973e2fb49c81e9a78e50df95266c0`. The exact new-SHA evidence
directory was also scanned before it was committed. Machine evidence does not
substitute a source inspection or a physical acceptance observation.

## Architecture Decision Summary

The current source contract and its selected-revision linkage are maintained
in [iOS Foundation Architecture](ios-foundation-architecture.md). Its
implementation boundaries are source-level facts, not physical acceptance
observations.

## Findings and Follow-up Issues

- HPA-210 is open for the physical-device preflight prerequisite and all
  deferred physical acceptance observations.
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

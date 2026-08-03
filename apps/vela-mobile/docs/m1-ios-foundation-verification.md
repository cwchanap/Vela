# M1 iOS Foundation Verification

## Final Decision

No final decision is recorded yet. A decision is evidence-bound: it may be
written only after the selected manifests and required observations below are
available for one tested behavior revision.

## Tested Behavior Commit

No tested behavior commit is selected yet. When selected, use one full,
lowercase 40-character Git SHA that identifies the behavior under test; a
documentation revision alone is not a substitute for a tested behavior
revision.

## Selected Run Manifests

Evidence manifests are committed under
`docs/evidence/hpa-210/<testedBehaviorCommit>/<run-id>/manifest.json`.
Screenshots, video, raw logs, and archives are attached externally unless a
small binary is uniquely load-bearing. External evidence is referenced by
location, byte size, media type, and SHA-256.

HPA-209 retains its historical flat evidence layout under
`docs/evidence/hpa-209/`; do not migrate or reinterpret those files as
HPA-210 manifests. Select only manifests that match the tested behavior commit
and provide the build/config and evidence metadata required by the matrix row.

## Production Smoke Matrix

| ID  | Commit | Run ID | Matrix class | Build/config | Environment | Precondition | Observation | Status | Evidence | Follow-up |
| --- | ------ | ------ | ------------ | ------------ | ----------- | ------------ | ----------- | ------ | -------- | --------- |

## Diagnostic Observation Matrix

| ID  | Commit | Run ID | Matrix class | Build/config | Environment | Precondition | Observation | Status | Evidence | Follow-up |
| --- | ------ | ------ | ------------ | ------------ | ----------- | ------------ | ----------- | ------ | -------- | --------- |

## Physical iPhone Matrix

| ID  | Commit | Run ID | Matrix class | Build/config | Environment | Precondition | Observation | Status | Evidence | Follow-up |
| --- | ------ | ------ | ------------ | ------------ | ----------- | ------------ | ----------- | ------ | -------- | --------- |

## Security and Secret Scan

No scan result is predeclared. Record a completed scan only with its tested
behavior commit, manifest/evidence reference, and any follow-up issue; a clean
source inspection is not a substitute for a recorded scan run.

## Architecture Decision Summary

The source contract is maintained in
[iOS Foundation Architecture](ios-foundation-architecture.md). Add a decision
summary here only when its supporting matrix rows and manifests identify the
same tested behavior commit.

## Findings and Follow-up Issues

No finding or follow-up issue is predeclared. Each observed failure or
constraint must identify the relevant matrix row and follow-up issue before it
can inform the final decision.

## Source-Issue Closure Mapping

No source issue is marked closed by this schema. Map a closure only after its
acceptance evidence is recorded, keeping the source issue, tested behavior
commit, matrix row, and follow-up disposition together.

## Milestone 2 Recommendation

No Milestone 2 recommendation is recorded yet. It remains pending until the
required production, diagnostic, physical-iPhone, and security evidence is
selected and assessed.

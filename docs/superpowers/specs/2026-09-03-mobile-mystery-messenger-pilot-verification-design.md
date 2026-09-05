# Mobile Mystery Messenger Pilot Verification Design

**Ticket:** HPA-302 — `[Mystery Messenger][Release] Verify and accept the mobile pilot`

**Parent:** HPA-298 — `[Mystery Messenger Pilot] Ship one playable mobile Japanese mystery`

**Delivery:** One branch and one PR for HPA-302. Planning, test-infrastructure repair, acceptance coverage, any narrow release fixes, automated verification, Simulator evidence, physical-device evidence, review fixes, and final acceptance stay on PR #65.

## Context

HPA-299, HPA-300, and HPA-301 have shipped the playable loop, full 13-scene chapter, response builder, and run-local recap. The remaining HPA-302 job is release confidence, not a new product subsystem.

The current feature already has strong lower-level ownership:

- `model.test.ts` owns the literal 13-scene graph walk, authored response answers, alternate grading, duplicate-visible `に` grading, and recap rules;
- `storage.test.ts` owns storage validation and direct adapter round-trips;
- `useMysteryMessenger.test.ts` owns controller/session behavior and same-controller restart;
- composer/page/audio tests own component events, render state, replay wiring, and audio state behavior.

HPA-302 should add only the compositions those tests do not already prove.

## Test-environment storage contract

The mobile Vitest `jsdom` environment already provides `window.localStorage`. The Task-0 baseline (head `bc30599`) was fully green before any HPA-302 change, including `diagnostic-cold-entry.test.ts`, which directly consumes `window.localStorage`, and the Mystery Messenger page constructs browser progress storage from that same native API. No shared `src/test/setup.ts` storage polyfill is therefore added or required; an earlier planning premise that jsdom omits storage was disproved by the recorded baseline. HPA-302 adds only feature-local acceptance coverage.

## Goals

1. Add focused controller + real-browser-storage acceptance for the wrong/hint/swapped-`に` path and persisted restart.
2. Add one focused real-page mounted integration that uses the real Mystery Messenger controller/storage/composers from scene 07 through the ending.
3. Bootstrap dependencies and record the pre-change mobile baseline before interpreting failures as HPA-302 findings.
4. Run the existing mobile coverage, lint, type-check, and build gates with no new threshold.
5. Complete one scripted Simulator run and one development-iPhone run.
6. Complete one unguided timed playthrough and record final evidence on HPA-298.

## Non-goals

- No Appium, Maestro, Playwright-mobile, or other new E2E framework.
- No HPA-302 extension to the HPA-210 detached-worktree/manifest harness.
- No new evidence schema or committed device-evidence store.
- No backend/API/CDK/DynamoDB work.
- No SRS mutation, Review-flow integration, cloud sync, analytics, branching, scoring, or new product behavior.
- No permanent test-only route, fake-auth runtime mode, debug UI, or production helper for tests.
- No new HPA-302-specific coverage threshold.
- No committed UDID, account identifier, token, email address, or other sensitive test data.

## Selected automated shape

Planned non-product footprint:

```text
CREATE apps/vela-mobile/src/features/mystery-messenger/pilot-acceptance.test.ts
```

No production source file and no shared test-setup file is expected to change unless acceptance exposes a narrow real defect. The jsdom environment already provides `window.localStorage`, so `src/test/setup.ts` is not modified.

### 1. Controller + real storage: wrong/hint/swapped-に run

Use the real checked-in chapter, `useMysteryMessenger()`, and `createBrowserMysteryProgressStorage(window.localStorage)`.

Drive this path:

- scene 03: incorrect `today-morning`;
- scene 05: correct `minas-notebook` with `hintUsed: true`;
- scene 07: visibly correct sentence with the two distinct `ni-time` / `ni-place` identities swapped, with `hintUsed: true`;
- scene 09: incorrect `ask-notebook-color`;
- construct a second controller for the same user and same `window.localStorage`;
- finish scenes 10–13 normally.

Before and after the second-controller restore, assert the scene-07 history entry contains exactly:

```ts
[
  'time',
  'ni-place',
  'train',
  'de',
  'station',
  'ni-time',
  'go',
  'period',
]
```

and separately assert `hintUsed === true`.

Also assert the ordered recap IDs are exactly:

```text
tomorrow-seven
mina-possession
train-station-plan
wrote-yesterday
when-is-tomorrow
```

After completion, assert the stored snapshot is the current chapter version, is completed at scene 13, and contains the expected scene-01…scene-12 history sequence.

This replaces the previous separate clean 13-scene case. The literal clean graph walk remains owned by `model.test.ts`; HPA-302 only proves controller/storage composition and terminal persistence.

Do not claim this case tests recap deduplication. Repeated-target deduplication remains owned by the model tests.

### 2. Restart persistence

From a completed run with a non-empty recap:

- call `restart()`;
- directly load storage and assert scene 01, `completed: false`, and empty history;
- construct a fresh controller against the same storage and assert the same fresh run restores.

The direct storage assertion is load-bearing. A second controller alone is insufficient because missing persistence would also fall back to a newly-created scene-01 run.

### 3. Focused mounted real-page integration

The existing `MysteryMessengerPage.test.ts` intentionally mocks `useMysteryMessenger()` and `useMysteryAudio()` for focused UI tests. Keep that suite as-is.

The new `pilot-acceptance.test.ts` may define its own small Quasar `PageHost` and provide the existing `MOBILE_AUTH_KEY` / `MOBILE_TTS_SERVICE_KEY`, but it does not mock `useMysteryMessenger()`.

Seed real browser storage to scene 07 with the earlier wrong/hint history, then mount the real `MysteryMessengerPage` and use DOM controls to:

- select both distinct visible `に` token buttons once each in the intended swapped identity order;
- reveal the scene-07 hint and Send;
- continue through scene 08;
- answer scene 09 incorrectly;
- continue scene 10;
- build the chapter-owned canonical scene-11 response through token buttons and Send;
- continue scene 12;
- assert the real ending recap renders the expected phrase rows and Restart.

This is deliberately not another full chapter runner. It covers the component/controller/storage/DOM seam that the mocked page tests and pure model tests do not compose, while avoiding another literal copy of scenes 01–06.

Audio playback itself remains owned by `useMysteryAudio` tests plus native physical verification; the mounted acceptance case does not need to emulate HTML media playback.

## Bootstrap and baseline

Before interpreting any test/type failure as a release finding, execution must establish a valid checkout:

```bash
bun install --frozen-lockfile
bun --filter @vela/common build
```

The root install is required because the mobile workspace postinstall installs the committed Capacitor dependencies under `apps/vela-mobile/src-capacitor/node_modules`. Building `@vela/common` removes stale/missing `dist` as a baseline variable.

Then record the pre-HPA-302 mobile baseline:

```bash
bun --filter @vela/mobile test
bun --filter @vela/mobile typecheck
```

Record actual pass/fail counts in the PR before changing test setup. Environment/dependency failures are not Mystery Messenger product defects. After the acceptance coverage lands, rerun the baseline commands; any remaining unrelated pre-existing failure is triaged by its owner rather than silently blamed on HPA-302.

## Automated gates

After the focused acceptance work is green, use the existing gates:

```bash
bun --filter @vela/mobile test:coverage
bun --filter @vela/mobile lint
bun --filter @vela/mobile typecheck
bun --filter @vela/mobile build
git diff --check
```

No hand-picked regression subset and no HPA-302-specific threshold are maintained. The full mobile suite already includes the composers, recap UI, page, controller, storage, model, validator, audio, and boot tests exercised by the release matrix.

`MOBILE_SKIP_ENV_VALIDATION=true` may be recorded only as a local compile fallback when public mobile build configuration is unavailable. It cannot replace authenticated native acceptance.

## Physical-device gate decision

Physical iPhone acceptance remains mandatory for HPA-302 and HPA-298. We do not weaken the existing acceptance criteria to close the ticket on Simulator evidence.

The already-existing **HPA-538 — `[Mobile MVP][M1] Complete HPA-210 physical-device verification`** owns the deferred foundation prerequisite. HPA-302 should be explicitly blocked by HPA-538.

Decision:

- HPA-538 is tester/operator-owned;
- HPA-538 must be completed before PR #65 is marked ready for review;
- its physical verification should be run against the current HPA-302 tested head when practical, so generic TTS/silent-mode/interruption/safe-area/native-navigation evidence can be reused rather than rerun independently;
- if HPA-538 exposes a foundation defect, that defect is fixed under its owning Mobile MVP work before HPA-302 proceeds;
- HPA-302 then adds only Mystery Messenger-specific device observations: discover/start/leave/resume/complete, long-transcript composer usability, recap/restart, and feature-level relaunch persistence.

Simulator evidence is not a substitute for HPA-538 or HPA-302 physical acceptance.

## Simulator acceptance

Use the documented `bun run dev:ios` flow and a real authenticated session.

One scripted run covers:

1. Enter from the real Learn card.
2. Confirm no obvious safe-area clipping in portrait and one landscape orientation.
3. Leave via header/native back, return, and confirm persisted progress.
4. Exercise one wrong answer and one completed hint-assisted answer.
5. Exercise scene-07 response building with both visible `に` tokens.
6. Confirm the long transcript does not make the active composer unusable.
7. Replay one authored scene/prompt audio item.
8. Force-close/relaunch mid-run and confirm exact scene restoration.
9. Finish, inspect recap, and replay one recap phrase.
10. Restart and confirm scene 01/no recap persists after re-entry.

Record tested SHA, Simulator model, iOS runtime, Xcode version, build mode, and PASS/FAIL. Do not record private session values.

## Physical Mystery Messenger acceptance

Run only after HPA-538 foundation verification is green for the tested environment/head.

Feature-specific observations:

1. Discover/start/leave/resume/complete on the real iPhone.
2. Long-transcript choice/response controls remain scrollable and reachable.
3. Scene-07 duplicate-visible token interaction is usable.
4. Force-close/relaunch restores the exact in-progress scene.
5. Completion recap renders and one phrase replay is usable.
6. Restart persists and the next launch restores scene 01 with no recap.

Generic built-in-speaker pronunciation, Silent Mode observation, interruption recovery, safe-area baseline, and native swipe/navigation evidence may be reused from HPA-538 when captured against the same tested HPA-302 head/configuration. If not, run those generic rows before HPA-302 closes.

## Unguided playthrough

Run one fresh-start playthrough on the accepted iPhone build without consulting the answer list or scene graph.

Record:

- elapsed time;
- unclear next actions;
- unexpectedly ambiguous N5-adjacent copy;
- any dead end or need to leave the app to recover;
- consciously accepted minor polish.

Pass target remains approximately 8–12 minutes with no dead end or unclear next action. Record the real time even when it is outside the target.

## Evidence and defect policy

Do not create a new evidence manifest.

Keep live results in PR #65. Before HPA-302 closes, post one HPA-298 summary containing:

- final tested SHA;
- bootstrap/baseline notes;
- exact automated commands/outcomes and coverage;
- HPA-538 physical-foundation result;
- Simulator provenance/result;
- iPhone provenance and Mystery Messenger-specific result;
- relaunch/recap/restart result;
- unguided duration/clarity result;
- accepted limitations;
- links to any blocking/reopened issue.

Defect disposition:

- narrow Mystery Messenger defect → regression + smallest fix on PR #65;
- test-environment issue caused by missing browser contract → fix only in shared test setup;
- shell/auth/audio/signing/native-foundation defect → HPA-538 or the existing owning Mobile MVP ticket; HPA-302 remains blocked;
- feature request/larger redesign → separate future work.

No second PR is created for HPA-302.

## Completion semantics

HPA-302 may move to Done only when:

- dependency/bootstrap baseline is recorded;
- focused acceptance tests pass;
- current mobile coverage, lint, type-check, build, CI, and Codecov gates pass;
- scripted Simulator acceptance passes;
- HPA-538 physical foundation verification is complete;
- one development-iPhone Mystery Messenger acceptance run passes;
- relaunch restores both in-progress and ending/restart state as required;
- unguided run has no dead end/unclear next action and is approximately 8–12 minutes;
- HPA-298 contains the final evidence summary;
- no release-blocking child finding remains.

# Mobile Mystery Messenger Pilot Verification Design

**Ticket:** HPA-302 — `[Mystery Messenger][Release] Verify and accept the mobile pilot`

**Parent:** HPA-298 — `[Mystery Messenger Pilot] Ship one playable mobile Japanese mystery`

**Delivery:** One branch and one PR for HPA-302. The PR starts planning-only, then keeps acceptance-test additions, any narrow release-blocking fixes, review fixes, automated gates, Simulator evidence, physical-device evidence, and final acceptance notes on the same PR.

## Context

HPA-302 is now the next actionable Mystery Messenger task. Its explicit blockers are complete:

- HPA-299 shipped the five-scene playable loop;
- HPA-300 expanded it to the full 13-scene linear pilot with `response-build`;
- HPA-301 added the run-local missed-phrase recap and phrase replay.

The current feature already has substantial unit coverage around model transitions, browser persistence, controller/session ownership, response building, duplicate-visible token grading, hint capture, recap derivation, page rendering, and audio behavior. HPA-302 should therefore close the remaining confidence gap rather than create another product subsystem.

The remaining gap is cross-seam acceptance: prove the checked-in chapter can be completed from start to finish, interrupted and restored, restarted, exercised through wrong/hint-assisted answers and repeated-visible response tokens, and then accepted on real iOS surfaces.

## Goals

1. Add one focused automated acceptance layer over the real checked-in chapter and real feature-local controller/storage seams.
2. Re-run the existing mobile test, lint, type-check, and build gates.
3. Complete one scripted iOS Simulator acceptance run that stresses resume, navigation, composer layout, recap, and TTS.
4. Complete one development-iPhone acceptance run that additionally validates real speaker/silent-mode and native interaction behavior.
5. Complete one unguided timed playthrough and confirm the intended approximately 8–12 minute completion window with no dead end or unclear next action.
6. Record the tested commit, exact commands, device/OS details, observations, completion time, and accepted limitations on HPA-298 before HPA-302 closes.

## Non-goals

- No Appium, Maestro, Playwright-mobile, or other new E2E framework.
- No new generic release-verification framework.
- No backend/API/CDK/DynamoDB work.
- No new analytics, telemetry, event log, or cloud evidence store.
- No SRS mutation, Review-flow integration, vocabulary save action, branching, score, or product expansion.
- No permanent test-only route, debug UI, fake-auth product seam, or automation-only runtime code.
- No attempt to re-verify every Mobile MVP M1 acceptance criterion from HPA-210.
- No committed device UDID, account identifier, token, email address, or other sensitive test data.

## Existing seams to reuse

HPA-302 should reuse what already ships:

- `MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER` is the canonical 13-scene chapter.
- `useMysteryMessenger()` already owns start/load, transition persistence, resume, restart, transcript, and recap projection.
- `createBrowserMysteryProgressStorage()` already exercises the same `localStorage` shape used by the Capacitor WebView.
- model tests already pin canonical/alternate response grading and duplicate-visible `に` token behavior.
- composer/page tests already pin hint forwarding, transition guards, recap rendering, and replay wiring.
- `useMysteryAudio()` and its tests already own TTS preparation/playback state.
- `apps/vela-mobile/package.json` already exposes `test:coverage`, `lint`, `typecheck`, `build`, `dev:ios`, and `build:ios:ide`.
- `apps/vela-mobile/README.md` already documents Simulator and physical-device build/run flows.
- the existing iOS interaction baseline defines safe-area ownership and native navigation expectations; HPA-302 observes the Mystery Messenger against that baseline instead of redefining it.

## Approaches considered

### A. Focused feature acceptance test + existing gates + manual native matrix — selected

Add one feature-local `pilot-acceptance.test.ts` that drives the real chapter through `useMysteryMessenger()` using browser storage. Keep all lower-level tests where they are. Then run the current mobile gates and a short native acceptance matrix.

This adds the missing cross-seam confidence with the least machinery. The automated test is fast, readable, and specific to the pilot; the remaining native-only behaviors stay manual because they are visual, audio, navigation, or physical-device observations.

### B. Extend the HPA-210 M1 verification harness

The M1 harness is useful for broad foundation verification, but its detached-worktree receipts, environment handling, production-diagnostic scan, and full-repository gates are much broader than this feature acceptance task. Extending it with Mystery Messenger scene semantics would couple a feature-specific release test to infrastructure built for a different milestone.

Rejected for HPA-302. We may still run existing commands it already covers, but we do not add HPA-302 phases, schemas, manifests, or evidence rules to it.

### C. Add a native E2E framework

A native E2E framework could automate taps, relaunches, and some navigation behavior, but it would add substantial setup and maintenance for one pilot. It still would not replace human judgment for Japanese clarity, audible TTS, silent-mode behavior, visual safe areas, or the unguided timing check.

Rejected explicitly by HPA-302.

## Selected automated acceptance design

Create exactly one new test file:

```text
apps/vela-mobile/src/features/mystery-messenger/pilot-acceptance.test.ts
```

Do not add a new production helper only for the test. The test imports the existing chapter, browser storage adapter, controller, and a reactive usable auth state.

The file contains three cross-seam scenarios.

### 1. Clean full-chapter completion

Drive the real chapter in authored order:

- continue scenes 01 and 02;
- choose `tomorrow-morning` at scene 03;
- continue scene 04;
- choose `minas-notebook` at scene 05;
- continue scene 06;
- submit the scene-07 canonical response using both distinct visible-`に` tokens;
- continue scene 08;
- choose `ask-when-tomorrow` at scene 09;
- continue scene 10;
- submit the canonical scene-11 response;
- continue scene 12 into scene 13.

Assert:

- `currentScene.id === 'scene-13'`;
- `completed === true`;
- all 12 non-ending scenes have one completed history entry;
- the recap is empty;
- storage contains the completed current-version run.

This is the one automated proof that the checked-in content, transition graph, controller, and persistence layer compose into a complete playable run.

### 2. Wrong/hint/repeated-visible-token run survives relaunch

Use the real chapter and real browser storage again, but exercise the learning/recovery path:

- answer scene 03 incorrectly with `today-morning`;
- reveal/use the authored hint and answer scene 05 correctly with `minas-notebook` and `hintUsed: true`;
- at scene 07 submit the visibly correct sentence while swapping the two distinct `に` identities (`ni-time` / `ni-place`) and mark the completed submission hint-assisted;
- answer scene 09 incorrectly with `ask-notebook-color`;
- leave the run after a persisted transition;
- construct a fresh controller for the same user and storage to simulate page/app re-entry;
- assert it restores the exact next scene and the qualifying recap rows already derivable from stored history;
- finish scenes 10–13 normally;
- assert the final recap is deduplicated, ordered by first qualifying interaction, and contains the expected phrase IDs from the wrong/hint-assisted interactions.

The repeated-visible-token assertion is intentionally about the two unique IDs that both render `に`; the test must not submit the same token identity twice, because production storage correctly rejects repeated identity.

### 3. Restart resets a completed run

From a completed run with a non-empty recap:

- call `restart()`;
- assert scene 01 is active, `history` is empty, `completed === false`, and recap is empty;
- construct a fresh controller against the same storage and assert the restarted clean run restores, proving the reset was persisted rather than only held in memory.

## Why not add another page-level happy-path test

`MysteryMessengerPage.test.ts` intentionally mocks the controller/audio composables to test UI wiring. Turning it into a full chapter runner would either duplicate controller/model logic in mocks or require a large mounting harness around auth/TTS. The new acceptance file should instead compose the real feature-local state/persistence seams, while the existing page/composer tests continue to own DOM behavior.

The native manual matrix is the correct place to prove the fully mounted route, shell, layout, navigation, and TTS integration together.

## Automated verification gates

After the focused acceptance test is green, HPA-302 uses the existing mobile gates without adding scripts:

```bash
bun --filter @vela/mobile test:coverage
bun --filter @vela/mobile lint
bun --filter @vela/mobile typecheck
bun --filter @vela/mobile build
```

The build should use the normal configured mobile environment when available. `MOBILE_SKIP_ENV_VALIDATION=true` may be used only as a local compile/build fallback when real public mobile configuration is unavailable; it is not sufficient evidence for the authenticated Simulator/iPhone acceptance runs.

When the draft PR becomes ready for review, repository CI and Codecov remain the final automated merge gates. No separate HPA-302 coverage threshold is introduced.

## iOS Simulator acceptance matrix

Use the documented `apps/vela-mobile` Simulator flow and an authenticated session. Record the tested commit, Simulator model, iOS runtime, Xcode version, and build mode.

One scripted run should cover the following in as few repetitions as practical:

1. Enter Mystery Messenger from the real Learn card.
2. Confirm the page respects the existing top/bottom safe-area ownership in portrait; rotate once if needed to catch obvious horizontal/sensor-region clipping.
3. Use header/native back from the feature and return without losing the persisted run.
4. Reach a choice and response-build composer; confirm prompt, hint, answer controls, and Send remain reachable while the transcript is long/scrolled.
5. Exercise at least one wrong answer and one completed hint-assisted correct answer.
6. At scene 07 use both visible `に` tokens and confirm the composed sentence is usable.
7. Replay at least one scene/prompt audio item.
8. Leave the route, then force-close/relaunch the app and confirm the exact run resumes.
9. Complete the chapter, verify the expected recap rows are visible once each, and replay one recap phrase.
10. Tap Restart and confirm the run returns to scene 01 with no recap.

A visual/audio defect found here is fixed on the same HPA-302 PR when it is a narrow release defect. A change that materially redefines HPA-299/300/301 product behavior should reopen/return to the owning ticket rather than silently expanding HPA-302.

## Physical development-iPhone acceptance matrix

Prepare the native project using the documented `build:ios:ide` flow, select the tester-controlled development team/device in Xcode, and run the same tested commit.

Required observations:

1. Discover/start/leave/resume/complete work on the real device.
2. Header back and the supported native swipe/back behavior return to the expected prior route without a blank frame or navigation trap.
3. Safe areas remain correct around the status/sensor and home-indicator regions; the active composer remains scrollable and actionable.
4. TTS is audibly understandable through the built-in speaker with nonzero media volume.
5. Replaying prepared/available audio does not overlap or wedge the UI.
6. With system Silent Mode enabled, record the observed playback behavior on an explicit replay tap and confirm the app remains stable/replayable. HPA-302 does not invent a new audibility policy beyond the existing audio implementation; unexpected or unusable behavior is a release finding.
7. Background/foreground or interruption does not leave playback permanently stuck.
8. Force-close/relaunch restores the exact scene and, after completion, the recap.
9. Restart clears the run and the next launch restores the fresh run.

Do not record device UDID or private account values. Model name, iOS version, Xcode version, build configuration, and tested commit are sufficient provenance.

## Unguided playthrough

Run one fresh-start playthrough without following the scripted acceptance steps while the timer is running. The tester may use normal product hints but should not consult the expected answers or scene graph.

Record:

- start/end elapsed time;
- whether any next action was unclear;
- whether any Japanese copy felt unexpectedly ambiguous for the intended N5-adjacent pilot;
- whether any interaction appeared dead-ended or required leaving the app to recover;
- any minor polish note that is explicitly accepted rather than fixed.

Pass requires approximately 8–12 minutes and no dead end or unclear next action. A slightly out-of-band time with an otherwise clear run is a product finding to judge, not a reason to fabricate a passing duration.

## Evidence and tracking

Do not create another evidence manifest or committed device-evidence schema for HPA-302.

During execution, keep a compact checklist/results table in the HPA-302 PR body. Before closing HPA-302, post one structured summary comment on HPA-298 containing:

- tested commit SHA;
- exact automated commands and outcomes;
- Simulator model, iOS runtime, Xcode version, build mode, and result;
- physical iPhone model, iOS version, Xcode version, build mode, and result;
- relaunch/resume result;
- TTS speaker/silent-mode observations;
- unguided completion time and clarity result;
- accepted limitations;
- links to any blocking/reopened child issues.

This directly satisfies HPA-302 without adding permanent release infrastructure for a one-chapter pilot.

## Defect policy

HPA-302 is primarily an acceptance ticket, but discovered defects should not be deferred mechanically.

- **Narrow defect in current Mystery Messenger behavior:** add the smallest focused regression test and fix it on this same HPA-302 PR.
- **Native shell/audio defect already owned by an existing Mobile MVP ticket:** record the finding, return/reopen the owning ticket, and keep HPA-302 blocked until resolved or explicitly accepted.
- **New feature request or larger redesign:** out of scope; create/reuse the appropriate future ticket rather than folding it into release acceptance.

Do not split HPA-302 itself across multiple PRs.

## Completion semantics

HPA-302 may move to Done only when:

- the new focused acceptance tests pass;
- current mobile coverage, lint, type-check, build, CI, and Codecov gates pass;
- the scripted Simulator matrix passes;
- one development-iPhone matrix passes;
- relaunch restores both an in-progress run and the final recap state;
- the unguided run has no dead end/unclear next action and is approximately 8–12 minutes;
- HPA-298 contains the final evidence summary and accepted limitations;
- no unresolved release-blocking child finding remains.

Once HPA-302 is Done, HPA-298 can be closed as Done if its other acceptance criteria still match the shipped pilot.

## Expected implementation footprint

Planned code footprint before testing discovers a real defect:

```text
CREATE apps/vela-mobile/src/features/mystery-messenger/pilot-acceptance.test.ts
```

No product source file is expected to change merely to satisfy HPA-302. That is intentional: release verification should prove the existing pilot, not manufacture implementation work.

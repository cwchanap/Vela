# Mobile Mystery Messenger Pilot Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close HPA-302 by proving the checked-in Mystery Messenger pilot completes and restores correctly through real feature seams, passes the existing mobile gates, and is accepted on an iOS Simulator, one development iPhone, and one unguided timed playthrough.

**Architecture:** Add one feature-local Vitest acceptance file that composes the real chapter, `useMysteryMessenger()`, and browser progress storage. Reuse the existing mobile build/test scripts and existing iOS shell/audio/navigation behavior; do not extend the HPA-210 verification harness or add a native E2E framework. Native and playtest evidence stays on the same HPA-302 PR and is summarized on HPA-298 before closure.

**Tech Stack:** Vue 3 reactivity, TypeScript, Vitest/jsdom, Quasar + Capacitor iOS, Bun/Turborepo, existing `MobileAuthState`, `MysteryProgressStorage`, and Mystery Messenger model/controller/audio seams.

**Spec:** `docs/superpowers/specs/2026-09-03-mobile-mystery-messenger-pilot-verification-design.md`

## Global Constraints

- Keep HPA-302 on one branch and one PR: `codex/hpa-302-mystery-messenger-pilot-verification`.
- Planned product-code footprint is zero; the only planned source artifact is one feature-local acceptance test.
- Keep any narrow release-defect fix under the existing owning mobile/Mystery Messenger seam; do not create a generic release framework.
- No backend/API/CDK/DynamoDB changes.
- No SRS writes, Review-flow integration, vocabulary-save action, cloud sync, analytics, or new product behavior.
- No Appium, Maestro, Playwright-mobile, or other new E2E framework.
- Do not add a test-only route, fake-auth runtime mode, debug page, or automation-only production seam.
- Reuse the current chapter ID/version and current `localStorage` contract; do not add a migration for HPA-302.
- Treat the two scene-07 `に` tokens as distinct identities that may occupy swapped positions while resolving to identical visible text; never submit the same token ID twice.
- Do not commit device UDIDs, account identifiers, tokens, email addresses, or other private acceptance data.
- A narrow current-pilot defect may be fixed on this PR with a focused regression test; a larger behavior redesign returns to its owning ticket instead of expanding HPA-302.
- Do not mark HPA-302 Done until automated gates, Simulator, physical iPhone, relaunch/recap restoration, and the unguided playthrough all pass and HPA-298 contains the final evidence summary.

---

## File Map

### New file

- `apps/vela-mobile/src/features/mystery-messenger/pilot-acceptance.test.ts` — cross-seam acceptance over the real checked-in chapter, controller, and browser persistence.

### Existing runtime files consumed without planned modification

- `apps/vela-mobile/src/features/mystery-messenger/content.ts` — canonical 13-scene chapter and token IDs.
- `apps/vela-mobile/src/features/mystery-messenger/model.ts` — progress types and projections.
- `apps/vela-mobile/src/features/mystery-messenger/storage.ts` — real browser progress adapter.
- `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.ts` — start/resume/transition/restart controller.
- `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue` — native-route UI observed manually.
- `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.ts` — TTS/audio state observed manually.

### Tracking surfaces updated during execution

- HPA-302 draft PR body — live automated/native/playtest result table.
- Linear HPA-298 comment — final tested commit, commands, native provenance, playtest time, limitations, and blockers.
- Linear HPA-302 status — In Progress during execution; Done only after the completion gates are satisfied.

---

### Task 1: Add real-chapter cross-seam acceptance coverage

**Files:**
- Create: `apps/vela-mobile/src/features/mystery-messenger/pilot-acceptance.test.ts`

**Interfaces:**
- Consumes `MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER` from `./content`.
- Consumes `createBrowserMysteryProgressStorage()` and `MysteryProgressStorage` from `./storage`.
- Consumes `useMysteryMessenger()` and `MysteryMessengerController` from `./useMysteryMessenger`.
- Consumes `MobileAuthState` from `../../auth/mobile-auth-contract`.
- Adds no production interface and exports no new helper.

- [ ] **Step 1: Create test-local real-controller helpers**

Create the file with the normal Vitest imports and these test-local helpers:

```ts
import { reactive } from 'vue';
import { beforeEach, describe, expect, it } from 'vitest';
import type { MobileAuthState } from '../../auth/mobile-auth-contract';
import { MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER as chapter } from './content';
import {
  createBrowserMysteryProgressStorage,
  type MysteryProgressStorage,
} from './storage';
import {
  useMysteryMessenger,
  type MysteryMessengerController,
} from './useMysteryMessenger';

function usableAuthState(userId = 'pilot-user'): MobileAuthState {
  return {
    phase: 'authenticated',
    operation: 'idle',
    sessionUsable: true,
    errorCode: null,
    retryAction: null,
    notice: null,
    user: { userId, email: null },
  };
}

function createPilotController(userId = 'pilot-user'): {
  controller: MysteryMessengerController;
  storage: MysteryProgressStorage;
} {
  const storage = createBrowserMysteryProgressStorage(window.localStorage);
  const controller = useMysteryMessenger({
    authState: reactive(usableAuthState(userId)),
    storage,
    chapter,
  });
  return { controller, storage };
}

function completeCleanRun(controller: MysteryMessengerController): void {
  controller.continueMessage('scene-01');
  controller.continueMessage('scene-02');
  controller.chooseOption('scene-03', 'tomorrow-morning');
  controller.continueMessage('scene-04');
  controller.chooseOption('scene-05', 'minas-notebook');
  controller.continueMessage('scene-06');
  controller.submitResponse('scene-07', [
    'time',
    'ni-time',
    'train',
    'de',
    'station',
    'ni-place',
    'go',
    'period',
  ]);
  controller.continueMessage('scene-08');
  controller.chooseOption('scene-09', 'ask-when-tomorrow');
  controller.continueMessage('scene-10');
  controller.submitResponse('scene-11', ['again', 'say', 'please', 'period']);
  controller.continueMessage('scene-12');
}

function driveReviewRunToScene10(controller: MysteryMessengerController): void {
  controller.continueMessage('scene-01');
  controller.continueMessage('scene-02');
  controller.chooseOption('scene-03', 'today-morning');
  controller.continueMessage('scene-04');
  controller.chooseOption('scene-05', 'minas-notebook', true);
  controller.continueMessage('scene-06');
  controller.submitResponse(
    'scene-07',
    ['time', 'ni-place', 'train', 'de', 'station', 'ni-time', 'go', 'period'],
    true,
  );
  controller.continueMessage('scene-08');
  controller.chooseOption('scene-09', 'ask-notebook-color');
}

function finishFromScene10(controller: MysteryMessengerController): void {
  controller.continueMessage('scene-10');
  controller.submitResponse('scene-11', ['again', 'say', 'please', 'period']);
  controller.continueMessage('scene-12');
}

beforeEach(() => {
  window.localStorage.clear();
});
```

Run:

```bash
bun --filter @vela/mobile test -- pilot-acceptance.test.ts
```

Expected: Vitest reports no tests yet. Do not alter production code merely to manufacture a red phase; this ticket is validating already-shipped behavior.

- [ ] **Step 2: Add the clean full-chapter acceptance case**

Add:

```ts
describe('Mystery Messenger pilot acceptance', () => {
  it('completes the checked-in chapter cleanly and persists the ending', () => {
    const { controller, storage } = createPilotController();

    completeCleanRun(controller);

    expect(controller.currentScene.value?.id).toBe('scene-13');
    expect(controller.progress.value?.completed).toBe(true);
    expect(controller.progress.value?.history).toHaveLength(12);
    expect(controller.missedPhraseRecap.value).toEqual([]);

    const restored = storage.load('pilot-user', chapter);
    expect(restored?.currentSceneId).toBe('scene-13');
    expect(restored?.completed).toBe(true);
    expect(restored?.history).toHaveLength(12);
  });
});
```

Run:

```bash
bun --filter @vela/mobile test -- pilot-acceptance.test.ts
```

Expected: PASS. A failure is an HPA-302 release finding; do not weaken the expected chapter path to make it pass.

- [ ] **Step 3: Add wrong-answer, hint-use, duplicate-visible-token, and relaunch coverage**

Add a second case:

```ts
it('restores a wrong and hint-assisted run with the expected recap', () => {
  const first = createPilotController();
  driveReviewRunToScene10(first.controller);

  expect(first.controller.currentScene.value?.id).toBe('scene-10');
  expect(first.controller.missedPhraseRecap.value.map((item) => item.phraseId)).toEqual([
    'tomorrow-seven',
    'mina-possession',
    'train-station-plan',
    'wrote-yesterday',
    'when-is-tomorrow',
  ]);

  const relaunched = createPilotController();
  expect(relaunched.controller.currentScene.value?.id).toBe('scene-10');
  expect(relaunched.controller.missedPhraseRecap.value.map((item) => item.phraseId)).toEqual([
    'tomorrow-seven',
    'mina-possession',
    'train-station-plan',
    'wrote-yesterday',
    'when-is-tomorrow',
  ]);

  finishFromScene10(relaunched.controller);

  expect(relaunched.controller.currentScene.value?.id).toBe('scene-13');
  expect(relaunched.controller.progress.value?.completed).toBe(true);
  expect(relaunched.controller.missedPhraseRecap.value.map((item) => item.phraseId)).toEqual([
    'tomorrow-seven',
    'mina-possession',
    'train-station-plan',
    'wrote-yesterday',
    'when-is-tomorrow',
  ]);
});
```

The scene-07 submission deliberately swaps `ni-time` and `ni-place` while keeping the visible sentence unchanged. Both IDs occur exactly once, so the test covers repeated-visible tokens without violating stored-history identity rules.

Run the focused file and expect PASS.

- [ ] **Step 4: Add persisted restart coverage**

Add:

```ts
it('persists a clean restarted run after completing with review items', () => {
  const first = createPilotController();
  driveReviewRunToScene10(first.controller);
  finishFromScene10(first.controller);
  expect(first.controller.missedPhraseRecap.value).not.toEqual([]);

  first.controller.restart();

  expect(first.controller.currentScene.value?.id).toBe('scene-01');
  expect(first.controller.progress.value?.history).toEqual([]);
  expect(first.controller.progress.value?.completed).toBe(false);
  expect(first.controller.missedPhraseRecap.value).toEqual([]);

  const relaunched = createPilotController();
  expect(relaunched.controller.currentScene.value?.id).toBe('scene-01');
  expect(relaunched.controller.progress.value?.history).toEqual([]);
  expect(relaunched.controller.progress.value?.completed).toBe(false);
  expect(relaunched.controller.missedPhraseRecap.value).toEqual([]);
});
```

Run:

```bash
bun --filter @vela/mobile test -- pilot-acceptance.test.ts
```

Expected: 3/3 acceptance cases PASS.

- [ ] **Step 5: Run the feature regression set**

Run:

```bash
bun --filter @vela/mobile test -- \
  pilot-acceptance.test.ts \
  model.test.ts \
  storage.test.ts \
  useMysteryMessenger.test.ts \
  MysteryMessengerPage.test.ts
```

Expected: PASS. Keep the existing low-level tests as the owners of transition, storage-validation, page-wiring, and replay details; do not duplicate their matrices into the acceptance file.

- [ ] **Step 6: Run the task gate and commit**

Run:

```bash
bun --filter @vela/mobile test
bun --filter @vela/mobile typecheck
git diff --check
```

Expected: all PASS.

Commit only the new test file:

```bash
git add apps/vela-mobile/src/features/mystery-messenger/pilot-acceptance.test.ts
git commit -m "test(mobile): add mystery pilot acceptance coverage"
```

If one of the three acceptance cases exposes a real defect, keep this task uncommitted until the smallest regression test in the existing owning test file and the smallest corresponding fix are green. Do not add a new abstraction solely to satisfy the acceptance test.

---

### Task 2: Run the existing automated release gates

**Files:**
- No planned repository file changes.
- Update the HPA-302 PR body with actual command results and the tested commit SHA.

**Interfaces:**
- Consumes the existing `@vela/mobile` scripts from `apps/vela-mobile/package.json`.
- Produces the automated evidence row used by the final HPA-298 summary.

- [ ] **Step 1: Pin the tested revision**

Run:

```bash
git rev-parse HEAD
git status --short
```

Expected: a full 40-character commit SHA and no tracked implementation changes left uncommitted.

Record that SHA as the automated tested commit in the PR body.

- [ ] **Step 2: Run mobile coverage**

Run:

```bash
bun --filter @vela/mobile test:coverage
```

Expected: PASS at the repository-configured project/patch coverage policy. Record the test count and line coverage reported by Vitest; do not introduce an HPA-302-specific threshold.

- [ ] **Step 3: Run lint and type-check**

Run:

```bash
bun --filter @vela/mobile lint
bun --filter @vela/mobile typecheck
```

Expected: both PASS.

- [ ] **Step 4: Run the mobile build**

Run with the normal configured public mobile environment:

```bash
bun --filter @vela/mobile build
```

Expected: PASS.

If a developer checkout lacks the public mobile build configuration, `MOBILE_SKIP_ENV_VALIDATION=true bun --filter @vela/mobile build` may be recorded only as a local compile fallback. Do not count that fallback as native acceptance; Tasks 3 and 4 require a working authenticated mobile configuration.

- [ ] **Step 5: Check the branch and update the PR evidence table**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and no uncommitted tracked changes.

Update the draft PR body with the exact four gate commands, outcomes, tested SHA, test count, and coverage figure. Do not create a separate HPA-302 manifest or committed evidence file.

No commit is expected for this task.

---

### Task 3: Complete scripted iOS Simulator acceptance

**Files:**
- No planned repository file changes.
- Update the HPA-302 PR body with Simulator provenance and observations.

**Interfaces:**
- Consumes the real Learn card, `/learn/mystery-messenger` route, existing mobile auth, safe-area/navigation shell, browser storage, and TTS/audio integration.
- Produces one Simulator acceptance result for the final HPA-298 summary.

- [ ] **Step 1: Start the documented Simulator development flow**

Run:

```bash
cd apps/vela-mobile
bun run dev:ios
```

Keep the dev-server terminal running. In Xcode, select one iPhone Simulator and launch the app.

Record in the PR body:

- `git rev-parse HEAD` result;
- Simulator model;
- iOS runtime version;
- `xcodebuild -version` output;
- Debug/development build mode.

Do not record the Simulator UDID.

- [ ] **Step 2: Verify real entry, safe areas, and navigation persistence**

Using a signed-in session:

1. Open **Learn** and enter through the real Mystery Messenger card.
2. Confirm scene 01 is visible and controls do not overlap the status/sensor or bottom home-indicator regions in portrait.
3. Rotate once to landscape and confirm no obvious clipping into the sensor-region horizontal safe areas; return to portrait for the remainder.
4. Advance to scene 02, leave using the visible header/native back behavior, then return to Mystery Messenger.
5. Confirm scene 02 is still current rather than starting a new run.

Record PASS/FAIL plus any visual finding in the PR body.

- [ ] **Step 3: Exercise wrong answers, hints, active-composer scrolling, and repeated-visible tokens**

Continue the same run:

1. At scene 03 choose `きょうの朝7時` (wrong) and confirm the story continues.
2. At scene 05 reveal the authored hint, then choose `ミナさんのノートです` (correct) and confirm the story continues.
3. Reach scene 07 and scroll the transcript so the response composer is exercised after real accumulated content.
4. Build the visible sentence `7時に電車でさくら駅に行きます。` using both separately tappable `に` tokens exactly once; confirm Send remains reachable and the story advances.
5. Replay one available scene or choice-prompt audio item and confirm the playback status returns to a usable state.

Record PASS/FAIL and whether any control became obscured or unreachable.

- [ ] **Step 4: Verify force-close/relaunch resume**

After reaching scene 08 or later:

1. Force-close the Simulator app.
2. Relaunch the same build and signed-in user.
3. Re-enter Mystery Messenger if the app does not reopen directly on the route.
4. Confirm the exact persisted scene is restored and completed transcript/history has not been lost.

Record the scene ID observed before close and after relaunch in the PR body.

- [ ] **Step 5: Complete the run, verify recap replay, and restart**

Finish the chapter. At the ending:

1. Confirm every phrase expected from the actual wrong/hint-assisted choices appears once in the recap.
2. Replay one recap phrase and confirm row-local playback feedback is visible and the story/restart state does not change.
3. Tap Restart.
4. Confirm scene 01 is active and the recap is gone.
5. Leave and re-enter once to confirm the restarted fresh run persists.

Record the Simulator result as PASS only if the chapter completed with no dead end, resume worked, recap/restart worked, and no release-blocking layout/navigation/audio issue remains.

No commit is expected unless this matrix exposes a narrow release defect. Any such defect stays on this HPA-302 PR with a focused regression test before rerunning the affected Simulator steps.

---

### Task 4: Complete development-iPhone acceptance

**Files:**
- No planned repository file changes.
- Update the HPA-302 PR body with physical-device provenance and observations.

**Interfaces:**
- Consumes the documented Capacitor/Xcode physical-device flow and the same production feature code tested in Task 3.
- Produces the required physical-iPhone acceptance result for HPA-302/HPA-298.

- [ ] **Step 1: Prepare and launch the tested native build**

Run:

```bash
cd apps/vela-mobile
bun run build:ios:ide
```

In Xcode:

1. Select the tester-controlled development team under Signing & Capabilities.
2. Connect one development iPhone.
3. Select that device and Run.

Record only:

- tested commit SHA;
- iPhone model;
- iOS version;
- Xcode version;
- build configuration.

Do not record the device UDID or private account data.

- [ ] **Step 2: Verify product discovery, safe areas, composer usability, and native navigation**

On the real device:

1. Enter from Learn and advance into the chapter.
2. Confirm the page and active composer do not overlap the status/sensor region or home indicator.
3. Scroll a long transcript with the response composer active and confirm Hint, tokens, selected response, and Send remain reachable.
4. Leave with the visible header back behavior and return; confirm progress persists.
5. Exercise the supported native swipe/back behavior and confirm it returns to the expected prior route without a blank frame, app exit, or navigation trap.

Record PASS/FAIL for each behavior in the PR body.

- [ ] **Step 3: Verify built-in-speaker TTS and replay behavior**

With nonzero media volume and built-in speaker output:

1. Replay one authored scene or prompt and confirm the Japanese is audibly understandable.
2. Replay it repeatedly several times, waiting for each replay to settle, and confirm playback does not overlap or wedge the controls.
3. Replay one recap phrase after completing a run and confirm the same behavior.

Record the observed result. HPA-302 does not require a new audio implementation if current behavior is already acceptable.

- [ ] **Step 4: Observe Silent Mode and interruption recovery**

Enable system Silent Mode using the device's supported control; Focus mode does not count as Silent Mode.

1. Use an explicit replay tap on an already available/prepared audio item and record whether it is audible or silenced under the current implementation.
2. Confirm the app remains stable and replay remains usable after leaving Silent Mode.
3. Start playback, background the app or introduce a normal system interruption, then return.
4. Confirm playback is not permanently stuck and a later explicit replay works.

Treat unexpected instability, permanently stuck playback, or unusable recovery as a release finding. Record observed Silent Mode behavior rather than inventing a new policy during HPA-302.

- [ ] **Step 5: Verify physical relaunch restoration and restart persistence**

1. Stop mid-run at a known scene and force-close the app.
2. Relaunch and confirm the exact scene restores.
3. Finish a run that contains at least one qualifying missed/hint-assisted phrase.
4. Force-close and relaunch again; confirm the ending and recap restore.
5. Restart, force-close/relaunch once more, and confirm scene 01 restores with an empty history/recap.

Record the before/after scene IDs and recap result.

The physical-device task passes only when the pilot completes and all required observations are acceptable. No commit is expected unless a narrow current-pilot defect is fixed on this same PR.

---

### Task 5: Run the unguided playthrough, final gates, and tracking closeout

**Files:**
- No planned repository file changes.
- Update the HPA-302 PR body.
- Post the final evidence summary on Linear HPA-298.
- Transition HPA-302 and HPA-298 only after merge/acceptance criteria are satisfied.

**Interfaces:**
- Consumes all automated and native results from Tasks 1–4.
- Produces the final HPA-302 acceptance record and parent-pilot closure evidence.

- [ ] **Step 1: Run one fresh unguided playthrough**

Restart to a fresh run on the accepted iPhone build. Start a timer immediately before entering the story and stop it when scene 13 is reached.

During the timed run:

- use only normal product UI and authored hints;
- do not consult the scene graph, this plan's expected-answer lists, or test code;
- note any unclear next action;
- note any Japanese copy that is unexpectedly ambiguous for the intended beginner/N5-adjacent pilot;
- note any dead end or need to leave the app to recover;
- note minor polish findings separately from completion blockers.

Record the actual elapsed duration. Pass the product criterion when the run is approximately 8–12 minutes and has no dead end or unclear next action. Do not alter the recorded time to fit the target.

- [ ] **Step 2: Resolve or explicitly route every release finding**

For each finding from Tasks 3–5, apply exactly one policy:

- narrow Mystery Messenger defect: add the smallest focused regression test and fix it on this HPA-302 PR;
- existing mobile shell/auth/audio defect: return or reopen the existing owning Mobile MVP ticket and keep HPA-302 blocked until resolved or explicitly accepted;
- larger feature request/redesign: keep it out of HPA-302 and reuse/create the appropriate future ticket.

Do not mark an unresolved completion/understanding defect as an accepted limitation.

- [ ] **Step 3: Re-run final automated gates after the last code change**

Run from the final HPA-302 head:

```bash
bun --filter @vela/mobile test:coverage
bun --filter @vela/mobile lint
bun --filter @vela/mobile typecheck
bun --filter @vela/mobile build
git diff --check
git status --short
git rev-parse HEAD
```

Expected: all gates PASS, no uncommitted tracked changes, and one final tested head SHA.

Update the PR body so its automated result table references this final SHA rather than an earlier one.

- [ ] **Step 4: Mark the PR ready and require repository review gates**

Only after Tasks 1–5 have passed locally/native:

1. Convert the draft PR to ready for review.
2. Wait for the repository's normal CI and Codecov checks to finish.
3. Address review findings on this same PR.
4. If review changes runtime/test behavior, rerun the affected local gate and update the recorded final SHA.
5. Merge only when CI/Codecov and required review are green.

No second PR is created for HPA-302.

- [ ] **Step 5: Post the final structured evidence comment on HPA-298**

Create one HPA-298 comment only after all actual values are known. The comment must contain these sections populated from the completed tasks:

- **Tested revision:** final HPA-302 head SHA and merged PR link.
- **Automated gates:** exact four mobile commands, PASS outcomes, test count, and coverage figure.
- **Simulator:** model, iOS runtime, Xcode version, build mode, scripted result, relaunch scene restoration, recap/restart result.
- **Development iPhone:** model, iOS version, Xcode version, build mode, navigation/safe-area result, speaker replay result, Silent Mode observation, interruption recovery, relaunch/recap/restart result.
- **Unguided playthrough:** actual elapsed duration, clarity/dead-end result, and any language/polish note.
- **Accepted limitations:** only non-blocking limitations that were consciously accepted.
- **Blocking/reopened work:** links to any ticket that still prevents HPA-302 closure; this section is empty only when no blocker remains.

Do not include UDIDs, tokens, emails, or private account details.

- [ ] **Step 6: Close Linear tracking only after the evidence and merge gates hold**

After the PR is merged and the HPA-298 evidence comment is posted:

1. Move HPA-302 to Done if no blocking/reopened issue remains.
2. Re-check HPA-298 acceptance criteria against the merged pilot.
3. Move HPA-298 to Done if HPA-302 was the final unsatisfied child acceptance gate.

If a blocker remains, leave both tickets open in the appropriate state and link the owning issue rather than claiming acceptance.

---

## Self-Review Checklist

Before execution begins, verify the plan still has these properties:

- one ticket / one PR;
- one planned new test file and no planned production source changes;
- real chapter/controller/browser-storage composition rather than mocked page logic;
- explicit coverage for clean completion, resume, restart, wrong answer, hint use, repeated-visible tokens, and recap;
- existing mobile test/lint/type-check/build commands reused verbatim;
- Simulator and physical-iPhone checks cover safe areas, navigation, active-composer scrolling, TTS, Silent Mode observation, relaunch, recap, and restart;
- unguided playthrough records real elapsed time and clarity/dead-end findings;
- no new E2E/harness/evidence schema;
- final HPA-298 evidence is posted before HPA-302 closes.

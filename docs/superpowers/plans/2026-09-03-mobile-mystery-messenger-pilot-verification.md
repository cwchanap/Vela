# Mobile Mystery Messenger Pilot Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close HPA-302 by proving the checked-in Mystery Messenger pilot completes and restores through real feature seams, passes the current mobile gates, and is accepted on an iOS Simulator, one development iPhone, and one unguided timed playthrough.

**Architecture:** Add one feature-local Vitest acceptance file that composes the real chapter, `useMysteryMessenger()`, and browser progress storage. Reuse the existing mobile scripts and iOS shell/audio/navigation behavior; do not extend the HPA-210 harness or add native E2E infrastructure. Keep all implementation and release-fix work on this single HPA-302 PR.

**Tech Stack:** Vue 3, TypeScript, Vitest/jsdom, Quasar + Capacitor iOS, Bun/Turborepo.

**Spec:** `docs/superpowers/specs/2026-09-03-mobile-mystery-messenger-pilot-verification-design.md`

## Global Constraints

- One ticket / one branch / one PR: `codex/hpa-302-mystery-messenger-pilot-verification`.
- Planned product-code footprint is zero; planned source change is one acceptance test file.
- No backend/API/CDK/DynamoDB, SRS, Review-flow, cloud sync, analytics, or new product behavior.
- No Appium, Maestro, Playwright-mobile, new release harness, test-only route, fake-auth runtime mode, or debug page.
- Reuse the current chapter ID/version and `localStorage` contract; no migration.
- Scene 07's two visible `に` tokens are distinct IDs; never submit the same ID twice.
- Do not commit device UDIDs, account identifiers, tokens, email addresses, or other private acceptance data.
- A narrow current-pilot defect may be fixed on this PR with a focused regression test. A larger redesign returns to its owning ticket.
- HPA-302 is not Done until automated gates, Simulator, physical iPhone, relaunch/recap restoration, unguided playthrough, and the HPA-298 evidence summary all pass.

---

## File Map

**Create**

- `apps/vela-mobile/src/features/mystery-messenger/pilot-acceptance.test.ts` — real-chapter/controller/browser-storage acceptance.

**Consume without planned modification**

- `apps/vela-mobile/src/features/mystery-messenger/content.ts`
- `apps/vela-mobile/src/features/mystery-messenger/storage.ts`
- `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.ts`
- `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue`
- `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.ts`

**Tracking surfaces**

- HPA-302 PR body — live automated/native/playtest results.
- Linear HPA-298 — final acceptance summary comment.

## Risks and prerequisites

The critical path is the physical-device gate, not the new Vitest file. The existing HPA-210 foundation record still has physical acceptance deferred and a historical physical preflight marked `prerequisite_missing`.

Before Task 3 native acceptance starts, the tester-controlled environment must have:

- an Xcode development team/signing identity selected for the app target;
- a trusted iPhone with Developer Mode enabled as required;
- a development build that launches on that iPhone;
- a real usable Google/Cognito session on the device;
- access to the real Learn tab/card while signed in.

If that preflight fails because signing, device trust, launch, or the real auth/session foundation is unavailable, keep HPA-302 blocked and return/reopen the existing owning Mobile MVP work. Do not add a fake-auth runtime seam. Simulator evidence is still useful for diagnosis but is not a substitute for the physical acceptance gate.

---

### Task 1: Add real-chapter acceptance coverage

**Files:**
- Create: `apps/vela-mobile/src/features/mystery-messenger/pilot-acceptance.test.ts`

**Interfaces:**
- Consumes `MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER`.
- Consumes `createBrowserMysteryProgressStorage()`.
- Consumes `useMysteryMessenger()` and `MysteryMessengerController`.
- Adds no production interface or shared test utility.

This is acceptance/characterization coverage for behavior already implemented by HPA-299/300/301. Do not create an artificial failing phase; a failure of these assertions is itself an HPA-302 release finding.

- [ ] **Step 1: Create the focused acceptance test**

Create the file with local helpers and exactly three cases:

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
  return {
    controller: useMysteryMessenger({
      authState: reactive(usableAuthState(userId)),
      storage,
      chapter,
    }),
    storage,
  };
}

function responseSceneOf(sceneId: 'scene-07' | 'scene-11') {
  const scene = chapter.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene || scene.kind !== 'response-build') {
    throw new Error(`missing_response_scene:${sceneId}`);
  }
  return scene;
}

function scene07HistoryOf(controller: MysteryMessengerController) {
  const entry = controller.progress.value?.history.find((candidate) => candidate.sceneId === 'scene-07');
  if (!entry || entry.kind !== 'response-build') {
    throw new Error('missing_scene_07_response_history');
  }
  return entry;
}

const EXPECTED_HISTORY_SCENE_IDS = [
  'scene-01',
  'scene-02',
  'scene-03',
  'scene-04',
  'scene-05',
  'scene-06',
  'scene-07',
  'scene-08',
  'scene-09',
  'scene-10',
  'scene-11',
  'scene-12',
] as const;

const SCENE_07_REVIEW_TOKEN_IDS = [
  'time',
  'ni-place',
  'train',
  'de',
  'station',
  'ni-time',
  'go',
  'period',
] as const;

const REVIEW_PHRASE_IDS = [
  'tomorrow-seven',
  'mina-possession',
  'train-station-plan',
  'wrote-yesterday',
  'when-is-tomorrow',
] as const;

function completeCleanRun(controller: MysteryMessengerController): void {
  controller.continueMessage('scene-01');
  controller.continueMessage('scene-02');
  controller.chooseOption('scene-03', 'tomorrow-morning');
  controller.continueMessage('scene-04');
  controller.chooseOption('scene-05', 'minas-notebook');
  controller.continueMessage('scene-06');
  controller.submitResponse('scene-07', responseSceneOf('scene-07').correctTokenIds);
  controller.continueMessage('scene-08');
  controller.chooseOption('scene-09', 'ask-when-tomorrow');
  controller.continueMessage('scene-10');
  controller.submitResponse('scene-11', responseSceneOf('scene-11').correctTokenIds);
  controller.continueMessage('scene-12');
}

function driveReviewRunToScene10(controller: MysteryMessengerController): void {
  controller.continueMessage('scene-01');
  controller.continueMessage('scene-02');
  controller.chooseOption('scene-03', 'today-morning');
  controller.continueMessage('scene-04');
  controller.chooseOption('scene-05', 'minas-notebook', true);
  controller.continueMessage('scene-06');
  controller.submitResponse('scene-07', SCENE_07_REVIEW_TOKEN_IDS, true);
  controller.continueMessage('scene-08');
  controller.chooseOption('scene-09', 'ask-notebook-color');
}

function finishFromScene10(controller: MysteryMessengerController): void {
  controller.continueMessage('scene-10');
  controller.submitResponse('scene-11', responseSceneOf('scene-11').correctTokenIds);
  controller.continueMessage('scene-12');
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('Mystery Messenger pilot acceptance', () => {
  it('completes the checked-in chapter cleanly and persists the current-version ending', () => {
    const { controller, storage } = createPilotController();

    completeCleanRun(controller);

    expect(controller.currentScene.value?.id).toBe('scene-13');
    expect(controller.progress.value?.completed).toBe(true);
    expect(controller.progress.value?.history.map((entry) => entry.sceneId)).toEqual(
      EXPECTED_HISTORY_SCENE_IDS,
    );
    expect(controller.missedPhraseRecap.value).toEqual([]);

    const restored = storage.load('pilot-user', chapter);
    expect(restored).toMatchObject({
      chapterId: chapter.id,
      chapterVersion: chapter.version,
      currentSceneId: 'scene-13',
      completed: true,
    });
    expect(restored?.history.map((entry) => entry.sceneId)).toEqual(EXPECTED_HISTORY_SCENE_IDS);
  });

  it('round-trips wrong and hint-assisted scene-07 token identities through browser storage', () => {
    const first = createPilotController();
    driveReviewRunToScene10(first.controller);

    expect(first.controller.currentScene.value?.id).toBe('scene-10');
    expect(scene07HistoryOf(first.controller).selectedTokenIds).toEqual(SCENE_07_REVIEW_TOKEN_IDS);
    expect(scene07HistoryOf(first.controller).hintUsed).toBe(true);
    expect(first.controller.missedPhraseRecap.value.map((item) => item.phraseId)).toEqual(
      REVIEW_PHRASE_IDS,
    );

    const relaunched = createPilotController();
    expect(relaunched.controller.currentScene.value?.id).toBe('scene-10');
    expect(scene07HistoryOf(relaunched.controller).selectedTokenIds).toEqual(
      SCENE_07_REVIEW_TOKEN_IDS,
    );
    expect(scene07HistoryOf(relaunched.controller).hintUsed).toBe(true);
    expect(relaunched.controller.missedPhraseRecap.value.map((item) => item.phraseId)).toEqual(
      REVIEW_PHRASE_IDS,
    );

    finishFromScene10(relaunched.controller);

    expect(relaunched.controller.currentScene.value?.id).toBe('scene-13');
    expect(relaunched.controller.progress.value?.completed).toBe(true);
    expect(relaunched.controller.missedPhraseRecap.value.map((item) => item.phraseId)).toEqual(
      REVIEW_PHRASE_IDS,
    );
  });

  it('persists a clean restarted run across a second controller', () => {
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
});
```

The clean path deliberately consumes the chapter's own `correctTokenIds`, so this acceptance file does not become a third owner of canonical response content. The review path deliberately keeps the explicit swapped scene-07 IDs because their controller + real-browser-storage round-trip is the new composition being proved.

- [ ] **Step 2: Run the focused acceptance file**

Run:

```bash
bun --filter @vela/mobile test -- pilot-acceptance.test.ts
```

Expected: 3/3 PASS. If an assertion fails, keep the task open and treat the exact failure as a release defect; do not weaken the expected path, stored identities, version, or recap to make it green.

- [ ] **Step 3: Run the full task gate and commit**

Do not maintain a hand-picked regression subset here. The full mobile suite already includes the choice composer, response composer, recap UI, page, controller, storage, model, content validator, and audio tests that the native matrix depends on.

Run:

```bash
bun --filter @vela/mobile test
bun --filter @vela/mobile typecheck
git diff --check
```

Expected: all PASS.

Commit:

```bash
git add apps/vela-mobile/src/features/mystery-messenger/pilot-acceptance.test.ts
git commit -m "test(mobile): add mystery pilot acceptance coverage"
```

If Task 1 exposes a real defect, add the smallest failing regression to the existing owning test file and the smallest corresponding fix before this commit. Do not add a new abstraction solely for acceptance testing.

---

### Task 2: Run the existing automated release gates

**Files:**
- No planned repository file changes.
- Update the HPA-302 PR body with actual results.

**Interfaces:**
- Consumes existing `@vela/mobile` scripts.
- Produces the automated evidence used in the final HPA-298 summary.

- [ ] **Step 1: Pin a clean tested revision**

Run:

```bash
git rev-parse HEAD
git status --short
```

Expected: a full SHA and no uncommitted tracked implementation changes. Record the SHA in the PR body.

- [ ] **Step 2: Run all mobile gates**

Run:

```bash
bun --filter @vela/mobile test:coverage
bun --filter @vela/mobile lint
bun --filter @vela/mobile typecheck
bun --filter @vela/mobile build
git diff --check
```

Expected: all PASS. Record the exact commands, test count, line coverage, and outcomes in the PR body. Do not introduce an HPA-302-specific coverage threshold.

If the checkout lacks the normal public mobile build configuration, `MOBILE_SKIP_ENV_VALIDATION=true bun --filter @vela/mobile build` may be recorded only as a local compile fallback. It does not replace the authenticated native runs in Task 3.

No commit is expected for this task.

---

### Task 3: Complete native preflight, Simulator, and development-iPhone acceptance

**Files:**
- No planned repository file changes.
- Update the HPA-302 PR body with native provenance and results.

**Interfaces:**
- Consumes the real Learn entry, Mystery Messenger route, auth, shell/navigation, browser storage, and TTS/audio integration.
- Produces the required Simulator and physical-device acceptance results.

- [ ] **Step 1: Pass the physical-device prerequisite before relying on native acceptance**

Prepare/open the native project:

```bash
cd apps/vela-mobile
bun run build:ios:ide
```

Before running either acceptance matrix, confirm on the tester-controlled environment:

1. Xcode has a valid development team/signing identity selected for the app target.
2. The intended iPhone is trusted, Developer Mode is enabled as required, and Xcode can target it.
3. The current HPA-302 build launches on that iPhone.
4. A real Google/Cognito sign-in or restored real session reaches a usable authenticated state.
5. The signed-in app exposes the real Learn tab and Mystery Messenger card.

Record this preflight as PASS/FAIL in the PR body without recording UDID, email, account identifier, token, or other private values.

If any prerequisite is unavailable because of the existing mobile foundation, stop HPA-302 acceptance, keep the ticket blocked, and return/reopen the owning Mobile MVP work. Do not add fake auth or use Simulator evidence as a substitute for the required iPhone gate.

- [ ] **Step 2: Run the iOS Simulator matrix**

Start the documented development flow:

```bash
cd apps/vela-mobile
bun run dev:ios
```

Keep the dev server running, launch one iPhone Simulator from Xcode, and record only the tested SHA, Simulator model, iOS runtime, Xcode version, and Debug/development mode.

Use one continuous scripted run to verify:

1. Enter from the real Learn card.
2. Scene controls respect top/bottom safe areas in portrait; rotate once to check obvious horizontal sensor-region clipping.
3. Advance to scene 02, leave via header/native back, return, and confirm scene 02 restores.
4. At scene 03 answer `きょうの朝7時` incorrectly and confirm the story continues.
5. At scene 05 reveal the hint, answer `ミナさんのノートです`, and confirm continuation.
6. At scene 07, after the transcript is long, confirm the composer remains scrollable/actionable and build `7時に電車でさくら駅に行きます。` using both distinct `に` tokens once each.
7. Replay one scene or choice-prompt audio item and confirm playback returns to a usable state.
8. Force-close at scene 08 or later, relaunch, and confirm the exact persisted scene restores.
9. Finish the chapter, verify the recap contains each actually qualifying phrase once, and replay one recap phrase with visible row-local status.
10. Restart, confirm scene 01/no recap, leave/re-enter once, and confirm the fresh run persists.

Record PASS/FAIL and any visual/navigation/audio finding in the PR body. A narrow release defect is fixed on this same PR and the affected steps are rerun.

- [ ] **Step 3: Run the physical development-iPhone matrix**

Reuse the Step-1 native build when the tested SHA/configuration has not changed; otherwise rerun `bun run build:ios:ide`, select the same tester-controlled development team/device in Xcode, and Run.

Record tested SHA, iPhone model, iOS version, Xcode version, and build configuration; do not record the UDID or private account data.

Verify:

1. Discover/start/leave/resume/complete on the real device.
2. Header back and supported native swipe/back return to the expected prior route with no blank frame, app exit, or navigation trap.
3. Safe areas and long-transcript scrolling keep Hint/tokens/selected response/Send reachable.
4. With nonzero media volume and built-in speaker output, replay authored Japanese and confirm it is audibly understandable.
5. Repeat replay several times without overlap or a wedged control state.
6. Complete a run and replay one recap phrase.
7. Enable system Silent Mode (not Focus mode), perform an explicit replay, record the observed behavior, leave Silent Mode, and confirm replay remains usable. This is an observation of current behavior, not a new audibility policy.
8. Background/foreground or a normal interruption during playback does not leave playback permanently stuck.
9. Force-close mid-run and confirm the exact scene restores; after completion force-close/relaunch and confirm the ending recap restores.
10. Restart, relaunch once more, and confirm scene 01 with an empty run/recap restores.

Unexpected instability, stuck playback, broken resume, obscured controls, or a navigation trap is release-blocking until fixed or routed to the existing owning mobile ticket.

No commit is expected unless a narrow current-pilot defect is fixed.

---

### Task 4: Run the unguided playthrough and close the acceptance record

**Files:**
- No planned repository file changes.
- Update the HPA-302 PR body.
- Post one final structured comment on Linear HPA-298.

**Interfaces:**
- Consumes Tasks 1–3 results.
- Produces the final HPA-302/HPA-298 acceptance record.

- [ ] **Step 1: Run one fresh unguided timed playthrough**

Restart to a fresh run on the accepted iPhone build. Start a timer immediately before entering the story and stop it at scene 13.

During the timed run:

- use only normal product UI and authored hints;
- do not consult this plan's answer lists, test code, or the scene graph;
- record any unclear next action;
- record any unexpectedly ambiguous beginner/N5-adjacent Japanese copy;
- record any dead end or need to leave the app to recover;
- record minor polish separately from blockers.

Record the real elapsed duration. The product criterion is approximately 8–12 minutes with no dead end or unclear next action; do not alter the result to fit the target.

- [ ] **Step 2: Resolve every release finding by ownership**

Use exactly one disposition per finding:

- narrow Mystery Messenger defect → regression + minimal fix on this PR;
- existing shell/auth/audio/signing defect → return/reopen the existing owning Mobile MVP ticket and keep HPA-302 blocked until resolved or explicitly accepted;
- larger feature request/redesign → keep out of HPA-302 and track separately.

A defect that blocks understanding or completion is not an accepted limitation.

- [ ] **Step 3: Re-run final gates after the last code change**

Run from the final branch head:

```bash
bun --filter @vela/mobile test:coverage
bun --filter @vela/mobile lint
bun --filter @vela/mobile typecheck
bun --filter @vela/mobile build
git diff --check
git status --short
git rev-parse HEAD
```

Expected: all gates PASS, no uncommitted tracked changes, and one final tested SHA. Update the PR body so every automated result refers to that final head.

- [ ] **Step 4: Finish the PR through the normal review gate**

After automated, native, and unguided acceptance are green:

1. Mark the same PR ready for review.
2. Require the repository's normal CI and Codecov checks to pass.
3. Address review findings on the same PR and rerun affected gates after behavior/test changes.
4. Merge only when review and required checks are green.

Do not create a second HPA-302 PR.

- [ ] **Step 5: Post the final HPA-298 evidence comment**

Post one comment after all actual values are known. Include:

- final tested HPA-302 SHA and merged PR link;
- exact automated commands, PASS outcomes, test count, and coverage figure;
- native preflight result;
- Simulator model/iOS/Xcode/build mode, scripted result, relaunch scene, recap/restart result;
- iPhone model/iOS/Xcode/build mode, navigation/safe-area result, speaker replay result, Silent Mode observation, interruption recovery, relaunch/recap/restart result;
- unguided elapsed duration and clarity/dead-end result;
- consciously accepted non-blocking limitations;
- links to any blocking/reopened work.

Do not include UDIDs, tokens, emails, or private account details.

- [ ] **Step 6: Close Linear tracking only when acceptance is true**

After the PR is merged and the HPA-298 evidence comment is posted:

1. Move HPA-302 to Done if no blocking/reopened issue remains.
2. Re-check HPA-298 acceptance criteria against the merged pilot.
3. Move HPA-298 to Done if HPA-302 was the final unsatisfied child gate.

If a blocker remains, leave the tickets open and link the owning issue rather than claiming acceptance.
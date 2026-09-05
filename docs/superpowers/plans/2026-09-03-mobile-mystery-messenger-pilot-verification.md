# Mobile Mystery Messenger Pilot Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close HPA-302 by proving the checked-in Mystery Messenger pilot composes correctly across controller, browser storage, mounted UI, Simulator, and one physical iPhone without adding release infrastructure.

**Architecture:** Add one feature-local acceptance file. The acceptance file covers the two new controller/storage compositions plus one focused real-page DOM path from scene 07 through the ending. The mobile Vitest jsdom environment already provides `window.localStorage` (confirmed by the Task-0 baseline, which was fully green including `diagnostic-cold-entry.test.ts`), so no shared test-setup storage polyfill is added. Reuse existing mobile gates and HPA-538 for physical-foundation verification; keep all HPA-302 implementation/release fixes on PR #65.

**Tech Stack:** Vue 3, TypeScript, Vitest/jsdom, Vue Test Utils, Quasar, Capacitor iOS, Bun/Turborepo.

**Spec:** `docs/superpowers/specs/2026-09-03-mobile-mystery-messenger-pilot-verification-design.md`

## Global Constraints

- One HPA-302 branch / one PR: `codex/hpa-302-mystery-messenger-pilot-verification` / PR #65.
- Planned product-code footprint remains zero.
- Planned source changes are test-only: `pilot-acceptance.test.ts`. The shared `src/test/setup.ts` is not modified; the jsdom environment already provides `window.localStorage`.
- Do not modify the existing mocked `MysteryMessengerPage.test.ts` into a full chapter runner.
- No HPA-210 harness extension, Appium, Maestro, Playwright-mobile, new evidence schema, fake-auth runtime mode, or test-only product route.
- No backend/API/CDK/DynamoDB, SRS, Review-flow, cloud sync, analytics, or new product behavior.
- Reuse the checked-in chapter answers; do not copy canonical response token banks into HPA-302 tests.
- Keep scene-07 `ni-time` and `ni-place` as distinct stored identities.
- Do not add an HPA-302-specific coverage threshold.
- Do not record UDIDs, tokens, emails, account IDs, or other private test data.
- Physical acceptance remains mandatory. HPA-538 must complete before PR #65 leaves draft.

---

## File Map

**Create**

- `apps/vela-mobile/src/features/mystery-messenger/pilot-acceptance.test.ts` — controller/storage and focused mounted-page composition.

**Consume without planned modification**

- `apps/vela-mobile/src/test/setup.ts` — unchanged; the jsdom environment already provides `window.localStorage` (verified by the Task-0 baseline).
- `apps/vela-mobile/src/features/mystery-messenger/content.ts`
- `apps/vela-mobile/src/features/mystery-messenger/model.ts`
- `apps/vela-mobile/src/features/mystery-messenger/storage.ts`
- `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.ts`
- `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue`
- `apps/vela-mobile/src/features/mystery-messenger/components/*`
- `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.ts`

---

### Task 0: Bootstrap the checkout and record the baseline

**Files:**

- No repository changes.
- Update PR #65 body with actual baseline results.

**Interfaces:**

- Produces a valid dependency/build baseline before HPA-302 changes are judged.

- [ ] **Step 1: Install the complete workspace, including Capacitor dependencies**

From the repository root run:

```bash
bun install --frozen-lockfile
```

Expected: PASS. The mobile workspace postinstall must run `bun install --cwd src-capacitor --frozen-lockfile`, so imports such as `@capacitor/keyboard` and `@aparajita/capacitor-secure-storage` resolve from the committed native package tree.

If install fails, fix the checkout/environment before interpreting test failures. Do not file a Mystery Messenger release defect for a missing install.

- [ ] **Step 2: Rebuild the shared package baseline**

Run:

```bash
bun --filter @vela/common build
```

Expected: PASS. This removes stale/missing `packages/common/dist` as a typecheck variable.

- [ ] **Step 3: Record the pre-change mobile baseline**

Run separately and record the exact exit status/test counts/type errors in PR #65:

```bash
bun --filter @vela/mobile test
bun --filter @vela/mobile typecheck
```

This is a baseline, not yet an HPA-302 pass gate. The jsdom environment already provides `window.localStorage`, so there are no storage-contract failures to attribute to Task 1. Any unrelated failure that remains after a valid install/build is recorded before code changes so later deltas are not misclassified as pilot defects.

No commit is expected.

---

### Task 1: Add focused acceptance coverage

**Files:**

- Create: `apps/vela-mobile/src/features/mystery-messenger/pilot-acceptance.test.ts`

**Interfaces:**

- Consumes the real chapter, `createBrowserMysteryProgressStorage()`, `useMysteryMessenger()`, and real `MysteryMessengerPage`.
- Adds no production interface or shared feature test helper.
- Does not modify `src/test/setup.ts`; the jsdom environment already provides `window.localStorage` (confirmed by the Task-0 baseline).

- [ ] **Step 1: Create local acceptance helpers**

Create `pilot-acceptance.test.ts` with these imports/helpers. Keep helpers local to this file:

```ts
import { mount, type VueWrapper } from '@vue/test-utils';
import { QLayout, QPageContainer, Quasar } from 'quasar';
import { defineComponent, reactive } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MobileAuthCoordinator, MobileAuthState } from '../../auth/mobile-auth-contract';
import { MOBILE_AUTH_KEY } from '../../services/mobile-auth';
import { MOBILE_TTS_SERVICE_KEY } from '../../services/mobile-services';
import type { MobileTtsService } from '../../services/mobile-tts';
import MysteryMessengerPage from './MysteryMessengerPage.vue';
import { MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER as chapter } from './content';
import type { MysteryResponseBuildScene } from './model';
import { createBrowserMysteryProgressStorage, type MysteryProgressStorage } from './storage';
import { useMysteryMessenger, type MysteryMessengerController } from './useMysteryMessenger';

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

function responseSceneOf(sceneId: 'scene-07' | 'scene-11'): MysteryResponseBuildScene {
  const scene = chapter.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene || scene.kind !== 'response-build') {
    throw new Error(`missing_response_scene:${sceneId}`);
  }
  return scene;
}

function scene07HistoryOf(controller: MysteryMessengerController) {
  const entry = controller.progress.value?.history.find(
    (candidate) => candidate.sceneId === 'scene-07',
  );
  if (!entry || entry.kind !== 'response-build') {
    throw new Error('missing_scene_07_response_history');
  }
  return entry;
}

function driveReviewRunToScene07(controller: MysteryMessengerController): void {
  controller.continueMessage('scene-01');
  controller.continueMessage('scene-02');
  controller.chooseOption('scene-03', 'today-morning');
  controller.continueMessage('scene-04');
  controller.chooseOption('scene-05', 'minas-notebook', true);
  controller.continueMessage('scene-06');
}

function driveReviewRunToScene10(controller: MysteryMessengerController): void {
  driveReviewRunToScene07(controller);
  controller.submitResponse('scene-07', SCENE_07_REVIEW_TOKEN_IDS, true);
  controller.continueMessage('scene-08');
  controller.chooseOption('scene-09', 'ask-notebook-color');
}

function finishFromScene10(controller: MysteryMessengerController): void {
  controller.continueMessage('scene-10');
  controller.submitResponse('scene-11', responseSceneOf('scene-11').correctTokenIds);
  controller.continueMessage('scene-12');
}

function completeReviewRun(controller: MysteryMessengerController): void {
  driveReviewRunToScene10(controller);
  finishFromScene10(controller);
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});
```

- [ ] **Step 2: Add the real controller + browser-storage relaunch case**

Add:

```ts
describe('Mystery Messenger pilot acceptance', () => {
  it('round-trips the review path and swapped scene-07 token identities', () => {
    const first = createPilotController();
    driveReviewRunToScene10(first.controller);

    expect(first.controller.currentScene.value?.id).toBe('scene-10');
    expect(scene07HistoryOf(first.controller).selectedTokenIds).toEqual(
      SCENE_07_REVIEW_TOKEN_IDS,
    );
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

    const stored = relaunched.storage.load('pilot-user', chapter);
    expect(stored).toMatchObject({
      chapterId: chapter.id,
      chapterVersion: chapter.version,
      currentSceneId: 'scene-13',
      completed: true,
    });
    expect(stored?.history.map((entry) => entry.sceneId)).toEqual(EXPECTED_HISTORY_SCENE_IDS);
    expect(relaunched.controller.missedPhraseRecap.value.map((item) => item.phraseId)).toEqual(
      REVIEW_PHRASE_IDS,
    );
  });
```

This is the full controller/storage composition. Do not add a second clean 13-scene walk; `model.test.ts` already owns the literal clean graph traversal.

- [ ] **Step 3: Add the persisted restart case with a direct storage assertion**

Add:

```ts
it('persists restart before a fresh controller restores the run', () => {
  const first = createPilotController();
  completeReviewRun(first.controller);
  expect(first.controller.missedPhraseRecap.value).not.toEqual([]);

  first.controller.restart();

  expect(first.storage.load('pilot-user', chapter)).toMatchObject({
    chapterId: chapter.id,
    chapterVersion: chapter.version,
    currentSceneId: 'scene-01',
    completed: false,
    history: [],
  });

  const relaunched = createPilotController();
  expect(relaunched.controller.currentScene.value?.id).toBe('scene-01');
  expect(relaunched.controller.progress.value?.history).toEqual([]);
  expect(relaunched.controller.progress.value?.completed).toBe(false);
  expect(relaunched.controller.missedPhraseRecap.value).toEqual([]);
});
```

The direct `storage.load()` assertion is required; a fresh controller by itself would also look clean when persistence were missing.

- [ ] **Step 4: Add one focused mounted real-page case**

Continue in the same file with a small host and existing dependency providers:

```ts
const PageHost = defineComponent({
  components: { QLayout, QPageContainer, MysteryMessengerPage },
  template:
    '<q-layout view="hHh Lpr fFf"><q-page-container><mystery-messenger-page /></q-page-container></q-layout>',
});

function authCoordinatorFixture(userId: string): MobileAuthCoordinator {
  return { state: reactive(usableAuthState(userId)) } as MobileAuthCoordinator;
}

function ttsServiceFixture(): MobileTtsService {
  return {
    preparePronunciation: vi.fn(),
    invalidatePronunciation: vi.fn(),
    clearUser: vi.fn(),
    clearAll: vi.fn(),
  };
}

function mountRealPage(userId: string): VueWrapper {
  return mount(PageHost, {
    global: {
      plugins: [Quasar],
      provide: {
        [MOBILE_AUTH_KEY as symbol]: authCoordinatorFixture(userId),
        [MOBILE_TTS_SERVICE_KEY as symbol]: ttsServiceFixture(),
      },
    },
  });
}

async function unlockTransition(): Promise<void> {
  await vi.advanceTimersByTimeAsync(500);
}
```

Then add this integration case:

```ts
  it('drives the real page from scene 07 through the ending recap', async () => {
    vi.useFakeTimers();
    const userId = 'page-user';
    const seed = createPilotController(userId);
    driveReviewRunToScene07(seed.controller);
    expect(seed.controller.currentScene.value?.id).toBe('scene-07');

    const wrapper = mountRealPage(userId);
    expect(wrapper.find('[data-testid="mystery-response-build-composer"]').exists()).toBe(true);

    for (const tokenId of SCENE_07_REVIEW_TOKEN_IDS) {
      await wrapper.get(`[data-testid="mystery-response-token-${tokenId}"]`).trigger('click');
    }
    expect(wrapper.findAll('[data-testid="mystery-response-selected-ni-place"]')).toHaveLength(1);
    expect(wrapper.findAll('[data-testid="mystery-response-selected-ni-time"]')).toHaveLength(1);

    await wrapper.get('[data-testid="mystery-response-hint"]').trigger('click');
    await wrapper.get('[data-testid="mystery-response-send"]').trigger('click');
    await unlockTransition();

    await wrapper.get('[data-testid="mystery-continue"]').trigger('click');
    await unlockTransition();
    await wrapper.get('[data-testid="mystery-option-ask-notebook-color"]').trigger('click');
    await unlockTransition();
    await wrapper.get('[data-testid="mystery-continue"]').trigger('click');
    await unlockTransition();

    for (const tokenId of responseSceneOf('scene-11').correctTokenIds) {
      await wrapper.get(`[data-testid="mystery-response-token-${tokenId}"]`).trigger('click');
    }
    await wrapper.get('[data-testid="mystery-response-send"]').trigger('click');
    await unlockTransition();
    await wrapper.get('[data-testid="mystery-continue"]').trigger('click');
    await unlockTransition();

    expect(wrapper.find('[data-testid="mystery-restart"]').exists()).toBe(true);
    for (const phraseId of REVIEW_PHRASE_IDS) {
      expect(wrapper.find(`[data-testid="mystery-recap-phrase-${phraseId}"]`).exists()).toBe(true);
    }

    wrapper.unmount();
  });
});
```

This case uses the real page/controller/storage/composers, but deliberately begins from a real persisted scene-07 state. Do not duplicate scenes 01–06 through DOM and do not add HTML-audio emulation; existing audio tests and physical acceptance own playback.

- [ ] **Step 5: Run focused and full mobile verification**

Run:

```bash
bun --filter @vela/mobile test -- diagnostic-cold-entry.test.ts pilot-acceptance.test.ts
bun --filter @vela/mobile test
bun --filter @vela/mobile typecheck
git diff --check
```

Expected after the valid bootstrap and HPA-302 changes: the focused files pass and the full mobile suite/typecheck have no new failures versus the recorded Task-0 baseline. Any remaining pre-existing failure must be explicitly identified rather than relabeled as a pilot defect.

- [ ] **Step 6: Commit the test-only implementation**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/pilot-acceptance.test.ts
git commit -m "test(mobile): add mystery pilot acceptance coverage"
```

If these tests expose a narrow Mystery Messenger defect, add the smallest owning regression/fix on the same HPA-302 PR before this task is considered green.

---

### Task 2: Run the existing automated release gates

**Files:**

- No planned repository changes.
- Update PR #65 body with actual results.

- [ ] **Step 1: Pin a clean tested revision**

```bash
git status --short
git rev-parse HEAD
```

Expected: no uncommitted tracked implementation changes and one full tested SHA.

- [ ] **Step 2: Run the existing mobile gates**

```bash
bun --filter @vela/mobile test:coverage
bun --filter @vela/mobile lint
bun --filter @vela/mobile typecheck
bun --filter @vela/mobile build
git diff --check
```

Record exact commands, test count, line coverage, and outcomes in PR #65. No new HPA-302 threshold is introduced.

If normal public mobile build configuration is unavailable, `MOBILE_SKIP_ENV_VALIDATION=true bun --filter @vela/mobile build` is only a local compile fallback and must be labeled as such; it does not replace native acceptance.

No commit is expected.

---

### Task 3: Complete HPA-538 and the native Mystery Messenger matrices

**Files:**

- No planned HPA-302 repository changes.
- Update PR #65 and Linear evidence.

**Interfaces:**

- HPA-538 owns physical foundation eligibility and generic native observations.
- HPA-302 owns Mystery Messenger-specific Simulator/device acceptance.

- [ ] **Step 1: Treat HPA-538 as the hard physical prerequisite**

HPA-538 must be completed before PR #65 is marked ready for review.

Run HPA-538 against the current HPA-302 tested head/configuration when practical. Its owner/operator must establish:

- valid Xcode signing/development team;
- trusted iPhone / Developer Mode as required;
- install and launch;
- real Google/Cognito usable session and relaunch restoration;
- generic TTS playback/recovery and Silent Mode observation;
- keyboard/safe-area and native-navigation baseline.

If HPA-538 fails because of a foundation defect, keep PR #65 draft and fix that issue under HPA-538 or its existing owning Mobile MVP ticket. Do not add fake auth or waive the physical criterion.

- [ ] **Step 2: Run the iOS Simulator Mystery Messenger matrix**

```bash
cd apps/vela-mobile
bun run dev:ios
```

Record tested SHA, Simulator model, iOS runtime, Xcode version, and Debug/development mode.

Verify:

1. Enter from the real Learn card.
2. No obvious safe-area clipping in portrait and one landscape orientation.
3. Leave/back/return and preserve progress.
4. Exercise one wrong and one completed hint-assisted answer.
5. Build scene 07 using both distinct visible `に` tokens.
6. Long transcript keeps active composer controls reachable.
7. Replay one authored scene/prompt audio item.
8. Force-close/relaunch mid-run and restore the exact scene.
9. Finish, verify expected recap rows, and replay one recap phrase.
10. Restart and verify scene 01/no recap persists after re-entry.

Record PASS/FAIL and findings in PR #65.

- [ ] **Step 3: Run the physical Mystery Messenger matrix**

After HPA-538 is green, use the same tested head where possible:

```bash
cd apps/vela-mobile
bun run build:ios:ide
```

Record iPhone model, iOS version, Xcode version, build configuration, and tested SHA — never UDID/private account data.

Mystery Messenger-specific checks:

1. Discover/start/leave/resume/complete.
2. Long-transcript choice/response controls remain scrollable/reachable.
3. Scene-07 duplicate-visible token interaction is usable.
4. Force-close/relaunch restores the exact in-progress scene.
5. Completion recap is present and one phrase replay remains usable.
6. Restart persists; next launch restores scene 01 with no recap.

Reuse HPA-538 generic speaker/Silent Mode/interruption/safe-area/native-navigation evidence only when it was captured against the same HPA-302 head/configuration. Otherwise rerun those generic rows before HPA-302 closes.

No HPA-302 commit is expected unless a narrow feature defect is found.

---

### Task 4: Run the unguided playthrough and close the acceptance record

**Files:**

- No planned repository changes.
- Update PR #65.
- Post one final HPA-298 Linear comment.

- [ ] **Step 1: Run one fresh unguided timed iPhone playthrough**

Use the accepted physical build. Start the timer immediately before entering the story and stop at scene 13.

During the run:

- use only normal product UI/hints;
- do not consult the plan/test answers;
- record unclear next actions;
- record unexpectedly ambiguous beginner/N5-adjacent Japanese;
- record dead ends/recovery needs;
- record minor polish separately from blockers.

Record the real duration. Target is approximately 8–12 minutes with no dead end or unclear next action.

- [ ] **Step 2: Resolve findings by ownership**

- narrow Mystery Messenger defect → regression + smallest fix on PR #65;
- shared test-browser contract → `src/test/setup.ts` only;
- shell/auth/audio/signing/native-foundation defect → HPA-538 or existing Mobile MVP owner; HPA-302 stays blocked;
- larger feature request → separate future work.

- [ ] **Step 3: Re-run final automated gates after the last code change**

```bash
bun --filter @vela/mobile test:coverage
bun --filter @vela/mobile lint
bun --filter @vela/mobile typecheck
bun --filter @vela/mobile build
git diff --check
git status --short
git rev-parse HEAD
```

Update PR #65 so every automated/native result points to the final tested head.

- [ ] **Step 4: Mark PR #65 ready only after HPA-538 + HPA-302 native acceptance**

Require normal repository CI/Codecov review gates. Address review findings on the same PR and rerun affected checks after behavior/test changes.

Do not create a second HPA-302 PR.

- [ ] **Step 5: Post the HPA-298 final evidence summary**

Include:

- final tested SHA and PR #65;
- bootstrap and pre-change baseline results;
- exact automated commands/test counts/coverage;
- HPA-538 physical-foundation result;
- Simulator provenance/result;
- physical iPhone provenance and Mystery Messenger result;
- relaunch/recap/restart results;
- unguided duration and clarity/dead-end result;
- accepted non-blocking limitations;
- links to any reopened/blocking issue.

Exclude sensitive device/session values.

- [ ] **Step 6: Close Linear only when acceptance is true**

After PR #65 merges and the HPA-298 evidence comment exists:

1. Move HPA-302 to Done if no blocker remains.
2. Re-check HPA-298 criteria against the merged pilot.
3. Move HPA-298 to Done only when its remaining acceptance criteria are truly satisfied.

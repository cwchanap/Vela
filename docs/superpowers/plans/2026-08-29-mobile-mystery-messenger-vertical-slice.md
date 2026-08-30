# HPA-299 Mobile Mystery Messenger Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a five-scene, authenticated Mystery Messenger loop in Vela Mobile with one converging choice, local resume/restart, and existing TTS/audio playback.

**Architecture:** Keep the feature entirely under `apps/vela-mobile/src/features/mystery-messenger`. Use a closed local scene union, pure progression + transcript projection + authored-content validation, one user/chapter `localStorage` snapshot, one feature composable for auth/persistence orchestration, and a thin adapter over the existing `MobileTtsService` + injected `MobileAudioPlayer`. Reuse existing mobile routing/header/safe-area/auth boundaries unchanged.

**Tech Stack:** Vue 3, Quasar 2, TypeScript, Vue Router, Vitest, `@vue/test-utils`, existing Vela Mobile auth/TTS/audio services.

**Spec:** `docs/superpowers/specs/2026-08-29-mobile-mystery-messenger-vertical-slice-design.md`

## Global Constraints

- One ticket and one PR: HPA-299 implementation stays on PR #62.
- Keep all new feature code under `apps/vela-mobile/src/features/mystery-messenger`.
- Only `message`, `choice`, and `ending` scene variants in this ticket.
- Exactly one five-scene authored slice with one converging choice and one ending.
- No backend/API/CDK/DynamoDB/shared narrative package changes.
- No Pinia, generic story engine, branching framework, response builder, missed-phrase recap, or SRS mutation.
- Use `localStorage`; chapter-version mismatch discards the pilot save with no migration.
- Reuse existing `MobileTtsService` and `MobileAudioPlayer`; audio failure must never block story progression.
- HPA-300 remains blocked until this slice is manually accepted in an iOS Simulator.

---

## File Structure

### Create

```text
apps/vela-mobile/src/features/mystery-messenger/model.ts
apps/vela-mobile/src/features/mystery-messenger/model.test.ts
apps/vela-mobile/src/features/mystery-messenger/content.ts
apps/vela-mobile/src/features/mystery-messenger/validate-content.ts
apps/vela-mobile/src/features/mystery-messenger/validate-content.test.ts
apps/vela-mobile/src/features/mystery-messenger/storage.ts
apps/vela-mobile/src/features/mystery-messenger/storage.test.ts
apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.ts
apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.test.ts
apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.ts
apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.test.ts
apps/vela-mobile/src/features/mystery-messenger/components/MysteryTranscript.vue
apps/vela-mobile/src/features/mystery-messenger/components/MysteryTranscript.test.ts
apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.vue
apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts
apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue
apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts
apps/vela-mobile/src/pages/LearnPage.test.ts
```

### Modify

```text
apps/vela-mobile/src/pages/LearnPage.vue
apps/vela-mobile/src/pages/StubPages.test.ts
apps/vela-mobile/src/router/diagnostic-routes.ts
apps/vela-mobile/src/router/routes.test.ts
```

---

### Task 1: Add the closed scene model, progression, transcript selector, and five-scene content

**Files:**
- Create: `apps/vela-mobile/src/features/mystery-messenger/model.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/model.test.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/content.ts`

**Interfaces:**
- Produces: `MysteryChapter`, `MysteryScene`, `MysteryProgress`, `MysteryTranscriptItem`, `createMysteryProgress`, `continueMysteryMessage`, `chooseMysteryOption`, `restartMysteryProgress`, `getMysteryScene`, `selectMysteryTranscript`, `MYSTERY_MESSENGER_VERTICAL_SLICE`.
- Stale `expectedSceneId` is an idempotent no-op. The page-level rapid-transition lock in Task 5 owns accidental double-click/tap prevention.

- [ ] **Step 1: Write failing progression tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  chooseMysteryOption,
  continueMysteryMessage,
  createMysteryProgress,
  selectMysteryTranscript,
} from './model';
import { MYSTERY_MESSENGER_VERTICAL_SLICE as chapter } from './content';

describe('mystery progression', () => {
  it('advances one message', () => {
    const start = createMysteryProgress(chapter);
    const next = continueMysteryMessage(chapter, start, start.currentSceneId);

    expect(next.history).toEqual([{ sceneId: start.currentSceneId }]);
    expect(next.currentSceneId).toBe('scene-02');
  });

  it('treats a stale originating scene as an idempotent no-op', () => {
    const start = createMysteryProgress(chapter);
    const first = continueMysteryMessage(chapter, start, start.currentSceneId);
    const stale = continueMysteryMessage(chapter, first, start.currentSceneId);

    expect(stale).toBe(first);
  });

  it('checks staleness before validating the newer scene kind', () => {
    const start = createMysteryProgress(chapter);
    const afterFirst = continueMysteryMessage(chapter, start, 'scene-01');
    const afterSecond = continueMysteryMessage(chapter, afterFirst, 'scene-02');

    expect(
      chooseMysteryOption(chapter, afterSecond, 'scene-02', 'option-that-belongs-to-old-scene'),
    ).toBe(afterSecond);
  });
});
```

Also cover valid choice progression, invalid current-scene transition, unknown option, ending completion, and restart.

- [ ] **Step 2: Run the focused test and confirm failure**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/model.test.ts
```

Expected: FAIL because the feature modules do not exist.

- [ ] **Step 3: Implement the closed model and pure transitions**

Use the exact discriminated union from the spec. In both transitions, stale detection is first:

```ts
if (progress.currentSceneId !== expectedSceneId) {
  return progress;
}
```

Then validate the actual current scene kind and option. Use fixed errors only for real current-state defects:

```text
mystery_scene_not_found
mystery_invalid_transition
mystery_option_not_found
```

Do not add `mystery_stale_scene_action`; stale inputs are normal late UI events and return unchanged progress.

- [ ] **Step 4: Add transcript projection tests before the selector**

Build progress fixtures and assert the pure selector returns:

```text
completed message -> kind=message, active=false
completed choice -> kind=choice-result with selectedLabel + feedback
current unanswered choice -> kind=choice-prompt
current message -> kind=message, active=true
current ending -> kind=ending
```

Assert the current scene appears exactly once after all completed history entries.

- [ ] **Step 5: Implement `selectMysteryTranscript()` in `model.ts`**

Use the closed `MysteryTranscriptItem` union from the spec. Resolve each history entry through `getMysteryScene()`. For choice history, require `selectedOptionId` and map the selected option into `selectedLabel`, `feedback`, and `result`. Append the current scene once after history.

Do not move this reconstruction into `MysteryTranscript.vue`.

- [ ] **Step 6: Author the five-scene TypeScript constant**

Use this exact topology:

```text
scene-01 -> scene-02 -> scene-03(choice) -> scene-04 -> scene-05(ending)
                                      \-> scene-04
```

Use stable versioned TTS IDs:

```text
mystery-message-tomorrow-v1-scene-01
mystery-message-tomorrow-v1-scene-02
mystery-message-tomorrow-v1-scene-03-prompt
mystery-message-tomorrow-v1-scene-04
mystery-message-tomorrow-v1-scene-05
```

Pin convergence directly in `model.test.ts`:

```ts
const choice = chapter.scenes.find((scene) => scene.id === 'scene-03');
expect(choice?.kind).toBe('choice');
if (choice?.kind === 'choice') {
  expect(new Set(choice.options.map((option) => option.nextSceneId))).toEqual(new Set(['scene-04']));
}
```

Do not add a generic branching validator code.

- [ ] **Step 7: Run focused tests**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/model.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/model.ts \
  apps/vela-mobile/src/features/mystery-messenger/model.test.ts \
  apps/vela-mobile/src/features/mystery-messenger/content.ts
git commit -m "feat(mobile): add mystery messenger progression"
```

---

### Task 2: Validate authored content and local persisted progress

**Files:**
- Create: `apps/vela-mobile/src/features/mystery-messenger/validate-content.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/validate-content.test.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/storage.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/storage.test.ts`

**Interfaces:**
- Consumes: `MysteryChapter`, `MysteryProgress`, `MysteryScene`.
- Produces: `validateMysteryChapter`, `MysteryProgressStorage`, `createBrowserMysteryProgressStorage`, `mysteryProgressStorageKey`.

- [ ] **Step 1: Write failing content-validator tests**

Cover the real chapter success plus duplicate scene ID, dangling message/choice references, missing start, missing ending, unreachable ending, duplicate choice option ID, and fewer than two choice options.

```ts
it('accepts the authored vertical slice', () => {
  expect(validateMysteryChapter(MYSTERY_MESSENGER_VERTICAL_SLICE)).toEqual([]);
});
```

- [ ] **Step 2: Implement validator with `Map` + DFS/BFS**

No dependencies. Build a scene map, collect structural issues, then traverse from `startSceneId` when it exists. A choice contributes all option destinations to traversal.

Supported codes remain exactly:

```text
duplicate_scene_id
missing_start_scene
dangling_scene_reference
missing_ending
unreachable_ending
duplicate_choice_id
empty_choice_options
```

- [ ] **Step 3: Write failing storage tests with an in-memory Storage-like fake**

Cover user/chapter key encoding, missing load, round trip, invalid JSON deletion, chapter-version mismatch deletion, invalid current/history/option references, completion mismatch, and storage exceptions.

```ts
const values = new Map<string, string>();
const fakeStorage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => void values.set(key, value),
  removeItem: (key: string) => void values.delete(key),
};
```

- [ ] **Step 4: Implement the storage adapter**

Reject/delete when:

```text
chapterId !== chapter.id
chapterVersion !== chapter.version
currentSceneId is unknown
history sceneId is unknown
selectedOptionId is absent from the referenced choice scene
completed disagrees with whether current scene is ending
```

On browser-storage exceptions: `load -> null`, `save/clear -> false`. Do not throw into gameplay.

- [ ] **Step 5: Run focused tests**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/features/mystery-messenger/validate-content.test.ts \
  src/features/mystery-messenger/storage.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/validate-content.ts \
  apps/vela-mobile/src/features/mystery-messenger/validate-content.test.ts \
  apps/vela-mobile/src/features/mystery-messenger/storage.ts \
  apps/vela-mobile/src/features/mystery-messenger/storage.test.ts
git commit -m "feat(mobile): persist and validate mystery runs"
```

---

### Task 3: Add authenticated run orchestration with resume, restart, and identity isolation

**Files:**
- Create: `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.test.ts`

**Interfaces:**
- Consumes: `MOBILE_AUTH_KEY`, `selectMobileFeatureSessionStatus`, chapter model functions, `MysteryProgressStorage`.
- Produces: `useMysteryMessenger()` controller consumed by the page.

```ts
export type MysteryMessengerController = {
  progress: Readonly<Ref<MysteryProgress | null>>;
  currentScene: ComputedRef<MysteryScene | null>;
  transcript: ComputedRef<readonly MysteryTranscriptItem[]>;
  sessionStatus: ComputedRef<MobileFeatureSessionStatus>;
  persistenceWarning: Readonly<Ref<boolean>>;
  continueMessage(expectedSceneId: string): void;
  chooseOption(expectedSceneId: string, optionId: string): void;
  restart(): void;
};
```

- [ ] **Step 1: Write failing orchestration tests**

Cover usable restore, new-run save, transition save, storage-warning fallback, restart clear+save, recovering same-user mutation refusal, identity swap, and stale transition returning unchanged state without persistence churn.

- [ ] **Step 2: Implement the composable**

Use `computed` + `watch` over `selectMobileFeatureSessionStatus(coordinator.state)`.

```ts
function loadForUser(userId: string): void {
  const restored = storage.load(userId, chapter);
  const next = restored ?? createMysteryProgress(chapter);
  progress.value = next;
  activeUserId.value = userId;
  if (!restored && !storage.save(userId, next)) {
    persistenceWarning.value = true;
  }
}
```

For mutations require usable same-user ownership and non-null progress. Call the pure transition with `expectedSceneId`. If it returns the exact same progress object, do not save or replace the ref.

Expose:

```ts
const transcript = computed(() =>
  progress.value ? selectMysteryTranscript(chapter, progress.value) : [],
);
```

- [ ] **Step 3: Run focused tests**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/useMysteryMessenger.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.ts \
  apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.test.ts
git commit -m "feat(mobile): orchestrate mystery messenger runs"
```

---

### Task 4: Reuse authenticated TTS and the existing `MobileAudioPlayer` contract

**Files:**
- Create: `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.test.ts`

**Interfaces:**
- Consumes: `MOBILE_AUTH_KEY`, `MOBILE_TTS_SERVICE_KEY`, caller-supplied `MobileAudioPlayer`, `MobileTtsService`.
- Produces: `useMysteryAudio(audioPlayer: MobileAudioPlayer): MysteryAudioController`.

```ts
export type MysteryAudioState =
  | { kind: 'idle' }
  | { kind: 'preparing'; sceneId: string }
  | { kind: 'playing'; sceneId: string }
  | { kind: 'error'; sceneId: string; message: string };
```

- [ ] **Step 1: Write failing controller tests**

Pass a fake `MobileAudioPlayer` directly. Cover:

- usable user prepares with `userId`, exact `ttsId`, exact authored Japanese;
- prepared URL goes to `audioPlayer.play()`;
- `finished -> { kind: 'ended' }` settles state to `idle`;
- `finished -> { kind: 'stopped', reason: 'user' }` settles state to `idle`;
- `finished -> { kind: 'interrupted', reason: 'external' }` settles state to `idle`;
- TTS failure sets `error` and does not throw to page;
- rejected `MobileAudioError('media_unavailable')` invalidates only `(userId, scene.ttsId)` and sets error copy;
- unavailable/recovering auth refuses playback;
- `dispose()` stops/disposes owned playback;
- identity change prevents an old async preparation from starting playback.

Use a deferred `finished` promise in the fake so settlement is explicit.

- [ ] **Step 2: Implement the thin controller**

Signature:

```ts
export function useMysteryAudio(audioPlayer: MobileAudioPlayer): MysteryAudioController
```

Do not instantiate `HtmlAudioPlayer` inside the composable and do not copy the pronunciation diagnostic's counters/retry/interruption state machine.

After successful prepare:

```ts
const handle = audioPlayer.play(pronunciation.audioUrl);
state.value = { kind: 'playing', sceneId: scene.id };

try {
  await handle.finished;
  if (operationIsStillCurrent) {
    state.value = { kind: 'idle' };
  }
} catch (error) {
  // map MobileAudioError; media_unavailable also invalidates the one TTS identity
}
```

All three resolved outcome kinds map to `idle`. HPA-299 does not expose an interrupted UI state.

- [ ] **Step 3: Run focused tests**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/useMysteryAudio.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.ts \
  apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.test.ts
git commit -m "feat(mobile): add mystery messenger audio replay"
```

---

### Task 5: Build the dumb transcript UI, choice composer, and rapid-input-safe page

**Files:**
- Create: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryTranscript.vue`
- Create: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryTranscript.test.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.vue`
- Create: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue`
- Create: `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts`

**Interfaces:**
- Consumes: `useMysteryMessenger`, `useMysteryAudio`, `HtmlAudioPlayer`, `MysteryTranscriptItem[]`.
- Produces: one authenticated messenger screen inside the existing `MobileLayout`.

- [ ] **Step 1: Write thin transcript component tests**

Pass already-selected view items. Assert order, Japanese `lang="ja"`, selected-choice feedback rendering, and replay emission.

Public contract:

```ts
defineProps<{
  items: readonly MysteryTranscriptItem[];
}>();

defineEmits<{
  replay: [sceneId: string];
}>();
```

Do not pass `chapter` + `progress` and reconstruct history in the SFC.

- [ ] **Step 2: Implement `MysteryTranscript.vue`**

Use a `v-for` over the closed view-item union and switch only on `item.kind`. No auth, persistence, progression, or history lookup.

- [ ] **Step 3: Write and implement choice-composer tests**

Contract:

```ts
defineProps<{
  scene: MysteryChoiceScene;
  disabled: boolean;
}>();

defineEmits<{
  choose: [optionId: string];
}>();
```

Assert each option renders as a Quasar button, emits its ID, and does not emit while disabled.

- [ ] **Step 4: Write failing page tests including the real rapid-submit regression**

Mock the two composables and use fake timers. Cover message/choice/ending UI, session recovery, save warning, inline audio error, and this sequence:

```ts
vi.useFakeTimers();

// first visible message
await wrapper.get('[data-testid="mystery-continue"]').trigger('click');
// invoke the handler again before the 500ms transition guard clears
await wrapper.get('[data-testid="mystery-continue"]').trigger('click');

expect(continueMessage).toHaveBeenCalledTimes(1);

await vi.advanceTimersByTimeAsync(500);
// the next deliberate action can now proceed
```

The test must prove two rapid submissions cannot advance two messages. Do not rely on `expectedSceneId` alone.

- [ ] **Step 5: Implement the page-level transition lock**

Keep timing out of `model.ts`.

```ts
const RAPID_TRANSITION_GUARD_MS = 500;
const transitionLocked = ref(false);
let transitionUnlockTimer: ReturnType<typeof setTimeout> | null = null;

function lockTransition(): boolean {
  if (transitionLocked.value) return false;
  transitionLocked.value = true;
  if (transitionUnlockTimer) clearTimeout(transitionUnlockTimer);
  transitionUnlockTimer = setTimeout(() => {
    transitionLocked.value = false;
    transitionUnlockTimer = null;
  }, RAPID_TRANSITION_GUARD_MS);
  return true;
}
```

Continue handler:

```ts
function continueCurrentMessage(): void {
  const scene = messenger.currentScene.value;
  if (!scene || scene.kind !== 'message' || !lockTransition()) return;
  messenger.continueMessage(scene.id);
}
```

Choice handler follows the same lock before passing the visible scene ID and option ID. Bind `transitionLocked` into Continue/choice disabled state. Clear the timer on unmount.

- [ ] **Step 6: Wire audio through an explicit player dependency**

The page creates one concrete player:

```ts
const audio = useMysteryAudio(new HtmlAudioPlayer());
```

Replay resolves the scene by ID from the chapter and calls `audio.play(scene)`. Dispose audio on unmount.

- [ ] **Step 7: Run component/page tests**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/features/mystery-messenger/components/MysteryTranscript.test.ts \
  src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts \
  src/features/mystery-messenger/MysteryMessengerPage.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/components \
  apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue \
  apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts
git commit -m "feat(mobile): render mystery messenger loop"
```

---

### Task 6: Wire Learn entry, authenticated route, existing regression tests, full gates, and Simulator acceptance

**Files:**
- Modify: `apps/vela-mobile/src/pages/LearnPage.vue`
- Create: `apps/vela-mobile/src/pages/LearnPage.test.ts`
- Modify: `apps/vela-mobile/src/pages/StubPages.test.ts`
- Modify: `apps/vela-mobile/src/router/diagnostic-routes.ts`
- Modify: `apps/vela-mobile/src/router/routes.test.ts`
- Update: HPA-299 and PR #62 with final validation evidence.

**Interfaces:**
- Consumes: existing `pushMobileRoute`, `coreRoutes`, mobile header metadata.
- Produces: discoverable activity and final acceptance evidence.

- [ ] **Step 1: Write failing Learn-page test**

Assert:

```text
Mystery Messenger
The Message That Arrived Tomorrow
Play pilot
```

and clicking uses `pushMobileRoute(router, '/learn/mystery-messenger')`. Do not add Start/Resume persistence inspection.

- [ ] **Step 2: Update the existing stub-page test before replacing Learn**

In `apps/vela-mobile/src/pages/StubPages.test.ts`, remove `LearnPage` from the parameterized stub cases that require `Coming soon`. Leave Review/Words/More under the existing placeholder assertions. `LearnPage.test.ts` now owns Learn behavior.

Run:

```bash
bun run --cwd apps/vela-mobile test:unit -- src/pages/StubPages.test.ts src/pages/LearnPage.test.ts
```

Expected before implementation: Learn test FAIL; remaining stub tests PASS.

- [ ] **Step 3: Replace the Learn placeholder with one direct pilot card**

Keep the page literal and small; no activity registry or generic card catalog.

- [ ] **Step 4: Update route tests first**

Change the hard-coded expectations in `apps/vela-mobile/src/router/routes.test.ts`:

```ts
expect(root?.children).toHaveLength(9); // six core + three dev diagnostics
expect(buildMobileChildRoutes([])).toHaveLength(6); // production/core
```

Add:

```ts
expect(paths).toContain('learn/mystery-messenger');
```

Keep the existing `Promise.all(...loadDefault(c.component))` loop unchanged so the new lazy page import is resolved and a missing/broken page fails here.

- [ ] **Step 5: Add the route to existing `coreRoutes`**

```ts
{
  path: 'learn/mystery-messenger',
  name: 'mysteryMessenger',
  component: () => import('src/features/mystery-messenger/MysteryMessengerPage.vue'),
  meta: {
    mobileHeader: {
      title: 'Mystery Messenger',
      fallback: '/learn',
    },
  },
}
```

Do not set `bypassMobileAuth` and do not create a second router module.

- [ ] **Step 6: Run all focused tests**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/features/mystery-messenger \
  src/pages/LearnPage.test.ts \
  src/pages/StubPages.test.ts \
  src/router/routes.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run the full mobile gates**

```bash
bun run --cwd apps/vela-mobile test:unit
bun run --cwd apps/vela-mobile lint
bun run --cwd apps/vela-mobile typecheck
bun run --cwd apps/vela-mobile build
```

Expected: all PASS.

- [ ] **Step 8: Build/sync the iOS target and manually accept the slice in Simulator**

Use the repository's existing iOS workflow, then record the exact Simulator/device runtime used. Manually verify:

```text
Learn -> Mystery Messenger entry
five scenes -> one choice -> ending
leave route -> re-enter -> same scene, no duplicate transcript
app relaunch -> same local snapshot
restart -> scene-01
rapid repeated Continue -> only one scene advances
rapid repeated choice submit -> only one answer advances
TTS replay audible
natural audio end -> no stuck playing state
background/interruption during replay -> no stuck playing state
TTS error does not disable Continue/choice
```

HPA-300 remains blocked unless this Simulator pass succeeds.

- [ ] **Step 9: Update the same PR and Linear ticket with evidence**

Add the exact commands/results and Simulator observation to PR #62 and HPA-299. Do not open a second implementation PR.

- [ ] **Step 10: Commit integration/evidence updates**

```bash
git add apps/vela-mobile/src/pages/LearnPage.vue \
  apps/vela-mobile/src/pages/LearnPage.test.ts \
  apps/vela-mobile/src/pages/StubPages.test.ts \
  apps/vela-mobile/src/router/diagnostic-routes.ts \
  apps/vela-mobile/src/router/routes.test.ts
git commit -m "feat(mobile): expose mystery messenger pilot"
```

---

## Plan Self-Review

- Spec coverage: progression, transcript projection, authored validation, local persistence, auth ownership, audio settlement, Learn entry, route integration, existing-test updates, and Simulator acceptance all have owning tasks.
- Placeholder scan: no `TBD`, `TODO`, generic “add tests”, or undefined later interface remains.
- Type consistency: `MysteryTranscriptItem`, stale no-op transitions, `useMysteryAudio(audioPlayer)`, `transitionLocked`, six core routes, and nine development children are used consistently across tasks.
- Scope check: no backend/shared package/native plugin/store/engine work was added; HPA-300 remains the expansion gate.

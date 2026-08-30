# HPA-299 Mobile Mystery Messenger Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a five-scene, authenticated Mystery Messenger loop in Vela Mobile with one choice, local resume/restart, and existing TTS/audio playback.

**Architecture:** Keep the feature entirely under `apps/vela-mobile/src/features/mystery-messenger`. Use a closed local scene union, pure transitions and authored-content validation, one user/chapter `localStorage` snapshot, one feature composable for auth/persistence orchestration, and a thin adapter over the existing `MobileTtsService` + `HtmlAudioPlayer`. Reuse existing mobile routing/header/safe-area/auth boundaries unchanged.

**Tech Stack:** Vue 3, Quasar 2, TypeScript, Vue Router, Vitest, `@vue/test-utils`, existing Vela Mobile auth/TTS/audio services.

**Spec:** `docs/superpowers/specs/2026-08-29-mobile-mystery-messenger-vertical-slice-design.md`

## Global Constraints

- One ticket and one PR: HPA-299 implementation stays on this branch/PR.
- Keep all new feature code under `apps/vela-mobile/src/features/mystery-messenger`.
- Only `message`, `choice`, and `ending` scene variants in this ticket.
- Exactly one five-scene authored slice with one converging choice and one ending.
- No backend/API/CDK/DynamoDB/shared narrative package changes.
- No Pinia, generic story engine, branching framework, response builder, missed-phrase recap, or SRS mutation.
- Use `localStorage`; chapter-version mismatch discards the pilot save with no migration.
- Reuse existing `MobileTtsService` and `HtmlAudioPlayer`; audio failure must never block story progression.
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
apps/vela-mobile/src/router/diagnostic-routes.ts
apps/vela-mobile/src/router/routes.test.ts
```

---

### Task 1: Add the closed scene model, progression rules, and five-scene content

**Files:**
- Create: `apps/vela-mobile/src/features/mystery-messenger/model.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/model.test.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/content.ts`

**Interfaces:**
- Produces: `MysteryChapter`, `MysteryScene`, `MysteryProgress`, `createMysteryProgress`, `continueMysteryMessage`, `chooseMysteryOption`, `restartMysteryProgress`, `getMysteryScene`, `MYSTERY_MESSENGER_VERTICAL_SLICE`.
- Later tasks must pass the originating `expectedSceneId` into transitions so stale/double taps cannot skip scenes.

- [ ] **Step 1: Write failing progression tests**

Cover new-run creation, one message transition, one choice transition, ending completion, restart, invalid option, and stale expected-scene behavior.

```ts
import { describe, expect, it } from 'vitest';
import {
  chooseMysteryOption,
  continueMysteryMessage,
  createMysteryProgress,
} from './model';
import { MYSTERY_MESSENGER_VERTICAL_SLICE as chapter } from './content';

describe('mystery progression', () => {
  it('advances one message exactly once', () => {
    const start = createMysteryProgress(chapter);
    const next = continueMysteryMessage(chapter, start, start.currentSceneId);

    expect(next.history).toEqual([{ sceneId: start.currentSceneId }]);
    expect(next.currentSceneId).not.toBe(start.currentSceneId);
  });

  it('rejects a stale second tap instead of skipping a scene', () => {
    const start = createMysteryProgress(chapter);
    const first = continueMysteryMessage(chapter, start, start.currentSceneId);

    expect(() =>
      continueMysteryMessage(chapter, first, start.currentSceneId),
    ).toThrow('mystery_stale_scene_action');
  });
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/model.test.ts
```

Expected: FAIL because the feature modules do not exist.

- [ ] **Step 3: Implement the closed model and pure transitions**

Use the exact discriminated union from the design. Implement scene lookup with a simple `find` or local map helper. Transition rules:

```ts
function assertExpectedScene(progress: MysteryProgress, expectedSceneId: string): void {
  if (progress.currentSceneId !== expectedSceneId) {
    throw new Error('mystery_stale_scene_action');
  }
}
```

`continueMysteryMessage()` must require `kind === 'message'`, append one history entry, move to the next scene, and mark completion when the destination is `ending`.

`chooseMysteryOption()` must require `kind === 'choice'`, resolve a real option ID, append `{ sceneId, selectedOptionId }`, move to the option destination, and mark completion when that destination is `ending`.

Use fixed feature errors:

```text
mystery_scene_not_found
mystery_invalid_transition
mystery_option_not_found
mystery_stale_scene_action
```

- [ ] **Step 4: Author the five-scene TypeScript constant**

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

Keep Japanese beginner/N5-adjacent and make the choice comprehension-based rather than trivia-based.

- [ ] **Step 5: Run focused tests**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/model.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

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

Include one passing real-chapter test and explicit failures for duplicate scene ID, dangling reference, missing ending, unreachable ending, duplicate choice option ID, and fewer than two choice options.

```ts
it('accepts the authored vertical slice', () => {
  expect(validateMysteryChapter(MYSTERY_MESSENGER_VERTICAL_SLICE)).toEqual([]);
});

it('reports an unreachable ending', () => {
  const chapter = {
    id: 'test',
    version: 1,
    title: 'Test',
    startSceneId: 'a',
    scenes: [
      { id: 'a', kind: 'message', speaker: 'mina', text: 'A', ttsId: 'a', nextSceneId: 'a' },
      { id: 'end', kind: 'ending', title: 'End', text: '終わり', ttsId: 'end' },
    ],
  } as const;

  expect(validateMysteryChapter(chapter)).toContainEqual({
    code: 'unreachable_ending',
    sceneId: 'end',
  });
});
```

- [ ] **Step 2: Implement the validator with `Map` + DFS/BFS**

Do not add dependencies. Build a scene map, collect structural issues, then traverse from `startSceneId` only when the start exists. A choice contributes all option destinations to traversal.

- [ ] **Step 3: Write failing storage tests with an in-memory Storage-like fake**

Cover:

- user/chapter key encoding;
- missing load;
- round-trip save/load;
- invalid JSON deletion;
- chapter-version mismatch deletion;
- invalid current scene deletion;
- invalid history scene/option deletion;
- storage exceptions returning `false` rather than throwing.

Use a small fake:

```ts
const values = new Map<string, string>();
const fakeStorage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => void values.set(key, value),
  removeItem: (key: string) => void values.delete(key),
};
```

- [ ] **Step 4: Implement the storage adapter**

`load()` must parse unknown JSON defensively and validate only the fields HPA-299 stores. Reject/delete when:

```text
chapterId !== chapter.id
chapterVersion !== chapter.version
currentSceneId is unknown
history sceneId is unknown
selectedOptionId is absent from the referenced choice scene
completed disagrees with whether current scene is ending
```

On `getItem`, `setItem`, or `removeItem` exception, catch and return the documented safe value (`null` for load, `false` for save/clear).

- [ ] **Step 5: Run focused validator/storage tests**

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

Use this public shape:

```ts
export type MysteryMessengerController = {
  progress: Readonly<Ref<MysteryProgress | null>>;
  currentScene: ComputedRef<MysteryScene | null>;
  sessionStatus: ComputedRef<MobileFeatureSessionStatus>;
  persistenceWarning: Readonly<Ref<boolean>>;
  continueMessage(expectedSceneId: string): void;
  chooseOption(expectedSceneId: string, optionId: string): void;
  restart(): void;
};
```

- [ ] **Step 1: Write failing orchestration tests**

Provide a fake auth state and fake `MysteryProgressStorage`. Cover:

- usable user loads an existing run;
- usable user with no run gets `createMysteryProgress()` and saves it;
- transition saves new progress;
- storage failure sets `persistenceWarning` but keeps in-memory progress;
- restart clears then saves fresh progress;
- recovering same-user state retains current progress but mutations are ignored;
- user identity change discards old in-memory progress and loads the new user's snapshot;
- stale originating scene ID cannot advance twice.

- [ ] **Step 2: Implement the composable**

Use `computed` + `watch` over `selectMobileFeatureSessionStatus(coordinator.state)`.

Keep initialization per current usable user in one helper:

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

Mutation guards must require all of:

```text
sessionStatus.kind === 'usable'
activeUserId === sessionStatus.userId
progress !== null
progress.currentSceneId === expectedSceneId
```

If the last equality fails, return without mutation. The pure model still throws if called directly with stale data; the composable turns rapid stale UI actions into no-ops.

- [ ] **Step 3: Run focused test**

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

### Task 4: Reuse authenticated TTS and existing HTML audio playback

**Files:**
- Create: `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.test.ts`

**Interfaces:**
- Consumes: `MOBILE_AUTH_KEY`, `MOBILE_TTS_SERVICE_KEY`, `HtmlAudioPlayer`, `MobileTtsService`.
- Produces: `MysteryAudioController`.

Use:

```ts
export type MysteryAudioState =
  | { kind: 'idle' }
  | { kind: 'preparing'; sceneId: string }
  | { kind: 'playing'; sceneId: string }
  | { kind: 'error'; sceneId: string; message: string };

export type MysteryAudioController = {
  state: Readonly<Ref<MysteryAudioState>>;
  play(scene: MysteryMessageScene | MysteryChoiceScene | MysteryEndingScene): Promise<void>;
  dispose(): void;
};
```

- [ ] **Step 1: Write failing audio-controller tests**

Inject fakes through an internal factory option rather than mocking DOM audio globally. Test:

- usable user calls `preparePronunciation()` with the user's ID, scene TTS ID, and exact authored Japanese;
- prepared URL is passed to the audio player;
- TTS failure produces `{ kind: 'error' }` and does not throw to the page;
- media-unavailable invalidates only the scene pronunciation identity;
- unavailable/recovering auth refuses playback;
- `dispose()` stops/disposes owned playback;
- identity change prevents an old async preparation from starting playback.

- [ ] **Step 2: Implement a thin controller**

Do not duplicate the diagnostic controller's counters/retry state machine. HPA-299 only needs explicit-tap prepare/play plus simple error state.

When playback fails with `MobileAudioError('media_unavailable')`:

```ts
ttsService.invalidatePronunciation(userId, scene.ttsId);
state.value = {
  kind: 'error',
  sceneId: scene.id,
  message: 'Audio expired. Tap replay to try again.',
};
```

Do not automatically prepare a second URL.

- [ ] **Step 3: Run focused test**

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

### Task 5: Build transcript, choice composer, and playable page

**Files:**
- Create: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryTranscript.vue`
- Create: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryTranscript.test.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.vue`
- Create: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue`
- Create: `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts`

**Interfaces:**
- Consumes: `useMysteryMessenger`, `useMysteryAudio`, chapter content.
- Produces: one authenticated messenger screen rendered inside existing `MobileLayout`.

- [ ] **Step 1: Write failing transcript tests**

Mount with a small chapter/progress fixture and assert:

- completed message appears once;
- completed choice renders selected answer plus feedback;
- current scene appears after history;
- Japanese text has `lang="ja"`;
- replay emits the requested scene ID rather than performing service work directly.

- [ ] **Step 2: Implement `MysteryTranscript.vue` as presentation only**

Use props for chapter/progress/current scene and emit:

```ts
const emit = defineEmits<{
  replay: [sceneId: string];
}>();
```

No auth, persistence, or progression mutation inside the component.

- [ ] **Step 3: Write failing choice-composer tests**

Assert each option renders as a Quasar button, emits once per click, and disables when `disabled` is true.

Public contract:

```ts
defineProps<{
  scene: MysteryChoiceScene;
  disabled: boolean;
}>();

defineEmits<{
  choose: [optionId: string];
}>();
```

- [ ] **Step 4: Implement `MysteryChoiceComposer.vue`**

Use fixed buttons with minimum mobile touch target sizing. Do not add answer validation or feedback state here.

- [ ] **Step 5: Write failing page tests**

Mock the two composables and cover:

- message scene renders Continue;
- choice scene renders composer;
- ending renders Restart;
- recovering session disables progression;
- persistence warning is visible but non-blocking;
- audio error is inline and progression stays enabled;
- a captured message/choice action passes the scene ID visible at render time.

- [ ] **Step 6: Implement the page**

The page should:

```ts
const messenger = useMysteryMessenger(MYSTERY_MESSENGER_VERTICAL_SLICE);
const audio = useMysteryAudio();
```

For Continue:

```ts
const sceneId = currentScene.value.id;
messenger.continueMessage(sceneId);
```

For a choice:

```ts
const sceneId = currentScene.value.id;
messenger.chooseOption(sceneId, optionId);
```

This preserves the originating scene identity through rapid taps.

Dispose audio on unmount.

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

### Task 6: Wire Learn entry, authenticated route, full gates, and Simulator acceptance

**Files:**
- Modify: `apps/vela-mobile/src/pages/LearnPage.vue`
- Create: `apps/vela-mobile/src/pages/LearnPage.test.ts`
- Modify: `apps/vela-mobile/src/router/diagnostic-routes.ts`
- Modify: `apps/vela-mobile/src/router/routes.test.ts`
- Update as needed: HPA-299 and the same draft PR with validation evidence.

**Interfaces:**
- Consumes: existing `pushMobileRoute`, core authenticated child-route tree, mobile header metadata.
- Produces: discoverable activity and final acceptance evidence.

- [ ] **Step 1: Write failing Learn-page test**

Mount `LearnPage.vue` with a router stub and assert one direct card exists with:

```text
Mystery Messenger
The Message That Arrived Tomorrow
Play pilot
```

Clicking the button must call the existing mobile navigation helper for `/learn/mystery-messenger`.

Do not test `Start`/`Resume` copy because Learn intentionally does not read persistence.

- [ ] **Step 2: Replace the Learn placeholder with the direct pilot card**

Keep the page simple. No generic activity array or registry.

- [ ] **Step 3: Write failing route metadata test**

Assert the core route contains:

```ts
{
  path: 'learn/mystery-messenger',
  name: 'mysteryMessenger',
  meta: {
    mobileHeader: {
      title: 'Mystery Messenger',
      fallback: '/learn',
    },
  },
}
```

Also assert it does **not** set `bypassMobileAuth`.

- [ ] **Step 4: Add the route to the existing authenticated core routes**

Do not create a second router module just for one feature route.

- [ ] **Step 5: Run all HPA-299 focused tests**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger src/pages/LearnPage.test.ts src/router/routes.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run the full mobile automated gate**

```bash
bun run --cwd apps/vela-mobile test:unit
bun run --cwd apps/vela-mobile lint
bun run --cwd apps/vela-mobile typecheck
bun run --cwd apps/vela-mobile build
```

Expected: all commands exit 0.

- [ ] **Step 7: Build/sync the iOS target using the repository's existing workflow**

Run:

```bash
bun run --cwd apps/vela-mobile build:ios:assets
```

Then use the existing Xcode/Simulator path already documented for Vela Mobile; do not add a new automation framework.

- [ ] **Step 8: Manually verify the five-scene slice in an iOS Simulator**

Record these exact observations on HPA-299 / the PR:

```text
[ ] Signed-in Learn page shows Mystery Messenger card.
[ ] Play pilot opens /learn/mystery-messenger with existing mobile header/back behavior.
[ ] Scene 1 -> Scene 2 -> choice -> Scene 4 -> ending completes without dead end.
[ ] Correct and incorrect choice both converge and display authored feedback.
[ ] Rapid double-tap on Continue does not skip a scene.
[ ] Japanese replay uses the existing TTS/audio path.
[ ] TTS failure does not block Continue/choice progression.
[ ] Leaving to Learn and returning restores the same scene/history.
[ ] Relaunch restores the same signed-in user's run.
[ ] Restart returns to scene 1 and clears prior history.
[ ] Safe-area layout, scrolling, and header/back remain usable.
```

- [ ] **Step 9: Update the same draft PR with implementation evidence**

The PR body should list:

- focused/full test results;
- lint/typecheck/build results;
- Simulator model/iOS version;
- manual acceptance results;
- any accepted limitations.

Do not open another PR for implementation or verification.

- [ ] **Step 10: Commit final wiring/evidence-related code changes**

```bash
git add apps/vela-mobile/src/pages/LearnPage.vue \
  apps/vela-mobile/src/pages/LearnPage.test.ts \
  apps/vela-mobile/src/router/diagnostic-routes.ts \
  apps/vela-mobile/src/router/routes.test.ts
git commit -m "feat(mobile): expose mystery messenger pilot"
```

---

## Self-Review

### Spec coverage

- Closed local scene model: Task 1.
- Five-scene converging chapter: Task 1.
- Authored-content validation: Task 2.
- User/chapter local snapshot and version reset: Task 2.
- Same-user auth ownership, resume, restart, identity isolation: Task 3.
- Existing TTS/audio reuse with non-blocking errors: Task 4.
- Transcript, choice composer, page flow, stale-action protection: Task 5.
- Learn entry, authenticated route, automated gates, Simulator acceptance: Task 6.

### YAGNI check

The plan adds no backend route, cloud save, generic narrative engine, shared package, Pinia store, response builder, missed-phrase model, branching abstraction, or new E2E framework.

### Type/signature consistency

- `expectedSceneId` is present in both pure transition APIs and composable mutation methods.
- the page passes the rendered scene's ID into every mutation.
- storage consumes only `MysteryChapter` + `MysteryProgress` from Task 1.
- audio consumes existing auth/TTS/audio contracts and does not own progression.

### Completion gate

HPA-299 can move out of implementation only after the automated mobile gates pass and the five-scene loop is manually accepted in an iOS Simulator. HPA-300 remains blocked until then.

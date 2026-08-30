# HPA-287 Mobile Mystery Messenger Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one five-scene authenticated Mystery Messenger loop in Vela Mobile with a language choice, existing TTS/audio playback, local resume/restart, content validation, and iOS Simulator acceptance.

**Architecture:** Keep the slice feature-local under `apps/vela-mobile/src/features/mystery-messenger`. Use closed TypeScript scene types, pure content/progression functions, one user-scoped `localStorage` snapshot, one auth-aware Vue composable, and a thin feature-local adapter over the existing `MobileTtsService` + `HtmlAudioPlayer`. Reuse current mobile auth, route history, header, safe-area, and build/test infrastructure unchanged.

**Tech Stack:** Vue 3, Quasar 2, Vue Router 4, TypeScript 5.6, Vitest, Vue Test Utils, existing Vela Mobile auth/TTS/audio services, browser `localStorage`, Capacitor iOS.

**Spec:** `docs/superpowers/specs/2026-08-29-mobile-mystery-messenger-vertical-slice-design.md`

## Global Constraints

- Linear owner: HPA-287.
- One branch and one PR for planning, implementation, review fixes, and acceptance evidence.
- New domain/persistence/orchestration code stays feature-local; do not move it to `@vela/common`.
- Scene variants are exactly `message`, `choice`, and `ending`.
- Author exactly five scenes with one choice and one ending.
- Reuse `MobileAuthCoordinator`, `selectMobileFeatureSessionStatus`, `MobileTtsService`, `HtmlAudioPlayer`, `MobileLayout`, `MobilePageHeader`, and mobile navigation helpers.
- Use browser `localStorage`; no Capacitor persistence plugin, API, DynamoDB, cloud sync, migration, or retry queue.
- TTS failure never blocks story progression.
- No Pinia, story engine, registry, CMS, web parity, SRS write, `response-build`, recap, branching, or new E2E framework.
- Existing mobile unit tests, lint, type-check, and production build stay green.
- HPA-287 requires iOS Simulator acceptance; physical-device acceptance is deferred.

## File Map

### Create

```text
apps/vela-mobile/src/features/mystery-messenger/
  model.ts
  model.test.ts
  content.ts
  validate-content.ts
  validate-content.test.ts
  storage.ts
  storage.test.ts
  useMysteryMessenger.ts
  useMysteryMessenger.test.ts
  useMysteryAudio.ts
  useMysteryAudio.test.ts
  components/
    MysteryTranscript.vue
    MysteryTranscript.test.ts
    MysteryChoiceComposer.vue
    MysteryChoiceComposer.test.ts
  MysteryMessengerPage.vue
  MysteryMessengerPage.test.ts
apps/vela-mobile/src/pages/LearnPage.test.ts
```

### Modify

```text
apps/vela-mobile/src/pages/LearnPage.vue
apps/vela-mobile/src/pages/StubPages.test.ts
apps/vela-mobile/src/router/diagnostic-routes.ts
apps/vela-mobile/src/router/routes.test.ts
```

No backend, `@vela/common`, native iOS, package/dependency, or infrastructure files should change.

---

### Task 1: Define the five-scene contract and validate authored content

**Files:**
- Create: `apps/vela-mobile/src/features/mystery-messenger/model.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/content.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/validate-content.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/validate-content.test.ts`

**Interfaces:**
- Produces `MysteryChapter`, `MysteryScene`, `MysteryProgress`, and related closed types from the spec.
- Produces `MYSTERY_MESSENGER_VERTICAL_SLICE`.
- Produces `validateMysteryChapter(chapter): readonly MysteryContentIssue[]`.

- [ ] **Step 1: Write the validator tests first**

Create `validate-content.test.ts` with these required cases:

```ts
import { describe, expect, it } from 'vitest';
import { MYSTERY_MESSENGER_VERTICAL_SLICE } from './content';
import { validateMysteryChapter } from './validate-content';

const codes = (chapter: typeof MYSTERY_MESSENGER_VERTICAL_SLICE) =>
  validateMysteryChapter(chapter).map((issue) => issue.code);

describe('validateMysteryChapter', () => {
  it('accepts the authored vertical slice', () => {
    expect(validateMysteryChapter(MYSTERY_MESSENGER_VERTICAL_SLICE)).toEqual([]);
  });

  it('rejects duplicate scene ids', () => {
    const chapter = {
      ...MYSTERY_MESSENGER_VERTICAL_SLICE,
      scenes: [
        ...MYSTERY_MESSENGER_VERTICAL_SLICE.scenes,
        MYSTERY_MESSENGER_VERTICAL_SLICE.scenes[0],
      ],
    };
    expect(codes(chapter)).toContain('duplicate_scene_id');
  });

  it('rejects dangling references', () => {
    const [first, ...rest] = MYSTERY_MESSENGER_VERTICAL_SLICE.scenes;
    if (first.kind !== 'message') throw new Error('fixture_first_scene_must_be_message');
    expect(
      codes({
        ...MYSTERY_MESSENGER_VERTICAL_SLICE,
        scenes: [{ ...first, nextSceneId: 'missing-scene' }, ...rest],
      }),
    ).toContain('dangling_scene_reference');
  });

  it('rejects a missing ending', () => {
    expect(
      codes({
        ...MYSTERY_MESSENGER_VERTICAL_SLICE,
        scenes: MYSTERY_MESSENGER_VERTICAL_SLICE.scenes.filter(
          (scene) => scene.kind !== 'ending',
        ),
      }),
    ).toContain('missing_ending');
  });

  it('rejects an unreachable ending', () => {
    const scenes = MYSTERY_MESSENGER_VERTICAL_SLICE.scenes.map((scene) =>
      scene.kind === 'message' && scene.id === 'scene-04'
        ? { ...scene, nextSceneId: 'scene-04' }
        : scene,
    );
    expect(codes({ ...MYSTERY_MESSENGER_VERTICAL_SLICE, scenes })).toContain(
      'unreachable_ending',
    );
  });
});
```

Also cover duplicate choice IDs and fewer than two choice options.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/validate-content.test.ts
```

Expected: FAIL because the feature files do not exist.

- [ ] **Step 3: Add the closed contracts to `model.ts`**

Implement the exact discriminated unions from the spec. Do not add generic `payload`, handler names, registry IDs, or extension objects.

- [ ] **Step 4: Author the fixed five-scene fixture in `content.ts`**

Use this topology:

```text
scene-01 message (Mina)
→ scene-02 message (Haru)
→ scene-03 choice (Mina, 2 options)
→ scene-04 message (Haru)
→ scene-05 ending
```

Both choice options point to `scene-04`; one has `result: 'correct'`, one `result: 'incorrect'`, each with short feedback.

Use stable TTS IDs:

```text
mystery-message-tomorrow-v1-scene-01
mystery-message-tomorrow-v1-scene-02
mystery-message-tomorrow-v1-scene-03-prompt
mystery-message-tomorrow-v1-scene-04
mystery-message-tomorrow-v1-scene-05
```

Export with `satisfies MysteryChapter`, not a cast.

- [ ] **Step 5: Implement `validateMysteryChapter` with `Map` + DFS/BFS**

Public issue codes:

```ts
export type MysteryContentIssue = {
  code:
    | 'duplicate_scene_id'
    | 'missing_start_scene'
    | 'dangling_scene_reference'
    | 'missing_ending'
    | 'unreachable_ending'
    | 'duplicate_choice_id'
    | 'empty_choice_options';
  sceneId?: string;
  referenceId?: string;
};
```

Return all authored issues; do not throw and do not add Zod/graph dependencies.

- [ ] **Step 6: Run GREEN gate**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/validate-content.test.ts
bun run --cwd apps/vela-mobile typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/{model.ts,content.ts,validate-content.ts,validate-content.test.ts}
git commit -m "feat(mobile): define mystery messenger slice"
```

---

### Task 2: Add pure progression and migration-free local persistence

**Files:**
- Modify: `apps/vela-mobile/src/features/mystery-messenger/model.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/model.test.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/storage.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/storage.test.ts`

**Interfaces:**

```ts
export function createMysteryProgress(chapter: MysteryChapter): MysteryProgress;
export function getMysteryScene(chapter: MysteryChapter, sceneId: string): MysteryScene;
export function continueMysteryMessage(
  chapter: MysteryChapter,
  progress: MysteryProgress,
): MysteryProgress;
export function chooseMysteryOption(
  chapter: MysteryChapter,
  progress: MysteryProgress,
  optionId: string,
): MysteryProgress;
export function restartMysteryProgress(chapter: MysteryChapter): MysteryProgress;

export type MysteryProgressStorage = {
  load(userId: string, chapter: MysteryChapter): MysteryProgress | null;
  save(userId: string, progress: MysteryProgress): boolean;
  clear(userId: string, chapterId: string): boolean;
};
```

- [ ] **Step 1: Write progression tests and verify RED**

Required assertions:

```ts
let progress = createMysteryProgress(chapter);
expect(progress.currentSceneId).toBe('scene-01');
expect(progress.history).toEqual([]);

progress = continueMysteryMessage(chapter, progress);
progress = continueMysteryMessage(chapter, progress);
progress = chooseMysteryOption(chapter, progress, 'tomorrow-morning');

expect(progress.history).toEqual([
  { sceneId: 'scene-01' },
  { sceneId: 'scene-02' },
  { sceneId: 'scene-03', selectedOptionId: 'tomorrow-morning' },
]);
expect(progress.currentSceneId).toBe('scene-04');
```

Continue once more and assert `scene-05` + `completed: true`. Assert wrong-scene transition throws `mystery_invalid_transition`. Assert restart returns the exact fresh progress shape.

Run:

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/model.test.ts
```

Expected: RED before the functions exist.

- [ ] **Step 2: Implement the pure progression helpers**

Use immutable history copies. `createMysteryProgress` sets `completed` from whether the start scene is already an ending. `continueMysteryMessage` and `chooseMysteryOption` validate the current scene kind, append one history entry, advance, and mark completion from the destination scene.

No Vue or persistence call belongs in `model.ts`.

- [ ] **Step 3: Write persistence tests and verify RED**

Use an in-memory `Storage`-shape fake. Cover:

- key encodes user + chapter ID;
- same-user round trip;
- other user cannot read the snapshot;
- chapter-version mismatch deletes and returns `null`;
- malformed JSON deletes and returns `null`;
- invalid current/history/choice references delete and return `null`;
- `setItem`/`removeItem` exceptions return `false` rather than throwing.

Example:

```ts
const adapter = createBrowserMysteryProgressStorage(memoryStorage);
const progress = createMysteryProgress(chapter);
expect(adapter.save('user-a', progress)).toBe(true);
expect(adapter.load('user-a', chapter)).toEqual(progress);
expect(adapter.load('user-b', chapter)).toBeNull();
```

- [ ] **Step 4: Implement `storage.ts`**

```ts
export function mysteryProgressStorageKey(userId: string, chapterId: string): string {
  return `vela:mystery-messenger:${encodeURIComponent(userId)}:${encodeURIComponent(chapterId)}`;
}

export function createBrowserMysteryProgressStorage(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = window.localStorage,
): MysteryProgressStorage;
```

Parse JSON as `unknown`, validate primitive fields, then cross-check scene/choice references against the current chapter. Invalid/stale values are removed best-effort. Persist only `MysteryProgress`; no timestamp, event log, or transcript text.

- [ ] **Step 5: Run GREEN gate**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/features/mystery-messenger/model.test.ts \
  src/features/mystery-messenger/storage.test.ts
bun run --cwd apps/vela-mobile typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/{model.ts,model.test.ts,storage.ts,storage.test.ts}
git commit -m "feat(mobile): persist mystery messenger progress"
```

---

### Task 3: Orchestrate authenticated resume/restart with stale-action protection

**Files:**
- Create: `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.test.ts`

**Interfaces:**

```ts
export type MysteryMessengerController = {
  sessionStatus: ComputedRef<MobileFeatureSessionStatus>;
  progress: Readonly<Ref<MysteryProgress | null>>;
  currentScene: ComputedRef<MysteryScene | null>;
  persistenceWarning: Readonly<Ref<boolean>>;
  continueMessage(sceneId: string): void;
  chooseOption(sceneId: string, optionId: string): void;
  restart(): void;
};

export type UseMysteryMessengerOptions = {
  chapter?: MysteryChapter;
  storage?: MysteryProgressStorage;
};
```

- [ ] **Step 1: Write composable tests and verify RED**

Provide a fake `MOBILE_AUTH_KEY` coordinator state and fake storage. Cover:

1. usable user/no save → fresh `scene-01`;
2. usable same user → restore saved progress;
3. `continueMessage('scene-01')` advances once + saves once;
4. second stale `continueMessage('scene-01')` after advance is ignored and does not save again;
5. choice requires matching originating scene ID;
6. `restart()` clears then saves fresh progress;
7. storage save failure sets `persistenceWarning` but leaves in-memory progress advanced;
8. recovering same user keeps progress visible but mutations no-op;
9. user identity change loads only the new user's progress;
10. unavailable session clears in-memory progress.

Run:

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/useMysteryMessenger.test.ts
```

Expected: RED.

- [ ] **Step 2: Implement auth-aware initialization**

Inside `useMysteryMessenger`:

- inject `MOBILE_AUTH_KEY`; fixed error if missing;
- default chapter is `MYSTERY_MESSENGER_VERTICAL_SLICE`;
- default storage is `createBrowserMysteryProgressStorage()`;
- compute `selectMobileFeatureSessionStatus(coordinator.state)`;
- immediate-watch session status;
- usable new user → `load(...) ?? createMysteryProgress(...)`;
- same-user recovering → keep in-memory run;
- unavailable → clear run;
- different user → clear old run before loading the new user's own run.

Keep loaded user ID as one local variable; no global store.

- [ ] **Step 3: Implement stale-scene mutation guards**

Use a helper:

```ts
function canMutateFrom(sceneId: string): boolean {
  return (
    sessionStatus.value.kind === 'usable' &&
    loadedUserId === sessionStatus.value.userId &&
    progress.value?.currentSceneId === sceneId
  );
}
```

`continueMessage(sceneId)` and `chooseOption(sceneId, optionId)` return immediately if `canMutateFrom` is false. This is the double-tap guard; do not add debounce/mutex infrastructure.

Commit valid results through:

```ts
function commitProgress(userId: string, next: MysteryProgress): void {
  progress.value = next;
  persistenceWarning.value = !storage.save(userId, next);
}
```

- [ ] **Step 4: Run GREEN gate**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/useMysteryMessenger.test.ts
bun run --cwd apps/vela-mobile typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.ts \
  apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.test.ts
git commit -m "feat(mobile): orchestrate mystery messenger runs"
```

---

### Task 4: Reuse authenticated TTS and existing HTML audio

**Files:**
- Create: `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.test.ts`

**Interfaces:**

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

export type UseMysteryAudioOptions = {
  audioPlayer?: MobileAudioPlayer;
};
```

- [ ] **Step 1: Write audio tests and verify RED**

Provide fake auth/TTS through Vue injection and a fake `MobileAudioPlayer` option. Cover:

- current `userId`, scene `ttsId`, and exact text/prompt are sent to `preparePronunciation`;
- prepared URL is sent to `audioPlayer.play`;
- `ended` returns state to idle;
- TTS error becomes feature audio error without touching story progress;
- non-usable session makes no TTS request;
- `media_unavailable` invalidates only `(userId, scene.ttsId)` and does not auto-retry;
- user loss/change stops active audio;
- `dispose()` aborts preparation/stops playback/disposes player.

Run:

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/useMysteryAudio.test.ts
```

Expected: RED.

- [ ] **Step 2: Implement the narrow adapter**

Default to `new HtmlAudioPlayer()`. Extract TTS text with one closed helper:

```ts
function sceneTtsText(
  scene: MysteryMessageScene | MysteryChoiceScene | MysteryEndingScene,
): string {
  return scene.kind === 'choice' ? scene.prompt : scene.text;
}
```

On each explicit `play(scene)`:

1. abort/stop the controller's prior request/playback;
2. require a usable current user;
3. call existing `preparePronunciation({ userId, vocabularyId: scene.ttsId, text }, { signal })`;
4. play the prepared URL;
5. map errors to short local UI copy;
6. on `MobileAudioError('media_unavailable')`, invalidate that TTS identity once and wait for another user tap.

Do not duplicate diagnostic counters, URL display, or the diagnostic state machine.

- [ ] **Step 3: Watch auth ownership and dispose correctly**

If the usable user changes or becomes unavailable, abort/stop current feature audio. Do not clear global TTS caches; existing auth isolation owns that lifecycle.

- [ ] **Step 4: Run GREEN gate**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/useMysteryAudio.test.ts
bun run --cwd apps/vela-mobile typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.ts \
  apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.test.ts
git commit -m "feat(mobile): add mystery messenger audio replay"
```

---

### Task 5: Render the transcript, choice composer, and playable page

**Files:**
- Create: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryTranscript.vue`
- Create: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryTranscript.test.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.vue`
- Create: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue`
- Create: `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts`

**Interfaces:**
- Transcript receives data by props and emits `play-audio(sceneId)` only.
- Choice composer emits `select(optionId)` only.
- Page maps controls to `continueMessage(scene.id)` / `chooseOption(scene.id, optionId)`.

- [ ] **Step 1: Write transcript/composer tests and verify RED**

Transcript test after the choice must prove:

- completed scene-01/02 appear once;
- selected scene-03 option + its feedback appear once;
- unselected choice is absent from completed history;
- current scene-04 appears once;
- Japanese text has `lang="ja"`;
- audio click emits the correct scene ID.

Choice composer contract:

```ts
defineProps<{ scene: MysteryChoiceScene; disabled?: boolean }>();
defineEmits<{ select: [optionId: string] }>();
```

Click one option and assert one event; disabled means no selectable buttons.

Run:

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/features/mystery-messenger/components/MysteryTranscript.test.ts \
  src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts
```

Expected: RED.

- [ ] **Step 2: Implement both presentational components**

Use Quasar-only markup. Transcript rows use deterministic scene IDs as keys. Render compact speaker labels and icon-only audio buttons with descriptive `aria-label`s. Do not access auth/storage/TTS inside these components.

- [ ] **Step 3: Write the page test and verify RED**

With injected fakes/in-memory storage, test the full UI path:

```text
scene-01 Continue
→ scene-02 Continue
→ scene-03 choose answer
→ scene-04 Continue
→ scene-05 ending
→ Restart
→ scene-01
```

Also seed a scene-03 snapshot before mount and assert resume renders prior transcript once with scene-03 active.

Run:

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/MysteryMessengerPage.test.ts
```

Expected: RED.

- [ ] **Step 4: Implement `MysteryMessengerPage.vue`**

Compose:

```text
q-page
  persistence warning (conditional)
  session status (conditional)
  MysteryTranscript
  message → Continue
  choice → MysteryChoiceComposer
  ending → completion + Restart
  audio status/error
```

Rules:

- session not usable → disable story mutations;
- TTS preparing/failing does not disable Continue/choice;
- Continue calls `run.continueMessage(currentScene.id)`;
- choice calls `run.chooseOption(currentScene.id, optionId)`;
- transcript audio event resolves the exact chapter scene and calls `audio.play(scene)`;
- `onBeforeUnmount(audio.dispose)`;
- one local max-width is enough; no new layout system.

- [ ] **Step 5: Run GREEN UI gate**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/features/mystery-messenger/components/MysteryTranscript.test.ts \
  src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts \
  src/features/mystery-messenger/MysteryMessengerPage.test.ts
bun run --cwd apps/vela-mobile typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/components \
  apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue \
  apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts
git commit -m "feat(mobile): render mystery messenger loop"
```

---

### Task 6: Expose the pilot from Learn and register production mobile navigation

**Files:**
- Modify: `apps/vela-mobile/src/pages/LearnPage.vue`
- Create: `apps/vela-mobile/src/pages/LearnPage.test.ts`
- Modify: `apps/vela-mobile/src/pages/StubPages.test.ts`
- Modify: `apps/vela-mobile/src/router/diagnostic-routes.ts`
- Modify: `apps/vela-mobile/src/router/routes.test.ts`

**Interfaces:**
- Learn action: `pushMobileRoute(router, '/learn/mystery-messenger')`.
- Route: name `mysteryMessenger`, path `learn/mystery-messenger`, header title `Mystery Messenger`, fallback `/learn`, no auth bypass.

- [ ] **Step 1: Write route assertions and verify RED**

```ts
expect(route?.path).toBe('learn/mystery-messenger');
expect(route?.name).toBe('mysteryMessenger');
expect(route?.meta?.mobileHeader).toEqual({
  title: 'Mystery Messenger',
  fallback: '/learn',
});
expect(route?.meta?.bypassMobileAuth).not.toBe(true);
```

Run:

```bash
bun run --cwd apps/vela-mobile test:unit -- src/router/routes.test.ts
```

Expected: RED.

- [ ] **Step 2: Add the route to `coreRoutes` immediately after Learn**

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
},
```

Do not put it in diagnostic route arrays.

- [ ] **Step 3: Write Learn-page test and verify RED**

Assert the page renders:

- `Mystery Messenger`;
- `The Message That Arrived Tomorrow`;
- one short description;
- one `Play pilot` primary action;
- click calls `pushMobileRoute(router, '/learn/mystery-messenger')`.

The Learn card intentionally does not inspect storage for Start/Resume copy; route entry owns resume.

Run:

```bash
bun run --cwd apps/vela-mobile test:unit -- src/pages/LearnPage.test.ts
```

Expected: RED while Learn is still the stub.

- [ ] **Step 4: Replace only the Learn stub**

Implement one Quasar card using `useRouter()` + existing `pushMobileRoute()`. Update `StubPages.test.ts` only to remove Learn from generic stub expectations; preserve Review/Words assertions.

- [ ] **Step 5: Run GREEN navigation regression gate**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/pages/LearnPage.test.ts \
  src/pages/StubPages.test.ts \
  src/router/routes.test.ts \
  src/router/mobile-navigation.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/vela-mobile/src/pages/LearnPage.vue \
  apps/vela-mobile/src/pages/LearnPage.test.ts \
  apps/vela-mobile/src/pages/StubPages.test.ts \
  apps/vela-mobile/src/router/diagnostic-routes.ts \
  apps/vela-mobile/src/router/routes.test.ts
git commit -m "feat(mobile): expose mystery messenger from Learn"
```

---

### Task 7: Run the complete gate and record Simulator acceptance on the same PR

**Files:**
- Change production/test files only if the gate discovers a real HPA-287 defect.
- Update the existing draft PR body with validation/Simulator evidence; do not create another PR.

- [ ] **Step 1: Run all Mystery Messenger tests**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger
```

Expected: PASS.

- [ ] **Step 2: Run the full mobile suite**

```bash
bun run --cwd apps/vela-mobile test:unit
bun run --cwd apps/vela-mobile lint
bun run --cwd apps/vela-mobile typecheck
bun run --cwd apps/vela-mobile build
```

Expected: all PASS.

- [ ] **Step 3: Run the existing iOS workflow**

```bash
bun run --cwd apps/vela-mobile dev:ios
```

Choose an available iPhone Simulator through the existing Quasar/Capacitor flow. Do not add a new simulator harness.

- [ ] **Step 4: Execute the exact manual acceptance matrix**

Record pass/fail for:

1. signed-in Home → Learn → Mystery Messenger;
2. scene-01/02 Continue;
3. scene-03 choice + immediate feedback;
4. real Japanese audio playback on one message and the choice prompt;
5. rapid double tap on a Continue control does not skip the next scene;
6. leave to Learn and return: same current scene, no duplicate transcript;
7. terminate/relaunch: same user resumes the same scene;
8. Restart clears history and returns to scene-01;
9. scene-04 → scene-05 ending;
10. header/native back returns to Learn without a blank/trapped view;
11. no obvious safe-area clipping or unusable touch target.

If the test account lacks TTS configuration, leave the PR draft with that explicit blocker rather than treating mocked playback as acceptance.

- [ ] **Step 5: Check scope and diff hygiene**

```bash
git diff main...HEAD --stat
git diff --check main...HEAD
```

Expected diff scope: Mystery Messenger feature files, Learn/router changes/tests, and the two HPA-287 planning docs only. No backend/common/native/dependency change.

- [ ] **Step 6: Update this existing PR and mark ready only when gates pass**

Add the automated commands/results and Simulator device/OS/result to the current HPA-287 PR body. Do not open a second implementation or evidence PR.

---

## Self-Review Results

### Spec coverage

- Closed five-scene content + validator: Task 1.
- Pure progression + local snapshot/version reset: Task 2.
- Auth ownership + resume/restart + stale/double-tap guard: Task 3.
- Existing TTS/audio reuse + non-blocking failure: Task 4.
- Transcript/choice/ending UI: Task 5.
- Learn discovery + authenticated mobile route/header/history: Task 6.
- Automated/build/Simulator gates: Task 7.

### Placeholder scan

No `TODO`, `TBD`, generic “handle errors,” or unnamed test work remains. Each task specifies exact files, interfaces, RED/GREEN commands, and a commit gate.

### Type/signature consistency

`continueMessage(sceneId)` and `chooseOption(sceneId, optionId)` are used consistently from controller through page and tests. `MobileTtsService.preparePronunciation({ userId, vocabularyId, text }, { signal })` and the existing `MobileAudioPlayer` contract are reused directly.

### Scope check

This is one independently playable product slice and one PR. Nothing in the plan warrants a separate horizontal ticket or implementation PR.

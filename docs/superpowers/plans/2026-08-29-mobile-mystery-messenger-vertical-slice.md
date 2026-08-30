# HPA-287 Mobile Mystery Messenger Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one five-scene, authenticated Mystery Messenger loop in Vela Mobile with a language choice, existing TTS/audio playback, local resume/restart, content validation, and iOS Simulator acceptance.

**Architecture:** Keep the entire product slice feature-local under `apps/vela-mobile/src/features/mystery-messenger`. Use closed TypeScript scene contracts, pure progression/content validation, one browser-storage snapshot per user/chapter, one Vue composable for run orchestration, and a thin feature-local adapter over the existing `MobileTtsService` + `HtmlAudioPlayer`. Reuse current mobile auth, route history, header, safe-area, and build/test infrastructure unchanged.

**Tech Stack:** Vue 3, Quasar 2, Vue Router 4, TypeScript 5.6, Vitest, Vue Test Utils, existing Vela Mobile auth/TTS/audio services, browser `localStorage`, Capacitor iOS.

**Spec:** `docs/superpowers/specs/2026-08-29-mobile-mystery-messenger-vertical-slice-design.md`

## Global Constraints

- Linear owner: HPA-287.
- Use one branch and one PR for design, plan, implementation, review fixes, and acceptance evidence.
- Keep all new domain/persistence/orchestration code feature-local; do not move it to `@vela/common`.
- Scene variants in this ticket are exactly `message`, `choice`, and `ending`.
- Author exactly one five-scene fixture with one choice and one ending.
- Reuse `MobileAuthCoordinator`, `selectMobileFeatureSessionStatus`, `MobileTtsService`, `HtmlAudioPlayer`, `MobileLayout`, `MobilePageHeader`, and `pushMobileRoute`/`backOrFallback`.
- Use browser `localStorage`; do not add Capacitor Preferences/Secure Storage, an API route, DynamoDB, cloud sync, or a retry queue.
- No save migration or backward compatibility. Invalid or version-mismatched snapshots are deleted and replaced with a fresh run.
- TTS failure must never block story progression.
- No Pinia, narrative engine, plugin registry, CMS, new E2E framework, web parity, SRS write, `response-build`, missed-phrase recap, or branching.
- Existing mobile unit tests, lint, type-check, and production build must stay green.
- HPA-287 closes only after the five-scene slice is manually playable in the iOS Simulator; physical-iPhone acceptance belongs to the later full-pilot verification ticket.

---

## File Map

### Create

- `apps/vela-mobile/src/features/mystery-messenger/model.ts` — closed scene/progress contracts plus pure transition helpers.
- `apps/vela-mobile/src/features/mystery-messenger/model.test.ts` — reducer/progression tests.
- `apps/vela-mobile/src/features/mystery-messenger/content.ts` — the five-scene authored chapter and stable TTS IDs.
- `apps/vela-mobile/src/features/mystery-messenger/validate-content.ts` — pure authored-content validator.
- `apps/vela-mobile/src/features/mystery-messenger/validate-content.test.ts` — validation regressions.
- `apps/vela-mobile/src/features/mystery-messenger/storage.ts` — `localStorage` adapter and snapshot validation.
- `apps/vela-mobile/src/features/mystery-messenger/storage.test.ts` — resume, corruption, version-reset, and user-isolation tests.
- `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.ts` — auth-aware run/resume/restart orchestration.
- `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.test.ts` — composable behavior with fake auth/storage.
- `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.ts` — thin feature-local TTS/audio controller.
- `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.test.ts` — TTS identity, non-blocking failure, invalidation, and disposal tests.
- `apps/vela-mobile/src/features/mystery-messenger/components/MysteryTranscript.vue` — presentation-only transcript.
- `apps/vela-mobile/src/features/mystery-messenger/components/MysteryTranscript.test.ts` — transcript/feedback rendering tests.
- `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.vue` — fixed-option composer.
- `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts` — single-emission behavior.
- `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue` — route page combining run, transcript, composer, continuation, audio, restart, and warnings.
- `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts` — page-level happy path/resume/restart tests with injected fakes.
- `apps/vela-mobile/src/pages/LearnPage.test.ts` — pilot-card navigation/presentation tests.

### Modify

- `apps/vela-mobile/src/pages/LearnPage.vue` — replace the stub with the single pilot card.
- `apps/vela-mobile/src/pages/StubPages.test.ts` — remove Learn from the generic stub assertions while retaining Review/Words coverage.
- `apps/vela-mobile/src/router/diagnostic-routes.ts` — register the authenticated Mystery Messenger route with mobile header metadata.
- `apps/vela-mobile/src/router/routes.test.ts` — pin route/path/header/fallback behavior.

No backend, `@vela/common`, CDK, native iOS, package, or dependency file should change in this ticket.

---

### Task 1: Lock the feature contract, five-scene content, and validator

**Files:**
- Create: `apps/vela-mobile/src/features/mystery-messenger/model.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/content.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/validate-content.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/validate-content.test.ts`

**Interfaces:**
- Produces `MysteryChapter`, `MysteryScene`, `MysteryMessageScene`, `MysteryChoiceScene`, `MysteryEndingScene`, `MysteryChoiceOption`, `MysteryHistoryEntry`, and `MysteryProgress` exactly as specified by the design.
- Produces `MYSTERY_MESSENGER_VERTICAL_SLICE: MysteryChapter`.
- Produces `validateMysteryChapter(chapter): readonly MysteryContentIssue[]`.
- Later tasks import these types and the authored chapter directly; no barrel/index file is needed.

- [ ] **Step 1: Write validator tests before implementation**

Create `validate-content.test.ts` with a passing-case expectation and the required failure cases. Use small inline chapter copies rather than snapshotting the whole authored file.

```ts
import { describe, expect, it } from 'vitest';
import { MYSTERY_MESSENGER_VERTICAL_SLICE } from './content';
import { validateMysteryChapter } from './validate-content';

function issueCodes(chapter: typeof MYSTERY_MESSENGER_VERTICAL_SLICE) {
  return validateMysteryChapter(chapter).map((issue) => issue.code);
}

describe('validateMysteryChapter', () => {
  it('accepts the vertical-slice chapter', () => {
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
    expect(issueCodes(chapter)).toContain('duplicate_scene_id');
  });

  it('rejects dangling scene references', () => {
    const [first, ...rest] = MYSTERY_MESSENGER_VERTICAL_SLICE.scenes;
    if (first.kind !== 'message') throw new Error('fixture_first_scene_must_be_message');
    const chapter = {
      ...MYSTERY_MESSENGER_VERTICAL_SLICE,
      scenes: [{ ...first, nextSceneId: 'missing-scene' }, ...rest],
    };
    expect(issueCodes(chapter)).toContain('dangling_scene_reference');
  });

  it('rejects a chapter without an ending', () => {
    const chapter = {
      ...MYSTERY_MESSENGER_VERTICAL_SLICE,
      scenes: MYSTERY_MESSENGER_VERTICAL_SLICE.scenes.filter((scene) => scene.kind !== 'ending'),
    };
    expect(issueCodes(chapter)).toContain('missing_ending');
  });

  it('rejects an ending that cannot be reached from the start', () => {
    const scenes = MYSTERY_MESSENGER_VERTICAL_SLICE.scenes.map((scene) =>
      scene.kind === 'message' && scene.id === 'scene-04'
        ? { ...scene, nextSceneId: 'scene-04' }
        : scene,
    );
    expect(issueCodes({ ...MYSTERY_MESSENGER_VERTICAL_SLICE, scenes })).toContain(
      'unreachable_ending',
    );
  });
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/validate-content.test.ts
```

Expected: FAIL because `content.ts` / `validate-content.ts` do not exist.

- [ ] **Step 3: Add the closed contracts to `model.ts`**

Implement the exact design types. Keep `MysterySpeaker` closed to the two fixture characters for this ticket:

```ts
export type MysterySpeaker = 'mina' | 'haru';

export type MysteryMessageScene = {
  id: string;
  kind: 'message';
  speaker: MysterySpeaker;
  text: string;
  ttsId: string;
  nextSceneId: string;
};

export type MysteryChoiceOption = {
  id: string;
  label: string;
  result: 'correct' | 'incorrect';
  feedback: string;
  nextSceneId: string;
};

export type MysteryChoiceScene = {
  id: string;
  kind: 'choice';
  speaker: MysterySpeaker;
  prompt: string;
  ttsId: string;
  options: readonly MysteryChoiceOption[];
};

export type MysteryEndingScene = {
  id: string;
  kind: 'ending';
  title: string;
  text: string;
  ttsId: string;
};

export type MysteryScene = MysteryMessageScene | MysteryChoiceScene | MysteryEndingScene;

export type MysteryChapter = {
  id: string;
  version: number;
  title: string;
  startSceneId: string;
  scenes: readonly MysteryScene[];
};

export type MysteryHistoryEntry = {
  sceneId: string;
  selectedOptionId?: string;
};

export type MysteryProgress = {
  chapterId: string;
  chapterVersion: number;
  currentSceneId: string;
  history: readonly MysteryHistoryEntry[];
  completed: boolean;
};
```

- [ ] **Step 4: Author the five-scene fixture in `content.ts`**

Use this exact topology so tests and later UI work have a stable path:

```text
scene-01 message (Mina) →
scene-02 message (Haru) →
scene-03 choice (Mina prompt, 2 options) →
scene-04 message (Haru consequence) →
scene-05 ending
```

Both `scene-03` options point to `scene-04`; one is `correct`, one `incorrect`, and each has short authored feedback. Keep Japanese N5-adjacent and concise. Use stable TTS IDs:

```text
mystery-message-tomorrow-v1-scene-01
mystery-message-tomorrow-v1-scene-02
mystery-message-tomorrow-v1-scene-03-prompt
mystery-message-tomorrow-v1-scene-04
mystery-message-tomorrow-v1-scene-05
```

Export with `satisfies MysteryChapter`; do not cast with `as MysteryChapter`.

- [ ] **Step 5: Implement the validator with `Map` + graph walk only**

Define:

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

export function validateMysteryChapter(chapter: MysteryChapter): readonly MysteryContentIssue[];
```

Implementation rules:

1. Build a `Map<string, MysteryScene>` while recording duplicate scene IDs.
2. Validate `startSceneId`.
3. For messages, validate `nextSceneId`.
4. For choices, require at least two options, reject duplicate option IDs in that scene, and validate every option `nextSceneId`.
5. Require at least one ending.
6. If start exists, breadth/depth walk only valid references and record whether an ending is reached; if none is reached, emit `unreachable_ending`.
7. Return all discovered issues; do not throw for authored mistakes.

Do not add Zod or a generic graph helper.

- [ ] **Step 6: Run focused tests and type-check the files**

Run:

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/validate-content.test.ts
bun run --cwd apps/vela-mobile typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit the task gate**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/model.ts \
  apps/vela-mobile/src/features/mystery-messenger/content.ts \
  apps/vela-mobile/src/features/mystery-messenger/validate-content.ts \
  apps/vela-mobile/src/features/mystery-messenger/validate-content.test.ts
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
- Produces `createMysteryProgress`, `getMysteryScene`, `continueMysteryMessage`, `chooseMysteryOption`, and `restartMysteryProgress`.
- Produces `MysteryProgressStorage`, `mysteryProgressStorageKey`, and `createBrowserMysteryProgressStorage`.
- Task 3 consumes these functions without duplicating transition or snapshot logic.

- [ ] **Step 1: Write RED tests for progression**

Create `model.test.ts` covering initial state, message progression, choice history, completion, restart, and duplicate-action protection.

```ts
import { describe, expect, it } from 'vitest';
import { MYSTERY_MESSENGER_VERTICAL_SLICE as chapter } from './content';
import {
  chooseMysteryOption,
  continueMysteryMessage,
  createMysteryProgress,
  restartMysteryProgress,
} from './model';

it('records each completed scene exactly once', () => {
  let progress = createMysteryProgress(chapter);
  progress = continueMysteryMessage(chapter, progress);
  progress = continueMysteryMessage(chapter, progress);
  progress = chooseMysteryOption(chapter, progress, 'tomorrow-morning');
  expect(progress.history.map((entry) => entry.sceneId)).toEqual([
    'scene-01',
    'scene-02',
    'scene-03',
  ]);
  expect(progress.history[2]?.selectedOptionId).toBe('tomorrow-morning');
});

it('marks the run complete when progression enters the ending', () => {
  let progress = createMysteryProgress(chapter);
  progress = continueMysteryMessage(chapter, progress);
  progress = continueMysteryMessage(chapter, progress);
  progress = chooseMysteryOption(chapter, progress, 'tomorrow-morning');
  progress = continueMysteryMessage(chapter, progress);
  expect(progress.currentSceneId).toBe('scene-05');
  expect(progress.completed).toBe(true);
});
```

Also assert that calling the wrong transition for the current scene throws a fixed error such as `mystery_invalid_transition` rather than duplicating history.

- [ ] **Step 2: Run the progression tests and confirm RED**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/model.test.ts
```

Expected: FAIL because transition helpers are not implemented.

- [ ] **Step 3: Implement pure transition helpers in `model.ts`**

Use a private scene map lookup per call or a small `find` helper; five scenes do not justify a cached chapter runtime.

Required behavior:

```ts
export function createMysteryProgress(chapter: MysteryChapter): MysteryProgress {
  const first = getMysteryScene(chapter, chapter.startSceneId);
  return {
    chapterId: chapter.id,
    chapterVersion: chapter.version,
    currentSceneId: first.id,
    history: [],
    completed: first.kind === 'ending',
  };
}
```

`continueMysteryMessage` and `chooseMysteryOption` must copy the history array, append the current scene once, advance, and set `completed` from the target scene kind. `restartMysteryProgress` delegates to `createMysteryProgress`.

- [ ] **Step 4: Write RED persistence tests**

Use a tiny in-memory `Storage`-shape fake with `getItem`, `setItem`, and `removeItem` spies. Cover:

- key includes encoded user + chapter ID;
- same user saves/loads progress;
- another user cannot read it;
- chapter-version mismatch removes and returns `null`;
- malformed JSON removes and returns `null`;
- invalid current/history/choice references remove and return `null`;
- `setItem` failure returns `false` without throwing;
- `removeItem` failure returns `false` without throwing.

Example:

```ts
it('drops a stale chapter version instead of migrating it', () => {
  const storage = createMemoryStorage();
  const adapter = createBrowserMysteryProgressStorage(storage);
  const progress = createMysteryProgress(chapter);
  expect(adapter.save('user-a', progress)).toBe(true);

  const nextChapter = { ...chapter, version: chapter.version + 1 };
  expect(adapter.load('user-a', nextChapter)).toBeNull();
  expect(storage.getItem(mysteryProgressStorageKey('user-a', chapter.id))).toBeNull();
});
```

- [ ] **Step 5: Run persistence tests and confirm RED**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/storage.test.ts
```

Expected: FAIL because `storage.ts` does not exist.

- [ ] **Step 6: Implement `storage.ts`**

Expose:

```ts
export type MysteryProgressStorage = {
  load(userId: string, chapter: MysteryChapter): MysteryProgress | null;
  save(userId: string, progress: MysteryProgress): boolean;
  clear(userId: string, chapterId: string): boolean;
};

export function mysteryProgressStorageKey(userId: string, chapterId: string): string;

export function createBrowserMysteryProgressStorage(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = window.localStorage,
): MysteryProgressStorage;
```

Do not introduce a schema dependency. Parse JSON as `unknown`, verify primitive field shapes, then cross-check every referenced scene/choice against the current `MysteryChapter` during `load`. On any invalid/stale value, call `removeItem` best-effort and return `null`.

`save` serializes only `MysteryProgress`. No timestamp, event log, migration version, or redundant transcript text is needed.

- [ ] **Step 7: Run pure test gate**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/features/mystery-messenger/model.test.ts \
  src/features/mystery-messenger/storage.test.ts
bun run --cwd apps/vela-mobile typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit the task gate**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/model.ts \
  apps/vela-mobile/src/features/mystery-messenger/model.test.ts \
  apps/vela-mobile/src/features/mystery-messenger/storage.ts \
  apps/vela-mobile/src/features/mystery-messenger/storage.test.ts
git commit -m "feat(mobile): persist mystery messenger progress"
```

---

### Task 3: Orchestrate authenticated resume, progression, and restart

**Files:**
- Create: `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.test.ts`

**Interfaces:**
- Consumes `MOBILE_AUTH_KEY`, `selectMobileFeatureSessionStatus`, `MYSTERY_MESSENGER_VERTICAL_SLICE`, pure transition functions, and `MysteryProgressStorage`.
- Produces a page-facing `MysteryMessengerController` with no raw tokens and no direct localStorage calls outside the adapter.

Define the public result before implementation:

```ts
export type MysteryMessengerController = {
  sessionStatus: ComputedRef<MobileFeatureSessionStatus>;
  progress: Readonly<Ref<MysteryProgress | null>>;
  currentScene: ComputedRef<MysteryScene | null>;
  persistenceWarning: Readonly<Ref<boolean>>;
  continueMessage(): void;
  chooseOption(optionId: string): void;
  restart(): void;
};

export type UseMysteryMessengerOptions = {
  chapter?: MysteryChapter;
  storage?: MysteryProgressStorage;
};

export function useMysteryMessenger(
  options?: UseMysteryMessengerOptions,
): MysteryMessengerController;
```

- [ ] **Step 1: Write composable tests with provided fake auth**

Mount a minimal test component inside a Vue app that provides `MOBILE_AUTH_KEY`. Use a reactive coordinator state whose `user.userId` can change.

Cover:

1. usable user with no save gets fresh `scene-01`;
2. usable same user restores a saved `scene-03` run;
3. `continueMessage()` calls one transition and one storage save;
4. `chooseOption()` stores the selected option and advances;
5. `restart()` clears then saves a fresh run;
6. storage save returning `false` sets `persistenceWarning` but leaves progress advanced;
7. session `recovering` leaves current in-memory state visible but transition methods no-op;
8. identity change to another usable user replaces in-memory state with that user's own save/new run;
9. session unavailable clears in-memory progress.

Example assertion:

```ts
expect(controller.progress.value?.currentSceneId).toBe('scene-01');
controller.continueMessage();
expect(controller.progress.value?.currentSceneId).toBe('scene-02');
expect(storage.save).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/useMysteryMessenger.test.ts
```

Expected: FAIL because the composable is missing.

- [ ] **Step 3: Implement auth-aware initialization with one immediate watcher**

Inside `useMysteryMessenger`:

1. inject `MOBILE_AUTH_KEY`; throw `mystery_auth_dependency_unavailable` if absent;
2. instantiate the default browser storage only when an override is not supplied;
3. compute `sessionStatus = computed(() => selectMobileFeatureSessionStatus(coordinator.state))`;
4. watch `sessionStatus` with `{ immediate: true }`;
5. when usable user ID changes, `load(userId, chapter) ?? createMysteryProgress(chapter)` and best-effort save a newly created run;
6. when recovering for the same user, retain in-memory progress;
7. when unavailable or identity no longer matches, set progress to `null`.

Track the currently loaded `userId` in a plain local variable; do not add a global store.

- [ ] **Step 4: Implement mutation methods through a single `commitProgress` helper**

```ts
function commitProgress(userId: string, next: MysteryProgress): void {
  progress.value = next;
  persistenceWarning.value = !storage.save(userId, next);
}
```

Each public mutation first requires `sessionStatus.value.kind === 'usable'`, a same-user loaded run, and the appropriate current scene type. Then call the pure transition helper and `commitProgress`.

`restart()` calls `storage.clear(userId, chapter.id)`, creates a fresh run, and saves it. If clear/save fails, set the warning but keep the fresh in-memory run.

No queued mutation framework is required; Quasar buttons will be disabled during page-owned action handling and pure transitions reject wrong-scene replays.

- [ ] **Step 5: Run composable + previous pure tests**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/features/mystery-messenger/model.test.ts \
  src/features/mystery-messenger/storage.test.ts \
  src/features/mystery-messenger/useMysteryMessenger.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the task gate**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.ts \
  apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.test.ts
git commit -m "feat(mobile): orchestrate mystery messenger runs"
```

---

### Task 4: Reuse the existing TTS and HTML audio path

**Files:**
- Create: `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.test.ts`

**Interfaces:**
- Consumes `MOBILE_AUTH_KEY`, `MOBILE_TTS_SERVICE_KEY`, `selectMobileFeatureSessionStatus`, `MobileTtsService`, and `MobileAudioPlayer`.
- Default runtime player is `new HtmlAudioPlayer()`.
- Produces `MysteryAudioController` from the design.

Make the controller testable without introducing app-wide dependency injection:

```ts
export type UseMysteryAudioOptions = {
  audioPlayer?: MobileAudioPlayer;
};

export function useMysteryAudio(options?: UseMysteryAudioOptions): MysteryAudioController;
```

- [ ] **Step 1: Write RED audio-controller tests**

Provide fake auth + fake `MobileTtsService` through Vue injection and pass a fake `MobileAudioPlayer` option.

Cover:

- `play(scene)` sends the current authenticated `userId`, scene `ttsId`, and exact authored text/prompt to `preparePronunciation`;
- prepared URL is passed to `audioPlayer.play`;
- success returns state to `idle` after `finished` resolves `ended`;
- `MobileTtsError` produces `{ kind: 'error' }` but does not mutate story progress;
- session not usable prevents a TTS request and yields a small session/audio error state;
- `media_unavailable` invalidates only `(userId, scene.ttsId)` and returns an error that is recoverable by another explicit tap;
- user identity loss/change stops/disposes active playback state;
- `dispose()` aborts preparation, stops active playback, and disposes the player.

- [ ] **Step 2: Run focused audio tests and confirm RED**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/useMysteryAudio.test.ts
```

Expected: FAIL because the controller is missing.

- [ ] **Step 3: Implement the narrow controller**

Use this public state:

```ts
export type MysteryAudioState =
  | { kind: 'idle' }
  | { kind: 'preparing'; sceneId: string }
  | { kind: 'playing'; sceneId: string }
  | { kind: 'error'; sceneId: string; message: string };
```

Add a local helper that extracts the TTS text without making the scene contract generic:

```ts
function sceneTtsText(scene: MysteryMessageScene | MysteryChoiceScene | MysteryEndingScene): string {
  return scene.kind === 'choice' ? scene.prompt : scene.text;
}
```

Implementation flow:

1. cancel/abort the controller's previous preparation and stop prior playback with reason `restart`;
2. require a usable session and capture its user ID;
3. call `ttsService.preparePronunciation({ userId, vocabularyId: scene.ttsId, text: sceneTtsText(scene) }, { signal })`;
4. if still current, call `audioPlayer.play(pronunciation.audioUrl)`;
5. await `handle.finished` and return to idle for `ended`/expected stop;
6. convert TTS/audio failures into short user-facing messages only;
7. on `MobileAudioError('media_unavailable')`, call `ttsService.invalidatePronunciation(userId, scene.ttsId)` once for that failed tap, then expose an error; do not recursively replay.

Do not copy the diagnostic counter machinery from `usePronunciationDiagnostic`.

- [ ] **Step 4: Watch auth identity and clean audio ownership**

A small watcher on `selectMobileFeatureSessionStatus` is enough. If the usable user changes or becomes unavailable, abort preparation and stop active playback. Do not clear the global TTS cache; existing auth-isolation infrastructure already owns user cache cleanup.

- [ ] **Step 5: Run audio + type-check gate**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/useMysteryAudio.test.ts
bun run --cwd apps/vela-mobile typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the task gate**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.ts \
  apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.test.ts
git commit -m "feat(mobile): add mystery messenger audio replay"
```

---

### Task 5: Build the messenger transcript, choice composer, and route page

**Files:**
- Create: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryTranscript.vue`
- Create: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryTranscript.test.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.vue`
- Create: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue`
- Create: `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts`

**Interfaces:**
- Transcript is presentation-only and receives chapter/progress/current-scene data through props.
- Choice composer emits `select` with an option ID only.
- Page owns `useMysteryMessenger()` and `useMysteryAudio()` and maps user events to those controllers.

- [ ] **Step 1: Write RED transcript tests**

Mount `MysteryTranscript` with progress after the choice and assert:

- scene-01 and scene-02 messages appear once;
- selected scene-03 option appears once;
- the selected option's feedback appears once;
- unselected option does not appear in history;
- current scene-04 appears once;
- Japanese text uses `lang="ja"` on the authored text container;
- audio buttons emit the scene ID through a `play-audio` event rather than calling services directly.

Example:

```ts
expect(wrapper.text().match(/明日の/g)?.length).toBe(1);
expect(wrapper.emitted('play-audio')?.[0]).toEqual(['scene-01']);
```

- [ ] **Step 2: Write RED choice-composer tests**

Mount scene-03 and click one option. Assert exactly one `select` event with its option ID and that buttons are disabled when `disabled` prop is true.

Public contract:

```ts
defineProps<{
  scene: MysteryChoiceScene;
  disabled?: boolean;
}>();

defineEmits<{
  select: [optionId: string];
}>();
```

- [ ] **Step 3: Run component tests and confirm RED**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/features/mystery-messenger/components/MysteryTranscript.test.ts \
  src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts
```

Expected: FAIL because components are missing.

- [ ] **Step 4: Implement both presentation components with Quasar only**

`MysteryTranscript.vue` should use simple bubble/card markup and deterministic `:key="entry.sceneId"`; do not animate/re-key transcript rows. Use a small speaker label map (`Mina`, `Haru`) inside the component.

For completed choice history, look up `selectedOptionId` from the scene and render its label + feedback. If an impossible stored option reaches the component, omit feedback; storage validation should normally prevent this.

Each Japanese bubble/current prompt exposes a small icon-only replay button with a descriptive `aria-label`, for example `Play Mina message audio`.

`MysteryChoiceComposer.vue` renders one full-width `q-btn` per authored option. No form, radio group, free text, or generic interaction renderer.

- [ ] **Step 5: Write the page test before the page implementation**

Use fake provided auth/TTS services and an in-memory persistence adapter. Cover one complete UI path:

1. page starts at scene-01;
2. clicking Continue advances to scene-02;
3. second Continue reveals scene-03 choice;
4. choosing the correct option advances to scene-04 and renders feedback in history;
5. Continue reaches scene-05 and shows the ending;
6. Restart returns to scene-01.

Also mount with a pre-seeded scene-03 snapshot and assert the page resumes there without duplicated earlier transcript bubbles.

Do not make these tests depend on real network/audio; stub the audio controller/player boundary.

- [ ] **Step 6: Run page test and confirm RED**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/MysteryMessengerPage.test.ts
```

Expected: FAIL because `MysteryMessengerPage.vue` does not exist.

- [ ] **Step 7: Implement `MysteryMessengerPage.vue`**

Page composition:

```text
q-page
  persistence warning (only when needed)
  session recovery/unavailable status (only when needed)
  MysteryTranscript
  current message → Continue
  current choice → MysteryChoiceComposer
  current ending → completed copy + Restart
  audio error/status beside transcript controls
```

Rules:

- disable Continue/choice actions whenever the feature session is not `usable`;
- do not disable story progression while TTS is preparing/failing;
- map transcript `play-audio(sceneId)` to the exact current/history scene from `MYSTERY_MESSENGER_VERTICAL_SLICE`, then `audio.play(scene)`;
- call `audio.dispose()` in `onBeforeUnmount`;
- keep the content width comfortable on phone and tablet with one local max-width, not a new layout system;
- use existing Quasar spacing/touch-target conventions.

- [ ] **Step 8: Run the feature UI gate**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/features/mystery-messenger/components/MysteryTranscript.test.ts \
  src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts \
  src/features/mystery-messenger/MysteryMessengerPage.test.ts
bun run --cwd apps/vela-mobile typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit the task gate**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/components \
  apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue \
  apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts
git commit -m "feat(mobile): render mystery messenger loop"
```

---

### Task 6: Expose the pilot from Learn and register mobile navigation

**Files:**
- Modify: `apps/vela-mobile/src/pages/LearnPage.vue`
- Create: `apps/vela-mobile/src/pages/LearnPage.test.ts`
- Modify: `apps/vela-mobile/src/pages/StubPages.test.ts`
- Modify: `apps/vela-mobile/src/router/diagnostic-routes.ts`
- Modify: `apps/vela-mobile/src/router/routes.test.ts`

**Interfaces:**
- Learn navigates using existing `pushMobileRoute()`.
- Route name is `mysteryMessenger`, path is `/learn/mystery-messenger`, header title is `Mystery Messenger`, fallback is `/learn`.
- No new top-level tab or auth bypass is added.

- [ ] **Step 1: Write RED route assertions**

Extend `routes.test.ts`/the existing core-route test to find the route and assert:

```ts
expect(route?.path).toBe('learn/mystery-messenger');
expect(route?.name).toBe('mysteryMessenger');
expect(route?.meta?.mobileHeader).toEqual({
  title: 'Mystery Messenger',
  fallback: '/learn',
});
expect(route?.meta?.bypassMobileAuth).not.toBe(true);
```

- [ ] **Step 2: Run route test and confirm RED**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/router/routes.test.ts
```

Expected: FAIL because route is absent.

- [ ] **Step 3: Register the core route**

Add the route to `coreRoutes` in `diagnostic-routes.ts` immediately after `learn`:

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

Do not add it to diagnostic arrays; it is production-authenticated product UI.

- [ ] **Step 4: Write RED Learn-page tests**

Create `LearnPage.test.ts` and mock `pushMobileRoute`. Assert the page renders:

- `Mystery Messenger`;
- `The Message That Arrived Tomorrow`;
- one concise description;
- one primary action;
- action calls `pushMobileRoute(router, '/learn/mystery-messenger')`.

For HPA-287, the card button can use neutral `Play pilot` copy instead of reading storage a second time on Learn. Resume semantics are proven on route entry; do not duplicate the progress storage/controller on the card just to switch Start/Resume labels in this slice.

This is an intentional simplification from the broader pilot design: the behavior requirement is discover/start/resume, not dynamic card copy.

- [ ] **Step 5: Run Learn test and confirm RED**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/pages/LearnPage.test.ts
```

Expected: FAIL while `LearnPage.vue` is still the stub.

- [ ] **Step 6: Replace only the Learn stub**

Implement one Quasar card in `LearnPage.vue`. Use `useRouter()` and existing `pushMobileRoute()`. Keep Review and Words unchanged.

Update `StubPages.test.ts` to stop treating Learn as a stub; do not weaken its assertions for the remaining stub pages.

- [ ] **Step 7: Run navigation/page regression tests**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/pages/LearnPage.test.ts \
  src/pages/StubPages.test.ts \
  src/router/routes.test.ts \
  src/router/mobile-navigation.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit the task gate**

```bash
git add apps/vela-mobile/src/pages/LearnPage.vue \
  apps/vela-mobile/src/pages/LearnPage.test.ts \
  apps/vela-mobile/src/pages/StubPages.test.ts \
  apps/vela-mobile/src/router/diagnostic-routes.ts \
  apps/vela-mobile/src/router/routes.test.ts
git commit -m "feat(mobile): expose mystery messenger from Learn"
```

---

### Task 7: Run the full gate and record iOS Simulator acceptance in the same PR

**Files:**
- Modify only if validation finds a real defect in files already owned by Tasks 1–6.
- Update the HPA-287 PR body with final validation and Simulator evidence; do not create a second evidence document unless the existing repository verification conventions require one.

**Interfaces:**
- No new production interface.
- This gate decides whether HPA-287 can become ready for review.

- [ ] **Step 1: Run the complete feature test directory**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger
```

Expected: PASS.

- [ ] **Step 2: Run the complete mobile unit suite**

```bash
bun run --cwd apps/vela-mobile test:unit
```

Expected: PASS with no new failures.

- [ ] **Step 3: Run lint and type-check**

```bash
bun run --cwd apps/vela-mobile lint
bun run --cwd apps/vela-mobile typecheck
```

Expected: PASS.

- [ ] **Step 4: Build the production mobile SPA**

```bash
bun run --cwd apps/vela-mobile build
```

Expected: PASS.

Do not require a new dependency or framework to satisfy this gate.

- [ ] **Step 5: Run the existing iOS development workflow**

Use the repository's existing command:

```bash
bun run --cwd apps/vela-mobile dev:ios
```

Select an available iPhone Simulator through the current Quasar/Capacitor flow. Do not add a new simulator harness for this task.

- [ ] **Step 6: Manually execute the exact acceptance matrix**

Record pass/fail for:

1. signed-in Home → Learn → Mystery Messenger;
2. scene-01 and scene-02 Continue actions;
3. scene-03 choice selection and immediate feedback;
4. Japanese audio replay on at least one message and the choice prompt;
5. leave route and return: current scene and transcript remain correct with no duplication;
6. terminate/relaunch: same authenticated user resumes the same scene;
7. Restart returns to scene-01 and removes prior transcript history;
8. complete scene-04 and reach scene-05 ending;
9. header/native back returns to Learn and does not trap/blank the WebView; and
10. no visible safe-area clipping or unusable touch target on the tested Simulator.

If TTS configuration is unavailable in the test account, HPA-287 is not accepted as complete: configure/use an existing TTS-capable account or leave the PR draft with the exact blocker. Do not replace real playback acceptance with a mocked claim.

- [ ] **Step 7: Check the final diff for scope creep**

```bash
git diff main...HEAD --stat
git diff --check main...HEAD
```

Expected:

- feature-local mobile files plus Learn/router tests and the two planning docs only;
- no backend/CDK/common/native dependency change;
- no response-build, recap, cloud sync, or generic narrative framework.

- [ ] **Step 8: Update the existing draft PR instead of opening another PR**

Add the final test/build commands and Simulator device/OS result to the existing HPA-287 PR body. Keep the PR draft until all automated + Simulator gates pass, then mark that same PR ready for review.

- [ ] **Step 9: Final commit if evidence-required repository files changed**

Only if a repository evidence file was genuinely required by existing conventions:

```bash
git add <actual-evidence-file>
git commit -m "docs(mobile): record mystery messenger simulator verification"
```

Otherwise do not create an empty evidence commit; PR-body evidence is sufficient for this vertical slice.

---

## Self-Review Results

### Spec coverage

- Five-scene `message`/`choice`/`ending` contract: Task 1.
- Pure content validation including dangling references and ending reachability: Task 1.
- Pure progression, single-entry transcript history, completion, restart: Task 2.
- User-scoped local resume, corruption/version reset, no migration: Tasks 2–3.
- Same-user auth ownership and identity isolation: Task 3.
- Existing authenticated TTS + HTML audio reuse, non-blocking failures: Task 4.
- Chronological transcript, choice composer, ending/restart UI: Task 5.
- Learn discovery, authenticated route, existing mobile header/history: Task 6.
- Existing automated/build gates and Simulator acceptance: Task 7.
- Cloud/SRS/branching/response-build/framework exclusions remain out of scope in every task.

### Placeholder scan

The plan contains no `TODO`, `TBD`, generic “handle errors,” or unowned “write tests” steps. Each implementation task names its files, interfaces, test command, expected RED/GREEN state, and commit boundary.

### Type/signature consistency

The plan uses the same `MysteryChapter`, `MysteryProgress`, `MysteryProgressStorage`, `MysteryMessengerController`, and `MysteryAudioController` names and signatures across tasks. TTS calls use the existing `MobileTtsService.preparePronunciation({ userId, vocabularyId, text }, { signal })` contract and audio uses the existing `MobileAudioPlayer` contract.

### Scope check

This remains one independently playable product slice and one PR. No task is an independently shippable horizontal subsystem that warrants a separate Linear issue or PR.

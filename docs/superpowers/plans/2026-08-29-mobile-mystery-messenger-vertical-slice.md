# HPA-299 Mobile Mystery Messenger Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a five-scene authenticated Mystery Messenger loop with one converging choice, local resume/restart, and existing TTS/audio playback.

**Architecture:** Keep the feature under `apps/vela-mobile/src/features/mystery-messenger`. Use a closed scene/history model, pure progression and transcript projection, a test-only authored-content validator, one injected `localStorage` adapter, explicit options seams for both feature composables, and the existing mobile auth/TTS/audio/lifecycle/navigation contracts. The page owns Vue injection and concrete adapters.

**Tech Stack:** Vue 3, Quasar 2, TypeScript, Vue Router, Vitest, `@vue/test-utils`, existing Vela Mobile auth/TTS/audio services.

**Spec:** `docs/superpowers/specs/2026-08-29-mobile-mystery-messenger-vertical-slice-design.md`

## Global Constraints

- One ticket and one PR: HPA-299 stays on PR #62.
- Only `message`, `choice`, and `ending` scene variants.
- Exactly five authored scenes, one converging choice, one ending.
- No backend/API/CDK/DynamoDB/`@vela/common`/Pinia/story-engine work.
- No `response-build`, missed-phrase recap, SRS mutation, branching, or new E2E framework.
- Use browser `localStorage`; chapter-version mismatch discards the pilot save with no migration.
- Reuse `MobileTtsService`, `MobileAudioPlayer`, `mobileLifecycleState`, `pushMobileRoute`, and the existing mobile header/auth boundaries.
- Audio failure never blocks story progression.
- HPA-300 remains blocked until Simulator acceptance.

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
apps/vela-mobile/src/router/diagnostic-routes.test.ts
apps/vela-mobile/src/router/routes.test.ts
```

---

### Task 1: Closed model, progression, transcript selector, and five-scene content

**Files:**
- Create: `apps/vela-mobile/src/features/mystery-messenger/model.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/model.test.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/content.ts`

**Interfaces:**
- Produces: `MysteryChapter`, `MysteryScene`, `MysteryHistoryEntry`, `MysteryProgress`, `MysteryTranscriptItem`, `createMysteryProgress`, `continueMysteryMessage`, `chooseMysteryOption`, `restartMysteryProgress`, `getMysteryScene`, `selectMysteryTranscript`, `MYSTERY_MESSENGER_VERTICAL_SLICE`.

- [ ] **Step 1: Write failing model tests**

Use the closed history shapes from the start:

```ts
expect(continueMysteryMessage(chapter, start, 'scene-01').history).toEqual([
  { kind: 'message', sceneId: 'scene-01' },
]);
```

Pin stale behavior:

```ts
it('returns the same progress for a stale originating scene', () => {
  const start = createMysteryProgress(chapter);
  const next = continueMysteryMessage(chapter, start, 'scene-01');

  expect(continueMysteryMessage(chapter, next, 'scene-01')).toBe(next);
});
```

Pin choice history:

```ts
it('stores a closed choice history entry', () => {
  let progress = createMysteryProgress(chapter);
  progress = continueMysteryMessage(chapter, progress, 'scene-01');
  progress = continueMysteryMessage(chapter, progress, 'scene-02');
  progress = chooseMysteryOption(chapter, progress, 'scene-03', 'understood');

  expect(progress.history.at(-1)).toEqual({
    kind: 'choice',
    sceneId: 'scene-03',
    selectedOptionId: 'understood',
  });
});
```

Also cover invalid current-scene transition, unknown current option, ending completion, and restart.

- [ ] **Step 2: Verify failure**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/model.test.ts
```

Expected: FAIL because feature modules do not exist.

- [ ] **Step 3: Implement the closed contracts and transitions**

Use:

```ts
export type MysteryHistoryEntry =
  | { kind: 'message'; sceneId: string }
  | { kind: 'choice'; sceneId: string; selectedOptionId: string };
```

Both transitions begin with:

```ts
if (progress.currentSceneId !== expectedSceneId) return progress;
```

Then validate the actual current scene. Keep only real current-state errors:

```text
mystery_scene_not_found
mystery_invalid_transition
mystery_option_not_found
```

- [ ] **Step 4: Write transcript-selector tests before implementation**

Assert:

```text
completed message -> message(active=false)
completed choice -> choice-result(selectedLabel, feedback, result)
active message -> message(active=true)
active choice -> choice-prompt
ending -> ending
```

The current scene must appear exactly once after completed history.

- [ ] **Step 5: Implement `selectMysteryTranscript()`**

Switch on `entry.kind`; never probe an optional `selectedOptionId`. Resolve history through `getMysteryScene()`, then append the current scene once.

- [ ] **Step 6: Author the real five-scene chapter**

Topology:

```text
scene-01 -> scene-02 -> scene-03(choice) -> scene-04 -> scene-05(ending)
                                      \-> scene-04
```

TTS IDs:

```text
mystery-message-tomorrow-v1-scene-01
mystery-message-tomorrow-v1-scene-02
mystery-message-tomorrow-v1-scene-03-prompt
mystery-message-tomorrow-v1-scene-04
mystery-message-tomorrow-v1-scene-05
```

Pin convergence directly:

```ts
const choice = chapter.scenes.find((scene) => scene.id === 'scene-03');
expect(choice?.kind).toBe('choice');
if (choice?.kind === 'choice') {
  expect(new Set(choice.options.map((option) => option.nextSceneId))).toEqual(
    new Set(['scene-04']),
  );
}
```

Do not add a generic branching validator.

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

### Task 2: Test-only content validation and explicit local-storage adapter

**Files:**
- Create: `apps/vela-mobile/src/features/mystery-messenger/validate-content.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/validate-content.test.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/storage.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/storage.test.ts`

**Interfaces:**
- Produces: `validateMysteryChapter`, `MysteryProgressStorage`, `createBrowserMysteryProgressStorage`, `mysteryProgressStorageKey`.

- [ ] **Step 1: Write validator tests**

Test the real chapter plus these codes:

```text
duplicate_scene_id
missing_start_scene
dangling_scene_reference
missing_ending
unreachable_ending
duplicate_choice_id
empty_choice_options
```

Example:

```ts
it('accepts the real vertical slice', () => {
  expect(validateMysteryChapter(MYSTERY_MESSENGER_VERTICAL_SLICE)).toEqual([]);
});
```

Keep missing-start and dangling-reference checks. A hand-written literal ID union does not prove the referenced ID is present in `scenes`.

- [ ] **Step 2: Implement validator with `Map` + DFS/BFS**

No runtime page integration and no new dependency. Build the scene map, collect structural issues, then traverse only when the start exists.

- [ ] **Step 3: Write storage tests with an injected fake backend**

Factory contract:

```ts
const storage = createBrowserMysteryProgressStorage(fakeStorage);
```

Pin namespace:

```ts
expect(mysteryProgressStorageKey('user:a', 'chapter/1')).toBe(
  'vela:mobile:mystery-messenger:user%3Aa:chapter%2F1:v1',
);
```

Cover missing load, round-trip, malformed JSON deletion, chapter-version reset, invalid current/history references, history-kind mismatch, invalid choice option, completion mismatch, and backend exceptions.

- [ ] **Step 4: Implement the adapter**

```ts
export function createBrowserMysteryProgressStorage(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
): MysteryProgressStorage
```

Key:

```ts
return `vela:mobile:mystery-messenger:${encodeURIComponent(userId)}:${encodeURIComponent(chapterId)}:v1`;
```

Reject/delete when persisted data disagrees with the chapter or the closed history entry kind. On storage exceptions: `load -> null`, `save/clear -> false`.

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
git commit -m "feat(mobile): validate and persist mystery runs"
```

---

### Task 3: Authenticated run orchestration through an explicit options seam

**Files:**
- Create: `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.test.ts`

**Interfaces:**

```ts
export type UseMysteryMessengerOptions = {
  authState: Readonly<MobileAuthState>;
  storage: MysteryProgressStorage;
  chapter: MysteryChapter;
};

export function useMysteryMessenger(
  options: UseMysteryMessengerOptions,
): MysteryMessengerController;
```

Controller:

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

- [ ] **Step 1: Write direct composable tests with no mount harness**

Pass a reactive/fake auth state, fake storage, and chapter directly. Cover:

```text
usable restore
new-run save
transition save
storage failure -> warning + in-memory progress
restart clear + fresh save
recovering same user -> mutation disabled
identity change -> old run removed, new user's run loaded only when usable
stale transition -> same progress, no persistence churn
```

- [ ] **Step 2: Implement orchestration**

Use:

```ts
const sessionStatus = computed(() => selectMobileFeatureSessionStatus(options.authState));
const { storage, chapter } = options;
```

Do not call `inject()` here.

New-user load:

```ts
function loadForUser(userId: string): void {
  const restored = storage.load(userId, chapter);
  const next = restored ?? createMysteryProgress(chapter);
  activeUserId.value = userId;
  progress.value = next;
  if (!restored && !storage.save(userId, next)) persistenceWarning.value = true;
}
```

For transitions, require usable same-user ownership and non-null progress. If the pure transition returns the exact same object, do not save or replace the ref.

Transcript:

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

### Task 4: TTS/audio replay with gesture fallback and lifecycle cancellation

**Files:**
- Create: `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.test.ts`

**Interfaces:**

```ts
export type UseMysteryAudioOptions = {
  authState: Readonly<MobileAuthState>;
  ttsService: MobileTtsService;
  audioPlayer: MobileAudioPlayer;
  lifecycleState?: { isActive: Readonly<Ref<boolean>> };
};

export function useMysteryAudio(options: UseMysteryAudioOptions): MysteryAudioController;
```

State:

```ts
export type MysteryAudioState =
  | { kind: 'idle' }
  | { kind: 'preparing'; sceneId: string }
  | { kind: 'ready'; sceneId: string; audioUrl: string }
  | { kind: 'playing'; sceneId: string }
  | { kind: 'error'; sceneId: string; message: string };
```

- [ ] **Step 1: Write direct controller tests**

Pass fake auth/TTS/player/lifecycle directly; do not mount Vue only for injection.

Cover exact TTS call including signal:

```ts
expect(ttsService.preparePronunciation).toHaveBeenCalledWith(
  { userId: 'user-1', vocabularyId: scene.ttsId, text: scene.text },
  { signal: expect.any(AbortSignal) },
);
```

Cover all settlement outcomes:

```text
ended -> idle
stopped -> idle
interrupted -> idle
```

Cover `gesture_required`:

```ts
expect(controller.state.value).toEqual({
  kind: 'ready',
  sceneId: scene.id,
  audioUrl: prepared.audioUrl,
});
```

Then invoke `play(scene)` again and assert the existing URL is replayed without a second `preparePronunciation()` call.

Cover `media_unavailable`: invalidate only `(userId, scene.ttsId)`, clear prepared URL, set inline error.

Cover background while preparing: fake lifecycle flips inactive and the captured `AbortSignal.aborted` becomes true.

Cover background while playing: `audioPlayer.interruptActive('background')` is called and state does not remain `playing`.

Cover identity change/unmount: abort preparation, stop owned playback, ignore late completions, dispose player.

- [ ] **Step 2: Implement operation ownership**

Use:

```ts
const lifecycle = options.lifecycleState ?? mobileLifecycleState;
const sessionStatus = computed(() => selectMobileFeatureSessionStatus(options.authState));
let operationGeneration = 0;
let requestController: AbortController | null = null;
let activeHandle: MobileAudioPlaybackHandle | null = null;
let preparedUserId: string | null = null;
```

Before preparing:

```ts
const controller = new AbortController();
requestController = controller;
const pronunciation = await options.ttsService.preparePronunciation(
  { userId, vocabularyId: scene.ttsId, text: authoredTextFor(scene) },
  { signal: controller.signal },
);
```

- [ ] **Step 3: Implement prepared replay and playback outcomes**

If state is `ready` for the same scene and `preparedUserId` still matches the usable user, skip TTS preparation and call `audioPlayer.play(state.audioUrl)` directly.

After `play()`:

```ts
state.value = { kind: 'playing', sceneId: scene.id };
try {
  await handle.finished;
  if (isCurrent(generation)) state.value = { kind: 'idle' };
} catch (error) {
  // gesture_required -> ready with same URL
  // media_unavailable -> invalidate one TTS identity + error
  // other error -> error
}
```

Do not add an interrupted product state.

- [ ] **Step 4: Implement lifecycle/session cancellation**

On user identity change:

```ts
operationGeneration += 1;
requestController?.abort();
activeHandle?.stop('dispose');
preparedUserId = null;
state.value = { kind: 'idle' };
```

On lifecycle inactive:

```ts
operationGeneration += 1;
requestController?.abort();
options.audioPlayer.interruptActive('background');
activeHandle = null;
preparedUserId = null;
state.value = { kind: 'idle' };
```

`dispose()` aborts, stops, disposes, stops both watches, and leaves `idle`.

- [ ] **Step 5: Run focused tests**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/useMysteryAudio.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.ts \
  apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.test.ts
git commit -m "feat(mobile): add mystery messenger audio replay"
```

---

### Task 5: Dumb transcript/composer UI and rapid-input-safe page

**Files:**
- Create: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryTranscript.vue`
- Create: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryTranscript.test.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.vue`
- Create: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts`
- Create: `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue`
- Create: `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts`

**Interfaces:**
- The page owns `inject(MOBILE_AUTH_KEY)`, `inject(MOBILE_TTS_SERVICE_KEY)`, browser storage construction, and `HtmlAudioPlayer` construction.

- [ ] **Step 1: Write thin transcript tests**

Pass preselected `MysteryTranscriptItem[]`; assert order, `lang="ja"`, choice feedback, and `replay(sceneId)` emission. Do not pass chapter/progress to the component.

- [ ] **Step 2: Implement `MysteryTranscript.vue`**

Contract:

```ts
defineProps<{ items: readonly MysteryTranscriptItem[] }>();
defineEmits<{ replay: [sceneId: string] }>();
```

Render by `item.kind`; no auth/storage/progression/history lookup.

- [ ] **Step 3: Write and implement choice-composer tests**

Contract:

```ts
defineProps<{ scene: MysteryChoiceScene; disabled: boolean }>();
defineEmits<{ choose: [optionId: string] }>();
```

Assert disabled choices do not emit.

- [ ] **Step 4: Write page tests including dependency wiring and rapid input**

Mock the two composables for UI tests. Separately assert the page supplies concrete dependencies by mocking factories/injections as needed.

Use fake timers and a mocked messenger that synchronously replaces `currentScene` after the first transition:

```ts
vi.useFakeTimers();
await wrapper.get('[data-testid="mystery-continue"]').trigger('click');
await wrapper.get('[data-testid="mystery-continue"]').trigger('click');
expect(continueMessage).toHaveBeenCalledTimes(1);
await vi.advanceTimersByTimeAsync(500);
```

Also cover duplicate choice submission, session recovery disabled state, save warning, `ready` copy (`Tap play again`), audio error, and ending restart.

- [ ] **Step 5: Implement page dependency wiring**

```ts
const coordinator = inject(MOBILE_AUTH_KEY);
const ttsService = inject(MOBILE_TTS_SERVICE_KEY);
if (!coordinator || !ttsService) throw new Error('mystery_messenger_dependencies_unavailable');

const chapter = MYSTERY_MESSENGER_VERTICAL_SLICE;
const messenger = useMysteryMessenger({
  authState: coordinator.state,
  storage: createBrowserMysteryProgressStorage(window.localStorage),
  chapter,
});
const audio = useMysteryAudio({
  authState: coordinator.state,
  ttsService,
  audioPlayer: new HtmlAudioPlayer(),
});
```

- [ ] **Step 6: Implement the 500 ms page-local transition guard**

```ts
const RAPID_TRANSITION_GUARD_MS = 500;
const transitionLocked = ref(false);
let transitionUnlockTimer: ReturnType<typeof setTimeout> | null = null;

function lockTransition(): boolean {
  if (transitionLocked.value) return false;
  transitionLocked.value = true;
  transitionUnlockTimer = setTimeout(() => {
    transitionLocked.value = false;
    transitionUnlockTimer = null;
  }, RAPID_TRANSITION_GUARD_MS);
  return true;
}
```

Continue/choice handlers capture the visible scene only after acquiring the lock. Bind the lock into their disabled state. Clear the timer and `audio.dispose()` on unmount.

- [ ] **Step 7: Wire replay**

Resolve the requested scene ID from the chapter and call `void audio.play(scene)`. `ready` remains replayable by the same explicit button; no automatic second play attempt.

- [ ] **Step 8: Run UI tests**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/features/mystery-messenger/components/MysteryTranscript.test.ts \
  src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts \
  src/features/mystery-messenger/MysteryMessengerPage.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/components \
  apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue \
  apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts
git commit -m "feat(mobile): render mystery messenger loop"
```

---

### Task 6: Learn entry, authenticated route, regression tests, coverage gate, and Simulator acceptance

**Files:**
- Modify: `apps/vela-mobile/src/pages/LearnPage.vue`
- Create: `apps/vela-mobile/src/pages/LearnPage.test.ts`
- Modify: `apps/vela-mobile/src/pages/StubPages.test.ts`
- Modify: `apps/vela-mobile/src/router/diagnostic-routes.ts`
- Modify: `apps/vela-mobile/src/router/diagnostic-routes.test.ts`
- Modify: `apps/vela-mobile/src/router/routes.test.ts`
- Update: HPA-299 and PR #62 with validation evidence.

- [ ] **Step 1: Write Learn-page tests including rejection handling**

Assert the card copy:

```text
Mystery Messenger
The Message That Arrived Tomorrow
Play pilot
```

Happy path: clicking calls `pushMobileRoute(router, '/learn/mystery-messenger')`.

Rejected navigation:

```ts
vi.mocked(pushMobileRoute).mockRejectedValueOnce(new Error('navigation failed'));
const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
await wrapper.get('[data-testid="mystery-messenger-entry"]').trigger('click');
await flushPromises();
expect(consoleError).toHaveBeenCalledWith(
  'Mystery Messenger navigation failed',
  expect.any(Error),
);
```

- [ ] **Step 2: Remove Learn from existing stub expectations**

In `StubPages.test.ts`, remove `LearnPage` from the parameterized `Coming soon` table. Leave Review/Words/More unchanged.

- [ ] **Step 3: Replace the Learn placeholder**

Keep one literal card. Navigation must handle rejection like existing callers:

```ts
function openMysteryMessenger(): void {
  void pushMobileRoute(router, '/learn/mystery-messenger').catch((error: unknown) => {
    console.error('Mystery Messenger navigation failed', error);
  });
}
```

No Start/Resume persistence reader and no activity registry.

- [ ] **Step 4: Update both existing router test files before the route**

`routes.test.ts`:

```ts
it('has six core routes plus three development routes under the root layout', () => {
  expect(root?.children).toHaveLength(9);
});

it('constructs production routes with only the six core children', () => {
  expect(buildMobileChildRoutes([])).toHaveLength(6);
});
```

Add `learn/mystery-messenger` to the expected paths and keep the existing lazy `loadDefault()` loop.

`diagnostic-routes.test.ts`:

```ts
it('keeps production construction at the six authenticated core routes', () => {
  expect(buildMobileChildRoutes([])).toHaveLength(6);
});
```

Retain the assertions that no core route bypasses mobile auth.

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

Do not set `bypassMobileAuth` or create a second router module.

- [ ] **Step 6: Run focused regression tests**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/features/mystery-messenger \
  src/pages/LearnPage.test.ts \
  src/pages/StubPages.test.ts \
  src/router/diagnostic-routes.test.ts \
  src/router/routes.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run the actual mobile coverage/build gates**

```bash
bun run --cwd apps/vela-mobile test:coverage
bun run --cwd apps/vela-mobile lint
bun run --cwd apps/vela-mobile typecheck
bun run --cwd apps/vela-mobile build
```

Expected: all PASS. `test:coverage` must satisfy the existing mobile 95% line threshold and produce the coverage report CI uploads.

- [ ] **Step 8: Run PR CI/Codecov before acceptance**

When the PR is ready for review and CI is enabled for the non-draft state, confirm the mobile Codecov patch status is at least 90% with threshold 0. Do not declare HPA-299 accepted while that status is below target or missing.

- [ ] **Step 9: Build/sync iOS and manually accept in Simulator**

Record exact Simulator/runtime. Verify:

```text
Learn -> Mystery Messenger
five scenes -> choice -> ending
leave/re-enter -> same scene, no duplicate transcript
app relaunch -> same snapshot
restart -> scene-01
rapid Continue -> one transition
rapid choice -> one transition
cold TTS first tap either plays or shows Tap play again
Tap play again reuses prepared URL without another TTS request
natural audio completion -> no stuck playing
background during playback -> no stuck playing
background during TTS preparation -> request is cancelled
TTS/audio error -> story progression remains enabled
```

HPA-300 remains blocked unless this pass succeeds.

- [ ] **Step 10: Record evidence on the same PR/ticket**

Add exact commands/results, coverage result, Codecov result, and Simulator observations to PR #62 and HPA-299. Do not create another implementation PR.

- [ ] **Step 11: Commit integration changes**

```bash
git add apps/vela-mobile/src/pages/LearnPage.vue \
  apps/vela-mobile/src/pages/LearnPage.test.ts \
  apps/vela-mobile/src/pages/StubPages.test.ts \
  apps/vela-mobile/src/router/diagnostic-routes.ts \
  apps/vela-mobile/src/router/diagnostic-routes.test.ts \
  apps/vela-mobile/src/router/routes.test.ts
git commit -m "feat(mobile): expose mystery messenger pilot"
```

---

## Plan Self-Review

- Spec coverage: model/history, transcript selector, validator, storage seam, auth ownership, audio gesture fallback, lifecycle cancellation, Learn entry, both route tests, coverage gate, and Simulator acceptance all have owning tasks.
- Placeholder scan: no `TBD`, `TODO`, “similar to”, or undefined dependency seam remains.
- Type consistency: both composables have explicit options; history is a closed union; audio `ready` state and lifecycle seam are consistent across Tasks 4–5.
- Runtime-validator check: validator is exercised against checked-in content in tests only; no unused page initialization state is planned.
- Scope check: no backend/shared package/native plugin/store/engine expansion was introduced.

## Success Criteria

- Five-scene slice is playable through one converging choice to one ending.
- Rapid repeated Continue/choice cannot skip a scene.
- Transcript projection is pure and SFCs stay presentation-only.
- User-scoped local resume/restart/version reset work.
- TTS handles gesture-required replay without regenerating prepared audio.
- Background/unmount/identity change cancel owned TTS/audio work.
- Authored validator catches structural graph defects in tests.
- Existing Learn/stub/router regressions are deliberately updated.
- `test:coverage`, lint, typecheck, and build pass; mobile line coverage stays above the existing 95% gate.
- Codecov patch coverage is at least 90%.
- Slice is manually accepted in an iOS Simulator before HPA-300 begins.

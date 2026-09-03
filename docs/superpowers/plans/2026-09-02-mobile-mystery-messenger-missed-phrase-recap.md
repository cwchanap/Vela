# Mobile Mystery Messenger Missed-Phrase Recap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a run-local, persisted missed-phrase recap to the completed Mystery Messenger pilot, including hint-assisted outcomes and read-only TTS replay.

**Architecture:** Extend the existing immutable `MysteryProgress` snapshot with deduplicated missed-phrase provenance plus persisted hint-use markers. Keep grading and recap projection pure in `model.ts`, persist through the existing storage/controller transition path, render one feature-local ending recap component, and reuse the existing authenticated audio state machine for phrase replay.

**Tech Stack:** Vue 3, TypeScript, Quasar, Vitest, Bun/Turborepo, existing `MobileTtsService` + `HtmlAudioPlayer` integration.

**Spec:** `docs/superpowers/specs/2026-09-02-mobile-mystery-messenger-missed-phrase-recap-design.md`

## Global Constraints

- Keep HPA-301 on one branch and one PR.
- No backend/API/CDK/DynamoDB changes.
- No SRS writes, vocabulary-save APIs, personal dictionary mutation, or Review-flow dependency.
- No Pinia, generic mistakes/review framework, event bus, or shared package extraction.
- Keep the existing chapter ID, chapter version, and local-storage `:v1` key namespace.
- Existing HPA-300 snapshots that lack the additive recap fields must normalize to empty arrays on load; do not add a migration framework.
- First miss wins for source-scene provenance when the same target phrase is missed more than once.
- TTS replay is read-only and must reuse the existing Mystery Messenger audio state machine.
- Physical-device acceptance remains HPA-302.

---

## File Map

### Existing files to modify

- `apps/vela-mobile/src/features/mystery-messenger/model.ts` — progress fields, hint transition, response grading extraction, missed-phrase accumulation, recap projection.
- `apps/vela-mobile/src/features/mystery-messenger/model.test.ts` — pure rules for correct/incorrect/hint-assisted/deduplicated outcomes and projection.
- `apps/vela-mobile/src/features/mystery-messenger/storage.ts` — additive snapshot normalization and validation for recap/hint fields.
- `apps/vela-mobile/src/features/mystery-messenger/storage.test.ts` — compatibility, round-trip, malformed snapshot coverage.
- `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.ts` — controller `markHintUsed` method and recap computed projection.
- `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.test.ts` — persistence/resume/restart controller coverage.
- `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.ts` — narrow raw `MysterySceneAudio` replay method sharing the existing playback state machine.
- `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.test.ts` — raw replay delegation/state behavior.
- `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.vue` — emit first hint reveal.
- `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts` — one-shot hint event.
- `apps/vela-mobile/src/features/mystery-messenger/components/MysteryResponseBuildComposer.vue` — emit first hint reveal.
- `apps/vela-mobile/src/features/mystery-messenger/components/MysteryResponseBuildComposer.test.ts` — one-shot hint event.
- `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue` — wire hint events, ending recap, phrase TTS replay.
- `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts` — ending recap integration and non-mutating replay.

### New files

- `apps/vela-mobile/src/features/mystery-messenger/components/MysteryMissedPhraseRecap.vue` — read-only recap list/empty state and replay emit.
- `apps/vela-mobile/src/features/mystery-messenger/components/MysteryMissedPhraseRecap.test.ts` — isolated zero/one/multiple rendering and replay behavior.

---

### Task 1: Add run-local missed-phrase and hint facts to the pure model

**Files:**
- Modify: `apps/vela-mobile/src/features/mystery-messenger/model.ts`
- Test: `apps/vela-mobile/src/features/mystery-messenger/model.test.ts`

**Interfaces:**
- Produces: `MysteryMissedPhrase`, `MysteryMissedPhraseRecapItem`, `markMysteryHintUsed()`, `gradeMysteryResponse()`, `selectMysteryMissedPhraseRecap()`.
- Produces widened `MysteryProgress` with `missedPhrases` and `hintedSceneIds`.
- Later tasks consume these exact types/functions from storage, controller, and UI.

- [ ] **Step 1: Add failing creation/restart shape tests**

Add assertions showing a fresh and restarted run contain empty arrays:

```ts
expect(createMysteryProgress(chapter)).toMatchObject({
  missedPhrases: [],
  hintedSceneIds: [],
});

expect(restartMysteryProgress(chapter)).toMatchObject({
  missedPhrases: [],
  hintedSceneIds: [],
});
```

Run:

```bash
bun --filter @vela/mobile test -- model.test.ts
```

Expected: FAIL because the fields do not exist yet.

- [ ] **Step 2: Add the new progress and recap types minimally**

In `model.ts`, add:

```ts
export type MysteryMissedPhrase = {
  phraseId: string;
  sourceSceneId: string;
};

export type MysteryMissedPhraseRecapItem = {
  phraseId: string;
  text: string;
  reading: string;
  meaning: string;
  sourceSceneId: string;
  sourcePrompt: string;
};
```

Extend `MysteryProgress`:

```ts
missedPhrases: readonly MysteryMissedPhrase[];
hintedSceneIds: readonly string[];
```

Initialize both to `[]` in `createMysteryProgress()`.

Run the focused test again and expect PASS.

- [ ] **Step 3: Write failing hint-transition tests**

Cover:

```ts
const hinted = markMysteryHintUsed(chapter, progressAtChoice, 'scene-03');
expect(hinted.hintedSceneIds).toEqual(['scene-03']);
expect(markMysteryHintUsed(chapter, hinted, 'scene-03')).toBe(hinted);
expect(markMysteryHintUsed(chapter, progressAtChoice, 'stale-scene')).toBe(progressAtChoice);
```

Also pin that message/ending scene IDs do not become hinted IDs.

Expected: FAIL because `markMysteryHintUsed` is missing.

- [ ] **Step 4: Implement `markMysteryHintUsed()`**

Add:

```ts
export function markMysteryHintUsed(
  chapter: MysteryChapter,
  progress: MysteryProgress,
  expectedSceneId: string,
): MysteryProgress {
  if (progress.currentSceneId !== expectedSceneId) return progress;
  const scene = getMysteryScene(chapter, expectedSceneId);
  if (scene.kind !== 'choice' && scene.kind !== 'response-build') return progress;
  if (progress.hintedSceneIds.includes(scene.id)) return progress;
  return {
    ...progress,
    hintedSceneIds: [...progress.hintedSceneIds, scene.id],
  };
}
```

Run the focused tests and expect PASS.

- [ ] **Step 5: Write failing response-grading extraction tests**

Pin canonical, alternate, and incorrect sequences through a new exported function:

```ts
expect(gradeMysteryResponse(scene, scene.correctTokenIds)).toBe('correct');
expect(gradeMysteryResponse(scene, scene.alternateAnswerTokenIds![0]!)).toBe('correct');
expect(gradeMysteryResponse(scene, ['wrong-token-sequence'])).toBe('incorrect');
```

Use valid known token IDs for the incorrect case so the test is about grading, not validation.

Expected: FAIL because grading currently lives inline in transcript projection.

- [ ] **Step 6: Extract `gradeMysteryResponse()` without changing transcript behavior**

Move the existing visible-text comparison logic into:

```ts
export function gradeMysteryResponse(
  scene: MysteryResponseBuildScene,
  selectedTokenIds: readonly string[],
): 'correct' | 'incorrect' {
  // resolve selected/canonical/alternate visible text using the existing token map semantics
}
```

Call it from `selectMysteryTranscript()` instead of duplicating the comparison.

Run existing model tests plus the new focused tests and expect PASS.

- [ ] **Step 7: Write failing missed-phrase accumulation tests**

Cover all product rules:

```ts
// correct choice, no hint -> []
// incorrect choice -> targetPhraseIds exactly once
// correct choice after markMysteryHintUsed -> targetPhraseIds exactly once
// repeated target phrase from later interaction -> still one row, first sourceSceneId retained
// incorrect response-build -> targetPhraseIds
// canonical or alternate response without hint -> no phrase
// accepted response after hint -> targetPhraseIds
```

Expected: FAIL because transition functions do not accumulate missed phrases.

- [ ] **Step 8: Add one internal deduplicating helper and integrate both interaction transitions**

Add an internal helper shaped as:

```ts
function addMysteryMissedPhrases(
  progress: MysteryProgress,
  sourceSceneId: string,
  targetPhraseIds: readonly string[],
): MysteryProgress {
  const existing = new Set(progress.missedPhrases.map((item) => item.phraseId));
  const added = targetPhraseIds
    .filter((phraseId) => !existing.has(phraseId))
    .map((phraseId) => ({ phraseId, sourceSceneId }));
  if (added.length === 0) return progress;
  return { ...progress, missedPhrases: [...progress.missedPhrases, ...added] };
}
```

In `chooseMysteryOption()`, accumulate when:

```ts
option.result === 'incorrect' || progress.hintedSceneIds.includes(scene.id)
```

In `submitMysteryResponse()`, calculate:

```ts
const result = gradeMysteryResponse(scene, selectedTokenIds);
```

and apply the same incorrect-or-hinted rule before producing the final advanced progress object.

Do not create a second outcome/event model.

Run focused model tests and expect PASS.

- [ ] **Step 9: Write and implement recap projection tests**

Add a failing test expecting:

```ts
expect(selectMysteryMissedPhraseRecap(chapter, progress)).toEqual([
  {
    phraseId: 'tomorrow-seven',
    text: '...',
    reading: '...',
    meaning: '...',
    sourceSceneId: 'scene-03',
    sourcePrompt: '...',
  },
]);
```

Implement `selectMysteryMissedPhraseRecap()` by resolving phrase metadata from `chapter.targetPhrases` and source prompt from choice/response-build scenes.

Invalid IDs should throw model errors only if called directly with malformed in-memory data; Task 2 prevents malformed persisted data from reaching this selector.

Run:

```bash
bun --filter @vela/mobile test -- model.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit Task 1**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/model.ts \
  apps/vela-mobile/src/features/mystery-messenger/model.test.ts
git commit -m "feat(mobile): track mystery missed phrases"
```

---

### Task 2: Normalize and validate the additive snapshot fields

**Files:**
- Modify: `apps/vela-mobile/src/features/mystery-messenger/storage.ts`
- Test: `apps/vela-mobile/src/features/mystery-messenger/storage.test.ts`

**Interfaces:**
- Consumes widened `MysteryProgress` from Task 1.
- Produces compatibility behavior where missing `missedPhrases`/`hintedSceneIds` load as `[]`.
- Maintains the existing `MysteryProgressStorage` interface unchanged.

- [ ] **Step 1: Add a failing HPA-300 snapshot compatibility test**

Seed storage with a valid current chapter snapshot omitting only the two new fields. Expect `load()` to return:

```ts
expect(restored?.missedPhrases).toEqual([]);
expect(restored?.hintedSceneIds).toEqual([]);
```

Expected: FAIL under a strict widened type/validator.

- [ ] **Step 2: Normalize missing additive fields before validation**

Parse the raw object into an internal unknown/partial representation and construct a candidate where:

```ts
missedPhrases: Array.isArray(raw.missedPhrases) ? raw.missedPhrases : [],
hintedSceneIds: Array.isArray(raw.hintedSceneIds) ? raw.hintedSceneIds : [],
```

Only treat `undefined`/missing fields as the compatibility case. Explicit malformed non-array values must still be rejected rather than normalized away.

Run the compatibility test and expect PASS.

- [ ] **Step 3: Add failing recap/hint validation tests**

Add cases for:

- valid new snapshot round-trip;
- unknown `hintedSceneId`;
- hinted message/ending scene;
- duplicate hinted scene;
- unknown `phraseId`;
- unknown `sourceSceneId`;
- source scene that is not an interaction;
- source interaction whose `targetPhraseIds` does not include the phrase;
- duplicate phrase IDs in `missedPhrases`.

Expected: FAIL until validation is extended.

- [ ] **Step 4: Extend `isKnownProgress()` validation narrowly**

Build:

```ts
const targetPhrases = new Set(chapter.targetPhrases.map((phrase) => phrase.id));
```

Validate `hintedSceneIds` uniqueness and that each ID resolves to `choice` or `response-build`.

Validate `missedPhrases` uniqueness by `phraseId`, phrase existence, source interaction existence/kind, and `scene.targetPhraseIds.includes(phraseId)`.

Preserve all existing history/current/completed validation.

Run:

```bash
bun --filter @vela/mobile test -- storage.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/storage.ts \
  apps/vela-mobile/src/features/mystery-messenger/storage.test.ts
git commit -m "feat(mobile): persist mystery recap state"
```

---

### Task 3: Persist hint use and expose recap through the existing controller

**Files:**
- Modify: `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.ts`
- Test: `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.test.ts`

**Interfaces:**
- Consumes `markMysteryHintUsed()` and `selectMysteryMissedPhraseRecap()`.
- Produces controller methods/properties:

```ts
missedPhraseRecap: ComputedRef<readonly MysteryMissedPhraseRecapItem[]>;
markHintUsed(expectedSceneId: string): void;
```

- [ ] **Step 1: Add failing controller tests for hint persistence and recap**

Pin that:

```ts
controller.markHintUsed('scene-03');
expect(storage.save).toHaveBeenCalledWith(userId, expect.objectContaining({
  hintedSceneIds: ['scene-03'],
}));
```

Then choose a correct answer and expect `controller.missedPhraseRecap.value` to contain the target phrase.

Also pin stale scene IDs do not save and repeated hint use does not save again.

Expected: FAIL because the controller method/computed do not exist.

- [ ] **Step 2: Wire both through the existing `transition()` seam**

Import the Task-1 helpers and add:

```ts
const missedPhraseRecap = computed(() =>
  progress.value ? selectMysteryMissedPhraseRecap(chapter, progress.value) : [],
);
```

Expose:

```ts
markHintUsed: (expectedSceneId: string) =>
  transition((current) => markMysteryHintUsed(chapter, current, expectedSceneId)),
```

Do not add direct storage calls.

Run focused tests and expect PASS.

- [ ] **Step 3: Add resume and restart regression tests**

Persist a hinted/missed run, recreate the controller, and expect recap state to restore.

Call `restart()` and expect:

```ts
expect(controller.missedPhraseRecap.value).toEqual([]);
expect(controller.progress.value?.hintedSceneIds).toEqual([]);
```

Run focused tests and expect PASS.

- [ ] **Step 4: Commit Task 3**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.ts \
  apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.test.ts
git commit -m "feat(mobile): expose mystery recap state"
```

---

### Task 4: Emit one explicit hint-used signal from each interaction component

**Files:**
- Modify: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.vue`
- Test: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryResponseBuildComposer.vue`
- Test: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryResponseBuildComposer.test.ts`

**Interfaces:**
- Produces `hintUsed` event with no payload from each composer.
- Existing `choose` and `submit` payloads remain unchanged.

- [ ] **Step 1: Add failing choice-composer event tests**

Click Hint once and assert:

```ts
expect(wrapper.emitted('hintUsed')).toHaveLength(1);
```

Click again to hide and again to show; still expect one emission for the mounted scene.

Expected: FAIL.

- [ ] **Step 2: Implement first-reveal emission in the choice composer**

Replace direct toggle with:

```ts
const hintReported = ref(false);

function toggleHint(): void {
  showHint.value = !showHint.value;
  if (showHint.value && !hintReported.value) {
    hintReported.value = true;
    emit('hintUsed');
  }
}
```

Extend `defineEmits` with `hintUsed: []` and wire the button to `toggleHint`.

Run the component test and expect PASS.

- [ ] **Step 3: Add and implement the equivalent response-build test**

Use the same mounted-scene one-shot semantics. Do not persist visual expansion state and do not change selected-token behavior.

Run both component tests and expect PASS.

- [ ] **Step 4: Commit Task 4**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.vue \
  apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts \
  apps/vela-mobile/src/features/mystery-messenger/components/MysteryResponseBuildComposer.vue \
  apps/vela-mobile/src/features/mystery-messenger/components/MysteryResponseBuildComposer.test.ts
git commit -m "feat(mobile): report mystery hint use"
```

---

### Task 5: Reuse the existing audio state machine for raw phrase replay

**Files:**
- Modify: `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.ts`
- Test: `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.test.ts`

**Interfaces:**
- Consumes existing `MysterySceneAudio`.
- Produces:

```ts
playAudio(audio: MysterySceneAudio): Promise<void>;
```

- Existing `play(scene: MysteryScene)` behavior remains unchanged and delegates to the same internal path.

- [ ] **Step 1: Add a failing raw-audio replay test**

Call:

```ts
await controller.playAudio({ ttsId: 'message-that-arrived-tomorrow-recap-x', text: 'あした' });
```

Assert the existing TTS service receives that identity/text and the audio player follows the same ready/playing behavior as scene replay.

Expected: FAIL because `playAudio` does not exist.

- [ ] **Step 2: Refactor only the input boundary**

Move the existing prepare/play logic into one internal function accepting `MysterySceneAudio`.

Implement:

```ts
async function play(scene: MysteryScene): Promise<void> {
  const selected = selectMysterySceneAudio(scene);
  if (!selected) return;
  await playAudio(selected);
}
```

Expose both `play` and `playAudio`.

Do not duplicate cancellation, gesture-required, lifecycle, stale-user, or error handling.

- [ ] **Step 3: Run all existing audio tests plus the new raw replay test**

```bash
bun --filter @vela/mobile test -- useMysteryAudio.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit Task 5**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.ts \
  apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.test.ts
git commit -m "refactor(mobile): reuse mystery audio for recap"
```

---

### Task 6: Add the read-only ending recap component

**Files:**
- Create: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryMissedPhraseRecap.vue`
- Create: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryMissedPhraseRecap.test.ts`

**Interfaces:**
- Consumes: `readonly MysteryMissedPhraseRecapItem[]`.
- Produces event: `replay: [phraseId: string]`.

- [ ] **Step 1: Create failing empty-state test**

Mount with `items: []` and expect:

```ts
expect(wrapper.get('[data-testid="mystery-recap-empty"]').text())
  .toContain('No missed phrases this run.');
```

Expected: FAIL because component is missing.

- [ ] **Step 2: Add the minimal component shell and empty state**

Use a semantic section with heading such as `Missed phrases` and the exact empty copy from the spec.

Run the empty-state test and expect PASS.

- [ ] **Step 3: Add failing one/multiple row tests**

For each row assert Japanese text, reading, meaning, and source prompt are visible. Use stable test IDs keyed by `phraseId`.

Expected: FAIL until rows are rendered.

- [ ] **Step 4: Render recap rows and replay buttons**

Render each item without introducing local learning state. The replay button should emit only:

```ts
emit('replay', item.phraseId);
```

- [ ] **Step 5: Add and pass replay emission test**

Click one row's Replay button and assert exactly one `replay` event with that phrase ID.

Run:

```bash
bun --filter @vela/mobile test -- MysteryMissedPhraseRecap.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/components/MysteryMissedPhraseRecap.vue \
  apps/vela-mobile/src/features/mystery-messenger/components/MysteryMissedPhraseRecap.test.ts
git commit -m "feat(mobile): add mystery missed phrase recap"
```

---

### Task 7: Wire hint use, ending recap, and phrase replay on the page

**Files:**
- Modify: `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue`
- Test: `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts`

**Interfaces:**
- Consumes controller `markHintUsed()` and `missedPhraseRecap`.
- Consumes `MysteryMissedPhraseRecap` component and audio `playAudio()`.
- Keeps existing transition guard and Restart behavior.

- [ ] **Step 1: Add failing page tests for hint forwarding**

For choice and response-build fixtures, reveal Hint and assert the persisted run contains that scene ID in `hintedSceneIds`.

Expected: FAIL because page does not listen for `hintUsed`.

- [ ] **Step 2: Wire the two composer events**

Add:

```vue
@hint-used="handleHintUsed"
```

for both composers and implement:

```ts
function handleHintUsed(): void {
  const scene = messenger.currentScene.value;
  if (scene?.kind !== 'choice' && scene?.kind !== 'response-build') return;
  messenger.markHintUsed(scene.id);
}
```

Do not use the 500 ms transition lock for hint reporting; idempotency belongs in the model/controller.

Run the focused tests and expect PASS.

- [ ] **Step 3: Add failing ending recap visibility tests**

Cover:

- no recap before ending;
- ending with zero items shows empty state;
- ending with one/multiple items shows rows;
- Restart remains visible below recap.

Expected: FAIL.

- [ ] **Step 4: Render recap only for the ending scene**

Import `MysteryMissedPhraseRecap` and place it in the `currentEnding` branch before Restart, passing:

```vue
:items="messenger.missedPhraseRecap.value"
@replay="handleRecapReplay"
```

Keep transcript ending content intact.

- [ ] **Step 5: Add failing TTS replay integration test**

Click recap Replay and assert the existing injected TTS service receives:

```ts
{
  vocabularyId: `${chapter.id}-recap-${phraseId}`,
  text: phrase.text,
  // existing service options unchanged
}
```

Snapshot `messenger.progress.value` before replay and assert it is deeply unchanged afterward.

Expected: FAIL until handler is wired.

- [ ] **Step 6: Implement stable recap TTS identity at the page boundary**

Resolve the recap item by `phraseId` from `messenger.missedPhraseRecap.value`, then call:

```ts
void audio.playAudio({
  ttsId: `${chapter.id}-recap-${item.phraseId}`,
  text: item.text,
});
```

Unknown emitted IDs should no-op; the component normally emits only known IDs.

Do not call any messenger transition from replay.

Run the page test and expect PASS.

- [ ] **Step 7: Commit Task 7**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue \
  apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts
git commit -m "feat(mobile): wire mystery ending recap"
```

---

### Task 8: Run the complete HPA-301 verification gate

**Files:**
- Modify only files required by failures directly caused by HPA-301.

**Interfaces:**
- Produces one reviewable HPA-301 implementation with no unrelated refactor.

- [ ] **Step 1: Run all Mystery Messenger unit tests**

```bash
bun --filter @vela/mobile test -- src/features/mystery-messenger
```

Expected: PASS.

- [ ] **Step 2: Run mobile coverage**

```bash
bun --filter @vela/mobile test:coverage
```

Expected: PASS and repository-required patch coverage remains satisfied.

- [ ] **Step 3: Run lint**

```bash
bun --filter @vela/mobile lint
```

Expected: PASS.

- [ ] **Step 4: Run typecheck**

```bash
bun --filter @vela/mobile typecheck
```

Expected: PASS.

- [ ] **Step 5: Run build**

```bash
bun --filter @vela/mobile build
```

Expected: PASS.

- [ ] **Step 6: Perform Simulator smoke acceptance**

Verify two runs:

1. Complete all interactions correctly without Hint. Ending shows `No missed phrases this run.`
2. Use Hint on at least one interaction and answer another interaction incorrectly. Ending shows the expected deduplicated phrase rows, source prompts, and replay buttons. Relaunch before finishing and confirm recap state survives.

Also confirm Replay uses the existing audio status/error UI and does not alter story progress.

Record evidence in the PR body or a PR comment; do not create a second verification ticket.

- [ ] **Step 7: Final scope check**

Confirm the diff contains no backend/API/SRS/Pinia/shared-engine work and no physical-device release gate that belongs to HPA-302.

- [ ] **Step 8: Commit any verification-only fixture/doc correction if needed**

If no tracked files changed, do not create an empty commit.

---

## Self-Review Checklist

Before implementation is marked ready for review:

- Every incorrect interaction adds all of its target phrases exactly once.
- Every correct interaction after first hint reveal adds all of its target phrases exactly once.
- Correct-without-hint adds nothing.
- First miss retains provenance when later interactions target the same phrase.
- HPA-300 snapshots without the new arrays restore as empty recap/hint state.
- Malformed recap/hint snapshot fields are rejected by the existing storage boundary.
- Restart clears recap and hint state.
- Recap derives phrase text/reading/meaning from chapter content rather than duplicating content in storage.
- Recap renders only at the ending and handles zero/one/multiple items.
- Phrase replay reuses existing authenticated audio state and does not mutate progress.
- No backend, SRS, Pinia, generic review framework, or shared package was added.
- HPA-302 remains the final physical-device/release acceptance task.
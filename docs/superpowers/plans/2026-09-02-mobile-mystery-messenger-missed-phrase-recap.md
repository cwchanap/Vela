# Mobile Mystery Messenger Missed-Phrase Recap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a run-local Mystery Messenger missed-phrase recap derived from persisted interaction history plus the one new fact history cannot recover: hint use.

**Architecture:** Keep `history` as the single source of truth for completed interaction outcomes. Persist only `hintedSceneIds`, extract response grading so transcript and recap share one rule, derive recap rows on demand from history + chapter content, render one ending-only feature-local recap, and generalize the existing audio controller from scene identity to `audio.ttsId` so recap clips reuse the same retry/cancellation state machine.

**Tech Stack:** Vue 3, TypeScript, Quasar, Vitest, Bun/Turborepo, existing `MobileTtsService` + `HtmlAudioPlayer` integration.

**Spec:** `docs/superpowers/specs/2026-09-02-mobile-mystery-messenger-missed-phrase-recap-design.md`

## Global Constraints

- Keep HPA-301 on one branch and one PR.
- No persisted `missedPhrases` collection; recap is derived from history + `hintedSceneIds`.
- No backend/API/CDK/DynamoDB changes.
- No SRS writes, vocabulary-save APIs, personal dictionary mutation, or Review-flow dependency.
- No Pinia, generic mistakes/review framework, event bus, migrator registry, or shared package extraction.
- Keep the existing chapter ID, chapter version, and local-storage `:v1` key namespace.
- A valid HPA-300 snapshot missing only `hintedSceneIds` loads with `[]`; explicit malformed hint state still resets through the existing invalid-load boundary.
- First qualifying history occurrence wins source-scene provenance when multiple interactions target the same phrase.
- TTS replay is read-only and must reuse the existing Mystery Messenger audio state machine.
- `useMysteryAudio` must preserve preparing suppression, switching cancellation, gesture-required prepared retry, media invalidation, auth/lifecycle cancellation, and dispose behavior while changing identity from `scene.id` to `audio.ttsId`.
- Physical-device acceptance remains HPA-302.

---

## File Map

### Existing files to modify

- `apps/vela-mobile/src/features/mystery-messenger/model.ts` — `hintedSceneIds`, hint transition, response grading extraction, history-derived recap projection, phrase-audio selector.
- `apps/vela-mobile/src/features/mystery-messenger/model.test.ts` — pure hint/grading/recap/phrase-audio rules.
- `apps/vela-mobile/src/features/mystery-messenger/storage.ts` — one-field HPA-300 compatibility default and hint validation.
- `apps/vela-mobile/src/features/mystery-messenger/storage.test.ts` — old-snapshot, round-trip, malformed hint coverage.
- `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.ts` — `markHintUsed()` and derived recap computed projection.
- `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.test.ts` — persistence/resume/restart and derived recap coverage.
- `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.ts` — generic playback identity and public `playClip()` while retaining `play(scene)`.
- `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.test.ts` — state-field rename plus scene/clip retry, switch, cancellation, and invalidation regressions.
- `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.vue` — one-shot `hintUsed` emit.
- `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts` — first-reveal-only event coverage.
- `apps/vela-mobile/src/features/mystery-messenger/components/MysteryResponseBuildComposer.vue` — one-shot `hintUsed` emit.
- `apps/vela-mobile/src/features/mystery-messenger/components/MysteryResponseBuildComposer.test.ts` — first-reveal-only event coverage.
- `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue` — hint wiring, ending recap, phrase replay through `playClip()`.
- `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts` — end-to-end feature integration and no-write replay coverage.

### New files

- `apps/vela-mobile/src/features/mystery-messenger/components/MysteryMissedPhraseRecap.vue` — ending-only read-only recap list/empty state and replay emit.
- `apps/vela-mobile/src/features/mystery-messenger/components/MysteryMissedPhraseRecap.test.ts` — isolated zero/one/multiple rendering and replay behavior.

---

### Task 1: Make hint use the only new run fact and derive recap from history

**Files:**
- Modify: `apps/vela-mobile/src/features/mystery-messenger/model.ts`
- Test: `apps/vela-mobile/src/features/mystery-messenger/model.test.ts`

**Interfaces:**
- Produces widened `MysteryProgress` with `hintedSceneIds: readonly string[]` only.
- Produces `markMysteryHintUsed(chapter, progress, expectedSceneId): MysteryProgress`.
- Produces `gradeMysteryResponse(scene, selectedTokenIds): 'correct' | 'incorrect'`.
- Produces `MysteryMissedPhraseRecapItem` and `selectMysteryMissedPhraseRecap(chapter, progress)`.
- Produces `selectMysteryPhraseAudio(chapter, phraseId): MysterySceneAudio | null`.
- Does not change `chooseMysteryOption()` or `submitMysteryResponse()` write semantics beyond using the extracted response grader where needed by existing projection code.

- [ ] **Step 1: Add the failing fresh/restart hint-state assertions**

Update the existing `createMysteryProgress()` expectation and restart test:

```ts
expect(createMysteryProgress(chapter)).toEqual({
  chapterId: chapter.id,
  chapterVersion: chapter.version,
  currentSceneId: chapter.startSceneId,
  history: [],
  completed: false,
  hintedSceneIds: [],
});

expect(restartMysteryProgress(chapter).hintedSceneIds).toEqual([]);
```

Run:

```bash
bun --filter @vela/mobile test -- model.test.ts
```

Expected: FAIL because `MysteryProgress` does not carry hint use yet.

- [ ] **Step 2: Add `hintedSceneIds` to the progress contract**

Extend the type and creation function exactly:

```ts
export type MysteryProgress = {
  chapterId: string;
  chapterVersion: number;
  currentSceneId: string;
  history: readonly MysteryHistoryEntry[];
  completed: boolean;
  hintedSceneIds: readonly string[];
};
```

and in `createMysteryProgress()`:

```ts
return {
  chapterId: chapter.id,
  chapterVersion: chapter.version,
  currentSceneId: chapter.startSceneId,
  history: [],
  completed: false,
  hintedSceneIds: [],
};
```

Run the focused test and expect PASS.

- [ ] **Step 3: Write failing pure hint-transition tests**

Construct progress at a choice and response-build scene and pin:

```ts
const hinted = markMysteryHintUsed(chapter, progressAtChoice, progressAtChoice.currentSceneId);
expect(hinted.hintedSceneIds).toEqual([progressAtChoice.currentSceneId]);
expect(markMysteryHintUsed(chapter, hinted, hinted.currentSceneId)).toBe(hinted);
expect(markMysteryHintUsed(chapter, progressAtChoice, 'stale-scene')).toBe(progressAtChoice);
```

Also construct progress at a message and ending and assert each returns the original object.

Expected: FAIL because the function is missing.

- [ ] **Step 4: Implement the immutable idempotent hint transition**

Add:

```ts
export function markMysteryHintUsed(
  chapter: MysteryChapter,
  progress: MysteryProgress,
  expectedSceneId: string,
): MysteryProgress {
  if (progress.currentSceneId !== expectedSceneId) return progress;

  const scene = getMysteryScene(chapter, progress.currentSceneId);
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

Use an authored response-build scene with valid token IDs and pin canonical, alternate, and incorrect visible order:

```ts
expect(gradeMysteryResponse(scene, scene.correctTokenIds)).toBe('correct');
expect(gradeMysteryResponse(scene, scene.alternateAnswerTokenIds![0]!)).toBe('correct');
expect(gradeMysteryResponse(scene, [...scene.correctTokenIds].reverse())).toBe('incorrect');
```

Keep the existing invalid-token transcript/model test as the regression for `mystery_response_token_not_found`.

Expected: FAIL because grading is still inline in `selectMysteryTranscript()`.

- [ ] **Step 6: Extract the existing visible-text grader and make transcript use it**

Add a small resolver and exported grader in `model.ts`:

```ts
function resolveMysteryResponseTexts(
  scene: MysteryResponseBuildScene,
  tokenIds: readonly string[],
): readonly string[] {
  const textById = new Map(scene.tokens.map((token) => [token.id, token.text] as const));
  return tokenIds.map((tokenId) => {
    const text = textById.get(tokenId);
    if (text === undefined) throw new Error('mystery_response_token_not_found');
    return text;
  });
}

function responseTextsEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((text, index) => text === b[index]);
}

export function gradeMysteryResponse(
  scene: MysteryResponseBuildScene,
  selectedTokenIds: readonly string[],
): 'correct' | 'incorrect' {
  const selected = resolveMysteryResponseTexts(scene, selectedTokenIds);
  const canonical = resolveMysteryResponseTexts(scene, scene.correctTokenIds);
  if (responseTextsEqual(selected, canonical)) return 'correct';

  return (scene.alternateAnswerTokenIds ?? []).some((ids) =>
    responseTextsEqual(selected, resolveMysteryResponseTexts(scene, ids)),
  )
    ? 'correct'
    : 'incorrect';
}
```

In the response-history arm of `selectMysteryTranscript()`, replace only the inline correctness comparison with:

```ts
const result = gradeMysteryResponse(scene, entry.selectedTokenIds);
```

Continue deriving `selectedText` and `correctText` from the same resolver so displayed text stays unchanged.

Run `model.test.ts` and expect all existing transcript tests plus new grading tests to PASS.

- [ ] **Step 7: Write failing history-derived recap tests**

Add tests covering these exact cases using progress with `hintedSceneIds`:

```ts
expect(selectMysteryMissedPhraseRecap(chapter, cleanProgress)).toEqual([]);
expect(selectMysteryMissedPhraseRecap(chapter, incorrectChoiceProgress).map((item) => item.phraseId))
  .toEqual(['tomorrow-seven']);
expect(selectMysteryMissedPhraseRecap(chapter, correctButHintedProgress).map((item) => item.phraseId))
  .toEqual(['tomorrow-seven']);
```

Also pin:

- an incorrect response-build qualifies through `gradeMysteryResponse()`;
- a canonical/alternate response without hint does not qualify;
- repeated qualifying interactions targeting the same phrase emit one row;
- the first qualifying history interaction supplies `sourceSceneId` and `sourcePrompt`;
- a normalized HPA-300-style progress value (`history` contains an incorrect interaction, `hintedSceneIds: []`) still derives that missed phrase.

Expected: FAIL because the selector is missing.

- [ ] **Step 8: Implement the recap projection without write-time accumulation**

Add:

```ts
export type MysteryMissedPhraseRecapItem = {
  phraseId: string;
  text: string;
  reading: string;
  meaning: string;
  sourceSceneId: string;
  sourcePrompt: string;
};
```

Implement `selectMysteryMissedPhraseRecap()` as a single history walk. Use a `Set<string>` for first-wins deduplication. For each `choice` history entry, resolve the selected option and qualify on:

```ts
option.result === 'incorrect' || progress.hintedSceneIds.includes(scene.id)
```

For each `response-build` history entry, qualify on:

```ts
gradeMysteryResponse(scene, entry.selectedTokenIds) === 'incorrect' ||
  progress.hintedSceneIds.includes(scene.id)
```

For each qualifying `targetPhraseId`, skip it if already seen; otherwise resolve the matching `chapter.targetPhrases` item and append:

```ts
{
  phraseId: phrase.id,
  text: phrase.text,
  reading: phrase.reading,
  meaning: phrase.meaning,
  sourceSceneId: scene.id,
  sourcePrompt: scene.prompt,
}
```

Do not add or modify progress inside this selector.

Run `model.test.ts` and expect PASS.

- [ ] **Step 9: Add the phrase-audio selector beside `selectMysterySceneAudio()`**

Write a failing test:

```ts
expect(selectMysteryPhraseAudio(chapter, 'tomorrow-seven')).toEqual({
  ttsId: `${chapter.id}-v${chapter.version}-recap-tomorrow-seven`,
  text: chapter.targetPhrases.find((phrase) => phrase.id === 'tomorrow-seven')!.text,
});
expect(selectMysteryPhraseAudio(chapter, 'missing')).toBeNull();
```

Implement:

```ts
export function selectMysteryPhraseAudio(
  chapter: MysteryChapter,
  phraseId: string,
): MysterySceneAudio | null {
  const phrase = chapter.targetPhrases.find((candidate) => candidate.id === phraseId);
  if (!phrase) return null;
  return {
    ttsId: `${chapter.id}-v${chapter.version}-recap-${phrase.id}`,
    text: phrase.text,
  };
}
```

Run `model.test.ts` and expect PASS.

- [ ] **Step 10: Commit Task 1**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/model.ts \
  apps/vela-mobile/src/features/mystery-messenger/model.test.ts
git commit -m "feat(mobile): derive mystery missed phrases"
```

---

### Task 2: Keep the storage boundary strict while defaulting historic missing hint state

**Files:**
- Modify: `apps/vela-mobile/src/features/mystery-messenger/storage.ts`
- Test: `apps/vela-mobile/src/features/mystery-messenger/storage.test.ts`

**Interfaces:**
- Consumes `MysteryProgress.hintedSceneIds` from Task 1.
- Maintains `MysteryProgressStorage` unchanged.
- Produces one compatibility rule only: a valid HPA-300 object with no `hintedSceneIds` becomes an in-memory HPA-301 progress object with `hintedSceneIds: []`.

- [ ] **Step 1: Add failing tests for the one-field compatibility boundary**

Take an existing valid stored progress fixture, remove only `hintedSceneIds`, and store its JSON. Assert:

```ts
const restored = storage.load(userId, chapter);
expect(restored).not.toBeNull();
expect(restored?.hintedSceneIds).toEqual([]);
```

Add explicit malformed cases:

```ts
for (const hintedSceneIds of [null, 'scene-03', {}, 1]) {
  backend.set(key, JSON.stringify({ ...validProgress, hintedSceneIds }));
  expect(storage.load(userId, chapter)).toBeNull();
}
```

Expected: FAIL until the boundary distinguishes “missing” from “malformed.”

- [ ] **Step 2: Normalize only a missing hint field before existing validation**

After `JSON.parse`, require an object and build the candidate without a migration registry:

```ts
const parsed = JSON.parse(raw) as Record<string, unknown>;
const hintedSceneIds =
  parsed.hintedSceneIds === undefined
    ? []
    : Array.isArray(parsed.hintedSceneIds)
      ? parsed.hintedSceneIds
      : null;
if (hintedSceneIds === null) throw new Error('mystery_invalid_progress');

const progress = {
  ...parsed,
  hintedSceneIds,
} as MysteryProgress;
```

Then pass that candidate through the existing `isKnownProgress()` boundary. Do not save the normalized object merely because it was loaded; the next ordinary transition will persist the current shape.

Run the new compatibility tests and expect PASS.

- [ ] **Step 3: Add failing validation tests for hinted scene IDs**

Pin:

- valid choice ID accepted;
- valid response-build ID accepted;
- duplicate ID rejected;
- unknown ID rejected;
- message ID rejected;
- ending ID rejected.

Expected: FAIL until `isKnownProgress()` knows the new field.

- [ ] **Step 4: Extend `isKnownProgress()` only for hint facts**

At the top-level shape check require:

```ts
if (!Array.isArray(progress.hintedSceneIds)) return false;
```

Then validate:

```ts
const hinted = new Set<string>();
for (const sceneId of progress.hintedSceneIds) {
  if (typeof sceneId !== 'string' || hinted.has(sceneId)) return false;
  const scene = scenes.get(sceneId);
  if (!scene || (scene.kind !== 'choice' && scene.kind !== 'response-build')) return false;
  hinted.add(sceneId);
}
```

Do not add phrase/source validation; no missed-phrase data is stored.

Run:

```bash
bun --filter @vela/mobile test -- storage.test.ts
```

Expected: PASS, including all pre-existing invalid-history/current/completed tests.

- [ ] **Step 5: Pin the HPA-300 incorrect-history recovery contract**

In a storage test, seed valid current-version JSON with an incorrect choice history entry and no `hintedSceneIds`. Load it, then assert the loaded object keeps that history and has `hintedSceneIds: []`:

```ts
expect(restored?.history).toEqual(oldHistory);
expect(restored?.hintedSceneIds).toEqual([]);
```

The pure selector behavior for that history is already pinned in Task 1; this test ensures storage does not erase the fact needed to derive recap.

Run `storage.test.ts` and expect PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/storage.ts \
  apps/vela-mobile/src/features/mystery-messenger/storage.test.ts
git commit -m "feat(mobile): persist mystery hint use"
```

---

### Task 3: Persist hint use through composers and the existing controller transition seam

**Files:**
- Modify: `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.ts`
- Test: `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.test.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.vue`
- Test: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryResponseBuildComposer.vue`
- Test: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryResponseBuildComposer.test.ts`

**Interfaces:**
- Consumes `markMysteryHintUsed()` and `selectMysteryMissedPhraseRecap()`.
- Produces controller members:

```ts
missedPhraseRecap: ComputedRef<readonly MysteryMissedPhraseRecapItem[]>;
markHintUsed(expectedSceneId: string): void;
```

- Both composers emit `hintUsed` once per mounted scene when the hint first becomes visible.

- [ ] **Step 1: Add failing controller tests for hint persistence and derived recap**

After loading a usable run at an interaction:

```ts
controller.markHintUsed(sceneId);
expect(storage.save).toHaveBeenLastCalledWith(
  userId,
  expect.objectContaining({ hintedSceneIds: [sceneId] }),
);
```

Call `markHintUsed(sceneId)` again and assert the save call count does not increase.

Complete the interaction correctly and assert:

```ts
expect(controller.missedPhraseRecap.value.map((item) => item.phraseId)).toEqual(
  expectedTargetPhraseIds,
);
```

Also load an incorrect non-hinted history fixture and assert the computed recap derives it without any stored missed-phrase state.

Expected: FAIL because the controller surface is missing.

- [ ] **Step 2: Add the controller computed and transition method**

Import the Task-1 types/functions and add:

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

and return `missedPhraseRecap` with the existing controller fields.

Do not call storage directly; the existing `transition()` function must remain the only write path.

Run `useMysteryMessenger.test.ts` and expect PASS.

- [ ] **Step 3: Add controller resume and restart regressions**

Persist a run containing `hintedSceneIds`, recreate the controller, and assert the same hint-assisted recap is derived after load.

Then call `restart()` and assert:

```ts
expect(controller.progress.value?.history).toEqual([]);
expect(controller.progress.value?.hintedSceneIds).toEqual([]);
expect(controller.missedPhraseRecap.value).toEqual([]);
```

Run the focused controller tests and expect PASS.

- [ ] **Step 4: Add failing one-shot hint event tests to both composers**

For each component:

1. click Hint once;
2. assert hint copy is visible;
3. assert `wrapper.emitted('hintUsed')` has length 1;
4. click Hint to hide;
5. click Hint to re-show;
6. assert `hintUsed` still has length 1;
7. exercise the existing choose/submit interaction and assert its original event still fires unchanged.

Expected: FAIL because composers currently only toggle `showHint`.

- [ ] **Step 5: Replace inline hint toggles with a one-shot helper**

In each composer, widen `defineEmits` with `hintUsed: []` and add:

```ts
const showHint = ref(false);
const hintUsedEmitted = ref(false);

function toggleHint(): void {
  showHint.value = !showHint.value;
  if (!showHint.value || hintUsedEmitted.value) return;
  hintUsedEmitted.value = true;
  emit('hintUsed');
}
```

Change the Hint button from:

```vue
@click="showHint = !showHint"
```

to:

```vue
@click="toggleHint"
```

Do not persist `showHint` or add a prop for expanded state.

Run both composer test files and expect PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.ts \
  apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.test.ts \
  apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.vue \
  apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts \
  apps/vela-mobile/src/features/mystery-messenger/components/MysteryResponseBuildComposer.vue \
  apps/vela-mobile/src/features/mystery-messenger/components/MysteryResponseBuildComposer.test.ts
git commit -m "feat(mobile): record mystery hint use"
```

---

### Task 4: Add the read-only ending recap component

**Files:**
- Create: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryMissedPhraseRecap.vue`
- Create: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryMissedPhraseRecap.test.ts`

**Interfaces:**
- Consumes `readonly MysteryMissedPhraseRecapItem[]`.
- Emits `replay: [phraseId: string]` only.
- Owns no progress, audio, storage, score, or Review-flow state.

- [ ] **Step 1: Write failing empty-state and row-rendering tests**

Mount with no items and assert:

```ts
expect(wrapper.get('[data-testid="mystery-recap-empty"]').text()).toContain(
  'No missed phrases this run.',
);
```

Mount with two items and assert both phrase texts, readings, meanings, and `From: ${sourcePrompt}` lines render. Assert no empty-state element exists.

Expected: FAIL because the component does not exist.

- [ ] **Step 2: Implement the minimal component**

Create a feature-local component shaped as:

```vue
<template>
  <section class="column q-gutter-sm" aria-labelledby="mystery-recap-title">
    <h2 id="mystery-recap-title" class="text-subtitle1 q-my-none">Review missed phrases</h2>

    <p v-if="items.length === 0" data-testid="mystery-recap-empty" class="q-my-none">
      No missed phrases this run.
    </p>

    <article
      v-for="item in items"
      v-else
      :key="item.phraseId"
      :data-testid="`mystery-recap-row-${item.phraseId}`"
      class="column q-gutter-xs"
    >
      <strong lang="ja">{{ item.text }}</strong>
      <span lang="ja">{{ item.reading }}</span>
      <span>{{ item.meaning }}</span>
      <span class="text-caption">From: {{ item.sourcePrompt }}</span>
      <q-btn
        class="mobile-touch-target"
        outline
        label="Replay"
        :data-testid="`mystery-recap-replay-${item.phraseId}`"
        @click="emit('replay', item.phraseId)"
      />
    </article>
  </section>
</template>

<script setup lang="ts">
import type { MysteryMissedPhraseRecapItem } from '../model';

defineProps<{ items: readonly MysteryMissedPhraseRecapItem[] }>();
const emit = defineEmits<{ replay: [phraseId: string] }>();
</script>
```

If Vue rejects `v-else` on the `v-for` article during implementation, use a surrounding `<template v-else>` and keep the rendered semantics/test IDs identical; do not introduce additional state.

Run the component test and expect PASS.

- [ ] **Step 3: Add replay-event and non-CTA assertions**

Click one row's Replay button and assert:

```ts
expect(wrapper.emitted('replay')).toEqual([[item.phraseId]]);
```

Assert the component contains no Review navigation button, score, percentage, or save action by checking only the expected buttons exist.

Run the component test and expect PASS.

- [ ] **Step 4: Commit Task 4**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/components/MysteryMissedPhraseRecap.vue \
  apps/vela-mobile/src/features/mystery-messenger/components/MysteryMissedPhraseRecap.test.ts
git commit -m "feat(mobile): add mystery recap component"
```

---

### Task 5: Generalize the existing audio state machine from scene ID to TTS playback ID

**Files:**
- Modify: `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.ts`
- Test: `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.test.ts`

**Interfaces:**
- Retains `play(scene: MysteryScene): Promise<void>`.
- Adds `playClip(audio: MysterySceneAudio): Promise<void>`.
- Renames non-idle state payload from `sceneId` to `playbackId`.
- Uses `audio.ttsId` as the playback ID for both scene and recap clips.

- [ ] **Step 1: Update tests first to describe the generalized state identity**

For existing scene-play tests, replace expectations such as:

```ts
{ kind: 'preparing', sceneId: scene.id }
```

with:

```ts
{ kind: 'preparing', playbackId: selectMysterySceneAudio(scene)!.ttsId }
```

Make the same change for `ready`, `playing`, and `error` state assertions.

Do not change the behavioral assertions around TTS call counts, abort signals, handle stop reasons, or invalidation.

Run:

```bash
bun --filter @vela/mobile test -- useMysteryAudio.test.ts
```

Expected: FAIL because the implementation still exposes `sceneId`.

- [ ] **Step 2: Rename the state payload and internal error/play helpers without changing behavior**

Change the state union to:

```ts
export type MysteryAudioState =
  | { kind: 'idle' }
  | { kind: 'preparing'; playbackId: string }
  | { kind: 'ready'; playbackId: string; audioUrl: string }
  | { kind: 'playing'; playbackId: string }
  | { kind: 'error'; playbackId: string; message: string };
```

Refactor private helpers so they receive `playbackId: string` and `audio: MysterySceneAudio` rather than `scene: MysteryScene`. Rename the current private `playAudio(...)` to a non-public name such as:

```ts
async function startPreparedPlayback(
  playbackId: string,
  audio: MysterySceneAudio,
  audioUrl: string,
  userId: string,
  generation: number,
): Promise<void>
```

`handlePlaybackError()` should likewise set `playbackId` and continue invalidating `audio.ttsId` for `media_unavailable`.

Run existing audio tests and expect the state-shape subset to PASS before adding the new public clip path.

- [ ] **Step 3: Extract the full prepare/retry/switch path to one resolved-audio function**

Move the current body of `play(scene)` after `selectMysterySceneAudio(scene)` into:

```ts
async function playResolvedAudio(audio: MysterySceneAudio): Promise<void> {
  if (disposed) return;
  const playbackId = audio.ttsId;
  if (state.value.kind === 'preparing' && state.value.playbackId === playbackId) return;

  const status = sessionStatus.value;
  if (status.kind !== 'usable') return;

  const current = state.value;
  if (
    current.kind === 'ready' &&
    current.playbackId === playbackId &&
    preparedUserId === status.userId
  ) {
    await startPreparedPlayback(
      playbackId,
      audio,
      current.audioUrl,
      status.userId,
      operationGeneration,
    );
    return;
  }

  operationGeneration += 1;
  requestController?.abort();
  requestController = null;
  const previousHandle = activeHandle;
  activeHandle = null;
  previousHandle?.stop('dispose');
  preparedUserId = null;
  state.value = { kind: 'preparing', playbackId };

  const generation = operationGeneration;
  const controller = new AbortController();
  requestController = controller;
  try {
    const pronunciation = await options.ttsService.preparePronunciation(
      { userId: status.userId, vocabularyId: audio.ttsId, text: audio.text },
      { signal: controller.signal },
    );
    if (!isCurrent(generation)) return;
    preparedUserId = status.userId;
    state.value = { kind: 'ready', playbackId, audioUrl: pronunciation.audioUrl };
    await startPreparedPlayback(
      playbackId,
      audio,
      pronunciation.audioUrl,
      status.userId,
      generation,
    );
  } catch (error) {
    if (!isCurrent(generation)) return;
    preparedUserId = null;
    state.value = { kind: 'error', playbackId, message: errorMessage(error) };
  } finally {
    if (requestController === controller) requestController = null;
  }
}
```

Then keep scene behavior as:

```ts
async function play(scene: MysteryScene): Promise<void> {
  const audio = selectMysterySceneAudio(scene);
  if (!audio) return;
  await playResolvedAudio(audio);
}
```

Run all existing `useMysteryAudio.test.ts` tests and expect PASS before adding recap-specific assertions. This is the gate that proves the refactor did not break scene playback.

- [ ] **Step 4: Add failing `playClip()` tests using a non-scene audio object**

Create:

```ts
const clip: MysterySceneAudio = {
  ttsId: 'mystery-message-tomorrow-v1-v2-recap-tomorrow-seven',
  text: 'あしたの朝7時',
};
```

Call `controller.playClip(clip)` and assert the existing TTS service receives:

```ts
{
  userId,
  vocabularyId: clip.ttsId,
  text: clip.text,
}
```

and state uses `playbackId: clip.ttsId`.

Expected: FAIL because the public method does not exist.

- [ ] **Step 5: Add `playClip()` as a thin resolved-audio entry point**

Widen the controller type:

```ts
export type MysteryAudioController = {
  state: Readonly<Ref<MysteryAudioState>>;
  sessionStatus: ComputedRef<MobileFeatureSessionStatus>;
  play(scene: MysteryScene): Promise<void>;
  playClip(audio: MysterySceneAudio): Promise<void>;
  dispose(): void;
};
```

Implement:

```ts
async function playClip(audio: MysterySceneAudio): Promise<void> {
  await playResolvedAudio(audio);
}
```

and return it from the controller.

Run the focused clip test and expect PASS.

- [ ] **Step 6: Pin gesture-required retry for `playClip()`**

Configure the first audio handle to reject with `new MobileAudioError('gesture_required')`. After the first `playClip(clip)` settles, assert:

```ts
expect(controller.state.value).toEqual({
  kind: 'ready',
  playbackId: clip.ttsId,
  audioUrl: PREPARED.audioUrl,
});
expect(tts.preparePronunciation).toHaveBeenCalledTimes(1);
```

Configure the next handle to finish successfully, call `playClip(clip)` again, and assert TTS is still called once and playback uses the same URL.

Run focused tests and expect PASS.

- [ ] **Step 7: Pin switching between scene replay and recap replay in both directions**

Use a deferred `preparePronunciation()` for a scene audio clip. Start `controller.play(scene)` and verify state is preparing for the scene audio's `ttsId`. Before it resolves, call `controller.playClip(recapClip)`.

Assert:

- the first request signal is aborted;
- the second TTS request uses `recapClip.ttsId`/text;
- resolving the stale first request does not replace state or auto-play;
- state/playback belongs to the recap clip.

Repeat with recap preparing first and `play(scene)` second. These regressions replace the old “different scene switches” assumption with “different playback ID switches.”

Run the focused tests and expect PASS.

- [ ] **Step 8: Re-run cancellation, invalidation, and disposal cases against the generalized identity**

Ensure existing tests still explicitly cover:

- same playback ID duplicate preparing tap -> no second TTS request;
- active playback replaced by a different playback ID -> old handle receives `stop('dispose')`;
- `media_unavailable` -> `invalidatePronunciation(userId, audio.ttsId)` and error/ready state does not retain a stale URL;
- auth user change -> request/handle canceled and state idle;
- lifecycle background -> `interruptActive('background')`, request canceled, state idle;
- `dispose()` -> request/handle canceled, audio player disposed, state idle.

Run:

```bash
bun --filter @vela/mobile test -- useMysteryAudio.test.ts
```

Expected: PASS for the complete file.

- [ ] **Step 9: Commit Task 5**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.ts \
  apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.test.ts
git commit -m "feat(mobile): replay mystery audio clips"
```

---

### Task 6: Wire hint persistence, recap rendering, and read-only phrase replay into the page

**Files:**
- Modify: `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue`
- Test: `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts`

**Interfaces:**
- Consumes `messenger.markHintUsed()` and `messenger.missedPhraseRecap`.
- Consumes `selectMysteryPhraseAudio()` and `audio.playClip()`.
- Renders `MysteryMissedPhraseRecap` only for the ending scene.

- [ ] **Step 1: Add failing page tests for composer hint wiring**

Mount a choice scene, click its Hint button, and assert the injected/spy storage receives progress whose `hintedSceneIds` contains that choice scene.

Repeat for a response-build scene.

Click hide/re-show and assert model/controller idempotency prevents a second persisted change for the same scene even if the component later remounts and emits again.

Expected: FAIL because the page does not listen for `hintUsed`.

- [ ] **Step 2: Wire both composer events to one page handler**

Add:

```ts
function handleHintUsed(): void {
  const scene = messenger.currentScene.value;
  if (scene?.kind !== 'choice' && scene?.kind !== 'response-build') return;
  messenger.markHintUsed(scene.id);
}
```

Update both components:

```vue
<MysteryChoiceComposer
  ...
  @choose="handleChoose"
  @hint-used="handleHintUsed"
/>

<MysteryResponseBuildComposer
  ...
  @submit="handleResponseSubmit"
  @hint-used="handleHintUsed"
/>
```

Run the page hint tests and expect PASS.

- [ ] **Step 3: Add failing ending recap integration tests**

For an ending run with empty derived recap, assert `mystery-recap-empty` renders and Restart still exists.

For ending runs with one and multiple qualifying history interactions, assert the expected recap rows render once with source prompts.

For a non-ending run, assert no `mystery-recap-title`/row/empty element renders.

Expected: FAIL because the recap component is not wired.

- [ ] **Step 4: Render recap and Restart together on the ending branch**

Import `MysteryMissedPhraseRecap` and replace the ending-only Restart button branch with a wrapper:

```vue
<div v-else-if="currentEnding" class="column q-gutter-md">
  <MysteryMissedPhraseRecap
    :items="messenger.missedPhraseRecap.value"
    @replay="handlePhraseReplay"
  />
  <q-btn
    data-testid="mystery-restart"
    class="mobile-touch-target full-width"
    outline
    label="Restart"
    :disable="transitionsDisabled"
    @click="handleRestart"
  />
</div>
```

Leave transcript and existing page-level audio status/error surfaces in place.

Run ending rendering tests and expect PASS except replay, which is added next.

- [ ] **Step 5: Add failing page replay test that proves no progress mutation**

At an ending with one recap row:

1. capture `const progressBefore = messenger.progress.value` through the test's controller/options seam;
2. capture the storage save call count;
3. click the row Replay button;
4. assert TTS receives the generated `selectMysteryPhraseAudio(chapter, phraseId)` ID/text;
5. assert progress is the same value/reference after replay;
6. assert storage save call count is unchanged.

Also assert the existing audio status element reflects preparing/ready/playing/error as the mocked audio path moves.

Expected: FAIL until phrase replay is wired.

- [ ] **Step 6: Resolve phrase audio in the page and call `playClip()`**

Import `selectMysteryPhraseAudio` and add:

```ts
function handlePhraseReplay(phraseId: string): void {
  const clip = selectMysteryPhraseAudio(chapter, phraseId);
  if (!clip) return;
  void audio.playClip(clip);
}
```

Do not construct TTS IDs in the page and do not cast the phrase into `MysteryScene`.

Run `MysteryMessengerPage.test.ts` and expect PASS.

- [ ] **Step 7: Update any page/audio state fixture typing after the `playbackId` rename**

Search the page tests for `sceneId` assertions against `MysteryAudioState`. Replace only audio-state identity expectations with `playbackId: expectedAudio.ttsId`; story scene IDs and transcript test IDs remain unchanged.

Run the page test file and expect PASS.

- [ ] **Step 8: Commit Task 6**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue \
  apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts
git commit -m "feat(mobile): show mystery missed-phrase recap"
```

---

### Task 7: Close type fixtures, full automated gates, and Simulator smoke acceptance

**Files:**
- Modify only if required by compiler/test fallout from the intentional `MysteryProgress.hintedSceneIds` and `MysteryAudioState.playbackId` contract changes.
- Do not broaden scope into unrelated refactors.

**Interfaces:**
- No new product interfaces.
- Produces verification evidence for HPA-301; HPA-302 still owns physical-device release acceptance.

- [ ] **Step 1: Run mobile typecheck and fix only intentional fixture fallout**

Run:

```bash
bun --filter @vela/mobile typecheck
```

Expected first-pass failures, if any, should be limited to test/fixture objects manually constructing `MysteryProgress` without:

```ts
hintedSceneIds: []
```

or audio state assertions still using `sceneId` instead of `playbackId`.

Update those exact fixtures. Do not make `hintedSceneIds` optional in the runtime type merely to silence fixtures.

Re-run until PASS.

- [ ] **Step 2: Run focused feature tests together**

Run:

```bash
bun --filter @vela/mobile test -- \
  model.test.ts \
  storage.test.ts \
  useMysteryMessenger.test.ts \
  useMysteryAudio.test.ts \
  MysteryChoiceComposer.test.ts \
  MysteryResponseBuildComposer.test.ts \
  MysteryMissedPhraseRecap.test.ts \
  MysteryMessengerPage.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run the repository mobile coverage gate**

Run:

```bash
bun --filter @vela/mobile test:coverage
```

Expected: PASS and Codecov patch coverage at or above the repository-required threshold after CI uploads the report.

- [ ] **Step 4: Run lint, typecheck, and production build**

Run the mobile package's existing scripts:

```bash
bun --filter @vela/mobile lint
bun --filter @vela/mobile typecheck
bun --filter @vela/mobile build
```

Expected: all PASS.

- [ ] **Step 5: Simulator smoke — clean run**

Run the existing iOS Simulator workflow for `apps/vela-mobile`, sign in through the existing development flow, launch Mystery Messenger, and complete all assessed interactions correctly without opening a Hint.

At the ending verify:

- `No missed phrases this run.` renders;
- Restart remains visible and usable;
- no Review CTA/score appears; and
- relaunch/re-entry preserves the completed run and same empty recap.

Record the Simulator model/iOS version and result in the PR description or verification comment.

- [ ] **Step 6: Simulator smoke — incorrect + hint-assisted run and replay**

Restart, then complete at least:

- one interaction incorrectly without a hint; and
- one different interaction correctly after opening its Hint.

At the ending verify:

- each affected target phrase appears once;
- repeated target phrases, if exercised, use first qualifying source provenance;
- source prompt/readings/meanings are correct;
- Replay uses the existing audio status/error surface and produces the phrase audio;
- replaying does not change the recap, completion, or trigger any story progress save; and
- force-close/relaunch preserves the same derived recap.

Record the result in the PR.

- [ ] **Step 7: Self-review the implementation against the two named risks**

Before marking HPA-301 ready for review, inspect the diff and confirm:

1. there is no `missedPhrases` field/write path/storage validation anywhere; `selectMysteryMissedPhraseRecap()` derives only from `history`, `hintedSceneIds`, and chapter content;
2. HPA-300 missing-hint compatibility defaults only `hintedSceneIds` and preserves old incorrect history;
3. `useMysteryAudio` uses `audio.ttsId` as generic `playbackId` for both `play(scene)` and `playClip(audio)`;
4. existing gesture retry, switch cancellation, invalidation, auth/lifecycle cancellation, and dispose tests still execute rather than being deleted or weakened;
5. recap replay never calls a messenger transition or storage API.

Fix any violation on this same PR.

- [ ] **Step 8: Commit verification-only fallout if Step 1 required changes**

If typecheck required fixture updates, commit only those files:

```bash
git add <only-the-fixture-files-changed-in-step-1>
git commit -m "test(mobile): align mystery recap fixtures"
```

If Step 1 required no file changes, do not create an empty verification commit.

---

## Completion Gate

HPA-301 is implementation-complete on this PR when all of the following are true:

- incorrect interactions derive target phrases from persisted history;
- correct interactions without hints derive no recap row;
- correct interactions after persisted hint use derive target phrases;
- phrase IDs deduplicate first-wins across history;
- HPA-300 snapshots with incorrect history and no hint field recover those incorrect recap rows;
- historic pre-HPA-301 correct-after-hint behavior is explicitly treated as unknowable rather than fabricated;
- ending UI handles zero, one, and multiple rows and keeps Restart;
- recap replay uses `selectMysteryPhraseAudio()` + `playClip()` and does not mutate progress;
- full audio retry/switch/cancel/invalidate regressions remain green;
- coverage, lint, typecheck, and build pass; and
- Simulator clean + missed/hint-assisted runs pass.

Physical iPhone/release acceptance remains HPA-302.
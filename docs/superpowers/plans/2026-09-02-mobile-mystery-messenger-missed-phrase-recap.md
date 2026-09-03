# Mobile Mystery Messenger Missed-Phrase Recap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a run-local Mystery Messenger missed-phrase recap derived from persisted interaction history plus the one new fact history cannot recover: hint use.

**Architecture:** Keep `history` as the single source of truth for completed interaction outcomes. Persist only `hintedSceneIds`, extract response grading so transcript and recap share one rule, derive recap rows on demand from history plus chapter content, render one ending-only feature-local recap, and generalize the existing audio controller from scene identity to `audio.ttsId` so recap clips reuse the same retry/cancellation state machine.

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
- Produces `MysteryProgress.hintedSceneIds: readonly string[]`.
- Produces `markMysteryHintUsed(chapter, progress, expectedSceneId): MysteryProgress`.
- Produces `gradeMysteryResponse(scene, selectedTokenIds): 'correct' | 'incorrect'`.
- Produces `MysteryMissedPhraseRecapItem` and `selectMysteryMissedPhraseRecap(chapter, progress)`.
- Produces `selectMysteryPhraseAudio(chapter, phraseId): MysterySceneAudio | null`.
- Does not add any missed-phrase write path to `chooseMysteryOption()` or `submitMysteryResponse()`.

- [ ] **Step 1: Add failing fresh/restart hint-state assertions**

Update the existing creation and restart expectations:

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

- [ ] **Step 2: Add `hintedSceneIds` to fresh progress**

Extend `MysteryProgress`:

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

Initialize it in `createMysteryProgress()`:

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

Run `model.test.ts` and expect the creation/restart assertions to PASS.

- [ ] **Step 3: Write failing pure hint-transition tests**

Pin interaction-only, stale-ID, and idempotent behavior:

```ts
const hinted = markMysteryHintUsed(chapter, progressAtChoice, progressAtChoice.currentSceneId);
expect(hinted.hintedSceneIds).toEqual([progressAtChoice.currentSceneId]);
expect(markMysteryHintUsed(chapter, hinted, hinted.currentSceneId)).toBe(hinted);
expect(markMysteryHintUsed(chapter, progressAtChoice, 'stale-scene')).toBe(progressAtChoice);
```

Also assert progress at a message or ending returns the same object.

Expected: FAIL because the function is missing.

- [ ] **Step 4: Implement the immutable hint transition**

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

Run `model.test.ts` and expect the new transition tests to PASS.

- [ ] **Step 5: Write failing response-grading extraction tests**

Use a response-build scene with valid token IDs:

```ts
expect(gradeMysteryResponse(scene, scene.correctTokenIds)).toBe('correct');
expect(gradeMysteryResponse(scene, scene.alternateAnswerTokenIds![0]!)).toBe('correct');
expect(gradeMysteryResponse(scene, [...scene.correctTokenIds].reverse())).toBe('incorrect');
```

Retain the existing invalid-token regression for `mystery_response_token_not_found`.

Expected: FAIL because correctness still lives inside transcript projection.

- [ ] **Step 6: Extract the existing visible-text grader and reuse it in transcript projection**

Add:

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

In `selectMysteryTranscript()`, replace the inline result calculation with:

```ts
const result = gradeMysteryResponse(scene, entry.selectedTokenIds);
```

Continue using `resolveMysteryResponseTexts()` for `selectedText` and `correctText` so display behavior stays unchanged.

Run `model.test.ts` and expect PASS.

- [ ] **Step 7: Write failing history-derived recap tests**

Pin:

```ts
expect(selectMysteryMissedPhraseRecap(chapter, cleanProgress)).toEqual([]);
expect(
  selectMysteryMissedPhraseRecap(chapter, incorrectChoiceProgress).map((item) => item.phraseId),
).toEqual(['tomorrow-seven']);
expect(
  selectMysteryMissedPhraseRecap(chapter, correctButHintedProgress).map((item) => item.phraseId),
).toEqual(['tomorrow-seven']);
```

Also test incorrect response-build, canonical/alternate correct response without hint, repeated target phrase first-wins provenance, phrase metadata/source prompt projection, and a normalized HPA-300-style value containing incorrect history plus `hintedSceneIds: []`.

Expected: FAIL because the selector is missing.

- [ ] **Step 8: Implement the recap selector as one ordered history walk**

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

In `selectMysteryMissedPhraseRecap()`, create:

```ts
const hinted = new Set(progress.hintedSceneIds);
const seenPhraseIds = new Set<string>();
const items: MysteryMissedPhraseRecapItem[] = [];
```

Walk `progress.history` in order. Ignore messages. A choice qualifies when its selected option is incorrect or its scene ID is hinted. A response-build qualifies when `gradeMysteryResponse(scene, entry.selectedTokenIds)` is incorrect or its scene ID is hinted. For every qualifying `scene.targetPhraseIds`, skip already-seen IDs; otherwise resolve the target phrase from `chapter.targetPhrases` and append:

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

Return `items`. Do not mutate progress and do not add a stored missed-phrase field.

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

- [ ] **Step 1: Add failing tests for missing versus malformed hint state**

Store valid current-version JSON with the hint field omitted:

```ts
const restored = storage.load(userId, chapter);
expect(restored).not.toBeNull();
expect(restored?.hintedSceneIds).toEqual([]);
```

Then store each malformed value and expect reset:

```ts
for (const hintedSceneIds of [null, 'scene-03', {}, 1]) {
  backend.set(key, JSON.stringify({ ...validProgress, hintedSceneIds }));
  expect(storage.load(userId, chapter)).toBeNull();
}
```

Expected: FAIL until missing is distinguished from malformed.

- [ ] **Step 2: Default only a missing `hintedSceneIds` field before existing validation**

After `JSON.parse`, require an object and resolve:

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

Pass the candidate through the existing `isKnownProgress()` boundary. Do not save merely because a historic object was normalized in memory.

Run the new tests and expect PASS.

- [ ] **Step 3: Add failing validation tests for hinted scene IDs**

Pin a valid choice ID, valid response-build ID, duplicate ID, unknown ID, message ID, and ending ID.

Expected: FAIL until `isKnownProgress()` validates the new fact.

- [ ] **Step 4: Extend `isKnownProgress()` only for hint facts**

Require the array:

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

Preserve every existing history/current/completed check. Do not add phrase/source validation because recap rows are not persisted.

Run:

```bash
bun --filter @vela/mobile test -- storage.test.ts
```

Expected: PASS.

- [ ] **Step 5: Pin old incorrect history survives the compatibility default**

Seed a valid HPA-300-shaped object containing incorrect choice history and no hint field. After load:

```ts
expect(restored?.history).toEqual(oldHistory);
expect(restored?.hintedSceneIds).toEqual([]);
```

This joins Task 1's selector test to prove old incorrect runs do not silently become clean.

Run `storage.test.ts` and expect PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/storage.ts \
  apps/vela-mobile/src/features/mystery-messenger/storage.test.ts
git commit -m "feat(mobile): persist mystery hint use"
```

---

### Task 3: Persist hint use through the existing controller and composers

**Files:**
- Modify: `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.ts`
- Test: `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.test.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.vue`
- Test: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryResponseBuildComposer.vue`
- Test: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryResponseBuildComposer.test.ts`

**Interfaces:**
- Produces controller `missedPhraseRecap: ComputedRef<readonly MysteryMissedPhraseRecapItem[]>`.
- Produces controller `markHintUsed(expectedSceneId: string): void`.
- Both composers emit `hintUsed` once per mounted scene when the hint first becomes visible.

- [ ] **Step 1: Add failing controller persistence/recap tests**

At an active interaction:

```ts
controller.markHintUsed(sceneId);
expect(storage.save).toHaveBeenLastCalledWith(
  userId,
  expect.objectContaining({ hintedSceneIds: [sceneId] }),
);
```

Call it again and assert the save call count does not increase. Complete the interaction correctly and assert `controller.missedPhraseRecap.value` contains its target phrase IDs. Also load incorrect non-hinted history and assert recap derives from history without stored missed-phrase data.

Expected: FAIL because the controller surface is missing.

- [ ] **Step 2: Add the controller computed and transition method**

Add:

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

Return `missedPhraseRecap` with the existing controller fields. Do not call storage directly.

Run `useMysteryMessenger.test.ts` and expect PASS.

- [ ] **Step 3: Add controller resume/restart regressions**

Persist a hinted run, recreate the controller, and assert the same hint-assisted recap is derived. Then call restart and assert:

```ts
expect(controller.progress.value?.history).toEqual([]);
expect(controller.progress.value?.hintedSceneIds).toEqual([]);
expect(controller.missedPhraseRecap.value).toEqual([]);
```

Run the controller test file and expect PASS.

- [ ] **Step 4: Add failing first-reveal-only tests to both composers**

For each composer: click Hint once and expect one `hintUsed` emission; hide and re-show and keep emission count at one; then exercise the existing choose/submit action and verify its original event is unchanged.

Expected: FAIL because the composers currently only toggle `showHint`.

- [ ] **Step 5: Replace inline hint toggles with a one-shot helper**

In each composer:

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

Widen `defineEmits` with `hintUsed: []` and change the Hint button to:

```vue
@click="toggleHint"
```

Do not persist visual expansion state.

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

- [ ] **Step 1: Write failing empty and multi-row rendering tests**

Mount with no items and assert:

```ts
expect(wrapper.get('[data-testid="mystery-recap-empty"]').text()).toContain(
  'No missed phrases this run.',
);
```

Mount with two items and assert both phrase texts, readings, meanings, and `From: ${sourcePrompt}` lines render once.

Expected: FAIL because the component does not exist.

- [ ] **Step 2: Implement the minimal component**

Create:

```vue
<template>
  <section class="column q-gutter-sm" aria-labelledby="mystery-recap-title">
    <h2 id="mystery-recap-title" class="text-subtitle1 q-my-none">Review missed phrases</h2>

    <p v-if="items.length === 0" data-testid="mystery-recap-empty" class="q-my-none">
      No missed phrases this run.
    </p>

    <template v-else>
      <article
        v-for="item in items"
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
    </template>
  </section>
</template>

<script setup lang="ts">
import type { MysteryMissedPhraseRecapItem } from '../model';

defineProps<{ items: readonly MysteryMissedPhraseRecapItem[] }>();
const emit = defineEmits<{ replay: [phraseId: string] }>();
</script>
```

Run the component test and expect PASS.

- [ ] **Step 3: Add replay-event and no-CTA assertions**

Click Replay and assert:

```ts
expect(wrapper.emitted('replay')).toEqual([[item.phraseId]]);
```

Assert the component has no Review navigation action, score, percentage, or save button.

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

- [ ] **Step 1: Change test expectations first from scene identity to playback identity**

For every existing audio-state assertion, replace `sceneId: scene.id` with the resolved scene audio identity:

```ts
const sceneAudio = selectMysterySceneAudio(scene)!;
expect(controller.state.value).toEqual({
  kind: 'preparing',
  playbackId: sceneAudio.ttsId,
});
```

Apply the same identity change to `ready`, `playing`, and `error` expectations. Do not weaken TTS-call, abort-signal, handle-stop, or invalidation assertions.

Run:

```bash
bun --filter @vela/mobile test -- useMysteryAudio.test.ts
```

Expected: FAIL because implementation state still uses `sceneId`.

- [ ] **Step 2: Rename the state payload and private prepared-play helper**

Change the state union:

```ts
export type MysteryAudioState =
  | { kind: 'idle' }
  | { kind: 'preparing'; playbackId: string }
  | { kind: 'ready'; playbackId: string; audioUrl: string }
  | { kind: 'playing'; playbackId: string }
  | { kind: 'error'; playbackId: string; message: string };
```

Rename the current private `playAudio()` to:

```ts
async function startPreparedPlayback(
  playbackId: string,
  audio: MysterySceneAudio,
  audioUrl: string,
  userId: string,
  generation: number,
): Promise<void>
```

Make `handlePlaybackError()` accept `playbackId` instead of `MysteryScene` and continue invalidating `audio.ttsId` on `media_unavailable`.

Run the state-shape tests and keep behavior otherwise unchanged.

- [ ] **Step 3: Move the current prepare/retry/switch body into one resolved-audio function**

Add:

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

Keep `play(scene)` as:

```ts
async function play(scene: MysteryScene): Promise<void> {
  const audio = selectMysterySceneAudio(scene);
  if (!audio) return;
  await playResolvedAudio(audio);
}
```

Run all pre-existing audio tests and expect PASS before adding the clip API. This is the regression gate for existing scene replay.

- [ ] **Step 4: Add a failing non-scene `playClip()` test**

Use:

```ts
const clip: MysterySceneAudio = {
  ttsId: 'mystery-message-tomorrow-v1-v2-recap-tomorrow-seven',
  text: 'あしたの朝7時',
};
```

Call `controller.playClip(clip)` and assert TTS receives:

```ts
{
  userId,
  vocabularyId: clip.ttsId,
  text: clip.text,
}
```

and state uses `playbackId: clip.ttsId`.

Expected: FAIL because `playClip()` is missing.

- [ ] **Step 5: Add `playClip()` as the second public entry into `playResolvedAudio()`**

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

Return `playClip` from the controller and run the focused test to PASS.

- [ ] **Step 6: Pin gesture-required prepared retry for `playClip()`**

Make first playback reject with `new MobileAudioError('gesture_required')`. Assert:

```ts
expect(controller.state.value).toEqual({
  kind: 'ready',
  playbackId: clip.ttsId,
  audioUrl: PREPARED.audioUrl,
});
expect(tts.preparePronunciation).toHaveBeenCalledTimes(1);
```

On the second explicit `playClip(clip)`, return a successful handle and assert TTS is still called once and the prepared URL is reused.

- [ ] **Step 7: Pin switching between scene and recap playback in both directions**

Start a deferred `controller.play(scene)`, then call `controller.playClip(recapClip)` before preparation resolves. Assert the first request signal is aborted, the second request uses recap identity/text, and late resolution of the stale first request cannot replace state or auto-play.

Repeat with a deferred recap clip first and `play(scene)` second. Both tests must assert the final `playbackId` belongs to the second request.

- [ ] **Step 8: Re-run all cancellation/invalidation regressions**

Keep explicit tests for same-ID preparing suppression, active playback replacement, `media_unavailable` invalidation, auth user change, background interruption, and `dispose()`.

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

### Task 6: Wire hint persistence, ending recap, and read-only phrase replay into the page

**Files:**
- Modify: `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue`
- Test: `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts`

**Interfaces:**
- Consumes `messenger.markHintUsed()` and `messenger.missedPhraseRecap`.
- Consumes `selectMysteryPhraseAudio()` and `audio.playClip()`.
- Renders `MysteryMissedPhraseRecap` only for the ending scene.

- [ ] **Step 1: Add failing page tests for composer hint wiring**

At a choice scene, click Hint and assert stored progress contains that scene ID in `hintedSceneIds`. Repeat at a response-build scene. Hide/re-show and assert no additional persisted state change for the same scene.

Expected: FAIL because the page does not listen to `hintUsed`.

- [ ] **Step 2: Wire both composers to one page handler**

Add:

```ts
function handleHintUsed(): void {
  const scene = messenger.currentScene.value;
  if (scene?.kind !== 'choice' && scene?.kind !== 'response-build') return;
  messenger.markHintUsed(scene.id);
}
```

Update the existing choice component block to:

```vue
<MysteryChoiceComposer
  v-else-if="currentChoice"
  :key="currentChoice.id"
  :scene="currentChoice"
  :disabled="transitionsDisabled"
  @choose="handleChoose"
  @hint-used="handleHintUsed"
/>
```

Update the response component block to:

```vue
<MysteryResponseBuildComposer
  v-else-if="currentResponseBuild"
  :key="currentResponseBuild.id"
  :scene="currentResponseBuild"
  :disabled="transitionsDisabled"
  @submit="handleResponseSubmit"
  @hint-used="handleHintUsed"
/>
```

Run the page hint tests and expect PASS.

- [ ] **Step 3: Add failing ending recap integration tests**

For an ending run with empty derived recap, assert `mystery-recap-empty` renders and Restart still exists. For ending runs with one and multiple qualifying history interactions, assert expected recap rows/source prompts. For a non-ending run, assert no recap title/row/empty state is rendered.

Expected: FAIL because the recap component is not wired.

- [ ] **Step 4: Render recap and Restart together on the ending branch**

Import `MysteryMissedPhraseRecap` and replace the ending-only Restart button with:

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

Keep the existing transcript and page-level audio status/error elements unchanged.

- [ ] **Step 5: Add failing replay test proving no progress/storage mutation**

At an ending with one recap row, capture the current progress object and storage save call count. Click Replay. Assert TTS receives the `selectMysteryPhraseAudio(chapter, phraseId)` ID/text, progress remains the same object, and storage save count does not increase.

Expected: FAIL until replay is wired.

- [ ] **Step 6: Resolve phrase audio in the model and call `playClip()`**

Add:

```ts
function handlePhraseReplay(phraseId: string): void {
  const clip = selectMysteryPhraseAudio(chapter, phraseId);
  if (!clip) return;
  void audio.playClip(clip);
}
```

Do not construct TTS IDs in the page and do not wrap the phrase in a fake `MysteryScene`.

Run `MysteryMessengerPage.test.ts` and expect PASS.

- [ ] **Step 7: Update page test audio-state expectations after the `playbackId` rename**

Where page tests inspect `MysteryAudioState`, use the selected audio clip's `ttsId` as `playbackId`. Do not change story scene IDs or transcript test IDs.

Run the page test file and expect PASS.

- [ ] **Step 8: Commit Task 6**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue \
  apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts
git commit -m "feat(mobile): show mystery missed-phrase recap"
```

---

### Task 7: Close fixture typing, full automated gates, and Simulator smoke acceptance

**Files:**
- Modify only feature-local test fixtures that manually construct `MysteryProgress` or assert `MysteryAudioState` and were not already updated by Tasks 1–6.
- Do not broaden scope into unrelated refactors.

**Interfaces:**
- No new product interfaces.
- Produces HPA-301 verification evidence; HPA-302 still owns physical-device release acceptance.

- [ ] **Step 1: Run typecheck and fix only intentional contract fallout**

Run:

```bash
bun --filter @vela/mobile typecheck
```

Any fixture manually constructing current `MysteryProgress` must add:

```ts
hintedSceneIds: [],
```

Any remaining audio state assertion must use `playbackId` rather than `sceneId`. Do not make `hintedSceneIds` optional in the runtime type merely to silence tests.

Re-run until PASS.

- [ ] **Step 2: Run focused Mystery Messenger tests together**

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

- [ ] **Step 3: Run coverage, lint, typecheck, and build**

Run:

```bash
bun --filter @vela/mobile test:coverage
bun --filter @vela/mobile lint
bun --filter @vela/mobile typecheck
bun --filter @vela/mobile build
```

Expected: all PASS; CI Codecov patch coverage remains at or above the repository-required threshold.

- [ ] **Step 4: Simulator smoke — clean run**

Use the existing iOS Simulator workflow, sign in through the existing development flow, and complete Mystery Messenger correctly without opening a Hint. At the ending verify `No missed phrases this run.`, Restart remains available, no Review CTA/score exists, and route re-entry/relaunch preserves the same completed run and empty recap.

Record Simulator model, iOS version, and result in the PR.

- [ ] **Step 5: Simulator smoke — incorrect + hint-assisted run and replay**

Restart. Complete one interaction incorrectly without a hint and a different interaction correctly after revealing its Hint. At the ending verify each affected phrase appears once with the expected first qualifying source prompt, Replay produces phrase audio through the existing status/error surface, replay does not change recap/completion or write story progress, and force-close/relaunch preserves the same derived recap.

Record the result in the PR.

- [ ] **Step 6: Review the diff against the two named risks**

Confirm all five conditions before marking HPA-301 ready for review:

1. no `missedPhrases` field, storage validator, or write-time accumulation exists;
2. HPA-300 missing-hint compatibility defaults only `hintedSceneIds` and preserves old incorrect history;
3. `useMysteryAudio` uses `audio.ttsId` as `playbackId` for both `play(scene)` and `playClip(audio)`;
4. gesture retry, switch cancellation, invalidation, auth/lifecycle cancellation, and dispose tests remain present and green;
5. recap replay never calls a messenger transition or storage API.

Fix any violation on this same PR.

- [ ] **Step 7: Commit fixture-only fallout if Step 1 changed files**

If Step 1 changed any uncommitted feature-local fixtures, inspect them first:

```bash
git status --short apps/vela-mobile/src/features/mystery-messenger
```

Then stage only the Mystery Messenger fixture changes and commit:

```bash
git add apps/vela-mobile/src/features/mystery-messenger
git commit -m "test(mobile): align mystery recap fixtures"
```

If there are no Step-1 file changes, do not create an empty commit.

---

## Completion Gate

HPA-301 is implementation-complete on this PR when all of the following are true:

- incorrect interactions derive target phrases from persisted history;
- correct interactions without hints derive no recap row;
- correct interactions after persisted hint use derive target phrases;
- phrase IDs deduplicate first-wins across history;
- HPA-300 snapshots with incorrect history and no hint field recover those incorrect recap rows;
- historic pre-HPA-301 correct-after-hint behavior is treated as unknowable rather than fabricated;
- ending UI handles zero, one, and multiple rows and keeps Restart;
- recap replay uses `selectMysteryPhraseAudio()` + `playClip()` and does not mutate progress;
- full audio retry/switch/cancel/invalidate regressions remain green;
- coverage, lint, typecheck, and build pass; and
- Simulator clean + missed/hint-assisted runs pass.

Physical iPhone/release acceptance remains HPA-302.
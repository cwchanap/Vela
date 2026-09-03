# Mobile Mystery Messenger Missed-Phrase Recap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a run-local Mystery Messenger ending recap that derives missed phrases from persisted interaction history, records hint use on each submitted assessed history entry, and provides read-only phrase replay with visible row-local audio feedback.

**Architecture:** Keep completed interaction history as the only durable source of recap outcomes. Add optional `hintUsed` to choice/response-build history entries, extract the existing response grader, derive recap rows from history plus chapter content, and generalize the existing audio controller from scene IDs to TTS playback IDs so scenes and phrase clips share one state machine. No top-level progress field, compatibility parser, recap cache, or hint-only persistence path is added.

**Tech Stack:** Vue 3, TypeScript, Quasar, Vitest, Bun/Turborepo, existing `MobileTtsService` and `HtmlAudioPlayer` integration.

**Spec:** `docs/superpowers/specs/2026-09-02-mobile-mystery-messenger-missed-phrase-recap-design.md`

## Global Constraints

- Keep HPA-301 on one branch and one PR.
- Keep runtime work under `apps/vela-mobile/src/features/mystery-messenger`.
- No backend/API/CDK/DynamoDB changes.
- No SRS writes, vocabulary-save APIs, personal dictionary mutation, or Review-flow dependency.
- No Pinia, generic mistakes/review framework, event bus, migration registry, or shared package extraction.
- Do not add `missedPhrases` or `hintedSceneIds` to `MysteryProgress`.
- Keep the chapter ID, chapter version, and local-storage `:v1` namespace unchanged.
- HPA-300 history entries with no `hintUsed` remain valid and are interpreted as unhinted.
- Accept the documented trade-off: a hint revealed and then abandoned before submission is not persisted.
- `gradeMysteryResponse()` is the single response correctness rule for transcript and recap.
- Recap provenance is the Japanese source prompt; do not add unused `sourceSceneId` to the recap item.
- Recap phrase TTS IDs follow `mystery-message-tomorrow-v2-*`, not a doubled `v1-v2` form.
- Recap replay is read-only and uses the existing audio state machine through `playClip()`.
- Every implementation task ends with full mobile tests and mobile typecheck green before commit.
- Physical-device/release acceptance remains HPA-302.

---

## File Map

### Existing files to modify

- `apps/vela-mobile/src/features/mystery-messenger/model.ts`
- `apps/vela-mobile/src/features/mystery-messenger/model.test.ts`
- `apps/vela-mobile/src/features/mystery-messenger/storage.ts`
- `apps/vela-mobile/src/features/mystery-messenger/storage.test.ts`
- `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.vue`
- `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts`
- `apps/vela-mobile/src/features/mystery-messenger/components/MysteryResponseBuildComposer.vue`
- `apps/vela-mobile/src/features/mystery-messenger/components/MysteryResponseBuildComposer.test.ts`
- `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.ts`
- `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.test.ts`
- `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.ts`
- `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.test.ts`
- `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue`
- `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts`

### New files

- `apps/vela-mobile/src/features/mystery-messenger/components/MysteryMissedPhraseRecap.vue`
- `apps/vela-mobile/src/features/mystery-messenger/components/MysteryMissedPhraseRecap.test.ts`

---

### Task 1: Put hint use on history and derive the recap

**Files:**
- Modify: `apps/vela-mobile/src/features/mystery-messenger/model.ts`
- Test: `apps/vela-mobile/src/features/mystery-messenger/model.test.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/storage.ts`
- Test: `apps/vela-mobile/src/features/mystery-messenger/storage.test.ts`

**Interfaces:**
- Produces `hintUsed?: boolean` on choice/response-build history entries.
- Produces `gradeMysteryResponse(scene, selectedTokenIds)`.
- Produces `MysteryMissedPhraseRecapItem` with `phraseId/text/reading/meaning/sourcePrompt`.
- Produces `selectMysteryMissedPhraseRecap(chapter, progress)`.
- Produces `selectMysteryPhraseAudio(chapter, phraseId): MysterySceneAudio`.
- Leaves top-level `MysteryProgress` unchanged.

- [ ] **Step 1: Write failing shared-grader tests**

Add canonical, alternate, known-wrong, and invalid-token cases:

```ts
expect(gradeMysteryResponse(responseScene, responseScene.correctTokenIds)).toBe('correct');
expect(gradeMysteryResponse(responseScene, responseScene.alternateAnswerTokenIds![0]!)).toBe(
  'correct',
);
expect(
  gradeMysteryResponse(responseScene, [
    'station',
    'ni-place',
    'time',
    'ni-time',
    'train',
    'de',
    'go',
    'period',
  ]),
).toBe('incorrect');
expect(() => gradeMysteryResponse(responseScene, ['missing'])).toThrow(
  'mystery_response_token_not_found',
);
```

Run:

```bash
bun --filter @vela/mobile test -- model.test.ts
```

Expected: FAIL because `gradeMysteryResponse` does not exist.

- [ ] **Step 2: Extract the current transcript grading rule**

Move the existing visible-text comparison into:

```ts
export function gradeMysteryResponse(
  scene: MysteryResponseBuildScene,
  selectedTokenIds: readonly string[],
): 'correct' | 'incorrect' {
  const textById = new Map(scene.tokens.map((token) => [token.id, token.text] as const));
  const visibleTexts = (tokenIds: readonly string[]): readonly string[] =>
    tokenIds.map((tokenId) => {
      const tokenText = textById.get(tokenId);
      if (tokenText === undefined) throw new Error('mystery_response_token_not_found');
      return tokenText;
    });
  const textsEqual = (a: readonly string[], b: readonly string[]): boolean =>
    a.length === b.length && a.every((text, index) => text === b[index]);

  const selected = visibleTexts(selectedTokenIds);
  const canonical = visibleTexts(scene.correctTokenIds);
  return textsEqual(selected, canonical) ||
    (scene.alternateAnswerTokenIds ?? []).some((ids) => textsEqual(visibleTexts(ids), selected))
    ? 'correct'
    : 'incorrect';
}
```

Keep transcript display-text construction unchanged and replace only its inline correctness expression with:

```ts
const result = gradeMysteryResponse(scene, entry.selectedTokenIds);
```

Run the focused model tests and expect PASS.

- [ ] **Step 3: Write failing entry-local hint and recap tests**

Pin:

```ts
// correct choice without hintUsed -> []
// incorrect choice -> target phrase row
// correct choice with hintUsed: true -> target phrase row
// canonical/alternate response without hintUsed -> []
// incorrect response -> target phrase row
// correct response with hintUsed: true -> target phrase row
// repeated target phrase -> one row from first qualifying prompt
// HPA-300 history entry without hintUsed -> treated as false
```

Also pin transition persistence:

```ts
const next = chooseMysteryOption(chapter, atChoice, 'scene-03', 'tomorrow-morning', true);
expect(next.history.at(-1)).toMatchObject({ kind: 'choice', hintUsed: true });
```

Add equivalent response-build coverage.

Expected: FAIL because the entry metadata and recap selector are missing.

- [ ] **Step 4: Widen only the assessed history variants and existing transitions**

Use:

```ts
export type MysteryHistoryEntry =
  | { kind: 'message'; sceneId: string }
  | { kind: 'choice'; sceneId: string; selectedOptionId: string; hintUsed?: boolean }
  | {
      kind: 'response-build';
      sceneId: string;
      selectedTokenIds: readonly string[];
      hintUsed?: boolean;
    };
```

Add trailing arguments with defaults:

```ts
chooseMysteryOption(chapter, progress, expectedSceneId, optionId, hintUsed = false)
submitMysteryResponse(chapter, progress, expectedSceneId, selectedTokenIds, hintUsed = false)
```

Write `hintUsed` on each new assessed history entry. Do not modify `MysteryProgress`.

- [ ] **Step 5: Implement the recap projection with compile-safe scene narrowing**

Add:

```ts
export type MysteryMissedPhraseRecapItem = {
  phraseId: string;
  text: string;
  reading: string;
  meaning: string;
  sourcePrompt: string;
};
```

Implement:

```ts
export function selectMysteryMissedPhraseRecap(
  chapter: MysteryChapter,
  progress: MysteryProgress,
): MysteryMissedPhraseRecapItem[] {
  const emitted = new Set<string>();
  const items: MysteryMissedPhraseRecapItem[] = [];

  for (const entry of progress.history) {
    if (entry.kind === 'message') continue;

    let qualifies: boolean;
    let targetPhraseIds: readonly string[];
    let sourcePrompt: string;

    if (entry.kind === 'choice') {
      const scene = getMysteryScene(chapter, entry.sceneId);
      if (scene.kind !== 'choice') throw new Error('mystery_invalid_transition');
      const option = scene.options.find((candidate) => candidate.id === entry.selectedOptionId);
      if (!option) throw new Error('mystery_option_not_found');
      qualifies = option.result === 'incorrect' || entry.hintUsed === true;
      targetPhraseIds = scene.targetPhraseIds;
      sourcePrompt = scene.prompt;
    } else {
      const scene = getMysteryScene(chapter, entry.sceneId);
      if (scene.kind !== 'response-build') throw new Error('mystery_invalid_transition');
      qualifies =
        gradeMysteryResponse(scene, entry.selectedTokenIds) === 'incorrect' ||
        entry.hintUsed === true;
      targetPhraseIds = scene.targetPhraseIds;
      sourcePrompt = scene.prompt;
    }

    if (!qualifies) continue;
    for (const phraseId of targetPhraseIds) {
      if (emitted.has(phraseId)) continue;
      const phrase = chapter.targetPhrases.find((candidate) => candidate.id === phraseId);
      if (!phrase) throw new Error('mystery_target_phrase_not_found');
      emitted.add(phraseId);
      items.push({
        phraseId,
        text: phrase.text,
        reading: phrase.reading,
        meaning: phrase.meaning,
        sourcePrompt,
      });
    }
  }

  return items;
}
```

Run `model.test.ts` and expect PASS.

- [ ] **Step 6: Add and implement phrase-audio identity tests**

Pin:

```ts
expect(selectMysteryPhraseAudio(chapter, 'tomorrow-seven')).toEqual({
  ttsId: 'mystery-message-tomorrow-v2-recap-tomorrow-seven',
  text: 'あしたの朝7時',
});
expect(() => selectMysteryPhraseAudio(chapter, 'missing')).toThrow(
  'mystery_target_phrase_not_found',
);
```

Implement:

```ts
export function selectMysteryPhraseAudio(
  chapter: MysteryChapter,
  phraseId: string,
): MysterySceneAudio {
  const phrase = chapter.targetPhrases.find((candidate) => candidate.id === phraseId);
  if (!phrase) throw new Error('mystery_target_phrase_not_found');
  const chapterTtsBase = chapter.id.replace(/-v\d+$/, '');
  return {
    ttsId: `${chapterTtsBase}-v${chapter.version}-recap-${phrase.id}`,
    text: phrase.text,
  };
}
```

Run `model.test.ts` and expect PASS.

- [ ] **Step 7: Write storage tests for optional hint metadata**

Add four cases:

1. Existing HPA-300 choice/response history with no `hintUsed` loads unchanged.
2. `hintUsed: true` round-trips.
3. `hintUsed: false` round-trips.
4. Raw persisted `hintUsed: 'yes'` is rejected and the existing invalid-load reset removes the key.

Expected: the malformed case FAILS until validation is added.

- [ ] **Step 8: Extend the existing history loop in place**

After scene-kind validation add:

```ts
if (
  entry.kind !== 'message' &&
  entry.hintUsed !== undefined &&
  typeof entry.hintUsed !== 'boolean'
) {
  return false;
}
```

Do not add normalization or a compatibility object.

Run:

```bash
bun --filter @vela/mobile test -- model.test.ts storage.test.ts
bun --filter @vela/mobile test
bun --filter @vela/mobile typecheck
```

Expected: all PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/model.ts \
  apps/vela-mobile/src/features/mystery-messenger/model.test.ts \
  apps/vela-mobile/src/features/mystery-messenger/storage.ts \
  apps/vela-mobile/src/features/mystery-messenger/storage.test.ts
git commit -m "feat(mobile): derive mystery missed phrases from history"
```

---

### Task 2: Capture hint use only on interaction submission

**Files:**
- Modify/Test: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.vue`
- Test: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryResponseBuildComposer.vue`
- Test: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryResponseBuildComposer.test.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.ts`
- Test: `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.test.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue`
- Test: `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts`

**Interfaces:**
- Choice emits `choose(optionId, hintUsed)`.
- Response builder emits `submit(tokenIds, hintUsed)`.
- Controller widens existing assessed methods and exposes `missedPhraseRecap` computed.
- No hint-only controller method or storage write exists.

- [ ] **Step 1: Write failing composer event tests**

For each composer pin:

```ts
// answer before opening Hint -> false
// reveal Hint then answer -> true
// reveal, hide, then answer -> true
```

Choice assertion:

```ts
expect(wrapper.emitted('choose')?.[0]).toEqual(['tomorrow-morning', true]);
```

Response assertion:

```ts
expect(wrapper.emitted('submit')?.[0]).toEqual([expectedTokenIds, true]);
```

Expected: FAIL because current events carry only the answer.

- [ ] **Step 2: Add local `hintRevealed` and explicit event helper functions**

In choice composer:

```ts
const showHint = ref(false);
const hintRevealed = ref(false);
const emit = defineEmits<{ choose: [optionId: string, hintUsed: boolean] }>();

function toggleHint(): void {
  showHint.value = !showHint.value;
  if (showHint.value) hintRevealed.value = true;
}

function choose(optionId: string): void {
  emit('choose', optionId, hintRevealed.value);
}
```

Use `@click="choose(option.id)"` on option buttons and `@click="toggleHint"` on Hint.

In response composer:

```ts
const showHint = ref(false);
const hintRevealed = ref(false);
const emit = defineEmits<{ submit: [tokenIds: string[], hintUsed: boolean] }>();

function toggleHint(): void {
  showHint.value = !showHint.value;
  if (showHint.value) hintRevealed.value = true;
}

function submit(): void {
  emit('submit', [...selectedTokenIds.value], hintRevealed.value);
}
```

Use `@click="submit"` and `@click="toggleHint"`.

Run both composer test files and expect PASS.

- [ ] **Step 3: Write failing controller tests**

Call:

```ts
controller.chooseOption('scene-03', 'tomorrow-morning', true);
```

Assert persisted history contains `hintUsed: true` and:

```ts
expect(controller.missedPhraseRecap.value.map((item) => item.phraseId)).toContain(
  'tomorrow-seven',
);
```

Add equivalent response forwarding, restored-history projection, and restart-empty-history tests.

Expected: FAIL until controller signatures/projection are widened.

- [ ] **Step 4: Widen only existing controller methods**

Add:

```ts
const missedPhraseRecap = computed(() =>
  progress.value ? selectMysteryMissedPhraseRecap(chapter, progress.value) : [],
);
```

Widen:

```ts
chooseOption(expectedSceneId: string, optionId: string, hintUsed?: boolean): void;
submitResponse(
  expectedSceneId: string,
  selectedTokenIds: readonly string[],
  hintUsed?: boolean,
): void;
```

Forward through `transition()` using `hintUsed ?? false`. Expose `missedPhraseRecap`. Do not add `markHintUsed()`.

- [ ] **Step 5: Widen the existing page handlers**

Use:

```ts
function handleChoose(optionId: string, hintUsed: boolean): void {
  if (!lockTransition()) return;
  const scene = messenger.currentScene.value;
  if (scene?.kind !== 'choice') return;
  messenger.chooseOption(scene.id, optionId, hintUsed);
}
```

```ts
function handleResponseSubmit(
  selectedTokenIds: readonly string[],
  hintUsed: boolean,
): void {
  if (!lockTransition()) return;
  const scene = messenger.currentScene.value;
  if (scene?.kind !== 'response-build') return;
  messenger.submitResponse(scene.id, selectedTokenIds, hintUsed);
}
```

Update existing page mocks/expectations in this task.

Run:

```bash
bun --filter @vela/mobile test -- \
  MysteryChoiceComposer.test.ts \
  MysteryResponseBuildComposer.test.ts \
  useMysteryMessenger.test.ts \
  MysteryMessengerPage.test.ts
bun --filter @vela/mobile test
bun --filter @vela/mobile typecheck
```

Expected: all PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.vue \
  apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts \
  apps/vela-mobile/src/features/mystery-messenger/components/MysteryResponseBuildComposer.vue \
  apps/vela-mobile/src/features/mystery-messenger/components/MysteryResponseBuildComposer.test.ts \
  apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.ts \
  apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.test.ts \
  apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue \
  apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts
git commit -m "feat(mobile): record mystery hint use on answers"
```

---

### Task 3: Generalize audio identity and add `playClip()`

**Files:**
- Modify: `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.ts`
- Test: `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.test.ts`

**Interfaces:**
- `MysteryAudioState.sceneId` becomes `playbackId`.
- Adds `playClip(audio: MysterySceneAudio): Promise<void>`.
- `play(scene)` behavior remains unchanged.
- Both entry points use one private resolved-audio path keyed by `audio.ttsId`.

- [ ] **Step 1: Prove the pre-refactor audio baseline**

```bash
bun --filter @vela/mobile test -- useMysteryAudio.test.ts
```

Expected: PASS.

- [ ] **Step 2: Add failing direct-clip and scene-to-clip tests**

Use:

```ts
const RECAP_CLIP = {
  ttsId: 'mystery-message-tomorrow-v2-recap-tomorrow-seven',
  text: 'あしたの朝7時',
};
```

Pin `controller.playClip(RECAP_CLIP)` prepares the TTS service with that vocabulary ID/text. Add one switch test: start pending scene playback, then call `playClip(RECAP_CLIP)`; assert the first signal aborts and recap preparation starts.

Expected: FAIL because `playClip` is missing.

- [ ] **Step 3: Refactor the state payload and shared path**

Use:

```ts
export type MysteryAudioState =
  | { kind: 'idle' }
  | { kind: 'preparing'; playbackId: string }
  | { kind: 'ready'; playbackId: string; audioUrl: string }
  | { kind: 'playing'; playbackId: string }
  | { kind: 'error'; playbackId: string; message: string };
```

Refactor private error/play helpers so their identity parameter is `playbackId = audio.ttsId`, not a `MysteryScene` used only for `.id`.

Create one private resolved-audio path containing the existing duplicate suppression, ready reuse, abort/switch, prepare, and play logic:

```ts
async function playResolvedAudio(audio: MysterySceneAudio): Promise<void> {
  const playbackId = audio.ttsId;
  // existing control flow moves here unchanged except identity comparisons use playbackId
}
```

Preserve the generation counter, `AbortController`, active-handle stop, prepared-user tracking, media invalidation, lifecycle watcher, auth watcher, and disposal behavior.

Public methods become:

```ts
async function play(scene: MysteryScene): Promise<void> {
  const resolved = selectMysterySceneAudio(scene);
  if (!resolved) return;
  await playResolvedAudio(resolved);
}

async function playClip(audio: MysterySceneAudio): Promise<void> {
  await playResolvedAudio(audio);
}
```

- [ ] **Step 4: Update old state assertions in this same task**

Replace expected `sceneId` with the resolved audio TTS ID, e.g.:

```ts
expect(controller.state.value).toMatchObject({
  kind: 'preparing',
  playbackId: 'mystery-message-tomorrow-v2-scene-01',
});
```

For choice audio, use `scene.audioPrompt.ttsId`.

- [ ] **Step 5: Run the complete audio regression suite**

```bash
bun --filter @vela/mobile test -- useMysteryAudio.test.ts
```

Expected: every pre-existing gesture retry, media invalidation, scene switching, auth change, background, and dispose test passes, plus direct clip and scene-to-clip tests.

Do not duplicate the full existing matrix through `playClip`; both entry points feed the same private path.

- [ ] **Step 6: Run green-commit gates and commit**

```bash
bun --filter @vela/mobile test
bun --filter @vela/mobile typecheck
git add apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.ts \
  apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.test.ts
git commit -m "feat(mobile): support mystery phrase audio clips"
```

Expected: all PASS.

---

### Task 4: Render the ending recap with row-local replay status

**Files:**
- Create: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryMissedPhraseRecap.vue`
- Test: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryMissedPhraseRecap.test.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue`
- Test: `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts`

**Interfaces:**
- Recap props: `items`, optional `activePhraseId`, optional `playbackKind`, optional `playbackError`.
- Recap emits `replay(phraseId)`.
- Page maps audio `playbackId` to the recap phrase whose `selectMysteryPhraseAudio(...).ttsId` matches.

- [ ] **Step 1: Write failing static recap tests**

Use:

```ts
const ITEM = {
  phraseId: 'tomorrow-seven',
  text: 'あしたの朝7時',
  reading: 'あしたのあさしちじ',
  meaning: 'tomorrow at 7 a.m.',
  sourcePrompt: 'ミナさんは、いつ駅に来てほしいですか？',
};
```

Pin:

- empty -> `No missed phrases this run.`;
- one/multiple rows render once each;
- text, reading, and source prompt have `lang="ja"`;
- literal `From:` is absent;
- Replay emits the phrase ID.

Expected: FAIL because the component does not exist.

- [ ] **Step 2: Implement the recap component**

Use:

```ts
type PlaybackKind = 'preparing' | 'ready' | 'playing' | 'error';

defineProps<{
  items: readonly MysteryMissedPhraseRecapItem[];
  activePhraseId?: string;
  playbackKind?: PlaybackKind;
  playbackError?: string;
}>();

const emit = defineEmits<{ replay: [phraseId: string] }>();
```

Render phrase/reading/source prompt as separate Japanese elements, meaning in English, and Replay as a button. Keep exact empty copy `No missed phrases this run.`.

- [ ] **Step 3: Add and implement active-row status tests**

Only the row matching `activePhraseId` renders:

- `Preparing audio…` for `preparing`;
- `Tap Replay again` for `ready`;
- `Playing audio…` for `playing`;
- `Audio playback failed: <message>` for `error`.

Use `role="status"` for non-error state and `role="alert"` for error. A different row renders no status.

Run component tests and expect PASS.

- [ ] **Step 4: Write failing page integration tests**

Pin:

- recap only at ending;
- Restart remains below recap;
- page passes zero/one/multiple `messenger.missedPhraseRecap` rows;
- Replay calls `audio.playClip(selectMysteryPhraseAudio(chapter, phraseId))`;
- Replay calls no story transition/restart method;
- recap clip `playbackId` marks the matching phrase active;
- transcript scene `playbackId` marks no recap phrase active.

Expected: FAIL until page wiring lands.

- [ ] **Step 5: Wire the ending branch and replay**

Use:

```vue
<template v-else-if="currentEnding">
  <MysteryMissedPhraseRecap
    :items="messenger.missedPhraseRecap.value"
    :active-phrase-id="activeRecapPhraseId"
    :playback-kind="recapPlaybackKind"
    :playback-error="recapPlaybackError"
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
</template>
```

Replay:

```ts
function handlePhraseReplay(phraseId: string): void {
  void audio.playClip(selectMysteryPhraseAudio(chapter, phraseId));
}
```

Do not add a null guard.

- [ ] **Step 6: Map audio state to the active recap phrase**

Add:

```ts
const activeRecapPhraseId = computed(() => {
  const state = audio.state.value;
  if (state.kind === 'idle') return undefined;
  return messenger.missedPhraseRecap.value.find(
    (item) => selectMysteryPhraseAudio(chapter, item.phraseId).ttsId === state.playbackId,
  )?.phraseId;
});

const recapPlaybackKind = computed(() => {
  const state = audio.state.value;
  return activeRecapPhraseId.value && state.kind !== 'idle' ? state.kind : undefined;
});

const recapPlaybackError = computed(() => {
  const state = audio.state.value;
  return activeRecapPhraseId.value && state.kind === 'error' ? state.message : undefined;
});
```

Keep existing generic page audio status/error immediately after the transcript for existing replay behavior; the row status supplements it for later recap rows.

- [ ] **Step 7: Run focused and green-commit gates**

```bash
bun --filter @vela/mobile test -- \
  MysteryMissedPhraseRecap.test.ts \
  MysteryMessengerPage.test.ts
bun --filter @vela/mobile test
bun --filter @vela/mobile typecheck
```

Expected: all PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/components/MysteryMissedPhraseRecap.vue \
  apps/vela-mobile/src/features/mystery-messenger/components/MysteryMissedPhraseRecap.test.ts \
  apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue \
  apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts
git commit -m "feat(mobile): show mystery missed phrase recap"
```

---

### Task 5: Run final automated gates and Simulator acceptance

**Files:**
- Modify only HPA-301 runtime/test files if a gate exposes a regression.

**Interfaces:**
- No new product interfaces.
- Produces final HPA-301 verification evidence on the same PR.

- [ ] **Step 1: Run final mobile gates**

```bash
bun --filter @vela/mobile test:coverage
bun --filter @vela/mobile lint
bun --filter @vela/mobile typecheck
bun --filter @vela/mobile build
```

Expected: all PASS. Confirm Codecov patch coverage remains at the repository-required threshold when CI reports it.

- [ ] **Step 2: Launch the iOS development app**

```bash
bun --filter @vela/mobile dev:ios
```

Use the iOS Simulator and the existing authenticated Mystery Messenger route.

- [ ] **Step 3: Verify a clean completion**

Complete all assessed interactions correctly without opening Hint. At ending verify:

- `No missed phrases this run.`;
- Restart below the recap;
- ordinary transcript replay still works with existing generic audio feedback.

- [ ] **Step 4: Verify incorrect + completed hint-assisted outcomes**

Restart and complete a run containing at least one incorrect interaction and one correct interaction after revealing Hint. Verify:

- every affected phrase appears once;
- phrase/reading/meaning/source prompt are correct;
- source prompt uses Japanese presentation with no `From:` prefix;
- Replay shows preparing/ready/playing/error feedback on the tapped recap row;
- Replay does not move story state or change recap contents.

- [ ] **Step 5: Verify persistence semantics**

After completing a hinted interaction, leave/re-enter or relaunch and verify its recap result remains because `hintUsed` is on the persisted history entry.

Also verify the documented boundary: reveal a hint, leave before submitting, return, then submit; that abandoned pre-submit hint reveal is not remembered. Record this as accepted HPA-301 behavior, not a defect.

- [ ] **Step 6: Rerun gates after any smoke fix**

If Simulator testing changed code, rerun:

```bash
bun --filter @vela/mobile test:coverage
bun --filter @vela/mobile lint
bun --filter @vela/mobile typecheck
bun --filter @vela/mobile build
```

Expected: all PASS.

- [ ] **Step 7: Update the draft PR evidence**

Record automated gate results, Codecov patch status, clean-run recap, incorrect/hint-assisted recap, row-local replay feedback, and the accepted pre-submit hint limitation. Keep physical-device/release acceptance in HPA-302.

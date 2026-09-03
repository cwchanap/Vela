# Mobile Mystery Messenger Missed-Phrase Recap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a run-local Mystery Messenger ending recap that derives missed phrases from persisted interaction history, records hint use on the submitted history entry, and provides read-only phrase replay with visible row-local audio feedback.

**Architecture:** Keep history as the only durable source of completed interaction outcomes. Add optional `hintUsed` to choice/response-build history entries, extract the existing response grader, derive recap rows from history + chapter content, and generalize the existing audio controller from scene IDs to TTS playback IDs so both scenes and phrase clips use one state machine. No top-level progress field, compatibility parser, recap cache, or hint-only persistence path is added.

**Tech Stack:** Vue 3, TypeScript, Quasar, Vitest, Bun/Turborepo, existing `MobileTtsService` and `HtmlAudioPlayer` integration.

**Spec:** `docs/superpowers/specs/2026-09-02-mobile-mystery-messenger-missed-phrase-recap-design.md`

## Global Constraints

- Keep HPA-301 on one branch and one PR.
- Keep all runtime work under `apps/vela-mobile/src/features/mystery-messenger`.
- No backend/API/CDK/DynamoDB changes.
- No SRS writes, vocabulary-save APIs, personal dictionary mutation, or Review-flow dependency.
- No Pinia, generic mistakes/review framework, event bus, migration registry, or shared package extraction.
- Do not add `missedPhrases` or `hintedSceneIds` to `MysteryProgress`.
- Keep the chapter ID, chapter version, and local-storage `:v1` namespace unchanged.
- HPA-300 history entries with no `hintUsed` remain valid and are interpreted as unhinted.
- The deliberate trade-off is accepted: hint reveal before an unsubmitted force-quit is not persisted.
- `gradeMysteryResponse()` is the single response correctness rule for transcript and recap.
- Recap source provenance is displayed as the Japanese source prompt; do not add unused `sourceSceneId` to the recap item.
- Recap phrase TTS IDs follow `mystery-message-tomorrow-v2-*`, not a doubled `v1-v2` form.
- Recap replay is read-only and uses the existing audio state machine through `playClip()`.
- Every implementation task ends with full mobile tests and mobile typecheck green before commit.
- Physical-device/release acceptance remains HPA-302.

---

## File Map

### Existing files to modify

- `apps/vela-mobile/src/features/mystery-messenger/model.ts` — optional entry-local hint fact, response grader extraction, recap projection, phrase-audio selector.
- `apps/vela-mobile/src/features/mystery-messenger/model.test.ts` — pure grading/recap/phrase-audio rules.
- `apps/vela-mobile/src/features/mystery-messenger/storage.ts` — validate optional `hintUsed` inside the existing history loop.
- `apps/vela-mobile/src/features/mystery-messenger/storage.test.ts` — HPA-300 compatibility and malformed hint metadata.
- `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.vue` — track whether Hint was ever revealed and include the boolean in the existing `choose` event.
- `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts` — submit-time hint fact coverage.
- `apps/vela-mobile/src/features/mystery-messenger/components/MysteryResponseBuildComposer.vue` — same behavior for `submit`.
- `apps/vela-mobile/src/features/mystery-messenger/components/MysteryResponseBuildComposer.test.ts` — submit-time hint fact coverage.
- `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.ts` — widen existing assessed controller methods and expose derived recap projection.
- `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.test.ts` — persistence/resume/restart projection coverage.
- `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.ts` — `playbackId`, shared resolved-audio path, and `playClip()`.
- `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.test.ts` — existing regression suite plus focused clip coverage.
- `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue` — forward hint booleans, render ending recap, phrase replay, active-row playback mapping.
- `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts` — recap integration and read-only replay.

### New files

- `apps/vela-mobile/src/features/mystery-messenger/components/MysteryMissedPhraseRecap.vue` — ending recap rows, empty state, Replay event, row-local audio status.
- `apps/vela-mobile/src/features/mystery-messenger/components/MysteryMissedPhraseRecap.test.ts` — zero/one/multiple rendering, language attributes, replay, active-row state.

---

### Task 1: Put hint use on history and derive recap from the model

**Files:**
- Modify: `apps/vela-mobile/src/features/mystery-messenger/model.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/model.test.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/storage.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/storage.test.ts`

**Interfaces:**
- Produces widened choice/response-build `MysteryHistoryEntry` variants with `hintUsed?: boolean`.
- Produces `gradeMysteryResponse(scene, selectedTokenIds)`.
- Produces `MysteryMissedPhraseRecapItem` without `sourceSceneId`.
- Produces `selectMysteryMissedPhraseRecap(chapter, progress)`.
- Produces `selectMysteryPhraseAudio(chapter, phraseId)` returning `MysterySceneAudio` or throwing for an unknown phrase.
- Keeps `MysteryProgress` and `MysteryProgressStorage` top-level interfaces unchanged.

- [ ] **Step 1: Add failing history/grading tests**

In `model.test.ts`, add tests proving old and new entry shapes are accepted by the model and grading is extracted:

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
```

Use only known token IDs in the wrong-order fixture.

Run:

```bash
bun --filter @vela/mobile test -- model.test.ts
```

Expected: FAIL because `gradeMysteryResponse` does not exist.

- [ ] **Step 2: Extract `gradeMysteryResponse()` and make transcript use it**

Move the current visible-text comparison out of the response-build branch in `selectMysteryTranscript()` into:

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

In transcript projection, keep the selected/correct display-text construction but replace the inline correctness expression with:

```ts
const result = gradeMysteryResponse(scene, entry.selectedTokenIds);
```

Run the focused model tests and expect PASS.

- [ ] **Step 3: Add failing entry-local hint and recap tests**

Widen the history test fixtures and pin these cases:

```ts
// choice correct, no hintUsed -> []
// choice incorrect -> target phrase row
// choice correct, hintUsed: true -> target phrase row
// response canonical/alternate, no hintUsed -> []
// response incorrect -> target phrase row
// response correct, hintUsed: true -> target phrase row
// repeated phrase across qualifying entries -> one first-wins sourcePrompt
// HPA-300 entry with missing hintUsed -> treated as false
```

For the two transition functions, add assertions that the supplied boolean is stored on the new history entry:

```ts
const next = chooseMysteryOption(chapter, atChoice, 'scene-03', 'tomorrow-morning', true);
expect(next.history.at(-1)).toMatchObject({ kind: 'choice', hintUsed: true });
```

and equivalent response-build coverage.

Expected: FAIL because the entry contract, transition arguments, and recap selector do not exist yet.

- [ ] **Step 4: Widen history entries and transition signatures**

Change only the assessed history variants:

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

Add trailing defaults:

```ts
export function chooseMysteryOption(
  chapter: MysteryChapter,
  progress: MysteryProgress,
  expectedSceneId: string,
  optionId: string,
  hintUsed = false,
): MysteryProgress
```

```ts
export function submitMysteryResponse(
  chapter: MysteryChapter,
  progress: MysteryProgress,
  expectedSceneId: string,
  selectedTokenIds: readonly string[],
  hintUsed = false,
): MysteryProgress
```

Write `hintUsed` into the appended history entry. Do not add a field to `MysteryProgress`.

- [ ] **Step 5: Implement the pure recap projection**

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

Implement one history walk:

```ts
export function selectMysteryMissedPhraseRecap(
  chapter: MysteryChapter,
  progress: MysteryProgress,
): MysteryMissedPhraseRecapItem[] {
  const emitted = new Set<string>();
  const items: MysteryMissedPhraseRecapItem[] = [];

  for (const entry of progress.history) {
    if (entry.kind === 'message') continue;
    const scene = getMysteryScene(chapter, entry.sceneId);

    let qualifies = false;
    if (entry.kind === 'choice' && scene.kind === 'choice') {
      const option = scene.options.find((candidate) => candidate.id === entry.selectedOptionId);
      if (!option) throw new Error('mystery_option_not_found');
      qualifies = option.result === 'incorrect' || entry.hintUsed === true;
    } else if (entry.kind === 'response-build' && scene.kind === 'response-build') {
      qualifies = gradeMysteryResponse(scene, entry.selectedTokenIds) === 'incorrect' || entry.hintUsed === true;
    } else {
      throw new Error('mystery_invalid_transition');
    }

    if (!qualifies) continue;
    for (const phraseId of scene.targetPhraseIds) {
      if (emitted.has(phraseId)) continue;
      const phrase = chapter.targetPhrases.find((candidate) => candidate.id === phraseId);
      if (!phrase) throw new Error('mystery_target_phrase_not_found');
      emitted.add(phraseId);
      items.push({
        phraseId,
        text: phrase.text,
        reading: phrase.reading,
        meaning: phrase.meaning,
        sourcePrompt: scene.prompt,
      });
    }
  }

  return items;
}
```

Run focused model tests and expect PASS.

- [ ] **Step 6: Add failing phrase-audio identity tests and implement the selector**

Pin the current chapter identity:

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

Run focused model tests and expect PASS.

- [ ] **Step 7: Add storage tests for optional `hintUsed`**

In `storage.test.ts`, seed valid HPA-300-shaped choice/response entries without `hintUsed` and verify they still load unchanged. Add new snapshots with `hintUsed: true` and `hintUsed: false` and verify round-trip.

Add a malformed case using a raw JSON object:

```ts
hintUsed: 'yes'
```

Expected: current storage incorrectly accepts the unknown metadata because it does not validate it.

- [ ] **Step 8: Extend the existing history validation in place**

Inside the history loop, after scene-kind validation and before choice/response-specific payload checks, add:

```ts
if (
  entry.kind !== 'message' &&
  entry.hintUsed !== undefined &&
  typeof entry.hintUsed !== 'boolean'
) {
  return false;
}
```

Do not add load normalization, a compatibility constructor, or a new top-level snapshot field.

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

### Task 2: Capture the hint fact only when the interaction is submitted

**Files:**
- Modify: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.vue`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryResponseBuildComposer.vue`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryResponseBuildComposer.test.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.test.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts`

**Interfaces:**
- Choice composer emits `choose(optionId, hintUsed)`.
- Response builder emits `submit(tokenIds, hintUsed)`.
- Controller widens only existing `chooseOption()` and `submitResponse()` methods.
- Controller produces `missedPhraseRecap` as a computed projection; no new write method is added.

- [ ] **Step 1: Add failing composer event tests**

For both composers, pin three cases:

```ts
// submit without opening Hint -> emitted boolean false
// reveal Hint, submit -> true
// reveal Hint, hide Hint, submit -> still true
```

For choice, assert the existing event now looks like:

```ts
expect(wrapper.emitted('choose')?.[0]).toEqual(['tomorrow-morning', true]);
```

For response-build:

```ts
expect(wrapper.emitted('submit')?.[0]).toEqual([expectedTokenIds, true]);
```

Expected: FAIL because existing events carry only the answer.

- [ ] **Step 2: Track `hintRevealed` locally and widen the existing events**

In each composer add:

```ts
const showHint = ref(false);
const hintRevealed = ref(false);

function toggleHint(): void {
  showHint.value = !showHint.value;
  if (showHint.value) hintRevealed.value = true;
}
```

Change the Hint button to `@click="toggleHint"`.

Choice emit contract:

```ts
const emit = defineEmits<{ choose: [optionId: string, hintUsed: boolean] }>();
```

Choice button:

```vue
@click="emit('choose', option.id, hintRevealed)"
```

If Vue ref auto-unwrapping is not accepted in the template event expression, use a small `choose(optionId)` function that emits `hintRevealed.value`.

Response emit contract:

```ts
const emit = defineEmits<{ submit: [tokenIds: string[], hintUsed: boolean] }>();
```

Use a `submit()` function that emits `([...selectedTokenIds.value], hintRevealed.value)`.

Run both composer test files and expect PASS.

- [ ] **Step 3: Add failing controller tests for persisted entry-local hint use and recap**

Call:

```ts
controller.chooseOption('scene-03', 'tomorrow-morning', true);
```

Assert the saved progress has a last history entry containing `hintUsed: true`, then assert:

```ts
expect(controller.missedPhraseRecap.value.map((item) => item.phraseId)).toContain(
  'tomorrow-seven',
);
```

Add equivalent response forwarding, restored-history projection, and restart-empty-history tests.

Expected: FAIL because controller signatures/projection are not widened yet.

- [ ] **Step 4: Widen existing controller methods and add the derived computed**

Import `selectMysteryMissedPhraseRecap` and `MysteryMissedPhraseRecapItem`.

Add:

```ts
const missedPhraseRecap = computed(() =>
  progress.value ? selectMysteryMissedPhraseRecap(chapter, progress.value) : [],
);
```

Widen controller methods:

```ts
chooseOption(expectedSceneId: string, optionId: string, hintUsed?: boolean): void;
submitResponse(
  expectedSceneId: string,
  selectedTokenIds: readonly string[],
  hintUsed?: boolean,
): void;
```

Forward through the existing transition seam:

```ts
chooseOption: (expectedSceneId, optionId, hintUsed = false) =>
  transition((current) =>
    chooseMysteryOption(chapter, current, expectedSceneId, optionId, hintUsed),
  ),
```

and equivalent response logic. Expose `missedPhraseRecap` in the controller return.

Run focused controller tests and expect PASS.

- [ ] **Step 5: Widen only the page answer handlers**

Change:

```ts
function handleChoose(optionId: string, hintUsed: boolean): void {
  if (!lockTransition()) return;
  const scene = messenger.currentScene.value;
  if (scene?.kind !== 'choice') return;
  messenger.chooseOption(scene.id, optionId, hintUsed);
}
```

and:

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

Do not add a hint-only page handler.

Update existing page mocks/expectations for the widened event arguments inside this task.

Run:

```bash
bun --filter @vela/mobile test -- \
  components/MysteryChoiceComposer.test.ts \
  components/MysteryResponseBuildComposer.test.ts \
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

### Task 3: Generalize the existing audio machine to resolved playback IDs

**Files:**
- Modify: `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.test.ts`

**Interfaces:**
- Renames `MysteryAudioState.sceneId` to `playbackId`.
- Adds `playClip(audio: MysterySceneAudio): Promise<void>`.
- Keeps `play(scene)` behavior unchanged.
- Both entry points use one private path keyed by `audio.ttsId`.

- [ ] **Step 1: Run the existing audio suite as the pre-refactor baseline**

```bash
bun --filter @vela/mobile test -- useMysteryAudio.test.ts
```

Expected: PASS before edits. Do not proceed with an already-red baseline.

- [ ] **Step 2: Add failing `playClip()` success and scene-to-clip switching tests**

Add a clip fixture:

```ts
const RECAP_CLIP = {
  ttsId: 'mystery-message-tomorrow-v2-recap-tomorrow-seven',
  text: 'あしたの朝7時',
};
```

Pin direct clip preparation:

```ts
await controller.playClip(RECAP_CLIP);
expect(tts.preparePronunciation).toHaveBeenCalledWith(
  expect.objectContaining({
    vocabularyId: RECAP_CLIP.ttsId,
    text: RECAP_CLIP.text,
  }),
  expect.anything(),
);
```

Pin one switching direction: start a pending scene `play(scene)`, then call `playClip(RECAP_CLIP)`. Assert the first request signal is aborted and the controller prepares the recap clip.

Expected: FAIL because `playClip()` does not exist.

- [ ] **Step 3: Refactor state identity to `playbackId` and create one shared resolved-audio path**

Change the state type to:

```ts
export type MysteryAudioState =
  | { kind: 'idle' }
  | { kind: 'preparing'; playbackId: string }
  | { kind: 'ready'; playbackId: string; audioUrl: string }
  | { kind: 'playing'; playbackId: string }
  | { kind: 'error'; playbackId: string; message: string };
```

Refactor the private error/play helpers to receive `audio` plus `playbackId` instead of a `MysteryScene` solely for identity.

Create one shared entry path conceptually shaped as:

```ts
async function playResolvedAudio(audio: MysterySceneAudio): Promise<void> {
  const playbackId = audio.ttsId;
  // existing duplicate-preparing suppression
  // existing usable-session gate
  // existing ready/preparedUserId reuse
  // existing generation increment, request abort, active-handle stop
  // existing preparePronunciation call
  // existing playback/error handling
}
```

Keep all existing generation, abort, active-handle, prepared-user, media invalidation, lifecycle, and dispose mechanics intact.

Public methods:

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

Do not expose the old private `playAudio(...)` helper name as a public overload.

- [ ] **Step 4: Update existing audio assertions from `sceneId` to `playbackId` in this same task**

Where the old suite asserts state identity, use the scene's TTS ID, for example:

```ts
expect(controller.state.value).toMatchObject({
  kind: 'preparing',
  playbackId: scene.ttsId,
});
```

For a choice with `audioPrompt`, use `scene.audioPrompt.ttsId`.

Do not defer these fixture/test updates to final cleanup.

- [ ] **Step 5: Run the complete audio regression suite**

```bash
bun --filter @vela/mobile test -- useMysteryAudio.test.ts
```

Expected: every pre-existing preparation suppression, gesture-required retry, media-unavailable invalidation, switching, auth change, background, and dispose case still passes, plus the two new clip tests.

No duplicate `playClip()` gesture/background/auth matrix is required because both public entry points now feed the same private path.

- [ ] **Step 6: Run the green-commit gates and commit**

```bash
bun --filter @vela/mobile test
bun --filter @vela/mobile typecheck
git add apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.ts \
  apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.test.ts
git commit -m "feat(mobile): support mystery phrase audio clips"
```

Expected: tests and typecheck PASS before commit.

---

### Task 4: Render the ending recap with row-local replay feedback

**Files:**
- Create: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryMissedPhraseRecap.vue`
- Create: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryMissedPhraseRecap.test.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts`

**Interfaces:**
- Component consumes `items`, `activePhraseId`, `playbackKind`, and `playbackError`.
- Component emits `replay(phraseId)` only.
- Page maps `MysteryAudioState.playbackId` to a recap phrase by comparing with `selectMysteryPhraseAudio(chapter, phraseId).ttsId`.

- [ ] **Step 1: Add the failing isolated recap component tests**

Create tests for:

```ts
// [] -> "No missed phrases this run."
// one item -> Japanese text, reading, meaning, Japanese source prompt, Replay
// multiple items -> every phrase once
// no literal "From:" prefix
// phrase text, reading, and source prompt have lang="ja"
// Replay emits the row phraseId
```

Use a fixture shaped as:

```ts
const ITEM = {
  phraseId: 'tomorrow-seven',
  text: 'あしたの朝7時',
  reading: 'あしたのあさしちじ',
  meaning: 'tomorrow at 7 a.m.',
  sourcePrompt: 'ミナさんは、いつ駅に来てほしいですか？',
};
```

Expected: FAIL because the component does not exist.

- [ ] **Step 2: Implement the read-only recap rows**

Create props:

```ts
type PlaybackKind = 'preparing' | 'ready' | 'playing' | 'error';

defineProps<{
  items: readonly MysteryMissedPhraseRecapItem[];
  activePhraseId?: string;
  playbackKind?: PlaybackKind;
  playbackError?: string;
}>();
```

Emit:

```ts
const emit = defineEmits<{ replay: [phraseId: string] }>();
```

For each item render phrase text/reading with `lang="ja"`, English meaning, and the source prompt as its own `lang="ja"` caption with no English `From:` prefix.

Keep the empty copy exactly:

```text
No missed phrases this run.
```

Run the component tests and expect the static rendering/replay cases PASS.

- [ ] **Step 3: Add failing active-row playback tests**

Pin that only the row matching `activePhraseId` shows feedback:

```ts
// preparing -> Preparing audio…
// ready -> Tap Replay again
// playing -> Playing audio…
// error -> Audio playback failed: media_unavailable (or fixture message)
// a different row shows no playback status
```

Implement row-local status beneath the matching Replay control. Give status copy `role="status"`; use `role="alert"` for the matching error state.

Run component tests and expect PASS.

- [ ] **Step 4: Add failing page integration tests**

Pin:

- recap renders only when current scene is `ending`;
- Restart remains below the recap;
- zero/one/multiple derived rows are forwarded from `messenger.missedPhraseRecap`;
- clicking Replay calls `audio.playClip(selectMysteryPhraseAudio(chapter, phraseId))`;
- replay does not call `continueMessage`, `chooseOption`, `submitResponse`, or `restart`;
- an audio state with a recap clip `playbackId` marks that phrase active;
- a transcript scene playback ID does not mark a recap row active.

Expected: FAIL because the page does not render/wire the component.

- [ ] **Step 5: Wire the ending branch and phrase replay**

Import the component and `selectMysteryPhraseAudio`.

Replace the single ending Restart `q-btn` branch with an ending template containing recap then Restart:

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

Add replay:

```ts
function handlePhraseReplay(phraseId: string): void {
  void audio.playClip(selectMysteryPhraseAudio(chapter, phraseId));
}
```

Do not add `if (!clip) return` because the selector throws on an impossible unknown ID.

- [ ] **Step 6: Map active playback to the matching recap row**

Add a computed mapping:

```ts
const activeRecapPhraseId = computed(() => {
  const state = audio.state.value;
  if (state.kind === 'idle') return undefined;
  return messenger.missedPhraseRecap.value.find(
    (item) => selectMysteryPhraseAudio(chapter, item.phraseId).ttsId === state.playbackId,
  )?.phraseId;
});
```

Then expose row-local state only when a recap phrase is active:

```ts
const recapPlaybackKind = computed(() => {
  const state = audio.state.value;
  return activeRecapPhraseId.value && state.kind !== 'idle' ? state.kind : undefined;
});

const recapPlaybackError = computed(() => {
  const state = audio.state.value;
  return activeRecapPhraseId.value && state.kind === 'error' ? state.message : undefined;
});
```

Keep the existing generic page `audioStatusCopy` / `audioErrorCopy` unchanged for transcript replay.

- [ ] **Step 7: Run focused and green-commit gates**

```bash
bun --filter @vela/mobile test -- \
  components/MysteryMissedPhraseRecap.test.ts \
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

### Task 5: Run final gates and Simulator acceptance

**Files:**
- Modify only runtime/test files if a gate exposes an HPA-301 regression. Keep fixes on this PR.

**Interfaces:**
- No new product interfaces.
- Produces final HPA-301 verification evidence for the draft PR.

- [ ] **Step 1: Run the repository-required mobile gates**

```bash
bun --filter @vela/mobile test:coverage
bun --filter @vela/mobile lint
bun --filter @vela/mobile typecheck
bun --filter @vela/mobile build
```

Expected: all PASS. Confirm Codecov patch coverage remains at the repository-required threshold once CI reports it.

- [ ] **Step 2: Launch the iOS development app**

Run:

```bash
bun --filter @vela/mobile dev:ios
```

Use the iOS Simulator and the existing authenticated Mystery Messenger route.

- [ ] **Step 3: Smoke-test a clean completion**

Complete all assessed interactions correctly without revealing hints.

Verify at the ending:

- recap is visible;
- copy says `No missed phrases this run.`;
- Restart is visible below the recap;
- replaying ordinary transcript audio still uses the existing generic status/error surface.

- [ ] **Step 4: Smoke-test incorrect and hint-assisted outcomes**

Restart and complete a run containing:

- at least one incorrect choice or response; and
- at least one correct answer after revealing its Hint.

Verify:

- every affected target phrase appears once;
- repeated phrase IDs do not duplicate;
- text/reading/meaning/source prompt are correct;
- source prompt renders as Japanese text without `From:`;
- tapping a recap Replay row visibly shows Preparing/Playing (or Ready on gesture requirement) on that same row;
- an audio failure, if forced through the existing test/debug seam, would render on the active row rather than relying only on off-row page copy; and
- Replay does not move the story or alter recap contents.

- [ ] **Step 5: Verify persistence semantics intentionally**

For a completed hinted interaction, leave and re-enter the route or relaunch and verify its history-derived recap remains the same.

Also confirm the documented trade-off rather than treating it as a bug: revealing a hint and quitting before submitting that interaction does not persist the hint fact because no history entry was completed.

- [ ] **Step 6: Final full regression run after any smoke fixes**

If Simulator testing caused any code change, rerun:

```bash
bun --filter @vela/mobile test:coverage
bun --filter @vela/mobile lint
bun --filter @vela/mobile typecheck
bun --filter @vela/mobile build
```

Expected: all PASS.

- [ ] **Step 7: Update the existing draft PR with verification evidence**

Record:

- coverage/lint/typecheck/build results;
- Codecov patch status;
- clean-run recap result;
- incorrect + hint-assisted recap result;
- row-local Replay feedback result; and
- the accepted mid-interaction hint persistence limitation.

Do not move physical-device/release acceptance into HPA-301; HPA-302 owns it.

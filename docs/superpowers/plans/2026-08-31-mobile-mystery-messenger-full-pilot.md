# HPA-300 Mobile Mystery Messenger Full Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the existing five-scene Mystery Messenger into the complete 13-scene linear pilot with hints, one audio-backed choice, and tap-to-build Japanese responses.

**Architecture:** Extend the existing feature-local closed model with one `response-build` variant and a small target-phrase catalog. Land the widened union as a closed compile unit: model, temporary content, transcript audio projection, audio playback selector, transcript component, and affected fixtures change together in Task 1. Keep immutable transitions, local snapshot persistence, content validation, auth orchestration, and page-local transition locking in their current modules. Add one tap-to-order Vue component; do not add a story engine, shared package, Pinia state, backend work, or a web sentence-builder dependency.

**Tech Stack:** Vue 3, Quasar 2, TypeScript, Vue Router, Vitest, `@vue/test-utils`, existing Vela Mobile auth/TTS/audio services.

**Spec:** `docs/superpowers/specs/2026-08-31-mobile-mystery-messenger-full-pilot-design.md`

## Global Constraints

- One ticket and one PR: all HPA-300 work stays on PR #63 / `codex/hpa-300-mystery-messenger-full-pilot`.
- Keep all runtime code under `apps/vela-mobile/src/features/mystery-messenger`.
- Keep exactly four closed scene variants: `message | choice | response-build | ending`.
- Final authored chapter: exactly 13 scenes, two recurring speakers (`mina`, `haru`), one path, one ending.
- Wrong answers always advance; hints never block progression.
- Hint visibility and partial response-builder drafts are ephemeral UI state in HPA-300.
- Keep browser `localStorage`; keep the storage key `:v1` suffix, keep chapter ID `mystery-message-tomorrow-v1`, bump chapter version from 1 to 2, and do not migrate old runs.
- Reuse the existing 500 ms page-local accidental-repeat guard for story transitions only; Hint taps do not take it.
- Reuse existing `MobileTtsService`, `MobileAudioPlayer`, lifecycle/auth/session contracts.
- Use one pure `selectMysterySceneAudio()` selector from model code for both transcript audio identity and playback.
- No backend/API/CDK/DynamoDB/`@vela/common`/Pinia/story-engine/shared sentence-builder work.
- No missed-phrase persistence/recap/SRS mutation; HPA-301 owns that.
- No branching or alternate endings.
- No new mobile E2E framework.
- Learner-facing assessed uses of the mystery word use `あした`; the chapter title may keep `明日`.
- The frozen copy/token sheet in the design spec is the single source of truth for Task 5.

---

## File Structure

### Create

```text
apps/vela-mobile/src/features/mystery-messenger/components/MysteryResponseBuildComposer.vue
apps/vela-mobile/src/features/mystery-messenger/components/MysteryResponseBuildComposer.test.ts
```

### Modify

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
apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.vue
apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts
apps/vela-mobile/src/features/mystery-messenger/components/MysteryTranscript.vue
apps/vela-mobile/src/features/mystery-messenger/components/MysteryTranscript.test.ts
apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue
apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts
```

No router, Learn-page, backend, or workspace dependency changes are expected.

---

### Task 1: Land the widened model, transcript, and audio contract as one compile unit

**Files:**
- Modify: `apps/vela-mobile/src/features/mystery-messenger/model.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/model.test.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/content.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.test.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryTranscript.vue`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryTranscript.test.ts`
- Modify fixtures/imports as required in:
  - `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts`
  - `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.test.ts`
  - `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts`
  - `apps/vela-mobile/src/features/mystery-messenger/storage.test.ts`
  - `apps/vela-mobile/src/features/mystery-messenger/validate-content.test.ts`

**Interfaces:**
- Produces: `MysteryTargetPhrase`, `MysteryChoiceAudioPrompt`, `MysteryResponseToken`, `MysteryResponseBuildScene`, `MysterySceneAudio`, widened `MysteryScene`, widened `MysteryHistoryEntry`, widened `MysteryTranscriptItem`, `submitMysteryResponse`, `selectMysterySceneAudio`.
- Leaves the current five-scene content temporarily in place but valid under the widened contract.
- Consumed later by storage/validation, response UI, run controller/page, and final authored content.

- [ ] **Step 1: Add failing model tests for `response-build` transition semantics**

Use a local chapter fixture with `targetPhrases: []` and this response scene:

```ts
const responseScene: MysteryResponseBuildScene = {
  kind: 'response-build',
  id: 'response-01',
  prompt: '返事を作ってください。',
  tokens: [
    { id: 'time', text: '7時' },
    { id: 'ni-time', text: 'に' },
    { id: 'station', text: '駅' },
    { id: 'ni-place', text: 'に' },
    { id: 'go', text: '行きます' },
    { id: 'period', text: '。' },
  ],
  correctTokenIds: ['time', 'ni-time', 'station', 'ni-place', 'go', 'period'],
  feedback: { correct: '正しいです。', incorrect: '語順を確認しましょう。' },
  hint: '時間を先に置きます。',
  explanation: '「に」は時間と行き先に使えます。',
  targetPhraseIds: [],
  nextSceneId: 'ending',
};
```

Cover:

```text
correct response -> closed response-build history entry + advance
wrong known-token order -> advance + transcript result incorrect
incomplete known-token answer -> advance + transcript result incorrect
stale expectedSceneId -> exact same progress object
unknown selected token ID -> mystery_response_token_not_found
duplicate selected token ID -> mystery_duplicate_response_token
swapped duplicate visible に IDs -> transcript result remains correct
missing punctuation -> transcript result incorrect
```

- [ ] **Step 2: Run the model test and verify failure**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/model.test.ts
```

Expected: FAIL because the new scene/history/transition contracts do not exist.

- [ ] **Step 3: Extend the closed model types**

Add exactly:

```ts
export type MysteryTargetPhrase = {
  id: string;
  text: string;
  reading: string;
  meaning: string;
  sourceSceneId: string;
};

export type MysteryChoiceAudioPrompt = {
  ttsId: string;
  text: string;
};

export type MysteryResponseToken = {
  id: string;
  text: string;
};

export type MysteryResponseBuildScene = {
  kind: 'response-build';
  id: string;
  prompt: string;
  tokens: readonly MysteryResponseToken[];
  correctTokenIds: readonly string[];
  feedback: { correct: string; incorrect: string };
  hint: string;
  explanation: string;
  targetPhraseIds: readonly string[];
  nextSceneId: string;
};
```

Change choice to:

```ts
export type MysteryChoiceScene = {
  kind: 'choice';
  id: string;
  speaker: MysterySpeaker;
  prompt: string;
  audioPrompt?: MysteryChoiceAudioPrompt;
  options: readonly MysteryChoiceOption[];
  hint: string;
  explanation: string;
  targetPhraseIds: readonly string[];
};
```

Extend `MysteryChapter` with:

```ts
targetPhrases: readonly MysteryTargetPhrase[];
```

Extend `MysteryScene` and `MysteryHistoryEntry` with only `response-build` as described in the spec.

- [ ] **Step 4: Implement `submitMysteryResponse()`**

Keep the stale-first behavior:

```ts
if (progress.currentSceneId !== expectedSceneId) return progress;
```

Then:

1. require the actual current scene to be `response-build`;
2. build a token map from `scene.tokens`;
3. reject unknown submitted IDs;
4. reject duplicate submitted identities;
5. append `{ kind: 'response-build', sceneId, selectedTokenIds: [...selectedTokenIds] }`;
6. resolve `scene.nextSceneId`; and
7. advance regardless of correctness.

Use only these new feature errors:

```text
mystery_response_token_not_found
mystery_duplicate_response_token
```

Keep `mystery_invalid_transition` for the wrong current scene kind.

- [ ] **Step 5: Add the pure scene-audio selector and tests before changing playback/UI**

Add:

```ts
export type MysterySceneAudio = {
  ttsId: string;
  text: string;
};

export function selectMysterySceneAudio(scene: MysteryScene): MysterySceneAudio | null {
  switch (scene.kind) {
    case 'message':
    case 'ending':
      return { ttsId: scene.ttsId, text: scene.text };
    case 'choice':
      return scene.audioPrompt ?? null;
    case 'response-build':
      return null;
  }
}
```

Pin all four cases:

```text
message -> own ttsId/text
ending -> own ttsId/text
text choice -> null
audio choice -> exact audioPrompt
response-build -> null
```

- [ ] **Step 6: Widen transcript items with optional audio and make projection exhaustive**

Use one optional audio field shared by the transcript union:

```ts
type MysteryTranscriptAudio = {
  audio?: MysterySceneAudio;
};
```

Remove required choice `ttsId` fields. Add:

```text
choice-result.explanation
response-prompt
response-result(selectedText, correctText, result, feedback, explanation)
```

For each completed/current scene call `selectMysterySceneAudio(scene)` and set `audio` only when non-null.

Do not retain the current `else => ending` projection. Switch explicitly over:

```text
message
choice
response-build
ending
```

For completed response results, compare arrays of resolved token text, not submitted IDs, and join visible Japanese with `join('')`.

- [ ] **Step 7: Update the temporary five-scene `content.ts` immediately**

Keep the existing five scenes for Tasks 1–4, but make them satisfy the widened contract:

```ts
export const MYSTERY_MESSENGER_VERTICAL_SLICE = {
  id: 'mystery-message-tomorrow-v1',
  version: 1,
  title: '明日からのメッセージ',
  startSceneId: 'scene-01',
  targetPhrases: [],
  // existing scenes
} satisfies MysteryChapter;
```

For the existing scene-03 choice:

```ts
hint: '「わかりました」は、理解したことを伝える返事です。',
explanation: '短い返事でも、相手に理解したことを伝えられます。',
targetPhraseIds: [],
```

Remove its old `ttsId`; it is a text choice in the temporary content and therefore has no `audioPrompt`.

Do not add `response-build` to the real content yet.

- [ ] **Step 8: Change `useMysteryAudio` to consume `selectMysterySceneAudio()`**

Delete `authoredTextFor()` and remove every direct `scene.ttsId` assumption from prepare/invalidate paths.

At the start of `play()` after the usable-session check:

```ts
const audio = selectMysterySceneAudio(scene);
if (!audio) return;
```

Use:

```ts
audio.ttsId
audio.text
```

for `preparePronunciation()` and `invalidatePronunciation()`. Pass the selected audio identity into helper functions so `handlePlaybackError()` never reads `ttsId` directly from a widened `MysteryScene`.

Preserve gesture-required, media-unavailable, cancellation, lifecycle, identity-change, and disposal behavior.

- [ ] **Step 9: Add exact audio regression tests**

Pin:

```ts
expect(ttsService.preparePronunciation).toHaveBeenCalledWith(
  {
    userId: 'user-1',
    vocabularyId: audioChoice.audioPrompt!.ttsId,
    text: audioChoice.audioPrompt!.text,
  },
  { signal: expect.any(AbortSignal) },
);
```

Also assert:

```text
text choice play -> no TTS call, state idle
response-build play -> no TTS call, state idle
message -> existing TTS behavior remains
media_unavailable on audio choice invalidates audioPrompt.ttsId, not a scene field
```

- [ ] **Step 10: Update `MysteryTranscript.vue` and its tests in the same task**

Make every transcript kind explicit:

```text
message
choice-result
choice-prompt
response-result
response-prompt
ending
```

Render replay only when `item.audio` exists:

```vue
<q-btn
  v-if="item.audio"
  ...
  @click="emit('replay', item.sceneId)"
/>
```

Pin both sides of the listening contract:

```text
text choice-prompt -> no replay button
text choice-result -> no replay button
audio choice-prompt -> replay button present
audio choice-result -> replay button present
message/ending -> replay present
response prompt/result -> no replay
```

- [ ] **Step 11: Update every affected current fixture/import**

Search the feature for the current content constant and closed choice shapes:

```bash
rg "MYSTERY_MESSENGER_VERTICAL_SLICE|MysteryChoiceScene|kind: 'choice'" \
  apps/vela-mobile/src/features/mystery-messenger
```

Update the current fixtures in at least:

```text
model.test.ts
useMysteryAudio.test.ts
useMysteryMessenger.test.ts
MysteryChoiceComposer.test.ts
MysteryMessengerPage.test.ts
validate-content.test.ts
storage.test.ts
MysteryTranscript.test.ts
```

Every chapter fixture gains `targetPhrases`. Every typed choice fixture gains `hint`, `explanation`, and `targetPhraseIds`; choices only gain `audioPrompt` when the test explicitly needs listening.

- [ ] **Step 12: Run the closed Task-1 gate**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/features/mystery-messenger/model.test.ts \
  src/features/mystery-messenger/useMysteryAudio.test.ts \
  src/features/mystery-messenger/components/MysteryTranscript.test.ts \
  src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts \
  src/features/mystery-messenger/useMysteryMessenger.test.ts \
  src/features/mystery-messenger/MysteryMessengerPage.test.ts \
  src/features/mystery-messenger/storage.test.ts \
  src/features/mystery-messenger/validate-content.test.ts
bun run --cwd apps/vela-mobile typecheck
```

Expected: all tests PASS and typecheck PASS before Task 2 starts.

- [ ] **Step 13: Commit**

```bash
git add apps/vela-mobile/src/features/mystery-messenger
git commit -m "feat(mobile): close mystery interaction and audio model"
```

---

### Task 2: Extend storage and authored-content validation

**Files:**
- Modify: `apps/vela-mobile/src/features/mystery-messenger/storage.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/storage.test.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/validate-content.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/validate-content.test.ts`

**Interfaces:**
- Consumes: Task 1 response/history/target-phrase/audio contracts.
- Produces: persistence acceptance for response history and validation for the final chapter contract.

- [ ] **Step 1: Write failing storage tests for response history**

Use a local chapter with one `response-build` scene. Cover valid round-trip plus reset/deletion for:

```text
response entry references a non-response scene
selectedTokenIds is not an array
unknown selected response token ID
duplicate selected response token ID
chapter version mismatch
```

Also keep this exact key invariant:

```ts
expect(mysteryProgressStorageKey('user:a', 'chapter/1')).toBe(
  'vela:mobile:mystery-messenger:user%3Aa:chapter%2F1:v1',
);
```

- [ ] **Step 2: Run storage tests and verify failure**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/storage.test.ts
```

Expected: new response-history tests FAIL.

- [ ] **Step 3: Extend `isKnownProgress()` with one response-build branch**

A persisted response entry is valid only when:

```ts
scene.kind === 'response-build'
Array.isArray(entry.selectedTokenIds)
entry.selectedTokenIds.every((id) => scene.tokens.some((token) => token.id === id))
new Set(entry.selectedTokenIds).size === entry.selectedTokenIds.length
```

Keep history closed to `message | choice | response-build`; ending remains represented only by current scene + `completed`.

Do not persist or validate partial composer UI state.

- [ ] **Step 4: Write failing validator tests for the new authored rules**

Add exact issue codes:

```text
duplicate_target_phrase_id
dangling_target_phrase_source
unknown_target_phrase_reference
duplicate_response_token_id
invalid_response_answer_token
unsupported_tts_markup
multiple_endings
```

Tests must also prove `response-build.nextSceneId` participates in dangling-reference and reachability checks.

Examples:

```ts
expect(validateMysteryChapter(chapterWithDuplicateToken)).toContainEqual({
  code: 'duplicate_response_token_id',
  sceneId: 'response-01',
  referenceId: 'ni',
});
```

```ts
expect(validateMysteryChapter(chapterWithUnknownTarget)).toContainEqual({
  code: 'unknown_target_phrase_reference',
  sceneId: 'choice-01',
  referenceId: 'missing-phrase',
});
```

- [ ] **Step 5: Run validator tests and verify failure**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/validate-content.test.ts
```

Expected: FAIL for the new rules.

- [ ] **Step 6: Extend `validateMysteryChapter()` without changing its shape**

Keep the existing `Map` + graph traversal.

For every response scene:

```text
validate nextSceneId exists
validate token IDs are unique
validate every correctTokenIds entry exists
validate correctTokenIds contains no repeated identity
validate targetPhraseIds exist
```

For every choice scene validate `targetPhraseIds`; preserve current option-ID and destination validation.

For chapter target phrases validate unique IDs and existing `sourceSceneId`.

Require exactly one ending:

```ts
if (endingIds.length === 0) issues.push({ code: 'missing_ending' });
if (endingIds.length > 1) issues.push({ code: 'multiple_endings' });
```

During traversal:

```text
message -> nextSceneId
choice -> every option nextSceneId
response-build -> nextSceneId
ending -> no edge
```

For TTS markup inspect the same content that `selectMysterySceneAudio()` can expose:

```text
message.text
ending.text
choice.audioPrompt?.text
```

Flag `unsupported_tts_markup` when a TTS-bound string contains an HTML/SSML-like `<...>` tag.

- [ ] **Step 7: Run storage + validator tests**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/features/mystery-messenger/storage.test.ts \
  src/features/mystery-messenger/validate-content.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/storage.ts \
  apps/vela-mobile/src/features/mystery-messenger/storage.test.ts \
  apps/vela-mobile/src/features/mystery-messenger/validate-content.ts \
  apps/vela-mobile/src/features/mystery-messenger/validate-content.test.ts
git commit -m "feat(mobile): validate full mystery pilot content"
```

---

### Task 3: Add tap-to-order responses and interaction assistance UI

**Files:**
- Create: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryResponseBuildComposer.vue`
- Create: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryResponseBuildComposer.test.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.vue`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts`

**Interfaces:**
- Consumes: Task 1 `MysteryResponseBuildScene` and Task-1 transcript rendering.
- Produces: `MysteryResponseBuildComposer` with `submit: [selectedTokenIds]` event and ephemeral Hint behavior for both interaction composers.

- [ ] **Step 1: Write response-composer tests first**

Use a scene whose authored available-token order is intentionally scrambled and contains two visible `に` values with different IDs plus `。`.

Cover:

```text
tapping available token appends exact ID
two visible に buttons remain independently addressable
selected token tap removes only that ID
punctuation can be selected and removed
Clear empties selection
Hint toggles the authored hint
Send emits selected IDs in tap order
Send disabled when selection is empty
all response-changing controls disabled when disabled=true
```

Use stable test IDs:

```text
mystery-response-token-<tokenId>
mystery-response-selected-<tokenId>
mystery-response-clear
mystery-response-hint
mystery-response-hint-copy
mystery-response-send
```

- [ ] **Step 2: Run the new component test and verify failure**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/features/mystery-messenger/components/MysteryResponseBuildComposer.test.ts
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement `MysteryResponseBuildComposer.vue` with only local input state**

```ts
const selectedTokenIds = ref<string[]>([]);
const showHint = ref(false);
```

Available tokens:

```ts
const availableTokens = computed(() => {
  const selected = new Set(selectedTokenIds.value);
  return props.scene.tokens.filter((token) => !selected.has(token.id));
});
```

Tap handlers move token IDs only. Render each selected token as an individually removable control keyed by token ID. Do not use drag/drop, scoring, Pinia, backend questions, or runtime shuffle.

Emit:

```ts
const emit = defineEmits<{
  submit: [selectedTokenIds: readonly string[]];
}>();
```

Emit a copied array, not the mutable local ref:

```ts
emit('submit', [...selectedTokenIds.value]);
```

- [ ] **Step 4: Add ephemeral Hint behavior to `MysteryChoiceComposer.vue`**

Use:

```ts
const showHint = ref(false);
```

Add test IDs:

```text
mystery-choice-hint
mystery-choice-hint-copy
```

Keep option selection unchanged. The page will key the component by `scene.id`, so no reset watcher or persisted hint state is needed.

Hint remains available when the story transition controls are otherwise usable; it never emits a story transition.

- [ ] **Step 5: Run focused component tests**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/features/mystery-messenger/components/MysteryResponseBuildComposer.test.ts \
  src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/components/MysteryResponseBuildComposer.vue \
  apps/vela-mobile/src/features/mystery-messenger/components/MysteryResponseBuildComposer.test.ts \
  apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.vue \
  apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts
git commit -m "feat(mobile): add tap-to-build mystery responses"
```

---

### Task 4: Wire response submission through the existing run controller and page

**Files:**
- Modify: `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.test.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts`

**Interfaces:**
- Consumes: Task 1 `submitMysteryResponse`; Task 3 response composer; Task 1 audio/transcript behavior unchanged.
- Produces: controller/page support for response submission with the existing auth, persistence, replay, and 500 ms transition semantics.

- [ ] **Step 1: Add failing `useMysteryMessenger` tests**

Extend the controller contract:

```ts
submitResponse(expectedSceneId: string, selectedTokenIds: readonly string[]): void;
```

Cover:

```text
usable owned run -> response transition saved exactly once
stale response transition -> same object and no save
recovering/unavailable -> no mutation/no save
save failure -> in-memory progress advances + persistenceWarning=true
```

- [ ] **Step 2: Implement controller wiring through existing `transition()`**

Import the Task-1 pure transition and expose:

```ts
submitResponse: (expectedSceneId, selectedTokenIds) =>
  transition((current) =>
    submitMysteryResponse(chapter, current, expectedSceneId, selectedTokenIds),
  ),
```

Do not add another auth, persistence, or state-management branch.

- [ ] **Step 3: Add failing page tests for response rendering and transition locking**

Extend the page controller fixture with `submitResponse`.

Cover:

```text
response scene renders MysteryResponseBuildComposer
first Send calls submitResponse(sceneId, ids)
second Send inside 500 ms is ignored
after 500 ms another Send can transition
unusable session disables response submission
Hint click does not call submitResponse/continue/choice and does not acquire the 500 ms story lock
```

Also add an integration-level listening check using the existing transcript replay surface:

```text
text choice transcript has no replay control
listening choice transcript has replay control
replay for listening choice invokes audio.play(scene-05)
```

The exact `audioPrompt.text + ttsId` request remains pinned in Task 1 `useMysteryAudio.test.ts`.

- [ ] **Step 4: Wire `MysteryMessengerPage.vue`**

Add:

```ts
const currentResponseBuild = computed(() =>
  currentScene.value?.kind === 'response-build' ? currentScene.value : null,
);
```

Template order:

```text
message -> Continue
choice -> MysteryChoiceComposer keyed by scene.id
response-build -> MysteryResponseBuildComposer keyed by scene.id
ending -> Restart
```

Handler:

```ts
function handleResponseSubmit(selectedTokenIds: readonly string[]): void {
  if (!lockTransition()) return;
  const scene = messenger.currentScene.value;
  if (scene?.kind !== 'response-build') return;
  messenger.submitResponse(scene.id, selectedTokenIds);
}
```

Do not change `handleReplay()` beyond whatever Task-1 type changes require; it still resolves the scene then calls `audio.play(scene)`.

- [ ] **Step 5: Run focused controller/page tests**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/features/mystery-messenger/useMysteryMessenger.test.ts \
  src/features/mystery-messenger/MysteryMessengerPage.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run the existing Task-1 audio/transcript regressions again**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/features/mystery-messenger/useMysteryAudio.test.ts \
  src/features/mystery-messenger/components/MysteryTranscript.test.ts
```

Expected: PASS; text choice remains silent/no-replay and listening choice still uses `audioPrompt`.

- [ ] **Step 7: Commit**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.ts \
  apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.test.ts \
  apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue \
  apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts
git commit -m "feat(mobile): wire full mystery interactions"
```

---

### Task 5: Replace the temporary five-scene content with the frozen 13-scene pilot

**Files:**
- Modify: `apps/vela-mobile/src/features/mystery-messenger/content.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/model.test.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/validate-content.test.ts`
- Modify all feature imports that still reference `MYSTERY_MESSENGER_VERTICAL_SLICE`.

**Interfaces:**
- Produces: `MYSTERY_MESSENGER_PILOT` satisfying the final `MysteryChapter` contract.
- Canonical authored values come only from **Spec → Frozen Pilot Copy and Token Sheet**. Do not invent alternate Japanese, token segmentation, target-phrase readings, or TTS IDs in this task.

- [ ] **Step 1: Write real-content tests before replacing `content.ts`**

Pin the chapter shape:

```ts
expect(MYSTERY_MESSENGER_PILOT.id).toBe('mystery-message-tomorrow-v1');
expect(MYSTERY_MESSENGER_PILOT.version).toBe(2);
expect(MYSTERY_MESSENGER_PILOT.title).toBe('明日からのメッセージ');
expect(MYSTERY_MESSENGER_PILOT.scenes).toHaveLength(13);
expect(MYSTERY_MESSENGER_PILOT.targetPhrases).toHaveLength(6);
expect(validateMysteryChapter(MYSTERY_MESSENGER_PILOT)).toEqual([]);
```

Pin exactly one ending and only the two speakers:

```ts
expect(chapter.scenes.filter((scene) => scene.kind === 'ending')).toHaveLength(1);
expect(
  new Set(
    chapter.scenes.flatMap((scene) => ('speaker' in scene ? [scene.speaker] : [])),
  ),
).toEqual(new Set(['mina', 'haru']));
```

Pin every choice converges:

```ts
for (const scene of chapter.scenes) {
  if (scene.kind !== 'choice') continue;
  expect(new Set(scene.options.map((option) => option.nextSceneId)).size).toBe(1);
}
```

Add one content-specific walk: start at `startSceneId`, follow message/response single edges and the first choice option, and expect all 13 scene IDs exactly once before the sole ending. This is the one-path proof; do not add a generic branching validator.

- [ ] **Step 2: Pin the frozen assessed copy before implementation**

At minimum assert:

```ts
expect(target('tomorrow-seven').text).toBe('あしたの朝7時');
expect(target('mina-possession').reading).toBe('ミナさんのです');
```

Pin scene-05 listening identity:

```ts
expect(scene05.audioPrompt).toEqual({
  ttsId: 'mystery-message-tomorrow-v2-scene-05-audio',
  text: '青いノートはミナさんのです。きのう、駅に忘れました。',
});
```

Pin scene-07 prompt and token contract:

```ts
expect(scene07.prompt).toBe('ミナさんに、あしたの予定を伝えてください。');
expect(scene07.tokens).toEqual([
  { id: 'station', text: 'さくら駅' },
  { id: 'ni-time', text: 'に' },
  { id: 'period', text: '。' },
  { id: 'train', text: '電車' },
  { id: 'go', text: '行きます' },
  { id: 'time', text: '7時' },
  { id: 'de', text: 'で' },
  { id: 'ni-place', text: 'に' },
]);
expect(scene07.correctTokenIds).toEqual([
  'time',
  'ni-time',
  'train',
  'de',
  'station',
  'ni-place',
  'go',
  'period',
]);
```

Pin scene-11 segmentation exactly:

```ts
expect(scene11.tokens).toEqual([
  { id: 'please', text: 'ください' },
  { id: 'period', text: '。' },
  { id: 'again', text: 'もう一度' },
  { id: 'say', text: '言って' },
]);
expect(scene11.correctTokenIds).toEqual(['again', 'say', 'please', 'period']);
```

These assertions prevent the two response exercises from silently choosing different tokenization than the design.

- [ ] **Step 3: Run content tests and verify failure**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/features/mystery-messenger/model.test.ts \
  src/features/mystery-messenger/validate-content.test.ts
```

Expected: FAIL because `content.ts` still exports the temporary five-scene slice.

- [ ] **Step 4: Replace `content.ts` from the frozen copy/token sheet exactly**

Rename the export:

```ts
export const MYSTERY_MESSENGER_PILOT = {
  id: 'mystery-message-tomorrow-v1',
  version: 2,
  title: '明日からのメッセージ',
  startSceneId: 'scene-01',
  targetPhrases: [/* exact frozen six records */],
  scenes: [/* exact frozen 13 scenes */],
} satisfies MysteryChapter;
```

Copy all learner-facing text, Hint/explanation copy, option labels, target phrase text/readings/meanings, response token arrays, `correctTokenIds`, and TTS IDs from **Spec → Frozen Pilot Copy and Token Sheet** without translation or normalization.

Use fresh `mystery-message-tomorrow-v2-*` TTS IDs exactly as frozen because the mobile TTS cache treats vocabulary ID as canonical identity for immutable text. Do not reuse HPA-299 `...-v1-*` IDs for rewritten lines.

- [ ] **Step 5: Update every feature import to `MYSTERY_MESSENGER_PILOT`**

Run:

```bash
rg "MYSTERY_MESSENGER_VERTICAL_SLICE" apps/vela-mobile/src/features/mystery-messenger
```

Expected before edits: current page/tests still reference the old constant.

Update every runtime/test import. Then rerun the same `rg`; expected: no matches under feature runtime/tests.

- [ ] **Step 6: Add the real duplicate-token semantic regression**

For scene 07 submit:

```ts
['time', 'ni-place', 'train', 'de', 'station', 'ni-time', 'go', 'period']
```

Expect `response-result.result === 'correct'` because both swapped identities render the same visible `に` sequence.

Then submit the correct sequence without `period`; expect `response-result.result === 'incorrect'`.

- [ ] **Step 7: Pin text-vs-listening audio on the real content**

Assert:

```text
scene-03 text choice -> selectMysterySceneAudio() === null
scene-05 listening choice -> exact audioPrompt source
scene-09 text choice -> selectMysterySceneAudio() === null
scene-07/scene-11 response-build -> null
```

This prevents later authored changes from accidentally giving text questions a dead speaker or making scene 05 speak the visible instruction.

- [ ] **Step 8: Run all Mystery Messenger tests**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger
```

Expected: PASS.

- [ ] **Step 9: Run typecheck immediately after content replacement**

```bash
bun run --cwd apps/vela-mobile typecheck
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/vela-mobile/src/features/mystery-messenger
git commit -m "feat(mobile): author full mystery messenger pilot"
```

---

### Task 6: Language-quality pass and full verification

**Files:**
- Modify only files that fail review/tests or require an approved frozen-copy correction.
- Update PR #63 description/checklist with final evidence; do not create another PR.

**Interfaces:**
- Consumes the complete HPA-300 implementation.
- Produces acceptance evidence for HPA-300 and a clean handoff to HPA-301.

- [ ] **Step 1: Run the complete mobile coverage suite**

```bash
bun run --cwd apps/vela-mobile test:coverage
```

Expected: PASS with the repository's existing mobile line threshold (>=95%).

- [ ] **Step 2: Run lint**

```bash
bun run --cwd apps/vela-mobile lint
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

```bash
bun run --cwd apps/vela-mobile typecheck
```

Expected: PASS.

- [ ] **Step 4: Run a production-shaped local build**

```bash
MOBILE_SKIP_ENV_VALIDATION=1 bun run --cwd apps/vela-mobile build
```

Expected: PASS. CI remains responsible for the real configured environment path.

- [ ] **Step 5: Review Codecov after the PR is ready for CI**

Expected: patch coverage >=90%. Add focused tests instead of lowering thresholds.

Codecov is a final gate only. Do not use it as evidence for the two design-sensitive Task-1 contracts: typecheck closure and listening-choice audio identity.

- [ ] **Step 6: Perform the manual Japanese pass against the frozen sheet**

Read all 13 scenes and six target phrases in sequence. Verify:

```text
learner-facing mystery word is consistently あした; title kanji stays intentional
relative-time logic is understandable: yesterday -> today's delivery -> yesterday's “tomorrow”
tomorrow-seven is exactly あしたの朝7時
mina-possession reading preserves ミナ rather than ambiguous みな
all English meanings are accurate
scene-07 particles and duplicate に placement are natural
scene-11 segmentation is exactly もう一度 / 言って / ください / 。
audio prompt is natural spoken Japanese
hints do not reveal unrelated information
explanations are short and beginner-friendly
no TTS-bound string contains HTML/SSML markup
```

If Japanese copy must change, update the **design spec frozen sheet**, `content.ts`, and the pinned real-content test in the same commit. Do not silently edit only `content.ts`.

- [ ] **Step 7: Run focused iOS Simulator smoke acceptance**

Exercise one complete run:

```text
Learn -> Mystery Messenger
scene 03 text choice: confirm there is no replay control; try wrong answer; story continues
scene 05 audio choice: replay and confirm spoken Japanese is 青いノートはミナさんのです。きのう、駅に忘れました。, not the visible instruction
scene 07 response: select both distinct に tokens and punctuation; send
restart/re-enter once to confirm version-2 persistence / old v1 chapter reset
scene 09 use Hint; confirm text choice has no replay; choose answer
scene 11 use Hint; exercise explicit もう一度 / 言って / ください / 。 tokens; send a wrong known-token order and confirm story continues
reach scene 13 ending
restart and confirm clean new run
```

Also verify the existing `Tap play again` gesture fallback and background cancellation still behave when replaying scene 05.

- [ ] **Step 8: Final diff scope review**

Confirm the branch contains only:

```text
HPA-300 planning docs
mystery-messenger feature runtime/tests
no router/Learn/backend/shared-package/dependency changes unless a concrete regression forced one
```

- [ ] **Step 9: Commit any verification fixes**

Use scoped messages such as:

```bash
git commit -m "fix(mobile): polish mystery pilot interactions"
```

Do not create a follow-up PR for HPA-300.

- [ ] **Step 10: Update Linear HPA-300 with final evidence when implementation is accepted**

Record coverage, lint/typecheck/build, Simulator smoke, manual Japanese pass, PR link, and any explicit deferrals to HPA-301/HPA-302. Mark HPA-300 Done only after those gates pass.

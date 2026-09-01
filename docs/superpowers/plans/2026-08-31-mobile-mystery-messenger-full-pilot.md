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
- Modify affected fixtures/imports in `MysteryChoiceComposer.test.ts`, `useMysteryMessenger.test.ts`, `MysteryMessengerPage.test.ts`, `storage.test.ts`, and `validate-content.test.ts`.

**Interfaces:**
- Produces: `MysteryTargetPhrase`, `MysteryChoiceAudioPrompt`, `MysteryResponseToken`, `MysteryResponseBuildScene`, `MysterySceneAudio`, widened `MysteryScene`, widened `MysteryHistoryEntry`, widened `MysteryTranscriptItem`, `submitMysteryResponse`, `selectMysterySceneAudio`.
- Leaves the current five-scene content temporarily in place but valid under the widened contract.
- Consumed later by storage/validation, response UI, run controller/page, and final authored content.

- [ ] **Step 1: Add failing model tests for `response-build` transition semantics**

Use a local chapter fixture with `startSceneId: 'response-01'`, `targetPhrases: []`, the response scene below, and an `ending` scene:

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

Add:

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

Extend `MysteryChapter` with `targetPhrases: readonly MysteryTargetPhrase[]`; extend `MysteryScene` and `MysteryHistoryEntry` with only the response-build variants defined in the spec.

- [ ] **Step 4: Implement `submitMysteryResponse()`**

Start with:

```ts
if (progress.currentSceneId !== expectedSceneId) return progress;
```

Then require `scene.kind === 'response-build'`, reject unknown/duplicate submitted token IDs, append the closed response history entry, resolve `scene.nextSceneId`, and advance regardless of correctness.

Use `mystery_response_token_not_found`, `mystery_duplicate_response_token`, and the existing `mystery_invalid_transition` only.

- [ ] **Step 5: Add `selectMysterySceneAudio()` and its four-kind tests**

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

Pin message, ending, text-choice, audio-choice, and response-build outputs explicitly.

- [ ] **Step 6: Widen transcript items with optional audio and make projection exhaustive**

Use:

```ts
type MysteryTranscriptAudio = {
  audio?: MysterySceneAudio;
};
```

Remove required choice `ttsId` fields. Add `choice-result.explanation`, `response-prompt`, and `response-result(selectedText, correctText, result, feedback, explanation)`.

For every completed/current scene call `selectMysterySceneAudio(scene)` and set `audio` only when non-null. Replace the current catch-all ending branch with an explicit switch over `message`, `choice`, `response-build`, and `ending`.

For completed response results, compare resolved token-text arrays, not identities, and join visible Japanese with `join('')`.

- [ ] **Step 7: Make the existing five-scene `content.ts` satisfy the widened model now**

Add `targetPhrases: []` at chapter level. Keep the existing message and ending objects unchanged. Replace only the current scene-03 object with this exact temporary text-choice object:

```ts
{
  kind: 'choice',
  id: 'scene-03',
  speaker: 'mina',
  prompt: 'どう返事をしますか？',
  options: [
    {
      id: 'understood',
      label: 'わかりました',
      result: 'correct',
      feedback: '「わかりました」という短い返事が送られました。',
      nextSceneId: 'scene-04',
    },
    {
      id: 'hesitant',
      label: '少し待って…',
      result: 'incorrect',
      feedback: '少し迷ったけれど、返事を送りました。',
      nextSceneId: 'scene-04',
    },
  ],
  hint: '「わかりました」は、理解したことを伝える返事です。',
  explanation: '短い返事でも、相手に理解したことを伝えられます。',
  targetPhraseIds: [],
},
```

Do not add `audioPrompt` or a response-build scene to the real content in Task 1.

- [ ] **Step 8: Change `useMysteryAudio` to consume the model selector**

Delete `authoredTextFor()` and remove direct `scene.ttsId` assumptions from prepare/invalidate paths. After the usable-session check:

```ts
const audio = selectMysterySceneAudio(scene);
if (!audio) return;
```

Use `audio.ttsId` and `audio.text` for `preparePronunciation()` and `invalidatePronunciation()`. Pass the selected audio identity through helper functions so widened `MysteryScene` is never assumed to own `ttsId`.

Preserve all existing cancellation/playback semantics.

- [ ] **Step 9: Add exact optional-audio regressions**

Create this local fixture in `useMysteryAudio.test.ts`:

```ts
const audioChoice: MysteryChoiceScene = {
  kind: 'choice',
  id: 'audio-choice',
  speaker: 'haru',
  prompt: '音声を聞いて選んでください。',
  audioPrompt: {
    ttsId: 'mystery-audio-choice-test',
    text: '青いノートはミナさんのです。',
  },
  options: [
    {
      id: 'mina',
      label: 'ミナさん',
      result: 'correct',
      feedback: '正しいです。',
      nextSceneId: 'ending',
    },
    {
      id: 'haru',
      label: 'ハルさん',
      result: 'incorrect',
      feedback: 'もう一度聞いてみましょう。',
      nextSceneId: 'ending',
    },
  ],
  hint: '「ミナさん」に注目してください。',
  explanation: '「の」は持ち主を表します。',
  targetPhraseIds: [],
};
```

Assert:

```ts
expect(ttsService.preparePronunciation).toHaveBeenCalledWith(
  {
    userId: 'user-1',
    vocabularyId: 'mystery-audio-choice-test',
    text: '青いノートはミナさんのです。',
  },
  { signal: expect.any(AbortSignal) },
);
```

Also pin text-choice play -> no TTS, response-build play -> no TTS, message behavior unchanged, and media-unavailable on this audio choice invalidates `mystery-audio-choice-test`.

- [ ] **Step 10: Update `MysteryTranscript.vue` and tests in the same task**

Render explicit branches for message, choice-result, choice-prompt, response-result, response-prompt, and ending. Render replay only when `item.audio` exists.

Pin:

```text
text choice prompt/result -> no replay
audio choice prompt/result -> replay present
message/ending -> replay present
response prompt/result -> no replay
```

- [ ] **Step 11: Update every affected current fixture/import**

Run:

```bash
rg "MYSTERY_MESSENGER_VERTICAL_SLICE|MysteryChoiceScene|kind: 'choice'" \
  apps/vela-mobile/src/features/mystery-messenger
```

Update typed chapter/choice fixtures in `model.test.ts`, `useMysteryAudio.test.ts`, `useMysteryMessenger.test.ts`, `MysteryChoiceComposer.test.ts`, `MysteryMessengerPage.test.ts`, `validate-content.test.ts`, `storage.test.ts`, and `MysteryTranscript.test.ts`. Every chapter fixture gains `targetPhrases`; every typed choice fixture gains `hint`, `explanation`, and `targetPhraseIds`; only listening-specific fixtures gain `audioPrompt`.

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

Use a local chapter with a response-build scene. Cover valid round-trip and reset/deletion for: response entry pointing at a non-response scene, non-array `selectedTokenIds`, unknown token ID, duplicate token ID, and chapter-version mismatch.

Keep this key assertion:

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

Require:

```ts
scene.kind === 'response-build'
Array.isArray(entry.selectedTokenIds)
entry.selectedTokenIds.every((id) => scene.tokens.some((token) => token.id === id))
new Set(entry.selectedTokenIds).size === entry.selectedTokenIds.length
```

Keep ending out of history and do not persist partial composer UI state.

- [ ] **Step 4: Write failing validator tests for the new rules**

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

Also prove response `nextSceneId` participates in dangling-reference and reachability checks.

- [ ] **Step 5: Run validator tests and verify failure**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/validate-content.test.ts
```

Expected: FAIL for the new rules.

- [ ] **Step 6: Extend the current Map + graph validator**

For response-build validate: destination exists, token IDs unique, correct IDs exist and are not repeated, and target phrase references exist. For choice validate target phrase references in addition to existing options. For target phrases validate unique IDs and existing source scenes.

Require exactly one ending. Traverse message/response single edges and every choice option edge. TTS markup validation inspects only `message.text`, `ending.text`, and `choice.audioPrompt?.text`, matching `selectMysterySceneAudio()`.

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
- Consumes: Task 1 `MysteryResponseBuildScene` and transcript rendering.
- Produces: `MysteryResponseBuildComposer` with `submit: [selectedTokenIds]` and ephemeral Hint behavior for both interaction composers.

- [ ] **Step 1: Write response-composer tests first**

Use a scrambled token fixture containing two separate visible `に` IDs and `。`. Cover exact-ID selection/removal, punctuation, Clear, Hint, ordered submit, empty-send disabled, and parent-disabled controls.

Use test IDs:

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

- [ ] **Step 3: Implement the response composer with only local state**

```ts
const selectedTokenIds = ref<string[]>([]);
const showHint = ref(false);

const availableTokens = computed(() => {
  const selected = new Set(selectedTokenIds.value);
  return props.scene.tokens.filter((token) => !selected.has(token.id));
});
```

Emit copied ordered IDs:

```ts
const emit = defineEmits<{
  submit: [selectedTokenIds: readonly string[]];
}>();

emit('submit', [...selectedTokenIds.value]);
```

No drag/drop, score state, Pinia, backend question fetch, or runtime shuffle.

- [ ] **Step 4: Add ephemeral Hint behavior to `MysteryChoiceComposer.vue`**

Use local `showHint` and test IDs `mystery-choice-hint` / `mystery-choice-hint-copy`. Keep option selection unchanged; page keying by scene ID handles reset. Hint emits no story transition.

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
- Consumes: Task 1 `submitMysteryResponse`; Task 3 response composer; Task 1 audio/transcript behavior.
- Produces: controller/page response submission using existing auth, persistence, replay, and 500 ms transition semantics.

- [ ] **Step 1: Add failing `useMysteryMessenger` tests**

Add:

```ts
submitResponse(expectedSceneId: string, selectedTokenIds: readonly string[]): void;
```

Cover one-save usable transition, stale no-save, recovering/unavailable no-op, and save-failure warning with in-memory advance.

- [ ] **Step 2: Implement through existing `transition()`**

```ts
submitResponse: (expectedSceneId, selectedTokenIds) =>
  transition((current) =>
    submitMysteryResponse(chapter, current, expectedSceneId, selectedTokenIds),
  ),
```

No new auth or persistence branch.

- [ ] **Step 3: Add failing page tests**

Cover response composer rendering, first Send submission, second Send ignored inside 500 ms, submission enabled again after 500 ms, unusable-session disable, and Hint not acquiring the story lock.

Also cover the replay surface:

```text
text choice -> no transcript replay control
listening choice -> replay control present
listening replay -> audio.play(listeningScene)
```

- [ ] **Step 4: Wire the page**

```ts
const currentResponseBuild = computed(() =>
  currentScene.value?.kind === 'response-build' ? currentScene.value : null,
);

function handleResponseSubmit(selectedTokenIds: readonly string[]): void {
  if (!lockTransition()) return;
  const scene = messenger.currentScene.value;
  if (scene?.kind !== 'response-build') return;
  messenger.submitResponse(scene.id, selectedTokenIds);
}
```

Template order is message Continue -> choice composer keyed by scene ID -> response composer keyed by scene ID -> ending Restart. Keep replay resolving `sceneId` then calling `audio.play(scene)`.

- [ ] **Step 5: Run focused controller/page tests**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/features/mystery-messenger/useMysteryMessenger.test.ts \
  src/features/mystery-messenger/MysteryMessengerPage.test.ts
```

Expected: PASS.

- [ ] **Step 6: Re-run Task-1 audio/transcript regressions**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/features/mystery-messenger/useMysteryAudio.test.ts \
  src/features/mystery-messenger/components/MysteryTranscript.test.ts
```

Expected: PASS; text choice remains silent/no-replay and listening choice uses `audioPrompt`.

- [ ] **Step 7: Commit**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.ts \
  apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.test.ts \
  apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue \
  apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts
git commit -m "feat(mobile): wire full mystery interactions"
```

---

### Task 5: Replace temporary content with the frozen 13-scene pilot

**Files:**
- Modify: `apps/vela-mobile/src/features/mystery-messenger/content.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/model.test.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/validate-content.test.ts`
- Modify all feature imports still referencing `MYSTERY_MESSENGER_VERTICAL_SLICE`.

**Interfaces:**
- Produces: `MYSTERY_MESSENGER_PILOT` satisfying the final `MysteryChapter` contract.
- Canonical authored values come only from **Spec → Frozen Pilot Copy and Token Sheet**. Do not invent alternate Japanese, token segmentation, target-phrase readings, or TTS IDs.

- [ ] **Step 1: Add real-content chapter-shape tests**

```ts
expect(MYSTERY_MESSENGER_PILOT.id).toBe('mystery-message-tomorrow-v1');
expect(MYSTERY_MESSENGER_PILOT.version).toBe(2);
expect(MYSTERY_MESSENGER_PILOT.title).toBe('明日からのメッセージ');
expect(MYSTERY_MESSENGER_PILOT.scenes).toHaveLength(13);
expect(MYSTERY_MESSENGER_PILOT.targetPhrases).toHaveLength(6);
expect(validateMysteryChapter(MYSTERY_MESSENGER_PILOT)).toEqual([]);
```

Pin exactly one ending, exactly speakers `mina`/`haru`, convergence of every choice, and one content-specific walk visiting all 13 IDs exactly once by following single edges and the first choice edge.

- [ ] **Step 2: Add local lookup helpers and pin the frozen assessed copy**

Use helpers defined in the test itself:

```ts
function target(id: string) {
  const phrase = MYSTERY_MESSENGER_PILOT.targetPhrases.find((candidate) => candidate.id === id);
  expect(phrase).toBeDefined();
  return phrase!;
}

function scene(id: string) {
  const found = MYSTERY_MESSENGER_PILOT.scenes.find((candidate) => candidate.id === id);
  expect(found).toBeDefined();
  return found!;
}
```

Pin:

```ts
expect(target('tomorrow-seven').text).toBe('あしたの朝7時');
expect(target('mina-possession').reading).toBe('ミナさんのです');
```

For scene 05:

```ts
const scene05 = scene('scene-05');
expect(scene05.kind).toBe('choice');
if (scene05.kind === 'choice') {
  expect(scene05.audioPrompt).toEqual({
    ttsId: 'mystery-message-tomorrow-v2-scene-05-audio',
    text: '青いノートはミナさんのです。きのう、駅に忘れました。',
  });
}
```

For scene 07:

```ts
const scene07 = scene('scene-07');
expect(scene07.kind).toBe('response-build');
if (scene07.kind === 'response-build') {
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
    'time', 'ni-time', 'train', 'de', 'station', 'ni-place', 'go', 'period',
  ]);
}
```

For scene 11:

```ts
const scene11 = scene('scene-11');
expect(scene11.kind).toBe('response-build');
if (scene11.kind === 'response-build') {
  expect(scene11.tokens).toEqual([
    { id: 'please', text: 'ください' },
    { id: 'period', text: '。' },
    { id: 'again', text: 'もう一度' },
    { id: 'say', text: '言って' },
  ]);
  expect(scene11.correctTokenIds).toEqual(['again', 'say', 'please', 'period']);
}
```

- [ ] **Step 3: Run content tests and verify failure**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/features/mystery-messenger/model.test.ts \
  src/features/mystery-messenger/validate-content.test.ts
```

Expected: FAIL because the final pilot export/content does not exist yet.

- [ ] **Step 4: Replace `content.ts` using the canonical frozen sheet**

Rename the export to `MYSTERY_MESSENGER_PILOT`. Set the top-level identity exactly:

```ts
id: 'mystery-message-tomorrow-v1',
version: 2,
title: '明日からのメッセージ',
startSceneId: 'scene-01',
```

Then copy the complete six-record `targetPhrases` array and complete 13-scene `scenes` array from **Spec → Frozen Pilot Copy and Token Sheet**, including every option label, Hint, explanation, target reference, token ID/text pair, correct token sequence, message/ending TTS ID, and scene-05 `audioPrompt`.

Do not reuse HPA-299 `...-v1-*` TTS IDs. Use the frozen `mystery-message-tomorrow-v2-*` IDs because `MobileTtsService` treats vocabulary ID as immutable cache identity for text.

- [ ] **Step 5: Update all feature imports**

```bash
rg "MYSTERY_MESSENGER_VERTICAL_SLICE" apps/vela-mobile/src/features/mystery-messenger
```

Update every runtime/test reference to `MYSTERY_MESSENGER_PILOT`. Re-run the command; expected: no matches under feature runtime/tests.

- [ ] **Step 6: Add the real duplicate-token semantic regression**

For scene 07 submit:

```ts
['time', 'ni-place', 'train', 'de', 'station', 'ni-time', 'go', 'period']
```

Expect `response-result.result === 'correct'`. Then remove `period` from the correct sequence and expect `incorrect`.

- [ ] **Step 7: Pin real-content audio selection**

Assert `selectMysterySceneAudio()` returns `null` for scene 03, exact scene-05 `audioPrompt` for scene 05, `null` for scene 09, and `null` for response scenes 07/11.

- [ ] **Step 8: Run all Mystery Messenger tests and typecheck**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger
bun run --cwd apps/vela-mobile typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

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

- [ ] **Step 1: Run complete mobile coverage**

```bash
bun run --cwd apps/vela-mobile test:coverage
```

Expected: PASS with existing mobile line threshold >=95%.

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

- [ ] **Step 4: Run production-shaped local build**

```bash
MOBILE_SKIP_ENV_VALIDATION=1 bun run --cwd apps/vela-mobile build
```

Expected: PASS. CI owns the real configured environment path.

- [ ] **Step 5: Review Codecov when the PR is ready for CI**

Expected: patch coverage >=90%. Add focused tests rather than lowering thresholds. Codecov is a final gate, not evidence for Task-1 typecheck closure or listening audio identity.

- [ ] **Step 6: Perform the manual Japanese pass against the frozen sheet**

Verify:

```text
learner-facing mystery word is consistently あした; title kanji stays intentional
relative-time logic is understandable
tomorrow-seven is exactly あしたの朝7時
mina-possession reading preserves ミナ rather than ambiguous みな
all English meanings are accurate
scene-07 particles and duplicate に placement are natural
scene-11 segmentation is exactly もう一度 / 言って / ください / 。
audio prompt is natural spoken Japanese
hints are short and relevant
explanations are beginner-friendly
no TTS-bound string contains HTML/SSML markup
```

If copy changes, update the design spec frozen sheet, `content.ts`, and pinned real-content test in the same commit.

- [ ] **Step 7: Run focused iOS Simulator smoke acceptance**

Exercise:

```text
Learn -> Mystery Messenger
scene 03: no replay; wrong answer still advances
scene 05: replay speaks 青いノートはミナさんのです。きのう、駅に忘れました。 rather than the visible instruction
scene 07: use both distinct に tokens and punctuation
restart/re-enter once to confirm version-2 chapter persistence/reset behavior
scene 09: Hint works; no replay
scene 11: exact もう一度 / 言って / ください / 。 tokens; wrong order still advances
scene 13 ending reached
restart produces a clean run
```

Also verify existing `Tap play again` gesture fallback and background cancellation on scene 05.

- [ ] **Step 8: Final diff scope review**

Confirm only HPA-300 planning docs plus Mystery Messenger runtime/tests changed; no router/Learn/backend/shared-package/dependency changes unless a concrete regression forced one.

- [ ] **Step 9: Commit any verification fixes**

Use a scoped message such as:

```bash
git commit -m "fix(mobile): polish mystery pilot interactions"
```

Do not create a follow-up PR for HPA-300.

- [ ] **Step 10: Update Linear HPA-300 with final evidence**

Record coverage, lint/typecheck/build, Simulator smoke, manual Japanese pass, PR link, and explicit HPA-301/HPA-302 deferrals. Mark HPA-300 Done only after those gates pass.

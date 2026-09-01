# HPA-300 Mobile Mystery Messenger Full Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the existing five-scene Mystery Messenger into the complete 13-scene linear pilot with hints, one audio-backed choice, and tap-to-build Japanese responses.

**Architecture:** Extend the existing feature-local closed model with one `response-build` variant and a small target-phrase catalog. Keep immutable transitions, transcript projection, local snapshot persistence, content validation, auth orchestration, and TTS/audio in their current modules. Add one tap-to-order Vue component; do not add a story engine, shared package, Pinia state, backend work, or a web sentence-builder dependency.

**Tech Stack:** Vue 3, Quasar 2, TypeScript, Vue Router, Vitest, `@vue/test-utils`, existing Vela Mobile auth/TTS/audio services.

**Spec:** `docs/superpowers/specs/2026-08-31-mobile-mystery-messenger-full-pilot-design.md`

## Global Constraints

- One ticket and one PR: all HPA-300 work stays on the draft PR created from `codex/hpa-300-mystery-messenger-full-pilot`.
- Keep all runtime code under `apps/vela-mobile/src/features/mystery-messenger`.
- Keep exactly four closed scene variants: `message | choice | response-build | ending`.
- Final authored chapter: exactly 13 scenes, two recurring speakers (`mina`, `haru`), one path, one ending.
- Wrong answers always advance; hints never block progression.
- Hint visibility and partial response-builder drafts are ephemeral UI state in HPA-300.
- Keep browser `localStorage`; bump chapter version from 1 to 2 and do not migrate old runs.
- Reuse the existing 500 ms page-local accidental-repeat guard.
- Reuse existing `MobileTtsService`, `MobileAudioPlayer`, lifecycle/auth/session contracts.
- No backend/API/CDK/DynamoDB/`@vela/common`/Pinia/story-engine/shared sentence-builder work.
- No missed-phrase persistence/recap/SRS mutation; HPA-301 owns that.
- No branching or alternate endings.
- No new mobile E2E framework.

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

### Task 1: Extend the closed model and pure transitions

**Files:**
- Modify: `apps/vela-mobile/src/features/mystery-messenger/model.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/model.test.ts`

**Interfaces:**
- Produces: `MysteryTargetPhrase`, `MysteryChoiceAudioPrompt`, `MysteryResponseToken`, `MysteryResponseBuildScene`, extended `MysteryScene`, extended `MysteryHistoryEntry`, extended `MysteryTranscriptItem`, `submitMysteryResponse`.
- Consumed later by storage, validation, components, controller, page, and final content.

- [ ] **Step 1: Add failing model tests for the new closed contracts**

Use a small local chapter fixture with one response scene:

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
  targetPhraseIds: ['station-plan'],
  nextSceneId: 'ending',
};
```

Cover:

```ts
it('stores a response-build history entry and advances on a correct answer', () => {
  const next = submitMysteryResponse(
    chapter,
    createMysteryProgress(chapter),
    'response-01',
    ['time', 'ni-time', 'station', 'ni-place', 'go', 'period'],
  );

  expect(next.history).toEqual([
    {
      kind: 'response-build',
      sceneId: 'response-01',
      selectedTokenIds: ['time', 'ni-time', 'station', 'ni-place', 'go', 'period'],
    },
  ]);
  expect(next.completed).toBe(true);
});
```

Also pin these behaviors:

```text
wrong known-token order -> advances and transcript result is incorrect
incomplete known-token answer -> advances and result is incorrect
stale expectedSceneId -> returns same progress object
unknown selected token ID -> throws mystery_response_token_not_found
duplicate selected token ID -> throws mystery_duplicate_response_token
swapped duplicate visible に IDs -> result remains correct
missing punctuation -> result is incorrect
```

- [ ] **Step 2: Run the focused model test and verify failure**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/model.test.ts
```

Expected: FAIL because `response-build` and `submitMysteryResponse` do not exist.

- [ ] **Step 3: Extend the model types minimally**

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

Add:

```ts
export type MysteryResponseToken = { id: string; text: string };

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

Extend `MysteryChapter` with `targetPhrases` and extend the scene/history unions exactly as defined in the spec.

- [ ] **Step 4: Implement `submitMysteryResponse()`**

Keep the same stale-first rule as the existing transitions:

```ts
if (progress.currentSceneId !== expectedSceneId) return progress;
```

Then require `scene.kind === 'response-build'`, resolve every selected token ID, reject duplicate IDs, append the closed history entry, and advance to `scene.nextSceneId` regardless of correctness.

Use fixed feature errors:

```text
mystery_invalid_transition
mystery_response_token_not_found
mystery_duplicate_response_token
```

- [ ] **Step 5: Extend transcript projection before touching Vue**

Add `response-prompt` and `response-result` transcript variants. For a completed response:

1. resolve selected token IDs to token text;
2. resolve `correctTokenIds` to correct token text;
3. compare the two text arrays, not raw IDs;
4. concatenate Japanese tokens with `join('')`;
5. select `scene.feedback.correct` or `.incorrect`; and
6. include `scene.explanation`.

Also add `explanation` to `choice-result`.

- [ ] **Step 6: Update existing model tests for choice hints/audio fields**

Every test fixture choice must now provide:

```ts
hint: 'ヒント',
explanation: '説明',
targetPhraseIds: [],
```

Remove the old required `ttsId` from choice fixtures. Add one fixture with `audioPrompt` and one without it.

- [ ] **Step 7: Run focused model tests**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/model.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/model.ts \
  apps/vela-mobile/src/features/mystery-messenger/model.test.ts
git commit -m "feat(mobile): extend mystery interaction model"
```

---

### Task 2: Extend storage and authored-content validation

**Files:**
- Modify: `apps/vela-mobile/src/features/mystery-messenger/storage.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/storage.test.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/validate-content.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/validate-content.test.ts`

**Interfaces:**
- Consumes: the Task 1 response/history/target-phrase contracts.
- Produces: persistence acceptance for response history and validation for the full chapter contract.

- [ ] **Step 1: Write failing storage tests for response history**

Cover valid round-trip plus deletion/reset for:

```text
response entry references non-response scene
unknown selected response token ID
duplicate selected response token ID
chapter version mismatch (v1 save loaded against v2 chapter)
```

Keep the existing storage key format unchanged.

- [ ] **Step 2: Run storage tests and verify failure**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/storage.test.ts
```

Expected: FAIL because the load boundary still accepts only `message | choice` history.

- [ ] **Step 3: Extend `isKnownProgress()` with one response-build branch**

Use a switch/closed-kind check. A response entry is valid only when:

```ts
scene.kind === 'response-build'
entry.selectedTokenIds is an array
all selected IDs exist in scene.tokens
new Set(entry.selectedTokenIds).size === entry.selectedTokenIds.length
```

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

Expected: FAIL for the new codes/scene variant.

- [ ] **Step 6: Extend `validateMysteryChapter()`**

Keep the current `Map` + graph traversal shape.

For every response scene:

```text
validate nextSceneId
validate unique token IDs
validate every correctTokenIds entry exists
validate correctTokenIds contains no repeated identity
validate targetPhraseIds
```

For every choice scene validate `targetPhraseIds`; preserve existing option validation.

For chapter target phrases validate unique IDs and existing `sourceSceneId`.

Require exactly one ending:

```ts
if (endingIds.length === 0) issues.push({ code: 'missing_ending' });
if (endingIds.length > 1) issues.push({ code: 'multiple_endings' });
```

During traversal, push `response-build.nextSceneId` as its only outgoing edge.

For TTS markup, inspect only text that can actually be sent to TTS:

```text
message.text
ending.text
choice.audioPrompt?.text
```

Flag `unsupported_tts_markup` when that text contains an HTML/SSML-like `<...>` tag.

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
- Modify: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryTranscript.vue`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryTranscript.test.ts`

**Interfaces:**
- Consumes: Task 1 scene/transcript types.
- Produces: `MysteryResponseBuildComposer` with `submit: [selectedTokenIds]` event; enriched choice/transcript rendering.

- [ ] **Step 1: Write response-composer tests first**

Use a scene whose available-token order is intentionally scrambled and contains two visible `に` values with different IDs plus `。`.

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
all mutating controls disabled when parent disabled=true
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

- [ ] **Step 3: Implement `MysteryResponseBuildComposer.vue`**

Keep only local state:

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

Tap handlers move IDs only. Render the selected Japanese as individual `q-btn`/`q-chip` controls keyed by token ID; do not use drag/drop or randomization.

- [ ] **Step 4: Add choice Hint behavior**

Extend `MysteryChoiceComposer.vue` with local `showHint` and test IDs:

```text
mystery-choice-hint
mystery-choice-hint-copy
```

Keep option selection unchanged. The page will key the component by scene ID, so no cross-scene reset watcher is needed.

- [ ] **Step 5: Extend transcript rendering**

Render `response-prompt` explicitly and `response-result` with:

```text
selectedText
feedback
explanation
```

Extend `choice-result` to show `explanation` after the existing selected label + feedback.

Do not use the old catch-all `v-else` for ending now that additional transcript kinds exist; make ending an explicit branch.

Only render replay when the item exposes audio/TTS identity. Text-only choices and response items have no replay button.

- [ ] **Step 6: Run focused component tests**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/features/mystery-messenger/components/MysteryResponseBuildComposer.test.ts \
  src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts \
  src/features/mystery-messenger/components/MysteryTranscript.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/components
git commit -m "feat(mobile): add tap-to-build mystery responses"
```

---

### Task 4: Wire response transitions and optional choice audio through existing controllers

**Files:**
- Modify: `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.test.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.test.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts`

**Interfaces:**
- Consumes: Task 1 `submitMysteryResponse`; Task 3 response composer.
- Produces: controller/page support for response submission and optional choice audio.

- [ ] **Step 1: Add failing `useMysteryMessenger` tests**

Add controller contract:

```ts
submitResponse(expectedSceneId: string, selectedTokenIds: readonly string[]): void;
```

Cover:

```text
usable owned run -> response transition saved once
stale response transition -> same object and no save
recovering/unavailable -> no mutation/no save
save failure -> in-memory progress advances and persistenceWarning=true
```

- [ ] **Step 2: Implement controller wiring**

Import `submitMysteryResponse` and expose:

```ts
submitResponse: (expectedSceneId, selectedTokenIds) =>
  transition((current) =>
    submitMysteryResponse(chapter, current, expectedSceneId, selectedTokenIds),
  ),
```

Do not add another persistence or auth branch.

- [ ] **Step 3: Add failing audio tests for optional choice audio**

Pin three cases:

```text
message -> existing text/ttsId request
choice with audioPrompt -> audioPrompt.text + audioPrompt.ttsId request
choice without audioPrompt -> no TTS request and state remains idle
response-build -> no TTS request and state remains idle
```

- [ ] **Step 4: Replace `authoredTextFor()` with one nullable audio selector**

Internal shape:

```ts
function authoredAudioFor(scene: MysteryScene): { ttsId: string; text: string } | null {
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

At the start of `play()` after the usable-session check, return when no authored audio exists. Use the selected `ttsId/text` consistently for prepare/invalidate logic; preserve all existing cancellation and playback-state behavior.

- [ ] **Step 5: Add failing page tests for response UI and rapid-send guard**

Extend the page test fixture/controller mock with `submitResponse`.

Cover:

```text
response scene renders MysteryResponseBuildComposer
first Send calls submitResponse(sceneId, ids)
second Send inside 500 ms is ignored
after 500 ms another Send can transition
unusable session disables response composer
hint does not trigger transition lock/story mutation
```

- [ ] **Step 6: Wire the page**

Add:

```ts
const currentResponseBuild = computed(() =>
  currentScene.value?.kind === 'response-build' ? currentScene.value : null,
);
```

Template order:

```text
message Continue
choice composer
response-build composer
ending Restart
```

Key both interaction composers by `scene.id`.

Handler:

```ts
function handleResponseSubmit(selectedTokenIds: readonly string[]): void {
  if (!lockTransition()) return;
  const scene = messenger.currentScene.value;
  if (scene?.kind !== 'response-build') return;
  messenger.submitResponse(scene.id, selectedTokenIds);
}
```

- [ ] **Step 7: Run focused controller/audio/page tests**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/features/mystery-messenger/useMysteryMessenger.test.ts \
  src/features/mystery-messenger/useMysteryAudio.test.ts \
  src/features/mystery-messenger/MysteryMessengerPage.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.ts \
  apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.test.ts \
  apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.ts \
  apps/vela-mobile/src/features/mystery-messenger/useMysteryAudio.test.ts \
  apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue \
  apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts
git commit -m "feat(mobile): wire full mystery interactions"
```

---

### Task 5: Replace the vertical-slice fixture with the complete authored pilot

**Files:**
- Modify: `apps/vela-mobile/src/features/mystery-messenger/content.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/model.test.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/validate-content.test.ts`
- Modify imports in page/tests that reference `MYSTERY_MESSENGER_VERTICAL_SLICE`.

**Interfaces:**
- Produces: `MYSTERY_MESSENGER_PILOT` satisfying the final `MysteryChapter` contract.

- [ ] **Step 1: Write the real-content tests before replacing content**

Pin:

```ts
expect(MYSTERY_MESSENGER_PILOT.version).toBe(2);
expect(MYSTERY_MESSENGER_PILOT.scenes).toHaveLength(13);
expect(MYSTERY_MESSENGER_PILOT.targetPhrases).toHaveLength(6);
expect(validateMysteryChapter(MYSTERY_MESSENGER_PILOT)).toEqual([]);
```

Pin exactly one ending and only the two existing speakers:

```ts
expect(chapter.scenes.filter((scene) => scene.kind === 'ending')).toHaveLength(1);
expect(
  new Set(
    chapter.scenes.flatMap((scene) =>
      'speaker' in scene ? [scene.speaker] : [],
    ),
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

Add one content-specific walk that starts at `startSceneId`, follows the single message/response edge and the first choice edge, and expects all 13 scene IDs exactly once before the ending. This is the one-path proof; do not add a generic branching framework.

- [ ] **Step 2: Run content tests and verify failure**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/features/mystery-messenger/model.test.ts \
  src/features/mystery-messenger/validate-content.test.ts
```

Expected: FAIL because the exported content is still the five-scene vertical slice.

- [ ] **Step 3: Rename the exported constant and set chapter version 2**

Use:

```ts
export const MYSTERY_MESSENGER_PILOT = {
  id: 'mystery-message-tomorrow-v1',
  version: 2,
  title: '明日からのメッセージ',
  // ...
} satisfies MysteryChapter;
```

Update all feature imports from `MYSTERY_MESSENGER_VERTICAL_SLICE` to `MYSTERY_MESSENGER_PILOT`.

- [ ] **Step 4: Author the six target phrases exactly**

```ts
targetPhrases: [
  {
    id: 'tomorrow-seven',
    text: 'あしたの朝7時',
    reading: 'あしたのあさしちじ',
    meaning: 'tomorrow at 7 a.m.',
    sourceSceneId: 'scene-02',
  },
  {
    id: 'mina-possession',
    text: 'ミナさんのです',
    reading: 'みなさんのです',
    meaning: "it is Mina's",
    sourceSceneId: 'scene-05',
  },
  {
    id: 'train-station-plan',
    text: '7時に電車でさくら駅に行きます',
    reading: 'しちじにでんしゃでさくらえきにいきます',
    meaning: 'I will go to Sakura Station by train at 7',
    sourceSceneId: 'scene-07',
  },
  {
    id: 'wrote-yesterday',
    text: 'きのう書きました',
    reading: 'きのうかきました',
    meaning: 'wrote it yesterday',
    sourceSceneId: 'scene-06',
  },
  {
    id: 'when-is-tomorrow',
    text: '「あした」はいつですか？',
    reading: 'あしたはいつですか',
    meaning: 'When is “tomorrow”?',
    sourceSceneId: 'scene-09',
  },
  {
    id: 'say-again',
    text: 'もう一度言ってください',
    reading: 'もういちどいってください',
    meaning: 'Please say it again',
    sourceSceneId: 'scene-11',
  },
],
```

- [ ] **Step 5: Author scenes 01–06**

Use these exact story beats/copy:

```text
scene-01 message mina
こんにちは。これは「あした」からのメッセージです。

scene-02 message mina
あしたの朝7時、電車でさくら駅に来てください。青いノートを持ってきてください。

scene-03 text choice mina
prompt: ミナさんは、いつ駅に来てほしいですか？
correct: あしたの朝7時
incorrect: きょうの朝7時
hint: 「あした」は tomorrow です。
explanation: 「あしたの朝7時」は “tomorrow at 7 a.m.” です。
targetPhraseIds: [tomorrow-seven]

scene-04 message haru
さくら駅で青いノートを見つけました。ノートに「きのう、ここに置きました」と書いてあります。

scene-05 audio-backed choice haru
visible prompt: 音声を聞いて、ノートはだれのものか選んでください。
audio text: 青いノートはミナさんのです。きのう、駅に忘れました。
correct: ミナさんのノートです
incorrect: ハルさんのノートです
hint: 「ミナさんのです」の「の」に注目してください。
explanation: 「Aのです」は、ここでは「Aのものです」という意味です。
targetPhraseIds: [mina-possession]

scene-06 message mina
そうです。きのう、駅に忘れました。でも、このメッセージもきのう書きました。
```

Give messages/endings stable scene TTS IDs. Give only scene 05 a choice `audioPrompt` TTS ID among choices.

- [ ] **Step 6: Author scene 07 with duplicate visible token identities and punctuation**

Prompt:

```text
ミナさんに、明日の予定を返事してください。
```

Tokens in authored available order:

```ts
[
  { id: 'station', text: 'さくら駅' },
  { id: 'ni-time', text: 'に' },
  { id: 'period', text: '。' },
  { id: 'train', text: '電車' },
  { id: 'go', text: '行きます' },
  { id: 'time', text: '7時' },
  { id: 'de', text: 'で' },
  { id: 'ni-place', text: 'に' },
]
```

Correct order:

```ts
['time', 'ni-time', 'train', 'de', 'station', 'ni-place', 'go', 'period']
```

Support copy:

```text
correct feedback: 予定をはっきり伝えられました。
incorrect feedback: 意味は伝わりました。正しい語順も確認しておきましょう。
hint: 時間の「に」を先に、場所の「に」をあとに置きます。
explanation: 「7時に」で時間、「さくら駅に」で行き先を表します。
targetPhraseIds: [train-station-plan]
```

- [ ] **Step 7: Author scenes 08–13**

Use:

```text
scene-08 message haru
ちょっと待ってください。メッセージは今日届きました。でも、ミナさんは「きのう書きました」と言いました。

scene-09 text choice
prompt: 何を確認するのが一番いいですか？
correct: 「あした」はいつですか？
incorrect: ノートは何色ですか？
hint: 今の謎は、日にちのことです。
explanation: 「いつですか？」は日時を確認するときに使います。
targetPhraseIds: [wrote-yesterday, when-is-tomorrow]

scene-10 message mina
「あした」は、メッセージを書いたきのうから見た今日のことです。

scene-11 response-build
prompt: もう一度、説明を聞きたいと伝えてください。
correct visible response: もう一度言ってください。
feedback correct: 丁寧に聞き返せました。
feedback incorrect: 意味は伝わりました。自然な言い方も確認しましょう。
hint: 「もう一度」= one more time です。
explanation: 「もう一度言ってください」は、丁寧に repetition を頼む表現です。
targetPhraseIds: [say-again]

scene-12 message mina
きのうの夜、このメッセージを書きました。そして、今日の朝に送るようにしました。だから、きのうの「あした」が今日になりました。

scene-13 ending
Title: 「あした」の正体
未来からのメッセージではありませんでした。きのう書いた「あした」のメッセージが、今日届いただけでした。青いノートもミナさんのものだと分かり、謎は解けました。
```

Scene 11 tokens must include `。` as a normal selectable token and no randomization.

- [ ] **Step 8: Add the real duplicate-token semantic regression**

For scene 07, submit:

```ts
['time', 'ni-place', 'train', 'de', 'station', 'ni-time', 'go', 'period']
```

Expect `response-result.result === 'correct'` because both swapped identities render the same `に` sequence.

Also remove `period` and expect `incorrect`.

- [ ] **Step 9: Run all mystery-messenger tests**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger
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
- Modify only files that fail review/tests or require Japanese copy correction.
- Update this PR description/checklist with final evidence; do not create another PR.

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

- [ ] **Step 3: Run type-check**

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

- [ ] **Step 6: Perform the manual Japanese pass**

Read all 13 scenes and six target phrases in sequence. Verify:

```text
relative-time logic is understandable: yesterday -> today's delivery -> yesterday's “tomorrow”
all readings match the authored Japanese
all English meanings are accurate
particles in both response-build answers are natural
audio prompt is natural spoken Japanese
hints do not reveal unrelated information
explanations are short and beginner-friendly
no TTS-bound string contains HTML/SSML markup
```

Correct copy directly in `content.ts` and rerun focused content tests after any change.

- [ ] **Step 7: Run focused iOS Simulator smoke acceptance**

Exercise one complete run:

```text
Learn -> Mystery Messenger
scene 03 text choice: try wrong answer; story continues
scene 05 audio choice: cold replay, then select answer
scene 07 response: select both distinct に tokens and punctuation; send
restart/re-enter once to confirm version-2 persistence
scene 09 use Hint; choose answer
scene 11 use Hint; send a wrong known-token order; story continues
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

Record coverage, lint/typecheck/build, Simulator smoke, manual Japanese pass, PR link, and any explicit deferrals to HPA-301/HPA-302. Then mark HPA-300 Done only after those gates pass.

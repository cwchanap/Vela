# HPA-300 Mobile Mystery Messenger Full Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the existing five-scene Mystery Messenger into the complete 13-scene linear chapter with hints, replayable Japanese choice prompts, one listening-specific choice, and tap-to-build Japanese responses that accept explicitly authored alternate valid word orders.

**Architecture:** Extend the existing feature-local closed model with one `response-build` variant and a small target-phrase catalog. Keep immutable transitions, transcript projection, local snapshot persistence, content validation, auth orchestration, and TTS/audio in their current modules. Add one tap-to-order Vue component; do not add a story engine, grammar engine, shared package, Pinia state, backend work, or web sentence-builder dependency.

**Tech Stack:** Vue 3, Quasar 2, TypeScript, Vue Router, Vitest, `@vue/test-utils`, existing Vela Mobile auth/TTS/audio services.

**Spec:** `docs/superpowers/specs/2026-08-31-mobile-mystery-messenger-full-pilot-design.md`

## Global Constraints

- One ticket and one PR: all HPA-300 work stays on PR #63 / `codex/hpa-300-mystery-messenger-full-pilot`.
- Keep runtime story code under `apps/vela-mobile/src/features/mystery-messenger`.
- Keep exactly four scene variants: `message | choice | response-build | ending`.
- Final chapter: exactly 13 scenes, two recurring speakers (`mina`, `haru`), one path, one ending.
- Wrong answers always advance; hints never block progression.
- Hint visibility and partial response drafts stay ephemeral in HPA-300.
- Keep browser `localStorage`; bump chapter version from 1 to 2 and do not migrate old runs.
- Keep chapter ID `mystery-message-tomorrow-v1` and storage-key `:v1` suffix.
- Use fresh `mystery-message-tomorrow-v2-*` TTS IDs for the rewritten/new chapter audio.
- Reuse the existing 500 ms page-local accidental-repeat guard.
- Reuse `MobileTtsService`, `MobileAudioPlayer`, lifecycle/auth/session contracts.
- Keep `audioPrompt` optional in the model; the final authored scenes 03, 05, and 09 all provide audio.
- Keep `MysteryTargetPhrase` to `id | text | reading | meaning`; do not add `sourceSceneId` in HPA-300.
- Response correctness is canonical visible text OR an authored alternate visible-text sequence; do not add a grammar parser.
- No backend/API/CDK/DynamoDB/`@vela/common`/Pinia/story-engine/shared sentence-builder work.
- No missed-phrase persistence/recap/SRS mutation; HPA-301 owns that.
- No branching or alternate endings.
- No new mobile E2E framework.
- `unsupported_tts_markup` is not a validator issue code; the real-content test still asserts no TTS-bound string contains markup.

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
apps/vela-mobile/src/pages/LearnPage.vue
apps/vela-mobile/src/pages/LearnPage.test.ts
```

No router, backend, workspace dependency, or shared-package changes are expected.

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
- Leaves the existing five-scene content in place temporarily but valid under the widened contract.
- Ends with all affected unit tests and full mobile typecheck green.

- [ ] **Step 1: Add failing model tests for response transition and alternate-answer semantics**

Use a local chapter fixture with `targetPhrases: []` and one `response-build` scene:

```ts
const responseScene: MysteryResponseBuildScene = {
  kind: 'response-build',
  id: 'response-01',
  prompt: '返事を作ってください。',
  tokens: [
    { id: 'time', text: '7時' },
    { id: 'ni-time', text: 'に' },
    { id: 'train', text: '電車' },
    { id: 'de', text: 'で' },
    { id: 'station', text: '駅' },
    { id: 'ni-place', text: 'に' },
    { id: 'go', text: '行きます' },
    { id: 'period', text: '。' },
  ],
  correctTokenIds: ['time', 'ni-time', 'train', 'de', 'station', 'ni-place', 'go', 'period'],
  alternateAnswerTokenIds: [
    ['train', 'de', 'time', 'ni-time', 'station', 'ni-place', 'go', 'period'],
  ],
  feedback: { correct: '正しいです。', incorrect: '例の語順も確認しましょう。' },
  hint: '時間と行き先の「に」を見てください。',
  explanation: '時間と行き先に「に」を使います。',
  targetPhraseIds: [],
  nextSceneId: 'ending',
};
```

Cover:

```text
canonical answer -> response-build history + advance + correct transcript result
authored alternate word order -> advance + correct transcript result
wrong known-token order -> advance + incorrect result
incomplete known-token answer -> advance + incorrect result
stale expectedSceneId -> exact same progress object
unknown selected token ID -> mystery_response_token_not_found
duplicate selected token identity -> mystery_duplicate_response_token
swapped duplicate visible に identities -> remains correct when visible text is unchanged
missing punctuation -> incorrect
correctText always comes from canonical correctTokenIds, including when alternate was accepted
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
  alternateAnswerTokenIds?: readonly (readonly string[])[];
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

Extend `MysteryChapter` with `targetPhrases: readonly MysteryTargetPhrase[]`, and extend the scene/history unions only with `response-build`.

- [ ] **Step 4: Implement `submitMysteryResponse()`**

Keep stale-first behavior:

```ts
if (progress.currentSceneId !== expectedSceneId) return progress;
```

Then require the actual current scene to be `response-build`, reject unknown/duplicate selected IDs, append a copied `selectedTokenIds` array to history, resolve `nextSceneId`, and advance regardless of correctness.

Use only these new transition errors:

```text
mystery_response_token_not_found
mystery_duplicate_response_token
```

Wrong current scene kind keeps `mystery_invalid_transition`.

- [ ] **Step 5: Extend transcript correctness to canonical or authored alternate visible text**

Inside transcript projection, resolve token IDs to visible token-text arrays:

```ts
const selectedTextTokens = resolveResponseTokenText(scene, entry.selectedTokenIds);
const canonicalTextTokens = resolveResponseTokenText(scene, scene.correctTokenIds);
const alternateTextTokens = (scene.alternateAnswerTokenIds ?? []).map((ids) =>
  resolveResponseTokenText(scene, ids),
);

const correct =
  arraysEqual(selectedTextTokens, canonicalTextTokens) ||
  alternateTextTokens.some((candidate) => arraysEqual(selectedTextTokens, candidate));
```

Keep `selectedText` and canonical `correctText` as `join('')`. Do not persist correctness.

- [ ] **Step 6: Add the pure scene-audio selector and tests**

```ts
export type MysterySceneAudio = { ttsId: string; text: string };

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

Pin message, ending, audio choice, synthetic text-only choice, and response-build cases.

- [ ] **Step 7: Widen transcript items with optional audio and make projection exhaustive**

Add `choice-result.explanation`, `response-prompt`, and `response-result`. Remove required choice `ttsId` fields and project optional `audio?: MysterySceneAudio` from `selectMysterySceneAudio()`.

Switch explicitly over:

```text
message
choice
response-build
ending
```

Do not retain a catch-all `else => ending` branch.

- [ ] **Step 8: Update the temporary five-scene `content.ts` immediately**

Keep the five existing scenes through Tasks 1–4, but add `targetPhrases: []`, choice `hint`, `explanation`, and `targetPhraseIds: []`.

Convert the existing scene-03 audio instead of dropping it:

```ts
audioPrompt: {
  ttsId: 'mystery-message-tomorrow-v1-scene-03-prompt',
  text: 'どう返事をしますか？',
},
```

Do not add a response-build scene to real content yet.

- [ ] **Step 9: Change `useMysteryAudio` to consume `selectMysterySceneAudio()`**

Delete `authoredTextFor()` and remove direct `scene.ttsId` assumptions from prepare/invalidate paths.

After the usable-session check:

```ts
const audio = selectMysterySceneAudio(scene);
if (!audio) return;
```

Use `audio.ttsId` and `audio.text` consistently through TTS prepare, ready replay, and `media_unavailable` invalidation.

- [ ] **Step 10: Add exact audio regressions**

Pin:

```text
synthetic text-only choice -> no TTS call, state idle
response-build -> no TTS call, state idle
audio choice -> preparePronunciation receives audioPrompt.ttsId + audioPrompt.text
media_unavailable choice -> invalidates audioPrompt.ttsId
message -> existing audio behavior remains
```

- [ ] **Step 11: Update `MysteryTranscript.vue` and tests**

Render each transcript kind explicitly. Replay button exists only when `item.audio` exists.

Tests must prove:

```text
text-only synthetic choice prompt/result -> no replay
audio choice prompt/result -> replay
response prompt/result -> no replay
message/ending -> replay
response result -> selected text + feedback + explanation
```

- [ ] **Step 12: Update every affected fixture to the widened contracts**

Update choice fixtures with `hint`, `explanation`, `targetPhraseIds`, and `audioPrompt` only when audio is expected. Add `targetPhrases` to local chapter fixtures. Do not postpone these edits to Tasks 2–4.

- [ ] **Step 13: Run the closed compile-unit gate**

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

Expected: all commands PASS before Task 2 starts.

- [ ] **Step 14: Commit**

```bash
git add apps/vela-mobile/src/features/mystery-messenger
git commit -m "feat(mobile): extend mystery interaction model"
```

---

### Task 2: Extend persistence and authored-content validation

**Files:**
- Modify: `apps/vela-mobile/src/features/mystery-messenger/storage.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/storage.test.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/validate-content.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/validate-content.test.ts`

**Interfaces:**
- Consumes: Task-1 response/history/target-phrase contracts.
- Produces: response-history load acceptance plus structural validation for response answers and target references.

- [ ] **Step 1: Add failing storage tests for response history**

Cover valid round-trip plus reset/delete for:

```text
response history points at non-response scene
selectedTokenIds is not an array
unknown selected token ID
duplicate selected token identity
chapter version mismatch (v1 progress against v2 chapter)
```

Keep the storage-key function unchanged.

- [ ] **Step 2: Run storage tests and verify failure**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/storage.test.ts
```

Expected: FAIL because load validation still accepts only message/choice history.

- [ ] **Step 3: Extend `isKnownProgress()` with one response-build branch**

Require:

```ts
scene.kind === 'response-build'
Array.isArray(entry.selectedTokenIds)
entry.selectedTokenIds.every((id) => scene.tokens.some((token) => token.id === id))
new Set(entry.selectedTokenIds).size === entry.selectedTokenIds.length
```

Do not persist draft tokens or hint state.

- [ ] **Step 4: Add failing validator tests**

Extend the issue union only with:

```text
duplicate_target_phrase_id
unknown_target_phrase_reference
duplicate_response_token_id
invalid_response_answer_token
multiple_endings
```

Cover:

```text
response-build dangling nextSceneId
response-build edge participates in ending reachability
duplicate response token identity
canonical correct answer references unknown token
canonical correct answer repeats one token identity
alternate answer references unknown token
alternate answer repeats one token identity
duplicate target phrase ID
choice target phrase reference missing
response target phrase reference missing
multiple endings
```

Do not add `dangling_target_phrase_source` or `unsupported_tts_markup`.

- [ ] **Step 5: Run validator tests and verify failure**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/validate-content.test.ts
```

Expected: FAIL for the new scene/issue rules.

- [ ] **Step 6: Extend `validateMysteryChapter()` with the existing Map + traversal shape**

For response scenes:

```text
validate nextSceneId
validate unique token IDs
validate canonical answer IDs
validate each alternateAnswerTokenIds answer IDs
validate targetPhraseIds
```

Use `invalid_response_answer_token` for unknown or repeated token identity inside canonical or alternate answers; do not add another issue code.

For chapter target phrases, validate unique IDs only. For choice/response interactions, validate every `targetPhraseIds` reference.

Require exactly one ending:

```ts
if (endingIds.length === 0) issues.push({ code: 'missing_ending' });
if (endingIds.length > 1) issues.push({ code: 'multiple_endings' });
```

Traversal edges:

```text
message -> nextSceneId
choice -> every option nextSceneId
response-build -> nextSceneId
ending -> none
```

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
git commit -m "feat(mobile): validate full mystery content"
```

---

### Task 3: Add tap-to-order responses and ephemeral assistance UI

**Files:**
- Create: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryResponseBuildComposer.vue`
- Create: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryResponseBuildComposer.test.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.vue`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts`

**Interfaces:**
- Consumes: `MysteryResponseBuildScene` from Task 1.
- Produces: response composer emitting ordered token IDs plus local Hint behavior for choice/response interaction components.

- [ ] **Step 1: Write response-composer tests first**

Use a scene with authored scrambled token order, two distinct IDs rendering `に`, and `。`.

Cover:

```text
tap available token -> append exact ID
two visible に buttons independently addressable
tap selected token -> remove only that ID
punctuation selectable/removable
Clear -> empty selection
Hint -> reveal/hide authored hint
Send -> emit selected IDs in tap order
Send disabled with no selected tokens
response-changing controls disabled when disabled=true
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

- [ ] **Step 3: Implement `MysteryResponseBuildComposer.vue` with local state only**

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

Tap handlers move identities only. Emit a copied array:

```ts
emit('submit', [...selectedTokenIds.value]);
```

Do not use drag/drop, randomization, scoring, Pinia, or backend questions.

- [ ] **Step 4: Add Hint behavior to `MysteryChoiceComposer.vue`**

Use local `showHint` and test IDs:

```text
mystery-choice-hint
mystery-choice-hint-copy
```

Keep option selection unchanged. The page will key the component by scene ID, so no reset watcher or persisted hint state is needed.

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

### Task 4: Wire response submission through the existing controller and page

**Files:**
- Modify: `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.test.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts`

**Interfaces:**
- Consumes: Task-1 `submitMysteryResponse`; Task-3 response composer.
- Produces: authenticated/persisted response submission using the existing transition helper and page rapid-transition lock.

- [ ] **Step 1: Add failing `useMysteryMessenger` tests**

Extend controller contract:

```ts
submitResponse(expectedSceneId: string, selectedTokenIds: readonly string[]): void;
```

Cover:

```text
usable owned run -> response transition saved exactly once
stale response transition -> same progress / no save
recovering or unavailable -> no mutation / no save
save failure -> in-memory progress advances + persistenceWarning=true
```

- [ ] **Step 2: Implement controller wiring through existing `transition()`**

```ts
submitResponse: (expectedSceneId, selectedTokenIds) =>
  transition((current) =>
    submitMysteryResponse(chapter, current, expectedSceneId, selectedTokenIds),
  ),
```

Do not add another auth/persistence branch.

- [ ] **Step 3: Add failing page tests**

Extend the mocked controller with `submitResponse` and cover:

```text
response scene renders response composer
first Send -> submitResponse(sceneId, ids)
second Send inside 500 ms -> ignored
after 500 ms -> another submission allowed
unusable session -> response composer disabled
Hint -> no submitResponse and does not acquire transition lock
choice/transcript replay still delegates scene to audio.play
```

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

Hint taps do not call `lockTransition()`.

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

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.ts \
  apps/vela-mobile/src/features/mystery-messenger/useMysteryMessenger.test.ts \
  apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.vue \
  apps/vela-mobile/src/features/mystery-messenger/MysteryMessengerPage.test.ts
git commit -m "feat(mobile): wire full mystery interactions"
```

---

### Task 5: Freeze language content, author the 13-scene chapter, and fix Learn entry copy

**Files:**
- Modify: `docs/superpowers/specs/2026-08-31-mobile-mystery-messenger-full-pilot-design.md` only if the independent language review changes canonical copy/accepted alternates.
- Modify: `apps/vela-mobile/src/features/mystery-messenger/content.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/model.test.ts`
- Modify: `apps/vela-mobile/src/features/mystery-messenger/validate-content.test.ts`
- Modify all feature imports still referencing `MYSTERY_MESSENGER_VERTICAL_SLICE`.
- Modify: `apps/vela-mobile/src/pages/LearnPage.vue`
- Modify: `apps/vela-mobile/src/pages/LearnPage.test.ts`

**Interfaces:**
- Produces: `MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER` satisfying the final `MysteryChapter` contract plus durable Learn-card copy.
- Canonical authored values come from **Spec → Canonical Pilot Copy and Token Sheet** after the independent language-review freeze gate.

- [ ] **Step 1: Run the independent language-review freeze gate before editing `content.ts`**

Have a native/advanced Japanese reader or separate model/reviewer inspect exactly:

```text
six target phrase texts/readings/meanings
scene 03, 05, 09 prompts/options/hints/explanations
scene 07 token bank + canonical answer + plausible alternate natural orders
scene 11 token bank + canonical answer + plausible alternate natural orders
scenes 08-13 relative-time explanation
```

The review must explicitly answer: “Are there other clearly correct responses constructible from each response scene’s exact token bank?”

If yes, add those token-ID sequences to the spec’s `alternateAnswerTokenIds` before continuing. If copy changes, update the canonical sheet first; do not silently diverge implementation from the spec.

- [ ] **Step 2: Add real-content chapter-shape tests**

```ts
expect(MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER.id).toBe('mystery-message-tomorrow-v1');
expect(MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER.version).toBe(2);
expect(MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER.title).toBe('明日からのメッセージ');
expect(MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER.scenes).toHaveLength(13);
expect(MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER.targetPhrases).toHaveLength(6);
expect(validateMysteryChapter(MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER)).toEqual([]);
```

Pin exactly one ending, exactly speakers `mina`/`haru`, every choice convergence, and one content-specific walk visiting all 13 scene IDs once before ending.

- [ ] **Step 3: Add local test lookup helpers and pin assessed copy**

```ts
function target(id: string) {
  const phrase = MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER.targetPhrases.find(
    (candidate) => candidate.id === id,
  );
  expect(phrase).toBeDefined();
  return phrase!;
}

function scene(id: string) {
  const found = MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER.scenes.find(
    (candidate) => candidate.id === id,
  );
  expect(found).toBeDefined();
  return found!;
}
```

Pin:

```ts
expect(target('tomorrow-seven').text).toBe('あしたの朝7時');
expect(target('mina-possession').reading).toBe('ミナさんのです');
```

- [ ] **Step 4: Pin scene 03/05/09 audio identity**

Assert:

```text
scene 03 audioPrompt.text === visible prompt
scene 03 ttsId === mystery-message-tomorrow-v2-scene-03-prompt
scene 05 audioPrompt.text === 青いノートはミナさんのです。きのう、駅に忘れました。
scene 05 ttsId === mystery-message-tomorrow-v2-scene-05-audio
scene 09 audioPrompt.text === visible prompt
scene 09 ttsId === mystery-message-tomorrow-v2-scene-09-prompt
```

Also assert `selectMysterySceneAudio(scene07)` and `selectMysterySceneAudio(scene11)` return `null`.

- [ ] **Step 5: Pin scene 07 canonical + alternate answer contract**

Pin the exact token bank from the spec and:

```ts
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

expect(scene07.alternateAnswerTokenIds).toContainEqual([
  'train',
  'de',
  'time',
  'ni-time',
  'station',
  'ni-place',
  'go',
  'period',
]);
```

The independent review may add more accepted arrays; tests should pin every accepted array present in the frozen spec.

- [ ] **Step 6: Pin scene 11 segmentation**

```ts
expect(scene11.tokens).toEqual([
  { id: 'please', text: 'ください' },
  { id: 'period', text: '。' },
  { id: 'again', text: 'もう一度' },
  { id: 'say', text: '言って' },
]);
expect(scene11.correctTokenIds).toEqual(['again', 'say', 'please', 'period']);
```

- [ ] **Step 7: Add the real-content TTS-markup assertion without a validator code**

```ts
for (const authoredScene of MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER.scenes) {
  const audio = selectMysterySceneAudio(authoredScene);
  if (audio) expect(audio.text).not.toMatch(/<[^>]+>/);
}
```

- [ ] **Step 8: Run content tests and verify failure**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/features/mystery-messenger/model.test.ts \
  src/features/mystery-messenger/validate-content.test.ts
```

Expected: FAIL because the final chapter export/content does not exist yet.

- [ ] **Step 9: Replace `content.ts` from the frozen canonical sheet**

Export:

```ts
export const MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER = {
  id: 'mystery-message-tomorrow-v1',
  version: 2,
  title: '明日からのメッセージ',
  startSceneId: 'scene-01',
  targetPhrases: /* exact six records from the frozen spec */,
  scenes: /* exact 13 scenes from the frozen spec */,
} satisfies MysteryChapter;
```

The two array comments above are not implementation placeholders: copy the complete concrete arrays from the adjacent canonical spec, which is the reviewed source of truth for this task. Do not invent alternate Japanese, token segmentation, or TTS IDs.

Use fresh `mystery-message-tomorrow-v2-*` TTS IDs exactly as frozen.

- [ ] **Step 10: Rename feature imports once to the title-stable chapter constant**

Before edits:

```bash
rg "MYSTERY_MESSENGER_VERTICAL_SLICE" apps/vela-mobile/src/features/mystery-messenger
```

Update runtime/tests to `MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER`.

After edits, rerun the same `rg`; expected: no matches in feature runtime/tests.

- [ ] **Step 11: Add real response semantic regressions**

For scene 07, submit canonical and the reviewer-approved alternate:

```ts
['time', 'ni-time', 'train', 'de', 'station', 'ni-place', 'go', 'period']
['train', 'de', 'time', 'ni-time', 'station', 'ni-place', 'go', 'period']
```

Both must project `result === 'correct'` and the same canonical `correctText`.

Also submit the canonical sequence with the two `に` identities swapped; expect correct because visible text is unchanged. Remove `period`; expect incorrect.

- [ ] **Step 12: Replace stale Learn-card copy and pin it**

Change `LearnPage.vue` description to exactly:

```text
A short Japanese mystery. Read, listen, and build replies to uncover what “tomorrow” means.
```

Keep title/subtitle/button/navigation unchanged.

Extend `LearnPage.test.ts`:

```ts
expect(wrapper.text()).toContain(
  'A short Japanese mystery. Read, listen, and build replies to uncover what “tomorrow” means.',
);
expect(wrapper.text()).not.toContain('five-scene');
```

- [ ] **Step 13: Run the chapter/Learn gate**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/features/mystery-messenger \
  src/pages/LearnPage.test.ts
bun run --cwd apps/vela-mobile typecheck
```

Expected: PASS.

- [ ] **Step 14: Commit**

```bash
git add docs/superpowers/specs/2026-08-31-mobile-mystery-messenger-full-pilot-design.md \
  apps/vela-mobile/src/features/mystery-messenger \
  apps/vela-mobile/src/pages/LearnPage.vue \
  apps/vela-mobile/src/pages/LearnPage.test.ts
git commit -m "feat(mobile): author full mystery messenger chapter"
```

---

### Task 6: Full verification and acceptance evidence

**Files:**
- Modify only files that fail review/tests or require Japanese copy correction.
- Update PR #63 description/checklist with final evidence.
- Update HPA-300 with final evidence when accepted.

**Interfaces:**
- Consumes the complete HPA-300 implementation.
- Produces acceptance evidence and a clean handoff to HPA-301.

- [ ] **Step 1: Run complete mobile coverage**

```bash
bun run --cwd apps/vela-mobile test:coverage
```

Expected: PASS with existing line threshold >=95%.

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

Expected: PASS. CI owns the real configured-environment path.

- [ ] **Step 5: Review Codecov when PR is ready for CI**

Expected: patch coverage >=90%. Add focused tests rather than lowering thresholds.

- [ ] **Step 6: Perform the final in-context Japanese pass**

Read the implemented chapter from scene 01 through 13 and verify against the already independently reviewed spec:

```text
all six phrase readings/meanings still match
scene 03/09 prompt audio matches visible Japanese
scene 05 speaks listening content, not visible instruction
all accepted scene 07 word orders are natural
scene 11 token segmentation stays natural
relative-time reveal is coherent
hints/explanations are beginner-friendly
```

Any copy correction updates the spec sheet and pinned tests in the same PR.

- [ ] **Step 7: Run focused iOS Simulator smoke**

Exercise:

```text
Learn -> new count-free Mystery Messenger card -> Play pilot
scene 03 replay prompt; try wrong answer; story continues
scene 05 replay and confirm spoken line differs from visible instruction
scene 07 submit canonical answer
restart and later submit authored alternate answer; it is accepted
scene 07 duplicate に identities and punctuation remain separately selectable
scene 09 replay prompt and use Hint
scene 11 use Hint; send one wrong known-token order; story continues
resume/re-enter after version-2 save
reach scene 13 ending
restart and confirm fresh run
```

Also verify existing `Tap play again` gesture fallback and background cancellation on scene 05 replay.

- [ ] **Step 8: Final diff scope review**

Allowed HPA-300 diff:

```text
planning docs
apps/vela-mobile/src/features/mystery-messenger/**
apps/vela-mobile/src/pages/LearnPage.vue
apps/vela-mobile/src/pages/LearnPage.test.ts
```

No router/backend/shared-package/dependency change unless a concrete regression discovered during implementation requires it and is documented on the PR.

- [ ] **Step 9: Commit any verification fixes**

Use scoped commits such as:

```bash
git commit -m "fix(mobile): polish mystery chapter interactions"
```

Do not create a follow-up PR for HPA-300.

- [ ] **Step 10: Record acceptance evidence in HPA-300**

Record coverage, lint, typecheck, build, Codecov, independent language review, final Japanese pass, Simulator smoke, PR link, and explicit HPA-301/HPA-302 deferrals. Mark HPA-300 Done only after those gates pass.

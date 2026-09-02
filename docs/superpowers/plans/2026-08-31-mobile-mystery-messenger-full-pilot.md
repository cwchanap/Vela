# HPA-300 Mobile Mystery Messenger Full Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the existing five-scene Mystery Messenger into the complete 13-scene linear chapter with hints, replayable Japanese choice prompts, one listening-specific choice, and tap-to-build responses that accept explicitly authored alternate valid word orders.

**Architecture:** Extend the existing feature-local closed model with one `response-build` variant and a small target-phrase catalog. Keep immutable transitions, transcript projection, local snapshot persistence, content validation, auth orchestration, and TTS/audio in their current modules. Add one tap-to-order Vue component; do not add a story engine, grammar engine, shared package, Pinia state, backend work, or web sentence-builder dependency.

**Tech Stack:** Vue 3, Quasar 2, TypeScript, Vue Router, Vitest, `@vue/test-utils`, existing Vela Mobile auth/TTS/audio services.

**Spec:** `docs/superpowers/specs/2026-08-31-mobile-mystery-messenger-full-pilot-design.md`

## Global Constraints

- One ticket and one PR: all HPA-300 work stays on PR #63 / `codex/hpa-300-mystery-messenger-full-pilot`.
- Keep runtime story code under `apps/vela-mobile/src/features/mystery-messenger`.
- Keep exactly four scene variants: `message | choice | response-build | ending`.
- Final chapter: exactly 13 scenes, two speakers (`mina`, `haru`), one path, one ending.
- Wrong answers always advance; hints never block progression.
- Hint visibility and partial response drafts stay ephemeral in HPA-300.
- Keep browser `localStorage`; bump chapter version from 1 to 2 with no migration.
- Keep chapter ID `mystery-message-tomorrow-v1` and storage-key `:v1` suffix.
- Use fresh `mystery-message-tomorrow-v2-*` TTS IDs for rewritten/new audio.
- Reuse the existing 500 ms page-local accidental-repeat guard.
- Reuse `MobileTtsService`, `MobileAudioPlayer`, lifecycle/auth/session contracts.
- Keep `audioPrompt` optional in the model; final scenes 03, 05, and 09 all provide audio.
- Keep `MysteryTargetPhrase` to `id | text | reading | meaning`; no static `sourceSceneId` in HPA-300.
- Response correctness is canonical visible text OR an authored alternate visible-text sequence; no grammar parser.
- `unsupported_tts_markup` is not a validator issue code; the real chapter test still asserts no TTS-bound text contains markup.
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
apps/vela-mobile/src/pages/LearnPage.vue
apps/vela-mobile/src/pages/LearnPage.test.ts
```

No router, backend, shared-package, or workspace-dependency change is expected.

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
- Update widened-contract fixtures in `MysteryChoiceComposer.test.ts`, `useMysteryMessenger.test.ts`, `MysteryMessengerPage.test.ts`, `storage.test.ts`, and `validate-content.test.ts`.

**Interfaces:**

- Produces: `MysteryTargetPhrase`, `MysteryResponseToken`, `MysteryResponseBuildScene`, `MysterySceneAudio`, widened `MysteryScene`, widened `MysteryHistoryEntry`, widened `MysteryTranscriptItem`, `submitMysteryResponse`, `selectMysterySceneAudio`.
- Leaves the existing five-scene content temporarily in place but valid under the widened contract.

- [ ] **Step 1: Add failing response-transition tests**

Use this local response fixture:

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
  feedback: { correct: '正しいです。', incorrect: '自然な語順の例も確認しましょう。' },
  hint: '時間と行き先の「に」を見てください。',
  explanation: '時間と行き先に「に」を使います。',
  targetPhraseIds: [],
  nextSceneId: 'ending',
};
```

Cover canonical correct, authored-alternate correct, wrong known order advances/incorrect, incomplete advances/incorrect, stale event identity, unknown selected token error, duplicate selected identity error, duplicate-visible-`に` swap correctness, punctuation participation, and canonical `correctText` even when an alternate was accepted.

- [ ] **Step 2: Run the model test and verify failure**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/model.test.ts
```

Expected: FAIL because `response-build` and `submitMysteryResponse` do not exist.

- [ ] **Step 3: Extend the closed contracts**

Add:

```ts
export type MysteryTargetPhrase = {
  id: string;
  text: string;
  reading: string;
  meaning: string;
};

export type MysteryResponseToken = { id: string; text: string };
export type MysterySceneAudio = { ttsId: string; text: string };

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

Change `MysteryChoiceScene` to `audioPrompt?: MysterySceneAudio` plus required `hint`, `explanation`, and `targetPhraseIds`. Add `targetPhrases: readonly MysteryTargetPhrase[]` to `MysteryChapter`. Extend only scene/history unions with `response-build`.

- [ ] **Step 4: Implement `submitMysteryResponse()`**

Start with:

```ts
if (progress.currentSceneId !== expectedSceneId) return progress;
```

Then require `response-build`, reject unknown/duplicate submitted IDs, append copied selected IDs, resolve `nextSceneId`, and advance regardless of correctness. Use `mystery_response_token_not_found` and `mystery_duplicate_response_token`; retain `mystery_invalid_transition` for the wrong scene kind.

- [ ] **Step 5: Extend transcript correctness**

Resolve selected/canonical/alternate token IDs to visible token arrays. Result is correct when selected visible text equals canonical visible text or any authored alternate visible text. Join Japanese with `join('')`. Persist no derived correctness.

- [ ] **Step 6: Add `selectMysterySceneAudio()` and tests**

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

Pin message, ending, audio choice, synthetic text-only choice, and response-build.

- [ ] **Step 7: Make transcript projection exhaustive with optional audio**

Add `choice-result.explanation`, `response-prompt`, `response-result`, and optional `audio?: MysterySceneAudio`. Remove required choice `ttsId`. Explicitly switch over all four scene kinds; do not retain `else => ending`.

- [ ] **Step 8: Update temporary five-scene content immediately**

Add `targetPhrases: []`; add choice hint/explanation/target references. Preserve existing scene-03 replay by converting its current TTS fields to:

```ts
audioPrompt: {
  ttsId: 'mystery-message-tomorrow-v1-scene-03-prompt',
  text: 'どう返事をしますか？',
},
```

Do not add real response-build content yet.

- [ ] **Step 9: Update `useMysteryAudio` to consume the selector**

Delete `authoredTextFor()`. After session usability check:

```ts
const audio = selectMysterySceneAudio(scene);
if (!audio) return;
```

Use only `audio.ttsId` and `audio.text` through prepare, ready replay, and media-unavailable invalidation.

- [ ] **Step 10: Pin audio regressions**

Test synthetic no-audio choice -> no TTS/idle, response-build -> no TTS/idle, audio choice -> exact `audioPrompt.ttsId + audioPrompt.text`, media unavailable -> invalidate that audio ID, and existing message playback.

- [ ] **Step 11: Update `MysteryTranscript.vue` and tests**

Render every transcript kind explicitly; render replay only when `item.audio` exists. Pin no replay for synthetic no-audio choice/response, replay for audio choice/message/ending, and response-result feedback/explanation.

- [ ] **Step 12: Update every widened-contract fixture**

Add chapter `targetPhrases`; add choice assistance fields; use `audioPrompt` only where expected. Do not leave fixture repair to later tasks.

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

Expected: PASS before Task 2 starts.

- [ ] **Step 14: Commit**

```bash
git add apps/vela-mobile/src/features/mystery-messenger
git commit -m "feat(mobile): extend mystery interaction model"
```

---

### Task 2: Extend persistence and authored-content validation

**Files:**

- Modify: `storage.ts`, `storage.test.ts`, `validate-content.ts`, `validate-content.test.ts` under the feature folder.

**Interfaces:**

- Consumes Task-1 response/history/target-phrase contracts.
- Produces response-history load acceptance plus structural validation for response answers and target references.

- [ ] **Step 1: Add failing response-history storage tests**

Cover valid round-trip plus reset/delete for non-response referenced scene, non-array selected IDs, unknown selected ID, duplicate selected identity, and version-1 progress loaded against version-2 content.

- [ ] **Step 2: Run storage tests and verify failure**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/storage.test.ts
```

Expected: FAIL because history validation still knows only message/choice.

- [ ] **Step 3: Extend `isKnownProgress()`**

For a response entry require `scene.kind === 'response-build'`, an array of selected IDs, every ID present in `scene.tokens`, and no repeated selected identity. Keep draft/hint state out of persistence.

- [ ] **Step 4: Add failing validator tests**

Extend issue codes only with:

```text
duplicate_target_phrase_id
unknown_target_phrase_reference
duplicate_response_token_id
invalid_response_answer_token
multiple_endings
```

Test response dangling edge/reachability, duplicate response token, unknown/repeated IDs in canonical answer, unknown/repeated IDs in each alternate answer, duplicate target phrase ID, missing choice/response target phrase reference, and multiple endings.

- [ ] **Step 5: Run validator tests and verify failure**

```bash
bun run --cwd apps/vela-mobile test:unit -- src/features/mystery-messenger/validate-content.test.ts
```

Expected: FAIL for the new rules.

- [ ] **Step 6: Extend `validateMysteryChapter()` with current Map + traversal shape**

Validate response edge, unique token IDs, canonical answer IDs, every alternate answer ID sequence, and target references. Use `invalid_response_answer_token` for unknown or repeated identity in canonical/alternate answers. Validate target phrase ID uniqueness only; no `sourceSceneId` relation. Require exactly one ending. Traverse response-build through its one `nextSceneId`.

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

- Create: `components/MysteryResponseBuildComposer.vue`, `components/MysteryResponseBuildComposer.test.ts`.
- Modify: `components/MysteryChoiceComposer.vue`, `components/MysteryChoiceComposer.test.ts`.

**Interfaces:**

- Consumes `MysteryResponseBuildScene`.
- Produces response composer emitting ordered token IDs plus local Hint behavior.

- [ ] **Step 1: Write response-composer tests first**

Use a scene with authored scrambled order, two IDs rendering `に`, and `。`. Cover add exact identity, separate duplicate-visible buttons, remove exact selected identity, punctuation, Clear, Hint toggle, ordered Send emission, empty Send disabled, and disabled parent state.

Stable test IDs:

```text
mystery-response-token-<tokenId>
mystery-response-selected-<tokenId>
mystery-response-clear
mystery-response-hint
mystery-response-hint-copy
mystery-response-send
```

- [ ] **Step 2: Run the new test and verify failure**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/features/mystery-messenger/components/MysteryResponseBuildComposer.test.ts
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement local response state only**

```ts
const selectedTokenIds = ref<string[]>([]);
const showHint = ref(false);
```

Available tokens are authored tokens whose IDs are not selected. Emit `submit` with `[...selectedTokenIds.value]`. No drag/drop, randomization, scoring, Pinia, or backend questions.

- [ ] **Step 4: Add local Hint behavior to choice composer**

Use `showHint` plus `mystery-choice-hint` / `mystery-choice-hint-copy`. Keep option emission unchanged. Page keying by scene ID handles reset.

- [ ] **Step 5: Run focused component tests**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/features/mystery-messenger/components/MysteryResponseBuildComposer.test.ts \
  src/features/mystery-messenger/components/MysteryChoiceComposer.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/vela-mobile/src/features/mystery-messenger/components
git commit -m "feat(mobile): add tap-to-build mystery responses"
```

---

### Task 4: Wire response submission through the existing controller and page

**Files:**

- Modify: `useMysteryMessenger.ts`, `useMysteryMessenger.test.ts`, `MysteryMessengerPage.vue`, `MysteryMessengerPage.test.ts`.

**Interfaces:**

- Consumes `submitMysteryResponse` and `MysteryResponseBuildComposer`.
- Produces authenticated/persisted response submission using existing transition and rapid-tap mechanisms.

- [ ] **Step 1: Add failing controller tests**

Extend controller contract:

```ts
submitResponse(expectedSceneId: string, selectedTokenIds: readonly string[]): void;
```

Cover owned usable run -> saved once, stale -> no save, recovering/unavailable -> no mutation, save failure -> in-memory advance + warning.

- [ ] **Step 2: Implement through existing `transition()`**

```ts
submitResponse: (expectedSceneId, selectedTokenIds) =>
  transition((current) =>
    submitMysteryResponse(chapter, current, expectedSceneId, selectedTokenIds),
  ),
```

No new auth/persistence branch.

- [ ] **Step 3: Add failing page tests**

Cover response composer render, first Send, second Send suppressed inside 500 ms, next Send allowed after 500 ms, unusable session disabled, Hint causes no story transition/lock, and transcript replay still delegates the scene to `audio.play`.

- [ ] **Step 4: Wire page response branch**

Add `currentResponseBuild`, key choice/response composers by scene ID, and:

```ts
function handleResponseSubmit(selectedTokenIds: readonly string[]): void {
  if (!lockTransition()) return;
  const scene = messenger.currentScene.value;
  if (scene?.kind !== 'response-build') return;
  messenger.submitResponse(scene.id, selectedTokenIds);
}
```

Hint taps never call `lockTransition()`.

- [ ] **Step 5: Run focused controller/page tests**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/features/mystery-messenger/useMysteryMessenger.test.ts \
  src/features/mystery-messenger/MysteryMessengerPage.test.ts
```

Expected: PASS.

- [ ] **Step 6: Re-run Task-1 audio/transcript tests**

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

### Task 5: Freeze language content, author the 13-scene chapter, and fix Learn copy

**Files:**

- Modify the spec first only if language review changes canonical copy/alternates.
- Modify: `content.ts`, `model.test.ts`, `validate-content.test.ts`, feature imports.
- Modify: `apps/vela-mobile/src/pages/LearnPage.vue`, `apps/vela-mobile/src/pages/LearnPage.test.ts`.

**Interfaces:**

- Produces `MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER` and durable Learn-card copy.
- Canonical authored values come from **Spec → Canonical Pilot Copy and Token Sheet** after the language-review freeze gate.

- [ ] **Step 1: Run the independent language-review freeze gate before editing `content.ts`**

Have a native/advanced Japanese reader or separate model/reviewer inspect exactly:

```text
six target phrase texts/readings/meanings
scene 03, 05, 09 prompts/options/hints/explanations
scene 07 token bank + canonical answer + all plausible alternate natural orders
scene 11 token bank + canonical answer + all plausible alternate natural orders
scenes 08-13 relative-time explanation
```

The review must explicitly answer whether any other clearly correct responses are constructible from each response scene's exact token bank. Add approved sequences to the spec before continuing.

- [ ] **Step 2: Add failing final-content shape tests**

```ts
expect(MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER.id).toBe('mystery-message-tomorrow-v1');
expect(MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER.version).toBe(2);
expect(MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER.title).toBe('明日からのメッセージ');
expect(MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER.scenes).toHaveLength(13);
expect(MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER.targetPhrases).toHaveLength(6);
expect(validateMysteryChapter(MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER)).toEqual([]);
```

Also pin exactly one ending, speakers `mina`/`haru`, every choice convergence, and one content-specific walk visiting all 13 scene IDs once.

- [ ] **Step 3: Pin the frozen assessed copy**

Add local `target(id)` and `scene(id)` helpers that assert the requested authored record exists. Pin:

```ts
expect(target('tomorrow-seven').text).toBe('あしたの朝7時');
expect(target('mina-possession').reading).toBe('ミナさんのです');
```

Pin the exact scene-07 and scene-11 token arrays/canonical answers from the spec. Pin scene 07 `alternateAnswerTokenIds` contains at least:

```ts
['train', 'de', 'time', 'ni-time', 'station', 'ni-place', 'go', 'period'];
```

Pin every additional alternate added by the independent review.

- [ ] **Step 4: Pin final choice audio**

Assert scene 03 and scene 09 `audioPrompt.text` equal their visible prompts with IDs `mystery-message-tomorrow-v2-scene-03-prompt` and `...scene-09-prompt`. Assert scene 05 uses `mystery-message-tomorrow-v2-scene-05-audio` with `青いノートはミナさんのです。きのう、駅に忘れました。` rather than its visible instruction.

- [ ] **Step 5: Add real-content TTS-markup assertion**

```ts
for (const authoredScene of MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER.scenes) {
  const audio = selectMysterySceneAudio(authoredScene);
  if (audio) expect(audio.text).not.toMatch(/<[^>]+>/);
}
```

- [ ] **Step 6: Run final-content tests and verify failure**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/features/mystery-messenger/model.test.ts \
  src/features/mystery-messenger/validate-content.test.ts
```

Expected: FAIL because the final export/content does not exist yet.

- [ ] **Step 7: Replace `content.ts` one-for-one from the reviewed canonical spec**

Use export name `MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER`, ID `mystery-message-tomorrow-v1`, version `2`, title `明日からのメッセージ`, and start `scene-01`.

Copy the complete concrete six-record `targetPhrases` array and complete concrete 13-scene `scenes` array from **Spec → Canonical Pilot Copy and Token Sheet**. That section is the reviewed source of truth and enumerates every learner-facing line, TTS ID, token identity, canonical/alternate answer, hint, explanation, target reference, and transition. Do not introduce an abbreviated second copy in the plan and do not invent values outside that sheet.

- [ ] **Step 8: Rename feature imports once to the title-stable constant**

```bash
rg "MYSTERY_MESSENGER_VERTICAL_SLICE" apps/vela-mobile/src/features/mystery-messenger
```

Change every runtime/test reference to `MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER`; rerun the command and expect no remaining feature matches.

- [ ] **Step 9: Add real response semantic regressions**

Submit canonical scene 07 and the reviewer-approved alternate; both project `correct`, with canonical `correctText`. Submit canonical IDs with the two `に` identities swapped; expect correct because visible text is unchanged. Remove `period`; expect incorrect.

- [ ] **Step 10: Fix Learn-card copy and pin it**

Change the description exactly to:

```text
A short Japanese mystery. Read, listen, and build replies to uncover what “tomorrow” means.
```

Keep title/subtitle/button/navigation unchanged. In `LearnPage.test.ts`, assert the exact new sentence and assert `five-scene` is absent.

- [ ] **Step 11: Run the chapter/Learn gate**

```bash
bun run --cwd apps/vela-mobile test:unit -- \
  src/features/mystery-messenger \
  src/pages/LearnPage.test.ts
bun run --cwd apps/vela-mobile typecheck
```

Expected: PASS.

- [ ] **Step 12: Commit**

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

- Modify only files requiring test/review/Japanese fixes.
- Update PR #63 and HPA-300 with final evidence.

**Interfaces:**

- Produces acceptance evidence and a clean HPA-301 handoff.

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

The mobile build's `validate-mobile-api-url` Vite plugin enforces a valid
`VITE_MOBILE_API_URL` (and the Cognito build-env contract) in production mode
and is on by default. Do not bypass it with `MOBILE_SKIP_ENV_VALIDATION=true`;
that flag exists for CI pipelines that already guarantee `.env.production`; a
clean checkout without it should fail at build time, not at app launch. Run the
real production env-injection sequence instead:

```bash
# 1. Produce CDK outputs (deploy, or synth + export outputs) so
#    packages/cdk/cdk-outputs.json exists.
bun --cwd packages/cdk cdk:deploy        # or: cdk synth + export-outputs

# 2. Generate apps/vela-mobile/.env.production from cdk-outputs.json.
bun packages/cdk/scripts/inject-env.ts

# 3. Build with the validated env.
bun run --cwd apps/vela-mobile build
```

Expected: PASS with `.env.production` present and `VITE_MOBILE_API_URL` set to
the deployment's absolute API URL. Only set `MOBILE_SKIP_ENV_VALIDATION=true`
when a valid `.env.production` containing `VITE_MOBILE_API_URL` is already
guaranteed by an earlier step (CI does this by exporting
`VITE_MOBILE_API_URL=https://example.invalid/api/` instead of bypassing).

- [ ] **Step 5: Review Codecov when the PR is ready for CI**

Expected: patch coverage >=90%; add tests rather than lowering thresholds.

- [ ] **Step 6: Perform final in-context Japanese review**

Read scenes 01–13 in order and confirm target readings/meanings, scene 03/09 prompt audio, scene 05 listening audio, all accepted scene-07 orders, scene-11 segmentation, relative-time reveal, and beginner-friendly hints/explanations. Any copy correction updates the spec sheet and pinned tests on this PR.

- [ ] **Step 7: Run focused iOS Simulator smoke**

Exercise:

```text
Learn -> count-free card -> Play pilot
scene 03 replay + wrong choice still advances
scene 05 replay speaks listening line, not visible instruction
scene 07 canonical response accepted
restart/second run -> authored alternate response accepted
scene 07 duplicate に identities + punctuation independently selectable
scene 09 replay + Hint
scene 11 Hint + wrong known order still advances
resume/re-enter version-2 save
reach scene 13 ending
restart -> fresh run
```

Also verify the existing `Tap play again` gesture fallback and background cancellation on scene 05 replay.

- [ ] **Step 8: Final diff scope review**

Allowed HPA-300 diff:

```text
docs/superpowers/specs/2026-08-31-mobile-mystery-messenger-full-pilot-design.md
docs/superpowers/plans/2026-08-31-mobile-mystery-messenger-full-pilot.md
apps/vela-mobile/src/features/mystery-messenger/**
apps/vela-mobile/src/pages/LearnPage.vue
apps/vela-mobile/src/pages/LearnPage.test.ts
```

No router/backend/shared-package/dependency change unless a concrete regression requires it and is documented on the PR.

- [ ] **Step 9: Commit verification fixes, if any**

Use scoped commits such as:

```bash
git commit -m "fix(mobile): polish mystery chapter interactions"
```

Do not create a follow-up PR for HPA-300.

- [ ] **Step 10: Record final evidence in HPA-300**

Record coverage, lint, typecheck, build, Codecov, independent language review, final in-context Japanese pass, Simulator smoke, PR link, and explicit HPA-301/HPA-302 deferrals. Mark HPA-300 Done only after those gates pass.

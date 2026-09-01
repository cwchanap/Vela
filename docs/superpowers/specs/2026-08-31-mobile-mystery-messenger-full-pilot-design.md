# HPA-300: Mobile Mystery Messenger Full Pilot

**Date:** 2026-08-31

**Linear:** [HPA-300](https://linear.app/cwchanap/issue/HPA-300/mystery-messengerpilot-author-the-full-linear-chapter-and-add-tap-to)

**Parent:** HPA-298 — Mystery Messenger Pilot

**Blocked-by gate:** HPA-299 is Done and PR #62 is merged.

## Goal

Expand the accepted five-scene Mystery Messenger slice into the complete first chapter of *The Message That Arrived Tomorrow* without turning the feature into a general story engine.

The HPA-300 chapter has exactly 13 authored scenes, two recurring characters, one linear path, one ending, three language choices, and two tap-to-build Japanese responses. Every interaction has one authored hint and one short explanation. Incorrect answers and hint use never dead-end the story.

Design, implementation plan, implementation, review fixes, and verification stay on one branch and one PR for HPA-300.

## Current State and Reuse

HPA-299 already established the seams this work should extend under `apps/vela-mobile/src/features/mystery-messenger`:

- `model.ts` owns the closed scene/history model, immutable progress transitions, and transcript projection.
- `content.ts` owns one checked-in TypeScript chapter constant.
- `validate-content.ts` owns pure test-time graph/reference validation.
- `storage.ts` owns one user/chapter local snapshot and already discards progress on chapter-version mismatch.
- `useMysteryMessenger.ts` owns authenticated run loading, transition persistence, restart, and session gating.
- `useMysteryAudio.ts` owns authenticated TTS/audio/lifecycle behavior.
- `MysteryTranscript.vue` renders the chronological story and emits replay requests.
- `MysteryChoiceComposer.vue` renders the active choice.
- `MysteryMessengerPage.vue` owns dependency injection and the existing 500 ms accidental-repeat guard.
- `LearnPage.vue` already exposes the activity and must have its stale five-scene copy updated when the full chapter lands.

The web `SentenceBuilder.vue` is deliberately not reused. It brings `vuedraggable`, Pinia stores, backend game questions, scoring, and session recording, while HPA-300 needs only feature-local tap-to-order input with stable token identity.

## Scope

HPA-300 adds only:

- one fourth scene variant: `response-build`;
- one feature-local `MysteryResponseBuildComposer.vue`;
- stable authored response-token identities, including duplicate visible tokens and punctuation;
- canonical plus explicitly authored alternate correct response sequences;
- optional `audioPrompt` on the existing `choice` scene instead of a listening-specific fifth scene kind;
- one pure scene-audio selector shared by transcript projection and playback;
- one hint, explanation, and target-phrase reference list on each interaction;
- a small chapter-level target-phrase catalog;
- the complete 13-scene chapter content from the canonical copy sheet below;
- the one-line Learn-card copy update required by the larger chapter;
- validator/storage/transcript/controller/page extensions required by those contracts; and
- focused automated, Simulator, and language-quality verification.

## Non-goals

Do not add:

- a story/interaction registry, visitor framework, command bus, plugin API, or grammar engine;
- new Pinia state;
- backend/API/CDK/DynamoDB changes;
- cloud progress or cross-device sync;
- SRS writes or dictionary mutation;
- missed-phrase accumulation or recap UI — HPA-301 owns that;
- branches, alternate endings, relationship state, inventory, or side content;
- persisted partial response-builder drafts;
- runtime token shuffling;
- the web drag/drop sentence-builder dependency;
- a mobile E2E framework; or
- physical-device release acceptance — HPA-302 owns the final device gate.

A second real narrative consumer remains the extraction gate for shared story machinery.

## Ticket Wording Clarification

The original acceptance line saying the pilot can be finished “without vocabulary outside the declared target set” is too literal for a small learning-target catalog: particles, connective grammar, names, and beginner story glue would otherwise all need to become artificial target phrases.

For implementation, “target set” means the explicitly assessed phrases attached to interactions. Every assessed interaction must be solvable from its authored prompt/tokens and declared target phrases. Surrounding story prose remains beginner/N5-adjacent and receives the language-quality gate described below.

## Risks

### Authored Japanese quality is the primary product risk

Coverage, lint, typecheck, and Codecov can verify the mechanism but cannot tell whether a learner was incorrectly marked wrong for natural Japanese. Response building is especially vulnerable because Japanese permits more constituent-order variation than a single token sequence suggests.

Before Task 5 freezes the chapter content, an independent second language pass — a native/advanced reader or a separate model/reviewer pass — must review:

- all six target phrases and readings;
- all three choice prompts/options and explanations;
- both response-build prompts, token segmentation, canonical answers, and plausible alternate valid answers; and
- the relative-time explanation across scenes 08–13.

Any clearly valid response sequence found there is authored explicitly in `alternateAnswerTokenIds`. This remains finite authored content, not a grammar parser.

### TTS cache identity can serve stale audio after copy edits

`MobileTtsService` treats vocabulary ID plus text as an immutable canonical pair while its cache key excludes text. HPA-300 therefore uses fresh `mystery-message-tomorrow-v2-*` TTS IDs for rewritten/new audio while keeping the chapter ID and local-storage namespace unchanged.

### Entry copy can drift from chapter content

`LearnPage.vue` currently says “A five-scene pilot.” HPA-300 replaces that count-specific sentence with durable activity copy and pins it in `LearnPage.test.ts`.

## Architecture

Keep the existing feature structure and add one component:

```text
apps/vela-mobile/src/features/mystery-messenger/
  model.ts
  content.ts
  validate-content.ts
  storage.ts
  useMysteryMessenger.ts
  useMysteryAudio.ts
  components/
    MysteryTranscript.vue
    MysteryChoiceComposer.vue
    MysteryResponseBuildComposer.vue
  MysteryMessengerPage.vue
```

No new package or cross-feature abstraction is introduced.

A model-union change is not complete until all current union consumers compile. Task 1 therefore widens the scene/history/transcript contracts together with the temporary `content.ts`, the scene-audio selector, `useMysteryAudio`, `MysteryTranscript`, and all affected fixtures. Storage and authored-validator semantics remain Task 2, but Task 1 ends with full mobile typecheck green.

## Closed Content Contract

### Target phrases

Keep only metadata HPA-300 actually needs to author and reference:

```ts
export type MysteryTargetPhrase = {
  id: string;
  text: string;
  reading: string;
  meaning: string;
};
```

`MysteryChapter` gains:

```ts
targetPhrases: readonly MysteryTargetPhrase[];
```

Interactions point to phrases through `targetPhraseIds`. Do not add a reverse `sourceSceneId` relation in HPA-300. It has no current consumer and is ambiguous when a phrase first appears in one scene but is assessed in another. HPA-301 can derive or persist the actual missed interaction when it implements recap provenance.

### Choice

Keep one choice type for reading and listening interactions:

```ts
export type MysteryChoiceAudioPrompt = {
  ttsId: string;
  text: string;
};

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

The contract keeps `audioPrompt` optional. In the final authored chapter, scenes 03 and 09 use their visible Japanese prompt as replay audio, preserving the existing read-aloud experience. Scene 05 remains the important divergent case: its visible instruction differs from the Japanese line the learner must hear.

### Response building

```ts
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
  feedback: {
    correct: string;
    incorrect: string;
  };
  hint: string;
  explanation: string;
  targetPhraseIds: readonly string[];
  nextSceneId: string;
};
```

`correctTokenIds` remains the canonical display answer. `alternateAnswerTokenIds` is a finite authored allow-list for other clearly natural answers made from the same token bank. Scene 07 has at least one such alternate; scene 11 needs none.

`MysteryScene` becomes:

```ts
export type MysteryScene =
  | MysteryMessageScene
  | MysteryChoiceScene
  | MysteryResponseBuildScene
  | MysteryEndingScene;
```

No arbitrary payload map or handler registry is added.

## Response-Build Semantics

Persist submitted token identities, not display text:

```ts
export type MysteryHistoryEntry =
  | { kind: 'message'; sceneId: string }
  | { kind: 'choice'; sceneId: string; selectedOptionId: string }
  | { kind: 'response-build'; sceneId: string; selectedTokenIds: readonly string[] };
```

Add one pure transition:

```ts
export function submitMysteryResponse(
  chapter: MysteryChapter,
  progress: MysteryProgress,
  expectedSceneId: string,
  selectedTokenIds: readonly string[],
): MysteryProgress;
```

Rules:

- stale `expectedSceneId` returns the exact same progress object;
- every submitted token ID must exist in the active response scene;
- the same token ID cannot be submitted twice;
- incomplete or wrong known-token sequences are valid submissions and still advance;
- punctuation is a normal authored token and participates in correctness;
- the response always advances to its one `nextSceneId`; and
- correctness is derived later from authored content, never stored in history.

For transcript correctness, resolve submitted IDs, `correctTokenIds`, and every authored alternate to visible token-text arrays. The result is correct when the submitted visible-text array equals the canonical visible-text array or any alternate visible-text array.

This preserves the existing duplicate-identity rule: swapping the two distinct `に` IDs remains correct when the rendered Japanese is unchanged. It also accepts genuinely different word orders that the language review explicitly approves.

`correctText` in the transcript always displays the canonical `correctTokenIds` sentence even when an alternate was accepted.

## Scene Audio and Transcript Contract

Audio availability is one pure model projection, not a Vue inference and not duplicated scene-kind logic in `useMysteryAudio`.

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

`MysteryTranscriptItem` is still a closed union, with optional projected audio:

```ts
type MysteryTranscriptAudio = {
  audio?: MysterySceneAudio;
};

export type MysteryTranscriptItem = (
  | {
      kind: 'message';
      sceneId: string;
      speaker: MysterySpeaker;
      text: string;
      active: boolean;
    }
  | {
      kind: 'choice-result';
      sceneId: string;
      speaker: MysterySpeaker;
      prompt: string;
      selectedLabel: string;
      feedback: string;
      explanation: string;
      result: 'correct' | 'incorrect';
    }
  | {
      kind: 'choice-prompt';
      sceneId: string;
      speaker: MysterySpeaker;
      prompt: string;
    }
  | {
      kind: 'response-prompt';
      sceneId: string;
      prompt: string;
    }
  | {
      kind: 'response-result';
      sceneId: string;
      prompt: string;
      selectedText: string;
      correctText: string;
      result: 'correct' | 'incorrect';
      feedback: string;
      explanation: string;
    }
  | {
      kind: 'ending';
      sceneId: string;
      title: string;
      text: string;
    }
) & MysteryTranscriptAudio;
```

`selectMysteryTranscript()` calls `selectMysterySceneAudio()` for current and completed scenes. Its current-scene switch is exhaustive over all four scene kinds; there is no catch-all “else means ending” branch.

`MysteryTranscript.vue` renders replay only when `item.audio` exists. The replay event still carries `sceneId`; the page resolves the scene and delegates to `useMysteryAudio.play(scene)`.

`useMysteryAudio.play(scene)` consumes the same selector. If it returns `null`, playback returns without a TTS request. When audio exists, prepare and media-unavailable invalidation use `audio.ttsId`, and TTS preparation uses exactly `audio.text`.

Existing gesture-required, media-unavailable, lifecycle cancellation, identity-change, and disposal behavior remain unchanged.

## Tap-to-Order UI

`MysteryResponseBuildComposer.vue` owns only ephemeral input state for the active scene:

- `selectedTokenIds: string[]`;
- available tokens are `scene.tokens` filtered by selected IDs, preserving authored order;
- tapping an available token appends its ID;
- tapping a selected token removes that exact ID;
- `Clear` empties the response;
- `Hint` toggles `scene.hint`;
- `Send` emits the ordered token IDs and is disabled when no tokens are selected or the parent disables transitions.

The page keys the composer by `scene.id`, so another response scene starts with fresh local state. Partial drafts are intentionally not persisted.

Stable IDs are a UI identity mechanism only. They are not exposed to the learner and do not make visually identical duplicate tokens semantically different.

## Hints and Explanations

Both interaction components keep the same simple product behavior:

- one `Hint` button reveals authored hint copy inline;
- hint visibility is local UI state only in HPA-300;
- hint taps do not acquire the page transition lock;
- choosing/submitting immediately advances;
- completed transcript entries show selected answer, result-specific feedback, and scene explanation; and
- wrong answers still continue to the same next scene.

HPA-301 may later add persisted `usedHint`/missed-phrase bookkeeping. HPA-300 does not pre-build it.

## Persistence and Version Reset

Keep the existing local-storage key:

```text
vela:mobile:mystery-messenger:<user>:<chapter>:v1
```

The `:v1` suffix versions the storage shape and does not change. The chapter keeps ID `mystery-message-tomorrow-v1` and increments `chapter.version` from `1` to `2`, deliberately discarding the five-scene save with no migration or fallback.

Extend closed history validation to accept `response-build` entries only when:

- the referenced scene exists and is `response-build`;
- every selected token ID exists in that scene; and
- no token ID is repeated in the stored submission.

No partial response draft is added to `MysteryProgress`.

## Authored-Content Validation

Extend the existing pure validator; do not add runtime validation UI.

Keep current checks and add only these focused issue codes:

```text
duplicate_target_phrase_id
unknown_target_phrase_reference
duplicate_response_token_id
invalid_response_answer_token
multiple_endings
```

Validation rules:

- response-build `nextSceneId` must exist;
- response token IDs are unique within a response scene;
- canonical `correctTokenIds` and every `alternateAnswerTokenIds` entry reference real scene tokens and never repeat the same token identity within one answer;
- every interaction target phrase ID exists in the chapter catalog;
- target phrase IDs are unique;
- there is exactly one ending; and
- start/reference/ending reachability traversal understands `response-build` as a single outgoing edge.

Do not add `sourceSceneId` validation or `dangling_target_phrase_source` in HPA-300.

Do not add `unsupported_tts_markup` as a validator issue. The acceptance requirement remains, but a simple real-content test iterates `selectMysterySceneAudio(scene)` for the actual chapter and asserts every returned `audio.text` does not match `/\<[^>]+\>/`.

Do not add a generic branching-choice error. The real-content test pins that every authored choice converges and that one content-specific walk visits all 13 scenes once. Validator unit fixtures may still use multi-edge graphs.

## Canonical Pilot Copy and Token Sheet

This section is the source of truth for HPA-300 learner-facing copy, assessed phrases, response token segmentation, and audio text. Task 5 performs the independent language-review freeze gate before copying it into `content.ts`. If that review changes Japanese or accepted response orders, this sheet and its pinned tests change together first.

The chapter title intentionally keeps kanji, while learner-facing assessed uses of the mystery word use `あした` consistently.

### Chapter identity

```text
id: mystery-message-tomorrow-v1
version: 2
title: 明日からのメッセージ
startSceneId: scene-01
final export: MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER
```

The title-based export name survives later HPA-301/HPA-302 milestones and future additional chapters without another milestone-label rename.

### Learn entry copy

```text
Mystery Messenger
The Message That Arrived Tomorrow
A short Japanese mystery. Read, listen, and build replies to uncover what “tomorrow” means.
Play pilot
```

### Scenes 01–06

```text
scene-01 | message | mina
text: こんにちは。これは「あした」からのメッセージです。
ttsId: mystery-message-tomorrow-v2-scene-01
next: scene-02

scene-02 | message | mina
text: あしたの朝7時、電車でさくら駅に来てください。青いノートを持ってきてください。
ttsId: mystery-message-tomorrow-v2-scene-02
next: scene-03

scene-03 | reading choice | mina
prompt: ミナさんは、いつ駅に来てほしいですか？
audioPrompt.text: ミナさんは、いつ駅に来てほしいですか？
audioPrompt.ttsId: mystery-message-tomorrow-v2-scene-03-prompt
option correct: あしたの朝7時
option incorrect: きょうの朝7時
hint: 「あした」は、今日の次の日です。
explanation: 「あしたの朝7時」は、今日の次の日の朝7時です。
targetPhraseIds: [tomorrow-seven]
next for every option: scene-04

scene-04 | message | haru
text: さくら駅で青いノートを見つけました。ノートに「きのう、ここに置きました」と書いてあります。
ttsId: mystery-message-tomorrow-v2-scene-04
next: scene-05

scene-05 | listening choice | haru
visible prompt: 音声を聞いて、青いノートはだれのものか選んでください。
audioPrompt.text: 青いノートはミナさんのです。きのう、駅に忘れました。
audioPrompt.ttsId: mystery-message-tomorrow-v2-scene-05-audio
option correct: ミナさんのノートです
option incorrect: ハルさんのノートです
hint: 「ミナさんのです」の「の」に注目してください。
explanation: 「ミナさんのです」は「ミナさんのものです」という意味です。
targetPhraseIds: [mina-possession]
next for every option: scene-06

scene-06 | message | mina
text: そうです。きのう、駅に忘れました。でも、このメッセージもきのう書きました。
ttsId: mystery-message-tomorrow-v2-scene-06
next: scene-07
```

### Scene 07 response build

```text
scene-07 | response-build
prompt: ミナさんに、あしたの予定を伝えてください。
correct feedback: 予定をはっきり伝えられました。
incorrect feedback: 返事を送りました。自然な語順の例も確認しておきましょう。
hint: 時間の「に」を先に、行き先の「に」をあとに置きます。
explanation: 「7時に」で時間、「さくら駅に」で行き先を表します。
targetPhraseIds: [train-station-plan]
next: scene-08
```

Authored available-token order:

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

Canonical token identities:

```ts
['time', 'ni-time', 'train', 'de', 'station', 'ni-place', 'go', 'period']
```

Canonical visible response:

```text
7時に電車でさくら駅に行きます。
```

The Task-5 independent language review froze exactly two alternate correct orders:

```ts
[
  ['train', 'de', 'time', 'ni-time', 'station', 'ni-place', 'go', 'period'],
  ['time', 'ni-time', 'station', 'ni-place', 'train', 'de', 'go', 'period'],
]
```

which render:

```text
電車で7時にさくら駅に行きます。
7時にさくら駅に電車で行きます。
```

Both are authored; the sheet freezes no other scene-07 alternate. Swapping only `ni-time` and `ni-place` also remains correct automatically because correctness compares resolved visible text.

### Scenes 08–10

```text
scene-08 | message | haru
text: ちょっと待ってください。メッセージは今日届きました。でも、ミナさんは「きのう書きました」と言いました。
ttsId: mystery-message-tomorrow-v2-scene-08
next: scene-09

scene-09 | reading choice | haru
prompt: 今、何を確認するのが一番いいですか？
audioPrompt.text: 今、何を確認するのが一番いいですか？
audioPrompt.ttsId: mystery-message-tomorrow-v2-scene-09-prompt
option correct: 「あした」はいつですか？
option incorrect: ノートは何色ですか？
hint: 今の謎は、日にちのことです。
explanation: 「いつですか？」は、時間や日にちを確認するときに使います。
targetPhraseIds: [wrote-yesterday, when-is-tomorrow]
next for every option: scene-10

scene-10 | message | mina
text: メッセージを書いたのはきのうです。きのうの「あした」は、今日です。
ttsId: mystery-message-tomorrow-v2-scene-10
next: scene-11
```

### Scene 11 response build

```text
scene-11 | response-build
prompt: 説明をもう一度聞きたいと伝えてください。
correct feedback: 丁寧に聞き返せました。
incorrect feedback: 返事を送りました。自然な言い方の例も確認しましょう。
hint: 「もう一度」は “one more time” です。
explanation: 「もう一度言ってください」は、同じことをもう一回聞きたいときに使います。
targetPhraseIds: [say-again]
next: scene-12
```

Authored available-token order:

```ts
[
  { id: 'please', text: 'ください' },
  { id: 'period', text: '。' },
  { id: 'again', text: 'もう一度' },
  { id: 'say', text: '言って' },
]
```

Canonical token identities:

```ts
['again', 'say', 'please', 'period']
```

Canonical visible response:

```text
もう一度言ってください。
```

No alternate is authored unless the independent language review identifies one that should be accepted from this exact token bank.

### Scenes 12–13

```text
scene-12 | message | mina
text: きのうの夜、このメッセージを書きました。でも、送ったのは今日の朝です。だから、きのうの「あした」が今日になりました。
ttsId: mystery-message-tomorrow-v2-scene-12
next: scene-13

scene-13 | ending
title: 「あした」の正体
text: 未来からのメッセージではありませんでした。きのう書いた「あした」のメッセージが、今日届いただけでした。青いノートもミナさんのものだと分かり、謎は解けました。
ttsId: mystery-message-tomorrow-v2-scene-13
```

### Target phrase catalog

| ID | Japanese | Reading | Meaning |
| --- | --- | --- | --- |
| `tomorrow-seven` | `あしたの朝7時` | `あしたのあさしちじ` | tomorrow at 7 a.m. |
| `mina-possession` | `ミナさんのです` | `ミナさんのです` | it is Mina's |
| `train-station-plan` | `7時に電車でさくら駅に行きます` | `しちじにでんしゃでさくらえきにいきます` | I will go to Sakura Station by train at 7 |
| `wrote-yesterday` | `きのう書きました` | `きのうかきました` | wrote it yesterday |
| `when-is-tomorrow` | `「あした」はいつですか？` | `あしたはいつですか` | When is “tomorrow”? |
| `say-again` | `もう一度言ってください` | `もういちどいってください` | Please say it again |

The `mina-possession` reading deliberately preserves the proper-name spelling `ミナ`; writing `みなさんのです` is ambiguous with `皆さん`.

Assessment provenance is expressed only by interaction `targetPhraseIds`: scene 03 -> `tomorrow-seven`; scene 05 -> `mina-possession`; scene 07 -> `train-station-plan`; scene 09 -> `wrote-yesterday`, `when-is-tomorrow`; scene 11 -> `say-again`.

## Page and Controller Wiring

`useMysteryMessenger` gains one method:

```ts
submitResponse(expectedSceneId: string, selectedTokenIds: readonly string[]): void;
```

It goes through the existing `transition()` helper so auth ownership, stale-event identity, persistence warnings, and no-save-on-idempotent behavior remain centralized.

`MysteryMessengerPage.vue` adds:

- `currentResponseBuild` computed projection;
- one `MysteryResponseBuildComposer` branch keyed by `scene.id`;
- `handleResponseSubmit()` using the existing 500 ms `lockTransition()`; and
- no new debounce/timer abstraction.

The choice composer is also keyed by `scene.id` so ephemeral Hint state resets naturally. Hint toggles do not acquire the transition lock.

## Testing Strategy

### Task-1 compile/audio closure

Before storage/validator/UI work begins, prove:

- the temporary five-scene `content.ts` satisfies the widened chapter contract with `targetPhrases: []` and assistance fields;
- its existing scene-03 replay is converted to `audioPrompt` rather than silently removed;
- every affected current fixture compiles;
- `selectMysterySceneAudio(message/ending)` returns scene `ttsId/text`;
- `selectMysterySceneAudio(choice with audioPrompt)` returns that prompt;
- a synthetic choice without audio and a response-build return `null`;
- transcript replay follows optional projected audio;
- `useMysteryAudio.play(choice without audio)` performs no TTS request;
- `useMysteryAudio.play(choice with audio)` calls TTS with `audioPrompt.text + audioPrompt.ttsId`; and
- full mobile typecheck passes.

### Model/content

Cover:

- correct and incorrect response submissions both advance;
- canonical and authored alternate response sequences are correct;
- stale response submission returns the same progress object;
- unknown/duplicate submitted token IDs fail;
- duplicate visible `に` identities can be swapped without changing correctness;
- punctuation participates in correctness;
- response history reconstructs selected/canonical text and explanation;
- real chapter has 13 scenes, two speakers, one ending, converging choices, and one complete path;
- `tomorrow-seven.text === 'あしたの朝7時'`;
- scene 07 and scene 11 token contracts match this sheet exactly;
- scene 03 and scene 09 audio use their visible prompt; scene 05 audio uses its distinct listening line;
- target phrase references match the catalog; and
- all real chapter TTS text is free of `<...>` markup through one content-test assertion.

### Storage/validation

Cover the new history variant and new content issue codes, including alternate-answer validation and chapter-version reset. Keep the storage key `:v1` suffix unchanged.

### Components

Cover:

- repeated visible tokens remain separately tappable by stable ID;
- selected-token removal removes the exact identity;
- punctuation can be selected/removed;
- Clear resets the builder;
- Hint toggles authored copy;
- Send emits ordered IDs and respects disabled state;
- choice Hint behaves the same way;
- transcript renders response feedback/explanation; and
- replay renders only when projected audio exists.

### Controller/page/audio

Cover:

- `submitResponse()` persists once;
- rapid double-Send invokes only one response transition;
- session-unusable state disables response submission;
- Hint does not take the transition lock;
- scene 03/09 replay uses their prompt audio;
- scene 05 replay uses the listening line, never its visible instruction; and
- existing cancellation/gesture/media behavior remains green.

### Learn entry

`LearnPage.test.ts` pins the count-free description so the old five-scene copy cannot survive the content expansion.

## Final Verification

Before HPA-300 is accepted on this PR:

```bash
bun run --cwd apps/vela-mobile test:coverage
bun run --cwd apps/vela-mobile lint
bun run --cwd apps/vela-mobile typecheck
MOBILE_SKIP_ENV_VALIDATION=true bun run --cwd apps/vela-mobile build
```

Keep the existing mobile line-coverage threshold and require Codecov patch coverage >= 90% when CI runs. Codecov is a final gate, not a substitute for the model/audio/language checks above.

Perform a focused Simulator smoke pass for:

- scene 03 prompt replay;
- scene 05 listening replay speaking its authored line rather than the visible instruction;
- scene 09 prompt replay;
- canonical and alternate-correct scene 07 responses;
- one genuinely wrong response that still advances;
- Hint on both interaction types;
- duplicate `に` token selection;
- punctuation selection in both response scenes;
- resume/restart after the chapter-version reset; and
- reaching the single ending.

Perform the independent language freeze review before Task 5 implementation, then one final in-context read-through after implementation. Copy corrections update this canonical sheet and its pinned content tests together.

Full physical-device pilot acceptance and missed-phrase recap remain HPA-302 and HPA-301 respectively.

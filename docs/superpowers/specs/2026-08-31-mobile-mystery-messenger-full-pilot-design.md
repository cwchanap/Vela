# HPA-300: Mobile Mystery Messenger Full Pilot

**Date:** 2026-08-31

**Linear:** [HPA-300](https://linear.app/cwchanap/issue/HPA-300/mystery-messengerpilot-author-the-full-linear-chapter-and-add-tap-to)

**Parent:** HPA-298 — Mystery Messenger Pilot

**Blocked-by gate:** HPA-299 is Done and PR #62 is merged, so the five-scene vertical-slice gate is treated as satisfied.

## Goal

Expand the accepted five-scene Mystery Messenger slice into the complete first pilot of *The Message That Arrived Tomorrow* without turning the feature into a general story engine.

The finished HPA-300 slice has exactly 13 authored scenes, two recurring characters, one linear path, one ending, text choices, one audio-backed choice, and two tap-to-build Japanese responses. Every interaction has one authored hint and one short explanation. Incorrect answers and hint use never dead-end the story.

Design, implementation plan, implementation, review fixes, and verification stay on one branch and one PR for HPA-300.

## Current State and Reuse

HPA-299 already established the right seams under `apps/vela-mobile/src/features/mystery-messenger`:

- `model.ts` owns the closed scene/history model, immutable progress transitions, and transcript projection.
- `content.ts` owns one checked-in TypeScript chapter constant.
- `validate-content.ts` performs pure test-time graph/reference validation.
- `storage.ts` owns one user/chapter local snapshot and discards incompatible content by chapter version.
- `useMysteryMessenger.ts` owns authenticated run loading, transition persistence, restart, and session gating.
- `useMysteryAudio.ts` owns existing authenticated TTS/audio/lifecycle behavior.
- `MysteryTranscript.vue` renders the chronological story and emits replay requests.
- `MysteryChoiceComposer.vue` renders the current choice.
- `MysteryMessengerPage.vue` owns dependency injection and the 500 ms accidental-repeat guard.

The web `SentenceBuilder.vue` uses `vuedraggable`, Pinia, backend game questions, scoring, and session recording. None of that shape is needed here. HPA-300 uses a feature-local tap-to-order component and does not extract or share the web implementation.

## Scope

HPA-300 adds only:

- one fourth scene variant: `response-build`;
- one feature-local `MysteryResponseBuildComposer.vue`;
- stable authored response-token identities, including duplicate visible tokens and punctuation;
- optional audio prompts on the existing `choice` scene instead of a separate listening interaction type;
- one pure scene-audio selector shared by transcript projection and playback;
- an authored hint, explanation, and target-phrase references on each `choice` and `response-build` interaction;
- a small chapter-level target-phrase catalog;
- the complete 13-scene pilot content from the frozen copy sheet below;
- validator/storage/transcript/controller/page extensions required by those contracts; and
- focused automated and manual verification.

## Non-goals

Do not add:

- a story/interaction registry, visitor framework, command bus, or plugin API;
- new Pinia state;
- backend/API/CDK/DynamoDB changes;
- cloud progress or cross-device sync;
- SRS writes or dictionary mutation;
- missed-phrase accumulation or recap UI — HPA-301 owns that;
- branches, alternate endings, relationship state, inventory, or side content;
- persisted partial response-builder drafts;
- random token shuffling;
- the web drag/drop sentence-builder dependency;
- a mobile E2E framework; or
- physical-device release acceptance — HPA-302 owns the final device gate.

A second real narrative consumer remains the extraction gate for shared story machinery.

## Ticket Wording Clarification

The original acceptance line saying the pilot can be finished “without vocabulary outside the declared target set” is too literal for a small learning-target catalog: particles, connective grammar, names, and beginner story glue would otherwise all need to become artificial target phrases.

For implementation, “target set” means the explicitly assessed phrases attached to interactions. Every assessed interaction must be solvable from its authored prompt/tokens and declared target phrases. Surrounding story prose remains beginner/N5-adjacent and receives the manual language-quality pass.

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

A model-union change is not considered complete until all current union consumers compile. Task 1 therefore widens the scene/history/transcript contracts together with `content.ts`, the scene-audio selector, `useMysteryAudio`, `MysteryTranscript`, and all affected fixtures. Storage and validator semantics for persisted response history remain Task 2, but Task 1 must end with `typecheck` green.

## Closed Content Contract

### Target phrases

```ts
export type MysteryTargetPhrase = {
  id: string;
  text: string;
  reading: string;
  meaning: string;
  sourceSceneId: string;
};
```

`MysteryChapter` gains:

```ts
targetPhrases: readonly MysteryTargetPhrase[];
```

These records are authored now so HPA-301 can later reference them. HPA-300 does not yet track missed phrases.

### Choice

Keep one choice type for both reading and listening interactions:

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

A text choice omits `audioPrompt`. An audio-backed choice keeps a visible instruction in `prompt` and supplies the Japanese listening line in `audioPrompt`. This proves listening without inventing a fifth scene type.

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

`MysteryScene` becomes:

```ts
export type MysteryScene =
  | MysteryMessageScene
  | MysteryChoiceScene
  | MysteryResponseBuildScene
  | MysteryEndingScene;
```

No arbitrary payload map or interaction-handler registry is added.

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
- correctness is evaluated by the visible token-text sequence, not by duplicate-token identity;
- therefore swapping two different token IDs that both render `に` remains correct when the visible Japanese sentence is unchanged;
- punctuation is a normal authored token and participates in correctness; and
- the response always advances to its single `nextSceneId`.

The component never mutates progress directly.

## Scene Audio and Transcript Contract

Audio availability is a model projection, not a Vue inference and not a second copy of scene-kind logic inside `useMysteryAudio`.

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

`MysteryTranscriptItem` is still a closed union, but every projected item may carry optional audio:

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

`selectMysteryTranscript()` calls `selectMysterySceneAudio()` when it projects the current/completed scene. Therefore:

- message and ending items always carry audio;
- text choice prompt/result items omit audio;
- the listening choice prompt/result carry the same `audioPrompt` identity and spoken text;
- response prompt/result items omit audio; and
- the current-scene switch is exhaustive over all four scene kinds. No catch-all “else means ending” remains.

`MysteryTranscript.vue` renders replay only when `item.audio` exists. The replay event still carries `sceneId`; the page resolves the scene and delegates to `useMysteryAudio.play(scene)`.

`useMysteryAudio.play(scene)` also calls `selectMysterySceneAudio(scene)`. When the selector returns `null`, playback returns without a TTS request. When it returns audio, prepare and media-unavailable invalidation use that same `audio.ttsId`; TTS preparation uses that same `audio.text`. This prevents a listening choice from speaking its visible instruction instead of its authored listening line.

Existing gesture-required, media-unavailable, lifecycle cancellation, identity change, and disposal behavior remain unchanged.

## Tap-to-Order UI

`MysteryResponseBuildComposer.vue` owns only ephemeral input state for the active scene:

- `selectedTokenIds: string[]`;
- available tokens are `scene.tokens` filtered by selected IDs, preserving authored order;
- tapping an available token appends its ID;
- tapping a selected token removes that exact ID;
- `Clear` empties the response;
- `Hint` toggles `scene.hint`;
- `Send` emits the ordered token IDs and is disabled when no tokens are selected or the parent disables transitions.

The page keys the composer by `scene.id`, so moving to another response scene naturally resets local token/hint state. Partial drafts are intentionally not persisted.

Stable IDs are a UI identity mechanism. They are not exposed to the learner and are not used to make visually identical duplicate tokens semantically different.

## Hints and Explanations

Both interaction components use the same product behavior without introducing a shared interaction framework:

- one `Hint` button reveals the authored hint inline;
- hint visibility is local UI state only in HPA-300;
- hint taps do not acquire the page transition lock;
- choosing/submitting immediately advances as today;
- completed transcript entries show the selected answer, result-specific feedback, and scene explanation; and
- wrong answers still continue to the same next scene.

HPA-301 may later add persisted `usedHint`/missed-phrase bookkeeping and bump the disposable chapter version. HPA-300 does not pre-build that state machine.

## Persistence and Version Reset

Keep the existing `localStorage` key format:

```text
vela:mobile:mystery-messenger:<user>:<chapter>:v1
```

The `:v1` suffix versions the storage shape and does not change in HPA-300. The chapter keeps ID `mystery-message-tomorrow-v1` and increments `chapter.version` from `1` to `2`; this deliberately discards the five-scene save with no migration or fallback path.

Extend closed history validation to accept `response-build` entries only when:

- the referenced scene exists and is `response-build`;
- every selected token ID exists in that scene; and
- no token ID is repeated in the stored submission.

No partial response draft is added to `MysteryProgress`.

## Authored-Content Validation

Extend the existing pure validator; do not add runtime validation UI.

Keep current checks and add focused codes for:

```text
duplicate_target_phrase_id
dangling_target_phrase_source
unknown_target_phrase_reference
duplicate_response_token_id
invalid_response_answer_token
unsupported_tts_markup
multiple_endings
```

Validation rules:

- response-build `nextSceneId` must exist;
- response token IDs are unique within a response scene;
- every `correctTokenIds` entry references a real token and each token ID appears at most once in the correct answer;
- every interaction target phrase ID exists in the chapter catalog;
- every target phrase source scene exists;
- there is exactly one ending;
- TTS-bound authored text contains no `<...>` markup; and
- the existing start/reference/ending reachability traversal understands `response-build` as a single outgoing edge.

Do not add a generic branching-choice error. The real-content test pins that every authored choice option converges to the same next scene and that all 13 scenes form one path to the sole ending. Unit validator fixtures remain free to contain multi-edge graphs so graph validation itself is still exercised.

Speaker validity remains compile-time through the closed `MysterySpeaker` union; no character registry is added just to validate it again at runtime.

## Frozen Pilot Copy and Token Sheet

This section is the single source of truth for learner-facing HPA-300 story copy, assessed phrases, response token segmentation, and listening text. Implementation should copy it as written. The chapter title intentionally keeps kanji, while learner-facing dialogue and assessed uses of the mystery word use `あした` consistently.

### Chapter identity

```text
id: mystery-message-tomorrow-v1
version: 2
title: 明日からのメッセージ
startSceneId: scene-01
```

Because `MobileTtsService` treats `(userId, vocabularyId, voice settings)` as cache identity and assumes `vocabularyId + text` is immutable, all HPA-300 TTS-bound lines use fresh `...-v2-...` IDs even though the chapter/storage identifiers above stay unchanged.

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

scene-03 | text choice | mina
prompt: ミナさんは、いつ駅に来てほしいですか？
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

scene-05 | audio-backed choice | haru
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
incorrect feedback: 意味は伝わりました。正しい語順も確認しておきましょう。
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

Correct token identities:

```ts
['time', 'ni-time', 'train', 'de', 'station', 'ni-place', 'go', 'period']
```

Correct visible response:

```text
7時に電車でさくら駅に行きます。
```

Swapping `ni-time` and `ni-place` in the submitted ID order remains correct because the visible text sequence is unchanged.

### Scenes 08–10

```text
scene-08 | message | haru
text: ちょっと待ってください。メッセージは今日届きました。でも、ミナさんは「きのう書きました」と言いました。
ttsId: mystery-message-tomorrow-v2-scene-08
next: scene-09

scene-09 | text choice | haru
prompt: 今、何を確認するのが一番いいですか？
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
incorrect feedback: 意味は伝わりました。自然な言い方も確認しましょう。
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

Correct token identities:

```ts
['again', 'say', 'please', 'period']
```

Correct visible response:

```text
もう一度言ってください。
```

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

| ID | Japanese | Reading | Meaning | Source |
| --- | --- | --- | --- | --- |
| `tomorrow-seven` | `あしたの朝7時` | `あしたのあさしちじ` | tomorrow at 7 a.m. | scene-02 |
| `mina-possession` | `ミナさんのです` | `ミナさんのです` | it is Mina's | scene-05 |
| `train-station-plan` | `7時に電車でさくら駅に行きます` | `しちじにでんしゃでさくらえきにいきます` | I will go to Sakura Station by train at 7 | scene-07 |
| `wrote-yesterday` | `きのう書きました` | `きのうかきました` | wrote it yesterday | scene-06 |
| `when-is-tomorrow` | `「あした」はいつですか？` | `あしたはいつですか` | When is “tomorrow”? | scene-09 |
| `say-again` | `もう一度言ってください` | `もういちどいってください` | Please say it again | scene-11 |

The `mina-possession` reading deliberately preserves the proper-name spelling `ミナ`; writing `みなさんのです` is ambiguous with `皆さん`.

## Page and Controller Wiring

`useMysteryMessenger` gains one method:

```ts
submitResponse(expectedSceneId: string, selectedTokenIds: readonly string[]): void;
```

It goes through the existing `transition()` helper, so auth ownership, stale-event identity, persistence warnings, and no-save-on-idempotent behavior remain centralized.

`MysteryMessengerPage.vue` adds:

- `currentResponseBuild` computed projection;
- one `MysteryResponseBuildComposer` branch keyed by `scene.id`;
- `handleResponseSubmit()` using the existing 500 ms `lockTransition()`; and
- no new timer/debounce abstraction.

The choice composer is also keyed by `scene.id` so its ephemeral Hint state resets naturally. Hint toggles do not acquire the transition lock because they do not mutate story progress.

## Testing Strategy

### Task-1 compile/audio closure

Before storage/validator/UI work begins, prove:

- the temporary five-scene `content.ts` still satisfies the widened `MysteryChapter` by adding `targetPhrases: []` and assistance fields to its choice;
- every affected current fixture compiles with the widened contracts;
- `selectMysterySceneAudio(message/ending)` returns scene `ttsId/text`;
- `selectMysterySceneAudio(text choice/response-build)` returns `null`;
- `selectMysterySceneAudio(audio choice)` returns `audioPrompt`;
- text `choice-prompt` and `choice-result` transcript items have no audio and therefore no replay button;
- audio-backed `choice-prompt` and `choice-result` carry replay audio;
- `useMysteryAudio.play(textChoice)` performs no TTS request;
- `useMysteryAudio.play(audioChoice)` calls TTS with `audioPrompt.text + audioPrompt.ttsId`; and
- the full mobile typecheck passes at the end of Task 1.

### Model/content

Cover:

- correct and incorrect response submissions both advance;
- stale response submission returns the same progress object;
- unknown/duplicate submitted token IDs fail;
- duplicate visible `に` identities can be swapped without changing correctness;
- punctuation participates in correctness;
- response history reconstructs selected/correct text and explanation;
- real chapter has 13 scenes, two speakers, one ending, converging choices, and one complete path;
- `tomorrow-seven.text === 'あしたの朝7時'`;
- scene 07 and scene 11 tokens/answers match the frozen copy sheet exactly; and
- real interaction target phrase references match the catalog.

### Storage/validation

Cover the new history variant and each new content issue code, plus chapter-version reset from the old five-scene content. Keep the storage key `:v1` suffix unchanged.

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
- replay is absent for text-only choice/response items and present for message/ending/listening-choice content.

### Controller/page/audio

Cover:

- `submitResponse()` persists once;
- rapid double-Send invokes only one response transition;
- session-unusable state disables response submission;
- Hint does not take the transition lock;
- page replay of the listening choice reaches `useMysteryAudio` with the listening scene; and
- existing cancellation/gesture/media behavior remains green.

## Final Verification

Before HPA-300 is accepted on this PR:

```bash
bun run --cwd apps/vela-mobile test:coverage
bun run --cwd apps/vela-mobile lint
bun run --cwd apps/vela-mobile typecheck
MOBILE_SKIP_ENV_VALIDATION=1 bun run --cwd apps/vela-mobile build
```

Keep the existing mobile line-coverage threshold and require Codecov patch coverage >= 90% when CI runs. Codecov is a final gate, not a substitute for the Task-1 compile/audio tests above.

Perform a focused Simulator smoke pass for:

- scene 03 text choice has no replay control;
- scene 05 listening choice has replay and speaks the authored listening line, not the visible instruction;
- correct and incorrect response-build submissions;
- Hint on both interaction types;
- duplicate `に` token selection;
- punctuation selection in both response scenes;
- resume/restart after the chapter-version reset; and
- reaching the single ending.

Perform a manual Japanese pass against the frozen copy sheet, checking naturalness, reading/meaning accuracy, relative-date clarity, and that no unsupported TTS markup is present. Copy corrections must update the frozen sheet and its pinned content tests together rather than silently diverging `content.ts`.

Full physical-device pilot acceptance and the missed-phrase recap remain HPA-302 and HPA-301 respectively.

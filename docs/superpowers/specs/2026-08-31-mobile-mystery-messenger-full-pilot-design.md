# HPA-300: Mobile Mystery Messenger Full Pilot

**Date:** 2026-08-31

**Linear:** [HPA-300](https://linear.app/cwchanap/issue/HPA-300/mystery-messengerpilot-author-the-full-linear-chapter-and-add-tap-to)

**Parent:** HPA-298 — Mystery Messenger Pilot

**Blocked-by gate:** HPA-299 is Done and PR #62 is merged, so the five-scene vertical-slice gate is treated as satisfied.

## Goal

Expand the accepted five-scene Mystery Messenger slice into the complete first pilot of *The Message That Arrived Tomorrow* without turning the feature into a general story engine.

The finished HPA-300 slice has 13 authored scenes, two recurring characters, one linear path, one ending, text choices, one audio-backed choice, and two tap-to-build Japanese responses. Every interaction has one authored hint and one short explanation. Incorrect answers and hint use never dead-end the story.

Design, implementation plan, implementation, review fixes, and verification stay on one branch and one PR for HPA-300.

## Current State and Reuse

HPA-299 already established the right seams under `apps/vela-mobile/src/features/mystery-messenger`:

- `model.ts` owns a closed `message | choice | ending` union, immutable progress transitions, and transcript projection.
- `content.ts` owns one checked-in TypeScript chapter constant.
- `validate-content.ts` performs pure test-time graph/reference validation.
- `storage.ts` owns one user/chapter local snapshot and discards incompatible content by chapter version.
- `useMysteryMessenger.ts` owns authenticated run loading, transition persistence, restart, and session gating.
- `useMysteryAudio.ts` owns existing authenticated TTS/audio/lifecycle behavior.
- `MysteryTranscript.vue` renders the chronological story.
- `MysteryChoiceComposer.vue` renders the current choice.
- `MysteryMessengerPage.vue` owns dependency injection, the 500 ms accidental-repeat guard, and page composition.

The web `SentenceBuilder.vue` uses `vuedraggable`, Pinia, backend game questions, scoring, and session recording. None of that shape is needed here. HPA-300 uses a feature-local tap-to-order component and does not extract or share the web implementation.

## Scope

HPA-300 adds only:

- one fourth scene variant: `response-build`;
- one feature-local `MysteryResponseBuildComposer.vue`;
- stable authored response-token identities, including duplicate visible tokens and punctuation;
- optional audio prompts on the existing `choice` scene instead of a separate listening interaction type;
- an authored hint, explanation, and target-phrase references on each `choice` and `response-build` interaction;
- a small chapter-level target-phrase catalog;
- the complete 13-scene pilot content;
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

The existing acceptance line saying the pilot can be finished “without vocabulary outside the declared target set” is too literal for a small learning-target catalog: particles, connective grammar, names, and beginner story glue would otherwise all need to become artificial target phrases.

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

Persist the submitted token identities, not display text:

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
- choosing/submitting immediately advances as today;
- completed transcript entries show the selected answer, result-specific feedback, and the scene explanation; and
- wrong answers still continue to the same next scene.

HPA-301 may later add persisted `usedHint`/missed-phrase bookkeeping and bump the disposable chapter version. HPA-300 does not pre-build that state machine.

## Transcript Projection

Extend `MysteryTranscriptItem` with:

```ts
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
```

`choice-result` also gains `explanation`.

`selectMysteryTranscript()` remains the only reconstruction boundary: it resolves stored response token IDs against authored content and derives selected/correct visible Japanese. The Vue transcript does not reimplement correctness.

The active `response-build` scene projects one `response-prompt`; the composer renders only the builder controls, avoiding duplicated prompt copy.

## Audio Behavior

Messages and endings keep their existing `ttsId + text` behavior.

Choice audio becomes optional and explicit:

- text choice: `audioPrompt` absent, no replay button;
- listening choice: `audioPrompt` present, replay button prepares/plays `audioPrompt.text` with `audioPrompt.ttsId`;
- response-build scenes do not add scene-level TTS in HPA-300.

`useMysteryAudio.play(scene)` stays the existing controller. Replace the current `authoredTextFor()` assumption with a tiny internal selector returning `{ ttsId, text } | null`. `play()` returns immediately when a scene has no authored audio.

`MysteryTranscript.vue` only shows replay when the projected item has audio. Existing gesture-required, media-unavailable, lifecycle cancellation, identity change, and disposal behavior remain unchanged.

## Persistence and Version Reset

Keep the existing `localStorage` key format and adapter. Extend its closed history validation to accept `response-build` entries only when:

- the referenced scene exists and is `response-build`;
- every selected token ID exists in that scene; and
- no token ID is repeated in the stored submission.

The full pilot changes both content and progress possibilities, so the chapter version increments from `1` to `2`. Existing HPA-299 runs are disposable and reset with no migration or fallback path.

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

Do not add a generic “branching choice” error. The real-content test pins that every authored choice option converges to the same next scene and that all 13 scenes form one path to the sole ending.

Speaker validity remains compile-time through the closed `MysterySpeaker` union; no character registry is added just to validate it again at runtime.

## Full Pilot Story

Keep two recurring characters: `mina` and `haru`.

Use 13 scenes:

1. **Message — Mina:** `こんにちは。これは「あした」からのメッセージです。`
2. **Message — Mina:** `あしたの朝7時、電車でさくら駅に来てください。青いノートを持ってきてください。`
3. **Text choice:** identify `あしたの朝7時` as the requested time.
4. **Message — Haru:** `さくら駅で青いノートを見つけました。ノートに「きのう、ここに置きました」と書いてあります。`
5. **Audio-backed choice:** listen to `青いノートはミナさんのです。きのう、駅に忘れました。` and identify Mina as the owner.
6. **Message — Mina:** `そうです。きのう、駅に忘れました。でも、このメッセージもきのう書きました。`
7. **Response build:** send `7時に電車でさくら駅に行きます。` using two distinct `に` token IDs plus `。`.
8. **Message — Haru:** `ちょっと待ってください。メッセージは今日届きました。でも、ミナさんは「きのう書きました」と言いました。`
9. **Text choice:** choose `「あした」はいつですか？` as the useful clarification.
10. **Message — Mina:** `「あした」は、メッセージを書いたきのうから見た今日のことです。`
11. **Response build:** send `もう一度言ってください。`.
12. **Message — Mina:** `きのうの夜、このメッセージを書きました。そして、今日の朝に送るようにしました。だから、きのうの「あした」が今日になりました。`
13. **Ending — `「あした」の正体`:** reveal that the message was written yesterday and delivered today; it was not literally from the future.

This keeps the mystery centered on relative time and Japanese comprehension rather than introducing lore or branching.

## Target Phrase Catalog

Author six target phrases:

| ID | Japanese | Reading | Meaning | Source |
| --- | --- | --- | --- | --- |
| `tomorrow-seven` | `明日の朝7時` | `あしたのあさしちじ` | tomorrow at 7 a.m. | scene 02 |
| `mina-possession` | `ミナさんのです` | `みなさんのです` | it is Mina's | scene 05 |
| `train-station-plan` | `7時に電車でさくら駅に行きます` | `しちじにでんしゃでさくらえきにいきます` | I will go to Sakura Station by train at 7 | scene 07 |
| `wrote-yesterday` | `きのう書きました` | `きのうかきました` | wrote it yesterday | scene 06 |
| `when-is-tomorrow` | `「あした」はいつですか？` | `あしたはいつですか` | When is “tomorrow”? | scene 09 |
| `say-again` | `もう一度言ってください` | `もういちどいってください` | Please say it again | scene 11 |

Interaction references:

- scene 03 -> `tomorrow-seven`;
- scene 05 -> `mina-possession`;
- scene 07 -> `train-station-plan`;
- scene 09 -> `wrote-yesterday`, `when-is-tomorrow`;
- scene 11 -> `say-again`.

## Real Response Token Sets

Scene 07 must exercise duplicate visible tokens and punctuation in production content:

```ts
tokens: [
  { id: 'station', text: 'さくら駅' },
  { id: 'ni-time', text: 'に' },
  { id: 'period', text: '。' },
  { id: 'train', text: '電車' },
  { id: 'go', text: '行きます' },
  { id: 'time', text: '7時' },
  { id: 'de', text: 'で' },
  { id: 'ni-place', text: 'に' },
],
correctTokenIds: ['time', 'ni-time', 'train', 'de', 'station', 'ni-place', 'go', 'period'],
```

A regression test also submits the two `に` IDs swapped and expects a correct result because the visible sentence is unchanged.

Scene 11 uses tokens for `もう一度言ってください。` and keeps `。` as a selectable token.

## Page and Controller Wiring

`useMysteryMessenger` gains one method:

```ts
submitResponse(expectedSceneId: string, selectedTokenIds: readonly string[]): void;
```

It goes through the existing `transition()` helper, so auth ownership, stale-event identity, persistence warnings, and no-save-on-idempotent behavior remain centralized.

`MysteryMessengerPage.vue` adds:

- `currentResponseBuild` computed projection;
- one `MysteryResponseBuildComposer` branch;
- `handleResponseSubmit()` using the existing 500 ms `lockTransition()`; and
- no new timer/debounce abstraction.

Hint toggles do not acquire the transition lock because they do not mutate story progress.

## Testing Strategy

Keep tests focused on the existing layers.

### Model/content

Cover:

- correct and incorrect response submissions both advance;
- stale response submission returns the same progress object;
- unknown/duplicate submitted token IDs fail;
- duplicate visible `に` identities can be swapped without changing correctness;
- punctuation participates in correctness;
- response history reconstructs selected/correct text and explanation;
- text choice has no audio identity;
- listening choice carries one audio prompt;
- real chapter has 13 scenes, two speakers, one ending, converging choices, and one complete path; and
- real interaction target phrase references match the catalog.

### Storage/validation

Cover the new history variant and each new content issue code, plus chapter-version reset from the old five-scene content.

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
- replay button is absent for text-only choice/response items and present for audio-backed content.

### Controller/page/audio

Cover:

- `submitResponse()` persists once;
- rapid double-Send invokes only one response transition;
- session-unusable state disables response submission;
- audio-backed choice uses `audioPrompt.text` + `audioPrompt.ttsId`;
- text choice/response scene passed defensively to audio produces no request; and
- existing cancellation/gesture/media behavior remains green.

## Final Verification

Before HPA-300 is accepted on this PR:

```bash
bun run --cwd apps/vela-mobile test:coverage
bun run --cwd apps/vela-mobile lint
bun run --cwd apps/vela-mobile typecheck
MOBILE_SKIP_ENV_VALIDATION=1 bun run --cwd apps/vela-mobile build
```

Keep the existing mobile line-coverage threshold and require Codecov patch coverage >= 90% when CI runs.

Perform a focused Simulator smoke pass for:

- text choice;
- audio-backed choice;
- correct and incorrect response-build submissions;
- Hint on both interaction types;
- duplicate `に` token selection;
- punctuation selection;
- resume/restart after the chapter-version reset; and
- reaching the single ending.

Perform a manual Japanese pass checking naturalness, reading/meaning accuracy, relative-date clarity, and that no unsupported TTS markup is present.

Full physical-device pilot acceptance and the missed-phrase recap remain HPA-302 and HPA-301 respectively.

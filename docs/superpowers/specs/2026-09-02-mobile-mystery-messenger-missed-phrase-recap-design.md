# HPA-301: Mobile Mystery Messenger Missed-Phrase Recap

**Date:** 2026-09-02

**Linear:** [HPA-301](https://linear.app/cwchanap/issue/HPA-301/mystery-messengerlearning-add-the-run-local-missed-phrase)

**Parent:** HPA-298 — Mystery Messenger Pilot

**Blocked-by gate:** HPA-299 and HPA-300 are Done. HPA-301 blocks HPA-302 final pilot acceptance.

## Goal

Connect mistakes made during *The Message That Arrived Tomorrow* to one useful, run-local review surface without depending on the unfinished mobile Review flow or mutating SRS, vocabulary progress, or personal dictionaries.

A learner who answers an interaction incorrectly or completes it after revealing the interaction hint should see each affected target phrase exactly once in the ending recap. A learner who finishes every interaction correctly without hints should see a clear no-mistakes state.

Design, implementation plan, implementation, review fixes, and verification stay on one branch and one PR for HPA-301.

## Current State and Reuse

HPA-299 and HPA-300 already established the complete feature-local runtime under `apps/vela-mobile/src/features/mystery-messenger`:

- `model.ts` owns the closed scene/history model, immutable progress transitions, response grading, and transcript projection.
- `content.ts` owns the chapter and its target-phrase catalog. Interactions already reference phrases through `targetPhraseIds`.
- `storage.ts` owns one user/chapter local snapshot and validates it against the active chapter version.
- `useMysteryMessenger.ts` owns authenticated run loading, immutable transitions, persistence, restart, and session gating.
- `MysteryChoiceComposer.vue` and `MysteryResponseBuildComposer.vue` own local interaction UI, including currently-local hint visibility.
- `MysteryMessengerPage.vue` owns feature composition and the existing authenticated TTS/audio controller.
- `useMysteryAudio.ts` already provides the correct authenticated TTS playback path and must be reused for recap replay.

The important missing fact is hint usage. Both interaction components currently toggle `showHint` locally and emit only the final answer. HPA-301 therefore cannot infer later whether a correct answer was hint-assisted. That fact must become explicit at the moment the hint is revealed.

## Scope

HPA-301 adds only:

- one run-local deduplicated missed-phrase collection inside `MysteryProgress`;
- one small persisted per-interaction hint-use marker so a hint-assisted correct answer is graded for recap correctly even after route re-entry or relaunch;
- pure model helpers that accumulate missed phrases from interaction outcomes;
- provenance sufficient to render the source interaction for each missed phrase;
- one ending-summary component listing phrase, reading, meaning, source scene, and replay action;
- one clear empty recap state;
- focused storage/controller/component/page tests for zero, one, multiple, repeated, incorrect, hint-assisted, restart, and resume behavior; and
- the existing mobile unit/coverage/lint/typecheck/build gates.

## Non-goals

Do not add:

- backend/API/CDK/DynamoDB changes;
- SRS writes, familiarity scores, review scheduling, or vocabulary-save APIs;
- a personal dictionary or case-notes subsystem;
- a generic review engine, mistakes package, Pinia store, event bus, or command registry;
- cloud sync or cross-device recap persistence;
- chapter branching or alternate ending logic;
- a second TTS service or recap-specific audio cache;
- target-phrase source metadata on every catalog item;
- adaptive assistance or repeated authored review slots; or
- physical-device release acceptance, which remains HPA-302.

A second real consumer remains the extraction gate for shared mistake-review infrastructure.

## Product Rules

The recap rule is intentionally closed and deterministic:

1. Correct answer without revealing the hint: add nothing.
2. Incorrect answer: add every `targetPhraseIds` entry from that interaction.
3. Correct answer after revealing the hint: add every `targetPhraseIds` entry from that interaction.
4. Incorrect answer after revealing the hint: same result as any incorrect answer; no duplicate phrase entries.
5. If multiple interactions target the same phrase, the recap still contains one row for that phrase.
6. Restart creates a fresh run and therefore clears both missed phrases and hint-use state.
7. Relaunch and route re-entry restore the run-local recap because it is part of the existing chapter-versioned snapshot.
8. Recap replay is read-only. It must not change `history`, `currentSceneId`, `completed`, missed phrases, hint-use state, or any external learning state.

## Data Model

### Persist the minimum facts needed

Extend `MysteryProgress` with two closed fields:

```ts
export type MysteryMissedPhrase = {
  phraseId: string;
  sourceSceneId: string;
};

export type MysteryProgress = {
  chapterId: string;
  chapterVersion: number;
  currentSceneId: string;
  history: readonly MysteryHistoryEntry[];
  completed: boolean;
  missedPhrases: readonly MysteryMissedPhrase[];
  hintedSceneIds: readonly string[];
};
```

`missedPhrases` stores IDs plus the actual interaction where the phrase was first missed. This avoids adding ambiguous reverse metadata such as `sourceSceneId` to `MysteryTargetPhrase`, while still satisfying the recap's source-scene requirement.

`hintedSceneIds` is deliberately a small persisted set, not a general interaction-state object. It exists only because a learner may reveal a hint before answering and that fact must survive route re-entry/relaunch until the answer is submitted.

Both arrays are treated as sets with stable insertion order:

- a scene ID appears at most once in `hintedSceneIds`;
- a phrase ID appears at most once in `missedPhrases`;
- first-miss provenance wins when the same phrase is targeted by more than one interaction.

### No snapshot namespace or chapter-version bump

HPA-301 changes the shape of the current version-2 progress payload but does not change authored chapter content. Keep the existing chapter ID, chapter version, and `:v1` storage-key namespace.

`storage.ts` should accept existing HPA-300 snapshots that lack the two new fields by normalizing them to empty arrays on load. This is a narrow additive snapshot compatibility rule, not a general migration framework. Once normalized, subsequent saves use the new shape.

Do not build versioned migrators or schema registries.

## Hint Flow

The components already know the exact moment a hint becomes visible. Keep that ownership and emit one idempotent signal only on the transition from hidden to shown:

```ts
const emit = defineEmits<{
  choose: [optionId: string];
  hintUsed: [];
}>();
```

and similarly for the response builder.

Tapping the Hint button again to hide or re-show the same hint must not create duplicate state. The page forwards the current scene ID to the controller:

```ts
messenger.markHintUsed(scene.id);
```

The controller persists the new progress through its existing `transition()` function. `markMysteryHintUsed()` is a pure model transition that no-ops for stale scene IDs, non-interaction scenes, or an already-marked scene.

Do not persist whether the hint is currently visually expanded. After route re-entry, the hint may render collapsed; only the fact that it was used matters for grading.

## Missed-Phrase Accumulation

Keep outcome calculation in `model.ts`, where the chapter, selected answer, interaction metadata, and immutable progress transitions already live.

Add a pure helper:

```ts
function addMysteryMissedPhrases(
  progress: MysteryProgress,
  sceneId: string,
  targetPhraseIds: readonly string[],
): MysteryProgress;
```

It appends only phrase IDs not already present and uses the current interaction scene as `sourceSceneId`.

`chooseMysteryOption()` should add phrases when either:

- the selected option has `result === 'incorrect'`; or
- `progress.hintedSceneIds` already contains the choice scene ID.

`submitMysteryResponse()` should determine correctness through the same visible-text semantics used by transcript grading, then apply the same incorrect-or-hinted rule before advancing.

To avoid duplicating response correctness logic, extract the existing response grading into one pure helper used by both submission and transcript projection, for example:

```ts
export function gradeMysteryResponse(
  scene: MysteryResponseBuildScene,
  selectedTokenIds: readonly string[],
): 'correct' | 'incorrect';
```

This is a reuse extraction inside the same file, not a new abstraction layer.

Hint markers do not need removal after answer submission because completed history never returns to the same interaction during one linear run. Keeping them makes resume validation simple and preserves an audit of which interactions were hint-assisted.

## Recap Projection

Do not store duplicated phrase text/reading/meaning in progress. Derive display rows from the snapshot plus the checked-in chapter catalog:

```ts
export type MysteryMissedPhraseRecapItem = {
  phraseId: string;
  text: string;
  reading: string;
  meaning: string;
  sourceSceneId: string;
  sourcePrompt: string;
};

export function selectMysteryMissedPhraseRecap(
  chapter: MysteryChapter,
  progress: MysteryProgress,
): MysteryMissedPhraseRecapItem[];
```

`sourcePrompt` is derived from the source interaction:

- choice: `scene.prompt`;
- response-build: `scene.prompt`.

If stored IDs cannot be resolved against the active chapter, storage validation rejects the snapshot before projection. No runtime placeholder rows are needed.

## Recap UI

Add one feature-local `MysteryMissedPhraseRecap.vue` rendered only when the current scene is the ending.

The component receives recap items and emits one replay event carrying `phraseId`:

```ts
const emit = defineEmits<{ replay: [phraseId: string] }>();
```

For each item render:

- Japanese phrase text;
- reading;
- English meaning;
- a short `From: <source prompt>` provenance line; and
- a Replay button.

When the list is empty, render a durable message such as:

> No missed phrases this run.

Keep the existing Restart button below the recap.

No score, percentage, mastery badge, save-to-review button, or CTA into the unfinished Review flow is added.

## TTS Replay

Target phrases currently have no dedicated `ttsId`. Do not widen the target-phrase content contract or create generated IDs in content for this ticket.

Reuse `MobileTtsService` through the existing `useMysteryAudio` seam by adding a narrow raw-audio play method to that composable/controller:

```ts
playAudio(audio: MysterySceneAudio): Promise<void>;
```

`play(scene)` remains for transcript/scene replay and delegates to the same internal playback function after `selectMysterySceneAudio(scene)`.

The recap creates a stable feature-local TTS identity from chapter and phrase IDs at the page boundary:

```ts
{
  ttsId: `${chapter.id}-recap-${phrase.id}`,
  text: phrase.text,
}
```

This keeps TTS behavior centralized and avoids pretending recap phrases are scenes.

Replay must use the same audio status/error surface already shown on `MysteryMessengerPage.vue`.

## Storage Validation

`storage.ts` remains the only snapshot boundary.

On load:

1. Parse the existing progress object and validate its current required HPA-300 fields.
2. Normalize missing `missedPhrases` and `hintedSceneIds` to empty arrays.
3. Validate every `hintedSceneId` resolves to a choice or response-build scene and is unique.
4. Validate every missed phrase ID exists in `chapter.targetPhrases`.
5. Validate every missed `sourceSceneId` resolves to a choice or response-build scene whose `targetPhraseIds` contains that phrase ID.
6. Reject duplicate phrase IDs in `missedPhrases`.
7. Preserve the existing rule that `completed` matches whether the current scene is an ending.

Malformed new fields still clear the snapshot through the existing invalid-load behavior.

## Controller and Restart Behavior

`useMysteryMessenger.ts` should expose:

```ts
missedPhraseRecap: ComputedRef<readonly MysteryMissedPhraseRecapItem[]>;
markHintUsed(expectedSceneId: string): void;
```

The recap computed projection follows the same `progress === null ? [] : ...` pattern as transcript.

Restart keeps using `restartMysteryProgress(chapter)`, which returns both new arrays empty, then saves through the existing transition path.

No additional storage writes occur during recap viewing or replay.

## Testing Strategy

Keep tests at existing ownership boundaries.

### `model.test.ts`

Pin pure behavior for:

- correct choice without hint -> no missed phrase;
- incorrect choice -> all targeted phrases added once;
- correct choice after `markMysteryHintUsed()` -> phrases added;
- repeated target phrase across interactions -> one recap entry with first-miss source scene;
- response-build incorrect grading -> phrases added;
- response-build accepted canonical/alternate answer without hint -> no phrase;
- response-build accepted answer after hint -> phrases added;
- mark-hint idempotency and stale-scene no-op;
- restart clears missed/hinted state;
- recap projection resolves phrase metadata and source prompt.

### `storage.test.ts`

Pin:

- new snapshot round-trip;
- HPA-300-shaped snapshot normalizes missing new arrays to empty;
- recap/hint state survives load;
- unknown phrase/source/hint IDs are rejected;
- duplicate missed phrase or hinted scene IDs are rejected;
- missed phrase whose source interaction does not target it is rejected.

### Composer tests

For both choice and response-build:

- first reveal emits `hintUsed` once;
- hide/re-show does not emit another `hintUsed` for the same mounted scene;
- existing answer/submit behavior stays unchanged.

### `useMysteryMessenger.test.ts`

Pin controller-level persistence for hint use, incorrect outcomes, resume, restart, and recap computed projection.

### `useMysteryAudio.test.ts`

Pin raw recap audio playback through the same prepare/gesture-required/play/cancel/error behavior used by scene audio without duplicating the state machine.

### Recap component/page tests

Pin zero/one/multiple rows, source prompt, replay emission, ending-only visibility, restart co-existence, and TTS replay not mutating progress.

## Verification

HPA-301 is complete when:

- affected focused tests pass during development;
- `bun --filter @vela/mobile test:coverage` passes;
- mobile lint passes;
- mobile typecheck passes;
- mobile build passes;
- Codecov patch coverage remains at the repository-required threshold; and
- a Simulator smoke run confirms one clean completion and one missed/hint-assisted completion render the expected recap.

Physical-device release acceptance remains HPA-302.

## File Shape

Expected implementation remains feature-local:

```text
apps/vela-mobile/src/features/mystery-messenger/
  model.ts
  model.test.ts
  storage.ts
  storage.test.ts
  useMysteryMessenger.ts
  useMysteryMessenger.test.ts
  useMysteryAudio.ts
  useMysteryAudio.test.ts
  components/
    MysteryChoiceComposer.vue
    MysteryChoiceComposer.test.ts
    MysteryResponseBuildComposer.vue
    MysteryResponseBuildComposer.test.ts
    MysteryMissedPhraseRecap.vue              # new
    MysteryMissedPhraseRecap.test.ts          # new
  MysteryMessengerPage.vue
  MysteryMessengerPage.test.ts
```

No other application layer should need modification.
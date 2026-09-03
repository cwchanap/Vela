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

- `model.ts` owns the closed scene/history model, immutable progress transitions, response grading inside transcript projection, and transcript projection itself.
- `content.ts` owns the chapter and its target-phrase catalog. Interactions already reference phrases through `targetPhraseIds`.
- `storage.ts` owns one user/chapter local snapshot and validates it against the active chapter version.
- `useMysteryMessenger.ts` owns authenticated run loading, immutable transitions, persistence, restart, and session gating.
- `MysteryChoiceComposer.vue` and `MysteryResponseBuildComposer.vue` own local interaction UI, including currently-local hint visibility.
- `MysteryMessengerPage.vue` owns feature composition and the existing authenticated TTS/audio controller.
- `useMysteryAudio.ts` already provides the correct authenticated TTS playback path and must be extended rather than bypassed for recap replay.

The run history already records each completed assessed interaction and the learner's answer. Choice correctness is recoverable from `option.result`; response-build correctness is recoverable from the same visible-text rule currently used by `selectMysteryTranscript()`. Therefore missed phrases should be a projection of persisted history, not another persisted collection.

The only outcome-relevant fact that cannot be recovered is hint usage. Both interaction components currently toggle `showHint` locally and emit only the final answer. HPA-301 must persist that fact when the hint is first revealed.

## Scope

HPA-301 adds only:

- one persisted `hintedSceneIds` field to the existing run snapshot;
- one-shot hint-used events from the two existing interaction composers;
- one pure response grading helper extracted from transcript projection;
- one pure missed-phrase recap selector that walks history plus `hintedSceneIds` and deduplicates target phrases first-wins;
- provenance derived from the first qualifying interaction in history;
- one ending-summary component listing phrase, reading, meaning, source scene prompt, and replay action;
- one clear empty recap state;
- one narrow extension of the existing audio state machine so it can play a resolved phrase clip without pretending phrases are scenes;
- focused model/storage/controller/component/audio/page tests for zero, one, multiple, repeated, incorrect, hint-assisted, restart, resume, gesture retry, cancellation, and switching behavior; and
- the existing mobile unit/coverage/lint/typecheck/build gates.

## Non-goals

Do not add:

- a persisted `missedPhrases` collection or any other derived recap cache;
- backend/API/CDK/DynamoDB changes;
- SRS writes, familiarity scores, review scheduling, or vocabulary-save APIs;
- a personal dictionary or case-notes subsystem;
- a generic review engine, mistakes package, Pinia store, event bus, or command registry;
- cloud sync or cross-device recap persistence;
- chapter branching or alternate ending logic;
- a second TTS service or recap-specific audio cache;
- target-phrase source metadata on catalog items;
- a migration registry or versioned snapshot framework;
- adaptive assistance or repeated authored review slots; or
- physical-device release acceptance, which remains HPA-302.

A second real consumer remains the extraction gate for shared mistake-review infrastructure.

## Product Rules

The recap rule is intentionally closed and deterministic:

1. Correct answer without revealing the hint: add nothing to the derived recap.
2. Incorrect answer: include every `targetPhraseIds` entry from that interaction.
3. Correct answer after revealing the hint: include every `targetPhraseIds` entry from that interaction.
4. Incorrect answer after revealing the hint: same result as any incorrect answer; no duplicate phrase rows.
5. If multiple qualifying interactions target the same phrase, the first qualifying interaction in history owns recap provenance.
6. Restart creates a fresh run and therefore clears `history` and `hintedSceneIds`; the derived recap becomes empty automatically.
7. Relaunch and route re-entry preserve the recap because its inputs are persisted in the existing chapter-versioned snapshot.
8. HPA-300 snapshots can recover incorrect-answer recap rows from their existing history. Historical correct-after-hint outcomes cannot be reconstructed because HPA-300 did not persist hint usage; missing `hintedSceneIds` therefore means no recorded hint use, not “no mistakes.”
9. Recap replay is read-only. It must not change `history`, `currentSceneId`, `completed`, `hintedSceneIds`, or any external learning state.

## Data Model

Persist only the fact that cannot be derived:

```ts
export type MysteryProgress = {
  chapterId: string;
  chapterVersion: number;
  currentSceneId: string;
  history: readonly MysteryHistoryEntry[];
  completed: boolean;
  hintedSceneIds: readonly string[];
};
```

`hintedSceneIds` is a stable-order set of interaction scene IDs. A scene ID appears at most once. It exists because a learner may reveal a hint before answering and that fact must survive route re-entry or relaunch until the interaction is completed.

Do not persist missed phrase IDs or source-scene IDs. Those are recoverable from `history`, each interaction's `targetPhraseIds`, response/choice grading, and first qualifying history order. Avoiding a second source of truth also means a new interaction kind only needs to participate in the recap selector rather than remembering a separate write-time accumulation hook.

### No chapter-version or storage-key bump

HPA-301 does not change authored chapter content. Keep the existing chapter ID, chapter version, and `:v1` storage-key namespace.

`storage.ts` accepts a valid HPA-300 snapshot with no `hintedSceneIds` by defaulting that one missing field to `[]`. That is the historically correct representation for a fact HPA-300 never recorded. Explicit malformed values remain invalid and follow the existing reset/delete behavior.

Do not introduce a compatibility constructor, migrator registry, versioned schema pipeline, or any normalization for a derived missed-phrase field because no such field exists.

## Hint Flow

The components already know the exact moment a hint becomes visible. Keep that ownership and emit one idempotent signal only on the first hidden-to-visible transition during that mounted interaction:

```ts
const emit = defineEmits<{
  choose: [optionId: string];
  hintUsed: [];
}>();
```

and similarly for the response builder.

A small component-local boolean prevents another `hintUsed` emit when the learner hides and re-shows the same hint. Across remounts, controller/model idempotency remains authoritative: if the scene ID is already in `hintedSceneIds`, marking it again returns the same progress object and causes no persistence write.

The page forwards the active interaction ID:

```ts
messenger.markHintUsed(scene.id);
```

The controller uses its existing `transition()` function. `markMysteryHintUsed()` is a pure model transition that no-ops for stale scene IDs, non-interaction scenes, or an already-marked scene.

Do not persist whether the hint is currently visually expanded. After route re-entry the hint may render collapsed; only the fact that it was used affects recap grading.

## Shared Response Grading

Response-build grading currently lives inline in `selectMysteryTranscript()`. Extract that exact visible-text comparison into one pure helper:

```ts
export function gradeMysteryResponse(
  scene: MysteryResponseBuildScene,
  selectedTokenIds: readonly string[],
): 'correct' | 'incorrect';
```

It keeps all existing semantics:

- token IDs resolve through the scene's authored token bank;
- correctness compares resolved visible token text, not token identity;
- `correctTokenIds` is accepted;
- every sequence in `alternateAnswerTokenIds` is accepted; and
- unknown token IDs retain the existing model error behavior.

`selectMysteryTranscript()` calls `gradeMysteryResponse()` so transcript feedback and recap classification cannot drift.

## Recap Projection

Add only the display projection type:

```ts
export type MysteryMissedPhraseRecapItem = {
  phraseId: string;
  text: string;
  reading: string;
  meaning: string;
  sourceSceneId: string;
  sourcePrompt: string;
};
```

and selector:

```ts
export function selectMysteryMissedPhraseRecap(
  chapter: MysteryChapter,
  progress: MysteryProgress,
): MysteryMissedPhraseRecapItem[];
```

The selector walks `progress.history` in order:

1. Ignore message entries.
2. For a choice, resolve the scene and selected option. The interaction qualifies when `option.result === 'incorrect'` or `progress.hintedSceneIds` contains the scene ID.
3. For a response-build entry, resolve the scene and call `gradeMysteryResponse()`. The interaction qualifies when the result is `incorrect` or the scene ID is hinted.
4. For a qualifying interaction, visit its `targetPhraseIds` in authored order.
5. Skip phrase IDs already emitted. This makes first qualifying history occurrence own provenance.
6. Resolve phrase copy from `chapter.targetPhrases` and source prompt from the qualifying interaction's `scene.prompt`.

The selector does not mutate progress and does not depend on completed state, although the product UI renders it only at the ending.

Authored-content validation already guarantees interaction `targetPhraseIds` resolve to chapter phrases. Existing storage validation guarantees history entries resolve to the proper scene/option/token shape. Direct malformed in-memory calls may keep throwing existing model errors; no placeholder recap rows are needed.

## Recap UI

Add one feature-local `MysteryMissedPhraseRecap.vue` rendered only when the current scene is the ending.

The component receives derived recap items and emits one replay event carrying `phraseId`:

```ts
const emit = defineEmits<{ replay: [phraseId: string] }>();
```

For each item render:

- Japanese phrase text;
- reading;
- English meaning;
- a short `From: <source prompt>` provenance line; and
- a Replay button.

When the list is empty, render durable copy:

> No missed phrases this run.

Keep the existing Restart button below the recap.

No score, percentage, mastery badge, save-to-review button, or CTA into the unfinished Review flow is added.

## TTS Replay

The existing audio controller is scene-keyed even though its actual TTS/cache identity is `MysterySceneAudio.ttsId`. HPA-301 must generalize that identity without weakening the existing retry/cancellation behavior.

Rename the audio state's discriminator payload from `sceneId` to `playbackId` and use `audio.ttsId` as the playback ID:

```ts
export type MysteryAudioState =
  | { kind: 'idle' }
  | { kind: 'preparing'; playbackId: string }
  | { kind: 'ready'; playbackId: string; audioUrl: string }
  | { kind: 'playing'; playbackId: string }
  | { kind: 'error'; playbackId: string; message: string };
```

Keep the scene API and add one clip API:

```ts
export type MysteryAudioController = {
  state: Readonly<Ref<MysteryAudioState>>;
  sessionStatus: ComputedRef<MobileFeatureSessionStatus>;
  play(scene: MysteryScene): Promise<void>;
  playClip(audio: MysterySceneAudio): Promise<void>;
  dispose(): void;
};
```

`play(scene)` remains the transcript/scene entry point: resolve `selectMysterySceneAudio(scene)` and delegate to the same private prepare/play path used by `playClip(audio)`. Do not expose or overload the current private `playAudio(...)` helper name.

The shared path must preserve all current behavior:

- duplicate taps while the same `playbackId` is preparing are suppressed;
- a different playback ID aborts the pending request and switches cleanly;
- `gesture_required` keeps the prepared URL in `ready` and a second explicit tap reuses it without another TTS request;
- switching clips stops active playback;
- `media_unavailable` invalidates only `(userId, audio.ttsId)`;
- user changes, app backgrounding, and dispose still abort/interrupt and reset state; and
- existing generic page audio status/error copy continues to work.

Put phrase audio identity beside the other pure Mystery Messenger audio selectors rather than inventing it in the page:

```ts
export function selectMysteryPhraseAudio(
  chapter: MysteryChapter,
  phraseId: string,
): MysterySceneAudio | null;
```

It resolves the phrase from `chapter.targetPhrases` and returns a stable feature-local clip identity. Use the chapter version in that generated identity so a future chapter-versioned phrase copy change cannot reuse stale cached TTS:

```ts
{
  ttsId: `${chapter.id}-v${chapter.version}-recap-${phrase.id}`,
  text: phrase.text,
}
```

The page handles recap replay by resolving `selectMysteryPhraseAudio(chapter, phraseId)` and calling `audio.playClip(clip)`. Recap phrases are never cast or wrapped as fake `MysteryScene` values.

## Storage Validation

`storage.ts` remains the only persisted snapshot boundary.

On load:

1. Parse the existing progress object and validate its current HPA-300 required fields.
2. If `hintedSceneIds` is missing, use `[]` for the in-memory candidate.
3. If `hintedSceneIds` is present but is not an array, reject the snapshot through the existing invalid-load reset.
4. Validate every hinted scene ID is unique and resolves to a `choice` or `response-build` scene.
5. Preserve all existing history, current-scene, chapter ID/version, and completed-state validation.

No missed-phrase validation exists because missed phrases are not persisted.

A valid old completed snapshot containing incorrect interaction history therefore derives those missed rows correctly after load. The only unrecoverable historic fact is pre-HPA-301 hint use.

## Controller and Restart Behavior

`useMysteryMessenger.ts` exposes:

```ts
missedPhraseRecap: ComputedRef<readonly MysteryMissedPhraseRecapItem[]>;
markHintUsed(expectedSceneId: string): void;
```

The recap computed projection follows the same `progress === null ? [] : ...` pattern as transcript.

`markHintUsed()` goes through existing `transition()`, so hint persistence inherits current auth/session ownership, stale-transition suppression, storage failure warning behavior, and no-write behavior when the pure transition returns the same object.

Restart remains unchanged except that `createMysteryProgress()` now initializes `hintedSceneIds: []`. `restartMysteryProgress(chapter)` therefore clears the only new persisted fact, while the fresh history makes the derived recap empty.

No storage writes occur during recap viewing or replay.

## Risks

### Recap must remain a projection of the run

Persisting a second missed-phrase collection would allow history and recap to diverge and would make old HPA-300 runs falsely appear clean when a new field defaulted empty. The design therefore treats immutable history plus persisted hint use as the only run facts and derives recap on demand.

The regression gate must include an HPA-300-shaped stored run with an incorrect history entry and no `hintedSceneIds`; after load it must still produce the incorrect phrase in recap. The test must also state the historical limitation: a correct answer that used a hint before HPA-301 cannot be identified retroactively.

### Audio generalization must preserve scene playback behavior

`useMysteryAudio` currently keys duplicate suppression, ready-state reuse, and status by `scene.id`. Changing that identity is more than an API rename. The implementation must move those decisions to `audio.ttsId` and prove existing scene playback still preserves preparing suppression, switching cancellation, gesture-required retry, media invalidation, auth/lifecycle cancellation, and disposal before relying on `playClip()` for recap.

Do not accept a page-level replay test as sufficient evidence for this refactor.

## Testing Strategy

Keep tests at existing ownership boundaries.

### `model.test.ts`

Pin pure behavior for:

- `markMysteryHintUsed()` idempotency, stale-scene no-op, and interaction-only marking;
- `gradeMysteryResponse()` canonical, alternate, incorrect, and invalid-token behavior;
- correct choice without hint -> no recap row;
- incorrect choice -> all targeted phrases exactly once;
- correct choice whose scene is hinted -> targeted phrases included;
- repeated target phrase across qualifying interactions -> one row with first qualifying source scene;
- incorrect response-build -> targeted phrases included;
- canonical/alternate response without hint -> no row;
- accepted response after hint -> targeted phrases included;
- restart -> empty history/hint state and therefore empty recap;
- recap projection resolves phrase metadata and source prompt; and
- normalized HPA-300-style progress with incorrect history plus empty hint IDs still derives the incorrect phrase.

### `storage.test.ts`

Pin:

- new snapshot round-trip with `hintedSceneIds`;
- valid HPA-300 snapshot with missing `hintedSceneIds` loads with `[]`;
- explicit non-array hint field is rejected rather than defaulted;
- hint state survives load;
- unknown/non-interaction hinted scene IDs are rejected;
- duplicate hinted scene IDs are rejected; and
- all existing history/current/completed invalid-load cases remain green.

### Composer tests

For both choice and response-build:

- first reveal emits `hintUsed` once;
- hide/re-show does not emit another `hintUsed` for the same mounted scene;
- existing answer/submit behavior stays unchanged.

### `useMysteryMessenger.test.ts`

Pin controller-level hint persistence, no duplicate save, resume, derived incorrect/hint-assisted recap, old-snapshot recovery, and restart.

### `useMysteryAudio.test.ts`

Update state assertions to `playbackId` and pin both scene and clip entry points across:

- duplicate preparing suppression;
- switch-to-different-playback cancellation;
- prepared `gesture_required` retry without a second TTS request;
- active playback replacement;
- media-unavailable invalidation;
- session identity change;
- background interruption;
- dispose; and
- error state identity.

### Recap component/page tests

Pin zero/one/multiple rows, source prompt, replay emission, ending-only visibility, Restart co-existence, phrase selector + `playClip()` wiring, and no progress/storage mutation from replay.

## Verification

HPA-301 is complete when:

- affected focused tests pass during development;
- `bun --filter @vela/mobile test:coverage` passes;
- mobile lint passes;
- mobile typecheck passes;
- mobile build passes;
- Codecov patch coverage remains at the repository-required threshold; and
- a Simulator smoke run confirms one clean completion and one missed/hint-assisted completion render the expected recap and replay audio correctly.

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

No backend, shared package, Review-flow, or other application layer should need modification.

## Review Resolution

The post-plan review changed three design decisions:

- derive missed phrases from persisted history instead of dual-writing `missedPhrases`;
- keep only the one-field HPA-300 compatibility default for `hintedSceneIds`;
- generalize the existing scene-keyed audio machine to `audio.ttsId` plus `playClip()` instead of exposing a scene-less `playAudio(audio)` wrapper.

These changes reduce persisted state and validation while preserving the current model, storage, and audio ownership boundaries.
# HPA-301: Mobile Mystery Messenger Missed-Phrase Recap

**Date:** 2026-09-02

**Linear:** [HPA-301](https://linear.app/cwchanap/issue/HPA-301/mystery-messengerlearning-add-the-run-local-missed-phrase)

**Parent:** HPA-298 — Mystery Messenger Pilot

**Blocked-by gate:** HPA-299 and HPA-300 are Done. HPA-301 blocks HPA-302 final pilot acceptance.

## Goal

Connect mistakes made during *The Message That Arrived Tomorrow* to one useful, run-local ending recap without depending on the unfinished mobile Review flow or mutating SRS, vocabulary progress, or personal dictionaries.

A learner who answers an interaction incorrectly or submits it after revealing its hint should see each affected target phrase exactly once. A learner who finishes every assessed interaction correctly without hints should see a clear no-mistakes state.

Design, implementation plan, implementation, review fixes, and verification stay on one branch and one PR for HPA-301.

## Current State and Reuse

HPA-299 and HPA-300 already provide the seams this ticket should extend under `apps/vela-mobile/src/features/mystery-messenger`:

- `model.ts` owns the closed scene/history model, immutable transitions, response grading inline in transcript projection, and transcript projection.
- `content.ts` owns the chapter and target-phrase catalog. Choice and response-build scenes already carry `targetPhraseIds`.
- `validate-content.ts` already rejects unknown target-phrase references.
- `storage.ts` validates the persisted history entries against the active chapter.
- `useMysteryMessenger.ts` owns authenticated run loading, transitions, persistence, restart, and projections.
- `MysteryChoiceComposer.vue` and `MysteryResponseBuildComposer.vue` own local hint visibility and the final answer/submit event.
- `useMysteryAudio.ts` owns the authenticated TTS preparation, gesture retry, playback, cancellation, and lifecycle behavior.
- `MysteryMessengerPage.vue` composes the feature and already has generic audio status/error copy.

The run history is already the durable record of completed assessed interactions. Choice correctness is recoverable from `option.result`; response correctness is recoverable from the visible-text comparison currently embedded in `selectMysteryTranscript()`. The recap therefore remains a projection of history instead of a second persisted result collection.

Hint use is also an interaction-attempt fact. Rather than add a top-level `hintedSceneIds` set, HPA-301 records `hintUsed` on the choice or response-build history entry at the same time the learner submits that interaction.

## Scope

HPA-301 adds only:

- optional `hintUsed` metadata on persisted choice and response-build history entries;
- local hint-revealed tracking in the two existing interaction composers and one extra boolean on their existing final events;
- one pure `gradeMysteryResponse()` extraction used by transcript and recap;
- one pure `selectMysteryMissedPhraseRecap()` projection that walks history and deduplicates target phrases first-wins;
- one pure `selectMysteryPhraseAudio()` helper beside the existing scene-audio selector;
- one feature-local ending recap component with zero/one/multiple states;
- one narrow generalization of the existing audio controller from scene identity to resolved TTS playback identity, plus `playClip()`;
- row-local recap playback feedback so a Replay tap remains visibly responsive on a phone; and
- focused model/storage/composer/controller/audio/component/page tests plus the existing mobile gates.

## Non-goals

Do not add:

- `missedPhrases`, `hintedSceneIds`, or another top-level recap/hint cache in `MysteryProgress`;
- backend/API/CDK/DynamoDB changes;
- SRS writes, familiarity scores, review scheduling, or vocabulary-save APIs;
- a personal dictionary or case-notes subsystem;
- a generic review engine, mistakes package, Pinia store, event bus, or command registry;
- cloud sync or cross-device recap persistence;
- chapter branching or alternate ending logic;
- a second TTS service or recap-specific audio cache;
- target-phrase source metadata on catalog items;
- a migration registry, versioned snapshot framework, or storage-key bump;
- score/percentage/mastery UI or a Review CTA;
- a new mobile E2E framework; or
- physical-device release acceptance, which remains HPA-302.

A second real consumer remains the extraction gate for shared mistake-review infrastructure.

## Product Rules

The recap rule is closed and deterministic:

1. Correct answer with `hintUsed !== true`: no recap row.
2. Incorrect answer: include every target phrase from that interaction.
3. Correct answer with `hintUsed === true`: include every target phrase from that interaction.
4. Incorrect answer with a hint: same result as any incorrect answer; no duplicate phrase rows.
5. When multiple qualifying history entries target the same phrase, the first qualifying history entry owns its displayed source prompt.
6. Restart already creates a fresh `history`, so the derived recap becomes empty without separate recap state.
7. HPA-300 entries have no `hintUsed`; missing means `false`. Old incorrect answers therefore still derive correctly. Old correct-after-hint outcomes are unknowable and must not be fabricated.
8. Recap replay is read-only. It must not mutate history, current scene, completion, SRS, vocabulary progress, or personal dictionaries.

### Deliberate mid-interaction trade-off

The hint fact is recorded when the interaction is submitted, not when the Hint button is tapped. If a learner reveals a hint and then force-quits or leaves the route before answering, that unsubmitted hint-use fact is lost.

That trade is intentional for this run-local ending recap. There is no completed history entry to classify yet, and preserving abandoned interaction UI state would require extra writes and a second in-progress interaction-state contract. If later product work requires resumable in-progress interactions, that should be designed with the whole interaction draft rather than adding a one-off hint cache here.

## History Contract

Widen only the two assessed history variants:

```ts
export type MysteryHistoryEntry =
  | { kind: 'message'; sceneId: string }
  | {
      kind: 'choice';
      sceneId: string;
      selectedOptionId: string;
      hintUsed?: boolean;
    }
  | {
      kind: 'response-build';
      sceneId: string;
      selectedTokenIds: readonly string[];
      hintUsed?: boolean;
    };
```

`MysteryProgress` itself is unchanged:

```ts
export type MysteryProgress = {
  chapterId: string;
  chapterVersion: number;
  currentSceneId: string;
  history: readonly MysteryHistoryEntry[];
  completed: boolean;
};
```

The optional field preserves HPA-300 snapshots without any compatibility constructor or normalization. New choice/response submissions write the boolean they received from the composer. Selectors treat only `entry.hintUsed === true` as hinted.

`chooseMysteryOption()` and `submitMysteryResponse()` gain one trailing argument with a safe default so existing direct callers remain valid while the UI can record the fact:

```ts
chooseMysteryOption(chapter, progress, expectedSceneId, optionId, hintUsed = false)
submitMysteryResponse(chapter, progress, expectedSceneId, selectedTokenIds, hintUsed = false)
```

No hint-only transition or storage write is added.

## Hint Capture in the Existing Composers

Each composer keeps two local facts:

- `showHint`: whether the hint is currently expanded;
- `hintRevealed`: whether the learner has revealed it at least once during this mounted interaction.

The Hint button uses a small toggle function:

```ts
function toggleHint(): void {
  showHint.value = !showHint.value;
  if (showHint.value) hintRevealed.value = true;
}
```

The existing final event carries the durable fact:

```ts
const emit = defineEmits<{
  choose: [optionId: string, hintUsed: boolean];
}>();
```

and:

```ts
const emit = defineEmits<{
  submit: [tokenIds: string[], hintUsed: boolean];
}>();
```

Hiding the hint after revealing it therefore still submits `true`. There is no separate `hintUsed` event, one-shot guard, page hint handler, `markMysteryHintUsed()` model transition, or `markHintUsed()` controller method.

## Shared Response Grading

Extract the current visible-text comparison from `selectMysteryTranscript()` into one pure helper:

```ts
export function gradeMysteryResponse(
  scene: MysteryResponseBuildScene,
  selectedTokenIds: readonly string[],
): 'correct' | 'incorrect';
```

It preserves all HPA-300 semantics:

- selected token IDs must resolve through the scene token bank;
- correctness compares resolved visible text rather than token identity;
- the canonical `correctTokenIds` sequence is accepted;
- each authored `alternateAnswerTokenIds` sequence is accepted; and
- unknown token IDs retain the existing model error behavior.

`selectMysteryTranscript()` calls this helper. `selectMysteryMissedPhraseRecap()` calls the same helper. There is one grading rule.

## Recap Projection

The recap type contains only data with a consumer:

```ts
export type MysteryMissedPhraseRecapItem = {
  phraseId: string;
  text: string;
  reading: string;
  meaning: string;
  sourcePrompt: string;
};
```

Raw `sourceSceneId` is intentionally omitted. The UI renders the source interaction prompt, and no other HPA-301 behavior consumes the ID.

Add:

```ts
export function selectMysteryMissedPhraseRecap(
  chapter: MysteryChapter,
  progress: MysteryProgress,
): MysteryMissedPhraseRecapItem[];
```

The selector walks `progress.history` in order:

1. Ignore message entries.
2. For a choice, resolve the choice scene and selected option. The entry qualifies when the option is incorrect or `entry.hintUsed === true`.
3. For a response-build entry, resolve the scene and use `gradeMysteryResponse()`. The entry qualifies when the result is incorrect or `entry.hintUsed === true`.
4. Visit `scene.targetPhraseIds` in authored order.
5. Skip phrase IDs already emitted; first qualifying history occurrence wins.
6. Resolve `text`, `reading`, and `meaning` from `chapter.targetPhrases` and `sourcePrompt` from `scene.prompt`.

`validate-content.ts` already guarantees every interaction target phrase resolves to the chapter catalog. Existing storage validation guarantees history scene/option/token identity. No recap-specific persisted validation is required.

## Phrase TTS Identity

Target phrases have no authored TTS ID, so add a pure helper beside `selectMysterySceneAudio()`:

```ts
export function selectMysteryPhraseAudio(
  chapter: MysteryChapter,
  phraseId: string,
): MysterySceneAudio;
```

An unknown phrase ID is a programmer/content-contract error and throws `mystery_target_phrase_not_found`; callers do not silently swallow it.

The chapter ID currently contains an old content suffix (`mystery-message-tomorrow-v1`) while current authored scene TTS IDs use `mystery-message-tomorrow-v2-*`. Avoid double-stamping `v1-v2`. Derive the current TTS prefix by removing a trailing version suffix from the chapter ID before appending the active chapter version:

```ts
const chapterTtsBase = chapter.id.replace(/-v\d+$/, '');
return {
  ttsId: `${chapterTtsBase}-v${chapter.version}-recap-${phrase.id}`,
  text: phrase.text,
};
```

For the current chapter this yields `mystery-message-tomorrow-v2-recap-<phrase-id>`, matching the authored `mystery-message-tomorrow-v2-*` convention and keeping cache identity tied to chapter content version.

## Audio Controller Extension

`useMysteryAudio` is currently scene-keyed internally, but the actual preparation/cache identity is `audio.ttsId`. Generalize only that internal identity.

Rename the state payload to `playbackId`:

```ts
export type MysteryAudioState =
  | { kind: 'idle' }
  | { kind: 'preparing'; playbackId: string }
  | { kind: 'ready'; playbackId: string; audioUrl: string }
  | { kind: 'playing'; playbackId: string }
  | { kind: 'error'; playbackId: string; message: string };
```

Keep the existing scene entry point and add one resolved-clip entry point:

```ts
export type MysteryAudioController = {
  state: Readonly<Ref<MysteryAudioState>>;
  sessionStatus: ComputedRef<MobileFeatureSessionStatus>;
  play(scene: MysteryScene): Promise<void>;
  playClip(audio: MysterySceneAudio): Promise<void>;
  dispose(): void;
};
```

Both delegate to one private resolved-audio path keyed by `audio.ttsId`. The refactor preserves existing behavior:

- same-playback preparation taps are suppressed;
- a different playback ID aborts the pending request and switches;
- `gesture_required` keeps the prepared URL in `ready`, and the next explicit tap reuses it;
- switching stops active playback;
- `media_unavailable` invalidates only `(userId, audio.ttsId)`;
- auth identity change, app backgrounding, and disposal still cancel/interrupt and reset state.

`MysteryAudioState.sceneId` is not a product-facing dependency outside this composable. The primary regression gate is therefore the complete existing `useMysteryAudio.test.ts` suite after the refactor, plus focused new `playClip()` coverage and one scene-to-clip switching case. There is no need to duplicate every gesture/cancellation scenario through both public entry points when both feed the same private path.

## Recap UI and Row-Local Playback Feedback

Add `MysteryMissedPhraseRecap.vue` only under the ending branch. It receives recap items and emits `replay(phraseId)`.

For each row render:

- Japanese phrase text with `lang="ja"`;
- reading with `lang="ja"`;
- English meaning;
- the Japanese source prompt in a caption element with `lang="ja"`; and
- Replay.

Do not prepend an English `From:` label to the Japanese prompt. The smaller source prompt itself is sufficient provenance and avoids mixed-language inline text.

Empty state copy remains:

> No missed phrases this run.

Keep Restart below the recap.

The existing generic page audio status/error remains useful for transcript replay, but a recap row can be several rows below it. To avoid a Replay button appearing dead on a phone, the page maps the current audio `playbackId` back to the recap phrase whose `selectMysteryPhraseAudio(...).ttsId` matches and passes row-local state into the recap component:

```ts
activePhraseId?: string;
playbackKind?: 'preparing' | 'ready' | 'playing' | 'error';
playbackError?: string;
```

Only the matching row renders status:

- preparing -> `Preparing audio…`
- ready -> `Tap Replay again`
- playing -> `Playing audio…`
- error -> `Audio playback failed: <message>`

A transcript-scene replay does not match a recap phrase playback ID, so no recap row claims that state.

## Storage Validation

`storage.ts` remains the only persisted snapshot boundary, but HPA-301 does not change the top-level snapshot shape.

Inside the existing history-entry loop, add only:

```ts
if (entry.kind !== 'message' && entry.hintUsed !== undefined && typeof entry.hintUsed !== 'boolean') {
  return false;
}
```

All existing scene/option/token checks remain unchanged. HPA-300 entries omit `hintUsed`, pass validation, and are interpreted as unhinted by selectors. There is no normalization, compatibility object, top-level field validation, or fixture-wide progress rewrite.

## Controller and Page Data Flow

`useMysteryMessenger.ts` keeps the existing transition API shape and widens only the existing assessed methods:

```ts
chooseOption(expectedSceneId: string, optionId: string, hintUsed?: boolean): void;
submitResponse(
  expectedSceneId: string,
  selectedTokenIds: readonly string[],
  hintUsed?: boolean,
): void;
```

They forward the boolean to the pure model transition through existing `transition()` persistence.

The controller may expose the recap projection beside `transcript`:

```ts
missedPhraseRecap: ComputedRef<readonly MysteryMissedPhraseRecapItem[]>;
```

No new write method is added.

The page receives `(optionId, hintUsed)` or `(tokenIds, hintUsed)` from the composers and forwards them to those existing controller methods. At ending it renders the recap and handles replay by calling:

```ts
const clip = selectMysteryPhraseAudio(chapter, phraseId);
void audio.playClip(clip);
```

There is no unreachable `if (!clip) return` guard because the helper either resolves the checked-in phrase or throws a model error.

## Risks

### Hint use is persisted at completion, not reveal time

A force-quit after revealing a hint but before submitting loses that abandoned attempt-local fact. This is intentional for HPA-301 and avoids introducing partial-interaction persistence just for one UI boolean. Completed history entries remain fully reproducible across route re-entry and relaunch.

### Transcript and recap grading must not diverge

`gradeMysteryResponse()` is the only response correctness implementation. Both transcript and recap use it. Tests pin canonical, alternate, and known-wrong token orders.

### Audio feedback must remain visible where the learner taps

The generic page status can be outside the viewport for later recap rows. The matching recap row therefore mirrors the current playback state/error while the generic page status remains unchanged for existing transcript replay.

### Audio identity refactor must not regress scene replay

The internal rename from scene identity to TTS playback identity changes duplicate/ready comparisons. All pre-existing audio tests must pass immediately after that task before `playClip()` is considered safe.

## Testing Strategy

Keep tests at current ownership boundaries.

### `model.test.ts`

Pin:

- `gradeMysteryResponse()` canonical, alternate, known-wrong, and invalid-token behavior;
- choice correct/no-hint -> no row;
- choice incorrect -> target phrases;
- choice correct + `hintUsed: true` -> target phrases;
- response canonical/alternate + no hint -> no row;
- response incorrect -> target phrases;
- response correct + `hintUsed: true` -> target phrases;
- repeated phrase across qualifying entries -> one first-wins row;
- missing HPA-300 `hintUsed` behaves as false;
- recap rows resolve phrase copy and Japanese source prompt;
- `selectMysteryPhraseAudio()` resolves current-version cache identity and rejects unknown phrase IDs; and
- restart remains empty because history is empty.

### `storage.test.ts`

Pin:

- HPA-300 history entries with no `hintUsed` still round-trip;
- `hintUsed: true` and `false` round-trip;
- malformed non-boolean `hintUsed` resets through the existing invalid-load behavior; and
- all prior history validation still passes.

### Composer tests

For choice and response-build:

- answer/submit before opening Hint emits `false`;
- reveal Hint then answer/submit emits `true`;
- reveal -> hide -> answer/submit still emits `true`;
- existing choice/token behavior remains unchanged.

### `useMysteryMessenger.test.ts`

Pin existing controller methods forward/persist the new optional boolean and `missedPhraseRecap` derives from restored history. No hint-only save exists.

### `useMysteryAudio.test.ts`

Run every pre-existing test after changing `sceneId` to `playbackId`. Add focused tests for:

- `playClip()` preparing/playing success using `audio.ttsId` as playback ID; and
- switching from a pending scene clip to a different recap clip aborts the first request and prepares the recap clip.

Do not duplicate the complete existing gesture/background/auth/dispose matrix through `playClip()`; those semantics are exercised on the shared internal path by the existing suite.

### Recap component/page tests

Pin:

- zero, one, and multiple rows;
- Japanese phrase/reading/source-prompt language attributes;
- no `From:` prefix;
- replay emission;
- only the active recap row shows preparing/ready/playing/error feedback;
- ending-only visibility and Restart coexistence;
- phrase replay uses `playClip()` and does not mutate progress; and
- an audio playback ID belonging to a transcript scene does not mark a recap row active.

## Verification and Green-Commit Rule

Every implementation task ends with both:

```bash
bun --filter @vela/mobile test
bun --filter @vela/mobile typecheck
```

A task is not committed while either command is red. Any typed fixture or test fallout caused by that task is fixed inside the same task rather than deferred to a later cleanup task.

Final HPA-301 gates remain:

```bash
bun --filter @vela/mobile test:coverage
bun --filter @vela/mobile lint
bun --filter @vela/mobile typecheck
bun --filter @vela/mobile build
```

Codecov patch coverage must remain at the repository-required threshold. Simulator smoke acceptance covers one clean run and one run containing both an incorrect answer and a hint-assisted correct answer, including visible recap-row playback feedback.

Physical-device/release acceptance remains HPA-302.

## File Shape

Expected implementation stays feature-local:

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

No backend, shared package, or other application layer needs modification.
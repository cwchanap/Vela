# HPA-299: Mobile Mystery Messenger Five-Scene Vertical Slice

**Date:** 2026-08-29

**Linear:** [HPA-299](https://linear.app/cwchanap/issue/HPA-299/mystery-messengervertical-slice-build-a-five-scene-playable-messenger)

**Parent:** HPA-298 — Mystery Messenger Pilot

**Related:** HPA-194 — iOS-first Vela Mobile MVP

## Goal

Build the smallest playable Mystery Messenger loop that can be evaluated on an iPhone before expanding to the full 10–15-scene pilot.

A signed-in learner can discover the activity from the existing mobile Learn tab, open a five-scene Japanese messenger story, advance through authored messages, answer one language-based choice, replay Japanese audio through Vela's existing authenticated TTS path, leave and resume, restart, and reach one ending.

This ticket uses one implementation branch and one PR. The design, implementation plan, implementation, review fixes, automated verification, and Simulator evidence stay on that PR.

## Current State

The repository already contains the platform pieces this slice needs:

- `apps/vela-mobile/src/pages/LearnPage.vue` is still a `Coming soon` stub.
- `MobileLayout.vue` owns mobile bottom navigation, safe-area layout, keyboard/footer behavior, and the common page header.
- authenticated routes already live in `coreRoutes` inside `router/diagnostic-routes.ts`; despite the filename, that is the current owner for Home/Review/Learn/Words/More.
- `pushMobileRoute()` and `backOrFallback()` already define app-owned mobile navigation history.
- `MobileAuthCoordinator.state` plus `selectMobileFeatureSessionStatus()` provide the signed-in user identity without exposing tokens to feature code.
- `MobileTtsService.preparePronunciation()` already handles authenticated TTS preparation and cache isolation.
- `HtmlAudioPlayer` already implements the `MobileAudioPlayer` contract and settles playback as `ended`, `stopped`, or `interrupted`.

No backend, CDK, DynamoDB, shared-package, or native-plugin change is needed.

## Scope

HPA-299 adds:

- one Mystery Messenger card on the mobile Learn page;
- one authenticated `/learn/mystery-messenger` route;
- feature-local `message`, `choice`, and `ending` scene types;
- one authored five-scene chapter with one converging choice and one ending;
- pure progression and transcript projection;
- chronological transcript rendering;
- one active fixed-choice composer;
- TTS replay for authored Japanese using the existing mobile service and audio player;
- one chapter-versioned `localStorage` snapshot per signed-in user and chapter;
- resume after route re-entry or relaunch;
- restart and destructive chapter-version reset;
- pure authored-content validation; and
- focused unit/component tests plus Simulator acceptance.

## Non-goals

Do not add:

- the final 10–15-scene pilot;
- `response-build`;
- missed-phrase recap;
- SRS or personal-dictionary mutation;
- cloud persistence or cross-device sync;
- backend APIs, DynamoDB tables, event logs, idempotency, or conflict handling;
- Pinia or another state package;
- branching paths or alternate endings;
- a generic visual-novel/story engine, registry, scripting runtime, CMS, or editor;
- web parity or shared narrative contracts in `@vela/common`;
- a new mobile E2E framework.

## Architecture

Keep all feature code under:

```text
apps/vela-mobile/src/features/mystery-messenger/
```

Use focused feature-local modules:

```text
model.ts                 closed contracts, pure transitions, transcript selector
content.ts               five-scene authored constant + stable TTS IDs
validate-content.ts      pure content validation
storage.ts               localStorage snapshot adapter
useMysteryMessenger.ts   auth/persistence orchestration
useMysteryAudio.ts       thin TTS + MobileAudioPlayer adapter
components/
  MysteryTranscript.vue
  MysteryChoiceComposer.vue
MysteryMessengerPage.vue
```

This keeps the first product experiment understandable and removable. A second real narrative consumer is the gate for extracting shared abstractions.

## Feature Contract

Use a closed discriminated union. Do not add handler registries, arbitrary payloads, or plugin fields.

```ts
export type MysterySpeaker = 'mina' | 'haru';

export type MysteryMessageScene = {
  id: string;
  kind: 'message';
  speaker: MysterySpeaker;
  text: string;
  ttsId: string;
  nextSceneId: string;
};

export type MysteryChoiceOption = {
  id: string;
  label: string;
  result: 'correct' | 'incorrect';
  feedback: string;
  nextSceneId: string;
};

export type MysteryChoiceScene = {
  id: string;
  kind: 'choice';
  speaker: MysterySpeaker;
  prompt: string;
  ttsId: string;
  options: readonly MysteryChoiceOption[];
};

export type MysteryEndingScene = {
  id: string;
  kind: 'ending';
  title: string;
  text: string;
  ttsId: string;
};

export type MysteryScene = MysteryMessageScene | MysteryChoiceScene | MysteryEndingScene;

export type MysteryChapter = {
  id: string;
  version: number;
  title: string;
  startSceneId: string;
  scenes: readonly MysteryScene[];
};

export type MysteryHistoryEntry = {
  sceneId: string;
  selectedOptionId?: string;
};

export type MysteryProgress = {
  chapterId: string;
  chapterVersion: number;
  currentSceneId: string;
  history: readonly MysteryHistoryEntry[];
  completed: boolean;
};
```

`content.ts` exports one chapter constant using `satisfies MysteryChapter`.

The five-scene topology is fixed:

```text
scene-01 -> scene-02 -> scene-03(choice) -> scene-04 -> scene-05(ending)
                                      \-> scene-04
```

Both authored choice options must share `scene-04` as `nextSceneId`. Pin that directly in the real-content unit test; do not add a generic `branching_choice` validation code for a pilot that intentionally has no branches.

## Progression

`model.ts` owns pure transitions:

```ts
export function createMysteryProgress(chapter: MysteryChapter): MysteryProgress;

export function continueMysteryMessage(
  chapter: MysteryChapter,
  progress: MysteryProgress,
  expectedSceneId: string,
): MysteryProgress;

export function chooseMysteryOption(
  chapter: MysteryChapter,
  progress: MysteryProgress,
  expectedSceneId: string,
  optionId: string,
): MysteryProgress;

export function restartMysteryProgress(chapter: MysteryChapter): MysteryProgress;

export function getMysteryScene(chapter: MysteryChapter, sceneId: string): MysteryScene;
```

Rules:

- new progress starts at `startSceneId` with empty history;
- message continuation appends the current scene once and advances;
- choice submission appends the current scene plus selected option once and advances;
- reaching an ending leaves that ending as `currentSceneId` and marks `completed: true`;
- `expectedSceneId` protects late/stale events: if it does not match `progress.currentSceneId`, the transition returns the same progress object unchanged;
- stale detection happens before scene-kind or option validation, so a late choice event cannot throw against a newer scene;
- invalid transitions for the actual current scene and unknown option IDs still throw fixed feature errors;
- transcript text is reconstructed from chapter content plus history; full rendered text is not persisted.

`expectedSceneId` is not the primary rapid-double-tap defense. A second click can evaluate the newly advanced reactive scene before it fires. The page therefore owns a small rapid-transition lock as described below.

No undo, rewind, checkpoints, or migration layer is added.

## Transcript Projection

Keep transcript reconstruction out of the Vue component, following the existing `selectDueReviewView()` pattern.

`model.ts` exports a closed view-item union and selector:

```ts
export type MysteryTranscriptItem =
  | {
      kind: 'message';
      sceneId: string;
      speaker: MysterySpeaker;
      text: string;
      ttsId: string;
      active: boolean;
    }
  | {
      kind: 'choice-result';
      sceneId: string;
      speaker: MysterySpeaker;
      prompt: string;
      selectedLabel: string;
      feedback: string;
      result: 'correct' | 'incorrect';
      ttsId: string;
    }
  | {
      kind: 'choice-prompt';
      sceneId: string;
      speaker: MysterySpeaker;
      prompt: string;
      ttsId: string;
    }
  | {
      kind: 'ending';
      sceneId: string;
      title: string;
      text: string;
      ttsId: string;
    };

export function selectMysteryTranscript(
  chapter: MysteryChapter,
  progress: MysteryProgress,
): readonly MysteryTranscriptItem[];
```

The selector maps completed history entries first, then appends the current scene exactly once. A completed choice becomes `choice-result`; an unanswered current choice becomes `choice-prompt`.

`MysteryTranscript.vue` receives only the selected items and renders them. Its tests stay thin: Japanese `lang="ja"`, order/rendering, and replay emission. HPA-300 can extend one pure selector when `response-build` arrives rather than teaching an SFC how to reconstruct a new scene kind.

## Content Validation

Use a pure validator with simple maps and graph traversal:

```ts
export type MysteryContentIssue = {
  code:
    | 'duplicate_scene_id'
    | 'missing_start_scene'
    | 'dangling_scene_reference'
    | 'missing_ending'
    | 'unreachable_ending'
    | 'duplicate_choice_id'
    | 'empty_choice_options';
  sceneId?: string;
  referenceId?: string;
};

export function validateMysteryChapter(chapter: MysteryChapter): readonly MysteryContentIssue[];
```

Validation covers:

- unique scene IDs;
- unique choice IDs within each choice scene;
- at least two options per choice;
- existing start scene;
- valid message and choice next-scene references;
- at least one ending; and
- at least one ending reachable from the start.

No schema or graph dependency is needed.

## Persistence

Use browser `localStorage` inside the Capacitor WebView.

The key is user and chapter scoped:

```ts
export function mysteryProgressStorageKey(userId: string, chapterId: string): string {
  return `vela:mystery-messenger:${encodeURIComponent(userId)}:${encodeURIComponent(chapterId)}`;
}
```

Expose one adapter:

```ts
export type MysteryProgressStorage = {
  load(userId: string, chapter: MysteryChapter): MysteryProgress | null;
  save(userId: string, progress: MysteryProgress): boolean;
  clear(userId: string, chapterId: string): boolean;
};
```

Load rules:

- missing value returns `null`;
- malformed JSON or invalid progress shape is deleted and returns `null`;
- chapter ID/version mismatch is deleted and returns `null`;
- references to removed scenes/options are deleted and return `null`.

There is no backward compatibility requirement. A chapter version bump intentionally resets the disposable pilot save.

Storage errors do not block play. The in-memory run continues and the page shows a non-blocking save warning.

## Authentication Ownership

`useMysteryMessenger.ts` injects the existing mobile auth coordinator and derives the feature-session status through `selectMobileFeatureSessionStatus()`.

- `usable`: load/create that user's run and enable progression.
- `recovering`: keep the current same-user in-memory run visible, but disable story mutations.
- `unavailable` or identity change: clear in-memory run and stop audio so one user's content is never displayed under another identity.

The feature never accesses Cognito tokens.

## TTS and Audio

`useMysteryAudio.ts` stays a thin adapter. It reuses `MOBILE_TTS_SERVICE_KEY` and accepts a `MobileAudioPlayer` dependency from the page rather than constructing a hidden `HtmlAudioPlayer` internally:

```ts
export function useMysteryAudio(audioPlayer: MobileAudioPlayer): MysteryAudioController;
```

`MysteryMessengerPage.vue` creates the concrete adapter exactly once:

```ts
const audio = useMysteryAudio(new HtmlAudioPlayer());
```

This mirrors the existing pronunciation diagnostic seam and keeps controller tests independent of DOM audio.

```ts
export type MysteryAudioState =
  | { kind: 'idle' }
  | { kind: 'preparing'; sceneId: string }
  | { kind: 'playing'; sceneId: string }
  | { kind: 'error'; sceneId: string; message: string };
```

Playback:

1. require a usable signed-in user;
2. call `preparePronunciation({ userId, vocabularyId: scene.ttsId, text })`;
3. pass the prepared URL to `audioPlayer.play()`;
4. set `playing` while the returned handle is active;
5. await `handle.finished`; `ended`, `stopped`, and `interrupted` all settle the simple product state back to `idle`;
6. keep audio failures non-blocking;
7. on `MobileAudioError('media_unavailable')`, invalidate that single pronunciation identity, show the inline error, and wait for the next explicit tap; do not add an automatic retry loop;
8. stop/dispose audio when the page unmounts or identity changes.

The pilot deliberately does not expose an `interrupted` product state or copy the diagnostic controller's counters/retry/URL-refresh machine.

Each authored line gets a stable TTS identity that includes chapter version, for example:

```text
mystery-message-tomorrow-v1-scene-01
mystery-message-tomorrow-v1-scene-03-prompt
```

Changing cached Japanese text requires a chapter-version/TTS-ID bump. No cache migration is needed.

## UI and Navigation

### Learn

Replace the Learn placeholder with one direct activity card:

- `Mystery Messenger`;
- `The Message That Arrived Tomorrow`;
- one short description;
- one `Play pilot` button.

The Learn page does not inspect persistence merely to choose `Start` versus `Resume`; the destination route owns loading the user's run. This avoids a second persistence reader and keeps Learn stateless.

Navigate through `pushMobileRoute(router, '/learn/mystery-messenger')`.

Do not build an activity catalog for one card.

### Route

Add one authenticated route to the existing `coreRoutes` list:

```ts
{
  path: 'learn/mystery-messenger',
  name: 'mysteryMessenger',
  component: () => import('src/features/mystery-messenger/MysteryMessengerPage.vue'),
  meta: {
    mobileHeader: {
      title: 'Mystery Messenger',
      fallback: '/learn',
    },
  },
}
```

Do not set `bypassMobileAuth`. `MobilePageHeader` continues to own back/fallback behavior through the existing navigation helper.

### Rapid transition guard

`expectedSceneId` remains useful for stale/late emits, but it cannot by itself prevent a second physical click from reading the newly advanced reactive scene.

The page therefore owns one local `transitionLocked` flag:

- set it synchronously before Continue or choice submission;
- return immediately if a submission arrives while it is already set;
- bind it to Continue/choice `disabled` state;
- after the synchronous progression update and Vue render, keep the control locked for a short `500ms` rapid-click guard before enabling the newly rendered action.

This is intentionally page-local UX protection, not a domain debounce framework. The model remains deterministic and timing-free.

The page test must submit twice without waiting for the guard to clear and prove only one scene advances, then advance fake timers and prove the next deliberate action is accepted.

### Transcript and Composer

`MysteryTranscript.vue` receives `readonly MysteryTranscriptItem[]` and emits replay only. It does not reconstruct history or touch auth/persistence/progression.

`MysteryChoiceComposer.vue` renders fixed buttons and emits one option ID. It owns no progression rules. Its `disabled` prop includes session recovery and the page transition lock.

The page renders:

- Continue for active `message`;
- choices for active `choice`;
- Restart for active `ending`;
- audio replay alongside authored Japanese.

No free text, drag-and-drop, typing animation, or branch map is included.

## Existing-Test Updates

Replacing the Learn placeholder changes existing repository expectations, so HPA-299 must update them deliberately:

- `apps/vela-mobile/src/pages/StubPages.test.ts`: remove Learn from the parameterized `Coming soon` stub cases; `LearnPage.test.ts` becomes the owner of Learn behavior.
- `apps/vela-mobile/src/router/routes.test.ts`: development root children become 9 and production/core children become 6; assert `learn/mystery-messenger` is present. Keep the existing `loadDefault()` loop so the new lazy page import is actually resolved.

These are part of the feature change, not cleanup deferred to the final test run.

## Error Handling

Keep errors small and player-friendly:

- invalid authored chapter: fixed initialization failure in development/tests;
- recovering/unavailable session: disable mutations and show simple session-state copy;
- storage failure: keep playing with a save warning;
- TTS failure: show inline audio error while leaving story progression enabled;
- corrupt or stale save: silently discard and start fresh.

No retry queue, telemetry framework, or recovery subsystem is introduced.

## Testing

Focused automated coverage includes:

- pure message/choice/ending progression;
- stale `expectedSceneId` returns the same progress unchanged;
- rapid page submission cannot skip a newly rendered message;
- pure transcript projection for completed message, selected choice feedback, active choice, and ending;
- chapter validation failures and valid reachability;
- real chapter assertion that both choice options converge to `scene-04`;
- local snapshot load/save/clear;
- malformed and version-mismatched snapshots are discarded;
- same-user resume and restart;
- identity change clears in-memory state;
- TTS request uses existing user ID, stable TTS ID, and authored text;
- `ended`, `stopped`, and `interrupted` playback outcomes all settle to `idle`;
- media-unavailable invalidates only the affected TTS identity;
- audio failure is non-blocking;
- Learn card navigation;
- existing stub-page expectations after Learn stops being a stub;
- route counts/path/header metadata and lazy import resolution;
- thin transcript/component rendering and replay emission.

Final automated gate:

```bash
bun run --cwd apps/vela-mobile test:unit
bun run --cwd apps/vela-mobile lint
bun run --cwd apps/vela-mobile typecheck
bun run --cwd apps/vela-mobile build
```

Then manually complete the five-scene loop in an iOS Simulator, including:

- leave/resume;
- restart;
- rapid double-click/tap on Continue does not skip the following scene;
- TTS playback reaches idle after natural completion and after interruption/backgrounding; and
- no stuck `playing` UI remains after audio settles.

HPA-300 remains blocked until this manual acceptance succeeds.

## Success Criteria

HPA-299 is successful when:

- the signed-in learner can discover and enter the pilot from Learn;
- all five scenes are playable through one choice to the ending;
- rapid repeated submission cannot skip a scene;
- transcript reconstruction stays in a pure selector rather than an SFC;
- TTS replay uses the existing authenticated path and settles cleanly for every existing playback outcome;
- route re-entry and relaunch restore the same run;
- restart starts fresh;
- chapter-version mismatch resets stale local progress;
- invalid chapter references fail focused tests;
- existing mobile unit/lint/typecheck/build gates remain green; and
- the slice is manually accepted in an iOS Simulator.

# HPA-299: Mobile Mystery Messenger Five-Scene Vertical Slice

**Date:** 2026-08-29

**Linear:** [HPA-299](https://linear.app/cwchanap/issue/HPA-299/mystery-messengervertical-slice-build-a-five-scene-playable-messenger)

**Parent:** HPA-298 — Mystery Messenger Pilot

**Related:** HPA-194 — iOS-first Vela Mobile MVP

## Goal

Build the smallest playable Mystery Messenger loop that can be evaluated on an iPhone before expanding to the full 10–15-scene pilot.

A signed-in learner can discover the activity from Learn, open a five-scene Japanese messenger story, advance through authored messages, answer one language-based choice, replay Japanese audio through Vela's existing authenticated TTS path, leave and resume, restart, and reach one ending.

HPA-299 uses one implementation branch and one PR. Design, implementation plan, implementation, review fixes, automated verification, and Simulator evidence stay on PR #62.

## Current State and Reuse

The repository already owns the platform pieces this slice needs:

- `apps/vela-mobile/src/pages/LearnPage.vue` is still a `Coming soon` stub.
- `MobileLayout.vue` owns bottom navigation, safe areas, keyboard/footer behavior, and the common page header.
- authenticated routes live in the existing `coreRoutes` list in `router/diagnostic-routes.ts`.
- `pushMobileRoute()` and `backOrFallback()` own app navigation history.
- `MobileAuthCoordinator.state` plus `selectMobileFeatureSessionStatus()` expose authenticated feature identity without exposing tokens.
- `MobileTtsService.preparePronunciation()` owns authenticated TTS preparation and accepts an `AbortSignal`.
- `HtmlAudioPlayer` implements `MobileAudioPlayer`, including `ended`, `stopped`, `interrupted`, `gesture_required`, and `media_unavailable` behavior.
- `mobileLifecycleState.isActive` is the existing lifecycle signal used by pronunciation playback.
- `selectDueReviewView()` establishes the mobile convention of keeping view projection in a pure selector rather than an SFC.

No backend, CDK, DynamoDB, shared-package, native-plugin, Pinia, or narrative-engine work is required.

## Scope

HPA-299 adds:

- one Mystery Messenger card on Learn;
- one authenticated `/learn/mystery-messenger` route;
- feature-local `message`, `choice`, and `ending` scene types;
- one authored five-scene chapter with one converging choice and one ending;
- pure progression and transcript projection;
- one active fixed-choice composer;
- TTS replay through existing mobile TTS/audio contracts;
- one versioned local snapshot per signed-in user and chapter;
- resume, restart, and destructive chapter-version reset;
- pure authored-content validation in tests; and
- focused tests plus iOS Simulator acceptance.

## Non-goals

Do not add:

- the final 10–15-scene pilot;
- `response-build`;
- missed-phrase recap;
- SRS or dictionary mutation;
- cloud persistence or cross-device sync;
- backend APIs, DynamoDB, event logs, idempotency, or conflict handling;
- Pinia or another state package;
- branching paths or alternate endings;
- a generic visual-novel/story engine, registry, scripting runtime, CMS, or editor;
- web parity or shared narrative contracts in `@vela/common`;
- a new mobile E2E framework; or
- a reusable debounce/throttle abstraction.

A second real narrative consumer remains the extraction gate for shared narrative code.

## Architecture

Keep all feature code under:

```text
apps/vela-mobile/src/features/mystery-messenger/
```

Use these focused modules:

```text
model.ts
content.ts
validate-content.ts
storage.ts
useMysteryMessenger.ts
useMysteryAudio.ts
components/
  MysteryTranscript.vue
  MysteryChoiceComposer.vue
MysteryMessengerPage.vue
```

The page owns Vue `inject()` calls and construction of concrete browser/audio adapters. The two feature composables receive explicit options and can therefore be unit-tested directly without mounting a component only to create an injection context.

## Explicit Dependency Seams

### Run orchestration

```ts
export type UseMysteryMessengerOptions = {
  authState: Readonly<MobileAuthState>;
  storage: MysteryProgressStorage;
  chapter: MysteryChapter;
};

export function useMysteryMessenger(
  options: UseMysteryMessengerOptions,
): MysteryMessengerController;
```

### Audio

```ts
export type UseMysteryAudioOptions = {
  authState: Readonly<MobileAuthState>;
  ttsService: MobileTtsService;
  audioPlayer: MobileAudioPlayer;
  lifecycleState?: { isActive: Readonly<Ref<boolean>> };
};

export function useMysteryAudio(options: UseMysteryAudioOptions): MysteryAudioController;
```

`lifecycleState` defaults to the existing `mobileLifecycleState`; tests may pass a tiny fake.

### Page wiring

`MysteryMessengerPage.vue` owns the concrete dependencies:

```ts
const coordinator = inject(MOBILE_AUTH_KEY);
const ttsService = inject(MOBILE_TTS_SERVICE_KEY);

if (!coordinator || !ttsService) {
  throw new Error('mystery_messenger_dependencies_unavailable');
}

const chapter = MYSTERY_MESSENGER_VERTICAL_SLICE;
const storage = createBrowserMysteryProgressStorage(window.localStorage);

const messenger = useMysteryMessenger({
  authState: coordinator.state,
  storage,
  chapter,
});

const audio = useMysteryAudio({
  authState: coordinator.state,
  ttsService,
  audioPlayer: new HtmlAudioPlayer(),
});
```

This follows the existing pronunciation diagnostic pattern: the page resolves dependencies and the controller remains a plain callable unit.

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
```

Persist history as a closed union rather than optional fields:

```ts
export type MysteryHistoryEntry =
  | { kind: 'message'; sceneId: string }
  | { kind: 'choice'; sceneId: string; selectedOptionId: string };

export type MysteryProgress = {
  chapterId: string;
  chapterVersion: number;
  currentSceneId: string;
  history: readonly MysteryHistoryEntry[];
  completed: boolean;
};
```

The ending is represented by `currentSceneId` + `completed`; it is not copied into history.

`content.ts` exports one constant using `satisfies MysteryChapter`.

The fixed topology is:

```text
scene-01 -> scene-02 -> scene-03(choice) -> scene-04 -> scene-05(ending)
                                      \-> scene-04
```

Both choice options must share `scene-04` as `nextSceneId`. Pin that directly in the real-content unit test; do not invent a generic branching validator code.

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
- message continuation appends `{ kind: 'message', sceneId }` and advances;
- choice submission appends `{ kind: 'choice', sceneId, selectedOptionId }` and advances;
- reaching an ending leaves the ending as `currentSceneId` and marks `completed: true`;
- stale `expectedSceneId` is checked first and returns the same progress object unchanged;
- stale events therefore cannot throw against a newer scene;
- invalid transitions for the actual current scene and unknown current-choice options still throw fixed feature errors;
- full rendered transcript text is never persisted.

`expectedSceneId` is a stale/late-event guard, not the primary double-tap defense.

## Rapid Transition Guard

A second physical click can evaluate a newly advanced reactive scene. A `nextTick` unlock is also too early because the second browser click can arrive after Vue's microtask flush.

Keep timing out of the model and use one page-local accidental-repeat guard:

- set `transitionLocked` synchronously before Continue or choice submission;
- return immediately while locked;
- bind the lock to Continue/choice disabled state;
- retain the lock for 500 ms; and
- clear its timer on unmount.

This is local product behavior, not a reusable debounce utility. Page tests use fake timers and synchronously advance the mocked current scene, proving two rapid clicks only invoke one transition.

## Transcript Projection

Keep reconstruction out of Vue components.

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

The selector switches on `MysteryHistoryEntry.kind`, resolves completed entries, then appends the current scene exactly once. `MysteryTranscript.vue` receives only selected items and emits replay.

HPA-300 can extend one pure selector when `response-build` arrives instead of rewriting an SFC.

## Authored-Content Validation

Keep the validator required by HPA-299 and useful for HPA-300's larger authored chapter:

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

Checks:

- unique scene IDs;
- unique choice IDs within each choice scene;
- at least two options per choice;
- `startSceneId` exists in `scenes`;
- every message/choice destination exists in `scenes`;
- at least one ending exists; and
- at least one ending is reachable from the start.

Do not replace these checks with a hand-written `SceneId` literal union. A literal union constrains spelling but does not prove that every allowed ID is actually present in the `scenes` array, so it cannot eliminate missing-start or dangling-reference validation.

The authored chapter is a checked-in TypeScript constant, not user data. Run `validateMysteryChapter()` against the real chapter in `validate-content.test.ts`; do not add a runtime page-initialization error state solely for validator output.

## Persistence

Use browser `localStorage` inside the Capacitor WebView. This is intentionally synchronous and disposable for the pilot.

Match the existing mobile store namespace convention and keep storage construction explicit:

```ts
export function mysteryProgressStorageKey(userId: string, chapterId: string): string {
  return `vela:mobile:mystery-messenger:${encodeURIComponent(userId)}:${encodeURIComponent(chapterId)}:v1`;
}

export type MysteryProgressStorage = {
  load(userId: string, chapter: MysteryChapter): MysteryProgress | null;
  save(userId: string, progress: MysteryProgress): boolean;
  clear(userId: string, chapterId: string): boolean;
};

export function createBrowserMysteryProgressStorage(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
): MysteryProgressStorage;
```

`:v1` versions the storage shape. `chapterVersion` independently versions disposable authored content.

Load rules:

- missing value returns `null`;
- malformed JSON or invalid progress shape is deleted and returns `null`;
- chapter ID/version mismatch is deleted and returns `null`;
- unknown current/history scene references are deleted and return `null`;
- a history entry whose `kind` disagrees with its referenced scene is deleted and returns `null`;
- a choice history entry with an unknown selected option is deleted and returns `null`;
- `completed` must agree with whether the current scene is an ending.

Storage exceptions do not block play. `load` returns `null`; `save`/`clear` return `false`; the in-memory run continues with one non-blocking save warning.

No migration or fallback persistence layer is added.

## Run Ownership and Authentication

`useMysteryMessenger(options)` derives `selectMobileFeatureSessionStatus(options.authState)`.

- `usable`: load/create that user's run and enable progression.
- `recovering`: retain the same user's in-memory run but disable story mutations.
- `unavailable` or identity change: clear old in-memory state and load only when a usable owner exists again.

The feature never receives or stores Cognito tokens.

## TTS and Audio

`useMysteryAudio(options)` is a small controller over existing contracts, not a copy of `usePronunciationDiagnostic`.

```ts
export type MysteryAudioState =
  | { kind: 'idle' }
  | { kind: 'preparing'; sceneId: string }
  | { kind: 'ready'; sceneId: string; audioUrl: string }
  | { kind: 'playing'; sceneId: string }
  | { kind: 'error'; sceneId: string; message: string };
```

### Playback flow

1. Require a usable current user.
2. If state is `ready` for the same scene and same prepared user, replay the prepared URL directly on the next explicit tap.
3. Otherwise create an `AbortController` and call:

```ts
await ttsService.preparePronunciation(
  { userId, vocabularyId: scene.ttsId, text: authoredText },
  { signal: controller.signal },
);
```

4. Pass the prepared URL to `audioPlayer.play()` and set `playing`.
5. Await `handle.finished`.
6. Resolved `ended`, `stopped`, and `interrupted` outcomes all settle the simple product state to `idle`.
7. `MobileAudioError('gesture_required')` preserves the prepared URL as `ready` and shows `Tap play again`; the next explicit tap does not regenerate audio.
8. `MobileAudioError('media_unavailable')` invalidates only `(userId, scene.ttsId)`, clears the prepared URL, and shows an inline retryable audio error. Do not automatically regenerate.
9. Other TTS/audio failures show inline error and never block Continue/choice.

### Cancellation and lifecycle

Use an operation generation plus owned `AbortController`/playback handle, matching only the minimum semantics already proven by the diagnostic controller:

- user identity change: abort preparation, stop owned playback, clear prepared URL/state;
- lifecycle becomes inactive: abort in-flight preparation, call `audioPlayer.interruptActive('background')`, invalidate the current operation, and settle product state to `idle`;
- `dispose()`: abort preparation, stop the owned handle, dispose the player, stop watches, and settle to `idle`.

This prevents a 45-second cold TTS request from continuing after background/unmount and prevents late completions from starting playback for the wrong user.

Do not add diagnostic counters, automatic session-continuation retries, URL-refresh loops, or an `interrupted` product state.

### TTS identity

Each authored line gets a stable ID containing chapter version, for example:

```text
mystery-message-tomorrow-v1-scene-01
mystery-message-tomorrow-v1-scene-03-prompt
```

The mobile TTS cache identity does not include text, so changing cached Japanese requires a chapter-version/TTS-ID bump. No cache migration is needed.

## UI and Navigation

### Learn

Replace the placeholder with one direct card:

- `Mystery Messenger`;
- `The Message That Arrived Tomorrow`;
- one short description; and
- one `Play pilot` button.

Learn remains stateless. The destination route owns resume/loading.

Use the existing navigation helper and handle its promise like current call sites:

```ts
function openMysteryMessenger(): void {
  void pushMobileRoute(router, '/learn/mystery-messenger').catch((error: unknown) => {
    console.error('Mystery Messenger navigation failed', error);
  });
}
```

No generic activity registry is added.

### Route

Add one authenticated record to existing `coreRoutes`:

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

Do not set `bypassMobileAuth`. `MobilePageHeader` continues to own back/fallback behavior.

### Transcript and composer

`MysteryTranscript.vue` receives `readonly MysteryTranscriptItem[]` and emits replay only.

`MysteryChoiceComposer.vue` receives the active choice plus `disabled`, renders fixed buttons, and emits the selected option ID. Its disabled state includes session recovery and the page transition lock.

The page renders Continue for `message`, choices for `choice`, Restart for `ending`, and audio replay beside authored Japanese.

No free text, drag-and-drop, typing animation, or branch map is included.

## Existing-Test Updates

Replacing Learn and adding a sixth core route deliberately changes existing test expectations:

- `apps/vela-mobile/src/pages/StubPages.test.ts`: remove Learn from the parameterized `Coming soon` cases; `LearnPage.test.ts` owns new behavior.
- `apps/vela-mobile/src/router/routes.test.ts`: retitle the tests that say “five core routes”; expect 6 production/core children and 9 development children; assert `learn/mystery-messenger`; retain the existing `loadDefault()` lazy-import resolution loop.
- `apps/vela-mobile/src/router/diagnostic-routes.test.ts`: retitle “five shell routes”, expect `buildMobileChildRoutes([])` length 6, and retain the auth-bypass assertions.

These are feature-owned regressions, not deferred cleanup.

## Error Handling

Keep product errors small:

- recovering/unavailable session: disable mutations and show simple session-state copy;
- storage failure: keep playing with a save warning;
- TTS/audio failure: show inline audio copy while story progression remains enabled;
- `gesture_required`: show prepared `ready` state with `Tap play again`;
- corrupt or stale save: silently discard and start fresh.

Authored-content validation is test-time for this checked-in constant; do not add a runtime validator error page.

No retry queue, telemetry framework, or recovery subsystem is introduced.

## Testing

Focused coverage includes:

- pure message/choice/ending progression;
- closed history-entry shapes;
- stale `expectedSceneId` returns the same progress unchanged;
- rapid page submission cannot skip a newly rendered message/choice;
- pure transcript projection;
- chapter validation failures and real-chapter reachability;
- direct assertion that the real choice converges to `scene-04`;
- local snapshot key/load/save/clear and destructive version reset;
- malformed/history-kind/option/current/completion-invalid snapshots are discarded;
- same-user resume and restart;
- identity change clears in-memory state;
- both composables are tested directly through explicit options without an injection mount harness;
- TTS request uses user ID, stable TTS ID, authored text, and an AbortSignal;
- `gesture_required` preserves prepared audio and replays it on the next tap without another TTS preparation;
- `ended`, `stopped`, and `interrupted` settle to `idle`;
- background while preparing aborts the request;
- background while playing interrupts and settles without a stuck state;
- media-unavailable invalidates only the affected TTS identity;
- Learn navigation handles helper rejection;
- updated stub and both router test files;
- transcript/composer presentation and replay emission.

### Final local gate

Run coverage, not only the non-coverage suite, because the mobile CI job runs Vitest with coverage and the mobile config enforces its existing line threshold:

```bash
bun run --cwd apps/vela-mobile test:coverage
bun run --cwd apps/vela-mobile lint
bun run --cwd apps/vela-mobile typecheck
bun run --cwd apps/vela-mobile build
```

`test:coverage` must pass the existing mobile 95% line threshold.

When PR CI runs, the Codecov patch status for the mobile changes must be at least 90% with zero threshold tolerance before HPA-299 is accepted.

## Simulator Acceptance

Manually verify:

- Learn → Mystery Messenger;
- five scenes → one choice → ending;
- route leave/re-entry restores the same scene with no duplicated transcript;
- app relaunch restores the same local snapshot;
- restart returns to scene-01;
- rapid repeated Continue/choice only advances once;
- cold TTS first tap either plays or reaches `Tap play again`, and the second tap plays already-prepared audio;
- natural audio completion settles cleanly;
- background during playback does not leave `playing` stuck;
- background during TTS preparation cancels the owned preparation cleanly; and
- TTS error does not disable story progression.

HPA-300 remains blocked until this Simulator pass succeeds.

## Success Criteria

HPA-299 succeeds when:

- a signed-in learner can discover and complete the five-scene slice;
- rapid repeated submissions cannot skip scenes;
- transcript reconstruction stays in a pure selector;
- local resume/restart/version reset work for the correct user;
- TTS replay supports the existing gesture-required and settlement contracts without copying the diagnostic controller;
- background/unmount/identity changes cancel owned audio work;
- invalid authored references fail focused validator tests;
- existing mobile coverage/lint/typecheck/build gates pass;
- Codecov patch coverage for the mobile change is at least 90%; and
- the slice is manually accepted in an iOS Simulator.

# HPA-287: Mobile Mystery Messenger Five-Scene Vertical Slice

**Date:** 2026-08-29

**Linear:** [HPA-287](https://linear.app/cwchanap/issue/HPA-287/mystery-messengervertical-slice-build-a-five-scene-playable-messenger)

**Product source:** [Mystery Messenger Pilot — lean scope and ready-to-create backlog](https://linear.app/cwchanap/document/mystery-messenger-pilot-lean-scope-and-ready-to-create-backlog-04907d2b1cf1)

**Related:** HPA-194 — iOS-first Vela Mobile MVP

## Goal

Prove the smallest enjoyable Mystery Messenger loop with working software before investing in a reusable narrative platform or the full 10–15-scene pilot.

A signed-in learner should be able to discover the pilot from the existing mobile Learn tab, open a five-scene Japanese messenger story, advance through authored messages, answer one language-based choice, replay Japanese audio through Vela's existing authenticated TTS path, leave and resume, restart, and reach a single ending.

This ticket owns one implementation branch and one PR. The PR begins with this design and its implementation plan; implementation and review fixes stay on the same PR.

## Current State

Vela Mobile already has the foundations this slice needs:

- `apps/vela-mobile/src/pages/LearnPage.vue` is still a `Coming soon` stub, so the pilot can become the first real Learn entry without displacing existing mobile learning UI.
- `MobileLayout.vue` already owns bottom navigation, horizontal safe-area handling, keyboard/footer behavior, and the shared `MobilePageHeader`.
- `router/diagnostic-routes.ts` owns the authenticated core child routes. Ordinary routes inherit the existing auth gate; only explicit development diagnostics bypass it.
- `pushMobileRoute()` and `backOrFallback()` already define app-owned mobile history semantics.
- `MobileAuthCoordinator.state` exposes the authenticated user through the existing feature-session selector without exposing tokens to feature code.
- `MobileTtsService.preparePronunciation({ userId, vocabularyId, text })` already owns authenticated TTS preparation, cache isolation, session recovery, and bounded generation requests.
- `HtmlAudioPlayer` already implements the mobile audio contract and is exercised by the existing TTS diagnostic flow.

No backend, shared-package, infrastructure, or native-plugin change is required for this vertical slice.

## Approved Product Scope

The five-scene slice contains exactly three scene variants:

1. `message` — one authored messenger bubble with a Continue action;
2. `choice` — one authored prompt with two or more fixed answers, immediate feedback, and a deterministic next scene;
3. `ending` — the conclusive end of the slice.

The authored fixture uses one linear route with one language choice. Different choice answers may show different feedback, but they converge to the same next scene. The slice is testing whether the messenger-learning loop is clear and pleasant, not whether branching narrative is valuable.

The slice includes:

- one Learn-page pilot card;
- one authenticated `/learn/mystery-messenger` route;
- five authored scenes;
- chronological transcript rendering;
- one active choice composer;
- Japanese audio replay on authored Japanese lines;
- one local progress snapshot per authenticated user and chapter;
- resume after route re-entry or relaunch;
- restart;
- chapter-version reset;
- authored-content validation; and
- focused automated tests plus iOS Simulator acceptance.

## Non-goals

Do not add any of the following in HPA-287:

- the final 10–15-scene chapter;
- `response-build`;
- missed-phrase tracking or recap;
- SRS or personal-dictionary mutation;
- cloud progress, API routes, DynamoDB, sync, conflict handling, or event logs;
- reinstall recovery;
- branching paths or alternate endings;
- adaptive hints, familiarity scores, case notes, relationship meters, inventory, evidence graphs, or city exploration;
- AI-generated dialogue, speech input, or pronunciation scoring;
- Pinia or another state package;
- a general visual-novel engine, story registry, scripting runtime, CMS, or editor;
- moving the feature contract into `@vela/common` before there is a second consumer;
- web parity or extraction from the web learning pages; or
- a new mobile E2E framework.

## Chosen Architecture

Keep the entire feature under:

```text
apps/vela-mobile/src/features/mystery-messenger/
```

Use a small set of feature-local modules:

```text
model.ts                 closed scene/progress contracts + pure transitions
content.ts               five-scene authored chapter and stable TTS IDs
validate-content.ts      pure authored-content validation
storage.ts               localStorage snapshot adapter
useMysteryMessenger.ts   authenticated run/resume/restart orchestration
useMysteryAudio.ts       thin TTS + HtmlAudioPlayer adapter
components/
  MysteryTranscript.vue
  MysteryChoiceComposer.vue
MysteryMessengerPage.vue
```

Keep tests next to the feature files they cover.

This is deliberately not split into a framework/domain package, persistence package, or platform service. A second real narrative consumer is the gate for extraction.

### Alternatives rejected

**Shared narrative engine now:** rejected because one five-scene feature cannot establish stable engine boundaries. It adds indirection before product validation.

**Reuse a web learning page:** rejected because this flow needs mobile-owned navigation, transcript interaction, safe-area behavior, and local run state. Sharing stable domain logic can happen later if a second consumer appears.

**Cloud-save first:** rejected because the pilot's risk is product enjoyment, not cross-device continuity. One local snapshot is sufficient to validate start/resume/restart.

## Feature Contract

Use a closed discriminated union. Do not add generic `payload`, registry, handler, or plugin fields.

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

`content.ts` exports one constant:

```ts
export const MYSTERY_MESSENGER_VERTICAL_SLICE = {
  id: 'the-message-that-arrived-tomorrow',
  version: 1,
  title: 'The Message That Arrived Tomorrow',
  // five scenes
} satisfies MysteryChapter;
```

The exact Japanese copy can be polished during implementation, but the fixture shape is fixed: two opening messages, one choice, one consequence message, one ending.

## Progression Semantics

`model.ts` owns pure functions; Vue is not involved.

```ts
export function createMysteryProgress(chapter: MysteryChapter): MysteryProgress;

export function continueMysteryMessage(
  chapter: MysteryChapter,
  progress: MysteryProgress,
): MysteryProgress;

export function chooseMysteryOption(
  chapter: MysteryChapter,
  progress: MysteryProgress,
  optionId: string,
): MysteryProgress;

export function restartMysteryProgress(chapter: MysteryChapter): MysteryProgress;

export function getMysteryScene(
  chapter: MysteryChapter,
  sceneId: string,
): MysteryScene;
```

Rules:

- A new run starts at `chapter.startSceneId` with empty history.
- Continuing a `message` appends that scene ID once, then moves to its `nextSceneId`.
- Choosing an option appends the choice scene ID plus the selected option ID once, then moves to that option's `nextSceneId`.
- Entering an `ending` marks `completed: true`; the ending remains `currentSceneId` so relaunch restores the completed ending surface.
- A transition invoked for the wrong scene kind throws a fixed feature error rather than silently mutating state.
- Repeating the same UI action after progress has already advanced must not duplicate history; the composable serializes one active transition and persistence occurs from the resulting state.
- The transcript is reconstructed from `history` plus `currentSceneId`; full rendered text is not persisted.

The slice does not need undo, rewind, branching history, checkpoints, or migrations.

## Authenticated Run Ownership

`useMysteryMessenger.ts` injects `MOBILE_AUTH_KEY` and derives the user through `selectMobileFeatureSessionStatus()` just like existing mobile features.

The feature only owns a run while the session selector is `usable`.

- `usable`: load/create that user's local snapshot and enable interaction.
- `recovering`: keep the last rendered in-memory run visible but disable progression until the same user becomes usable again.
- `unavailable` or user identity change: discard the in-memory run and audio state; do not display another user's saved progress.

The auth coordinator remains the only token owner. Mystery Messenger never reads or stores Cognito tokens.

## Local Persistence

Use `window.localStorage`; no Capacitor storage plugin is needed because the pilot only requires same-installation WebView persistence.

Use one namespace per authenticated user and chapter:

```ts
export function mysteryProgressStorageKey(userId: string, chapterId: string): string {
  return `vela:mystery-messenger:${encodeURIComponent(userId)}:${encodeURIComponent(chapterId)}`;
}
```

The snapshot stores the chapter version:

```ts
export type StoredMysteryProgress = MysteryProgress;
```

`storage.ts` exposes a narrow adapter:

```ts
export type MysteryProgressStorage = {
  load(userId: string, chapter: MysteryChapter): MysteryProgress | null;
  save(userId: string, progress: MysteryProgress): boolean;
  clear(userId: string, chapterId: string): boolean;
};

export function createBrowserMysteryProgressStorage(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = window.localStorage,
): MysteryProgressStorage;
```

Load rules are intentionally destructive and migration-free:

- missing snapshot → return `null`;
- invalid JSON or invalid progress shape → remove it and return `null`;
- `chapterId` mismatch → remove it and return `null`;
- `chapterVersion` mismatch → remove it and return `null`;
- referenced current/history/choice IDs no longer valid → remove it and return `null`.

If browser storage throws, the current run continues in memory and the page shows one non-blocking warning that progress cannot be saved on this device. No retry queue or fallback persistence layer is added.

Restart clears the stored snapshot first, then installs and saves a fresh `createMysteryProgress(chapter)` result.

## Authored-Content Validation

Validate the TypeScript constant before the feature is trusted by tests. The validator is a pure function:

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

Checks for HPA-287:

- scene IDs are unique;
- choice IDs are unique within their scene;
- a choice has at least two options;
- `startSceneId` exists;
- every message `nextSceneId` exists;
- every choice option `nextSceneId` exists;
- at least one `ending` exists; and
- at least one ending is reachable from the start through authored links.

Do not add schema libraries or a graph framework. A `Map` plus a small DFS/BFS is enough.

## TTS and Audio Reuse

Mystery Messenger does not create a new API or TTS service.

`useMysteryAudio.ts` injects:

- `MOBILE_AUTH_KEY` for the current feature-session user;
- `MOBILE_TTS_SERVICE_KEY` for `preparePronunciation()`; and
- one feature-owned `HtmlAudioPlayer` instance.

It exposes only the UI state this feature needs:

```ts
export type MysteryAudioState =
  | { kind: 'idle' }
  | { kind: 'preparing'; sceneId: string }
  | { kind: 'playing'; sceneId: string }
  | { kind: 'error'; sceneId: string; message: string };

export type MysteryAudioController = {
  state: Readonly<Ref<MysteryAudioState>>;
  play(scene: MysteryMessageScene | MysteryChoiceScene | MysteryEndingScene): Promise<void>;
  dispose(): void;
};
```

Playback flow:

1. Require a `usable` same-user session.
2. Call existing `MobileTtsService.preparePronunciation()` with current `userId`, the scene's `ttsId`, and the exact authored Japanese text/prompt.
3. Pass the prepared URL to `HtmlAudioPlayer.play()`.
4. Keep TTS failure non-blocking; the learner can continue the story without audio.
5. If playback reports `media_unavailable`, invalidate that one TTS cache identity once and allow the next explicit tap to prepare a fresh URL. Do not add an automatic retry loop.
6. Dispose/stop playback when the page unmounts, the user identity changes, or the feature session becomes unavailable.

### Stable authored TTS identity

The API cache identity uses `vocabularyId` independently of text, so a scene's `ttsId` must remain paired with exactly one authored text value.

Use IDs such as:

```text
mystery-message-tomorrow-v1-scene-01
mystery-message-tomorrow-v1-scene-03-prompt
```

If authored Japanese for a cached line changes, bump the chapter version and therefore its TTS IDs. No cache migration is needed.

## UI and Navigation

### Learn entry

Replace the `LearnPage.vue` placeholder with a simple page containing a single Mystery Messenger card:

- title: `Mystery Messenger`;
- chapter title: `The Message That Arrived Tomorrow`;
- one short description;
- `Start` when there is no valid snapshot;
- `Resume` when a valid snapshot exists; and
- `Play again` after completion.

The card navigates with `pushMobileRoute(router, '/learn/mystery-messenger')`, preserving the existing app-owned history depth.

Do not build a generic learning-activity catalog in this ticket. A direct card is the correct size for one activity.

### Messenger route

Add the authenticated core route:

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

This reuses `MobilePageHeader` and `backOrFallback()` rather than adding route-local back handling.

### Transcript

`MysteryTranscript.vue` receives the chapter, history, and current scene as props and renders only presentation:

- chronological completed messages;
- the selected choice and its authored feedback for completed choice scenes;
- the current message/choice/ending;
- compact speaker labels;
- a speaker/audio icon for Japanese content.

It does not mutate progress or access storage/auth services.

### Active composer

`MysteryChoiceComposer.vue` renders fixed `q-btn` choices and emits the selected option ID once. It owns no answer rules.

For message scenes, the page renders a single Continue button. For the ending, the page renders the ending state plus Restart.

No free text, drag-and-drop, keyboard entry, branching map, or animated typing system is added.

## Error and Empty States

Keep error handling visible but small:

- invalid authored chapter in development/tests: fail initialization with a fixed error;
- unavailable/recovering session: disable story mutations and show the existing-session state in plain copy;
- local storage failure: continue in-memory with a persistence warning;
- TTS failure: show an inline audio error beside the replay action; story progression remains enabled;
- corrupt/stale saved snapshot: silently discard and start a fresh run because there is no released save compatibility requirement.

Do not add telemetry, crash reporting, retry queues, or recovery protocols in this pilot slice.

## Testing Strategy

Use the existing Vitest and Vue Test Utils stack.

### Pure tests

Cover:

- valid five-scene chapter;
- duplicate scene ID;
- dangling message/choice reference;
- missing ending;
- unreachable ending;
- initial progress;
- message advance;
- choice selection and persisted choice history;
- ending completion;
- restart;
- prevention of duplicate history entries;
- snapshot save/load;
- user isolation;
- version reset;
- malformed snapshot reset.

### Composable/audio tests

Cover:

- same-user resume;
- identity change clears in-memory state;
- one transition produces one persisted snapshot;
- storage failure keeps the run usable with a warning;
- audio requests use current user + stable scene TTS ID + exact authored text;
- TTS failure is non-blocking;
- audio disposal on unmount/user loss.

### Component/router tests

Cover:

- Learn renders the pilot card and uses mobile navigation;
- route exists with the expected mobile header/fallback;
- transcript renders completed history only once;
- choice composer emits one selected option;
- messenger page advances, restores, restarts, and reaches the ending with injected fakes.

No Playwright or native automation is added.

## Verification Gates

Before the PR becomes ready for review, run:

```bash
bun run --cwd apps/vela-mobile test:unit
bun run --cwd apps/vela-mobile lint
bun run --cwd apps/vela-mobile typecheck
bun run --cwd apps/vela-mobile build
```

Then build/run through the existing iOS Simulator workflow and manually verify:

1. sign in;
2. open Learn → Mystery Messenger;
3. advance to the choice;
4. play Japanese audio;
5. choose an answer and see feedback;
6. leave to Learn and return; transcript/current scene are unchanged and not duplicated;
7. terminate/relaunch the app and confirm resume;
8. restart and confirm scene 1;
9. complete the five-scene ending; and
10. use native/header back navigation without a trap or blank frame.

Physical-iPhone acceptance belongs to the later complete-pilot verification ticket, not HPA-287.

## Follow-up Gate

Only after this five-scene loop is manually accepted in the Simulator should the next pilot slice add:

- the complete 10–15-scene authored chapter; and
- the single additional `response-build` interaction.

Do not extract shared narrative abstractions during that expansion unless a second real consumer also exists.

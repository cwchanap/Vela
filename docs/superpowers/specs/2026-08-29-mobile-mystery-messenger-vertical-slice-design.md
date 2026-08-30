# HPA-287: Mobile Mystery Messenger Five-Scene Vertical Slice

**Date:** 2026-08-29

**Linear:** [HPA-287](https://linear.app/cwchanap/issue/HPA-287/mystery-messengervertical-slice-build-a-five-scene-playable-messenger)

**Product source:** [Mystery Messenger Pilot — lean scope and ready-to-create backlog](https://linear.app/cwchanap/document/mystery-messenger-pilot-lean-scope-and-ready-to-create-backlog-04907d2b1cf1)

**Related:** HPA-194 — iOS-first Vela Mobile MVP

## Goal

Prove the smallest enjoyable Mystery Messenger loop with working software before investing in a reusable narrative platform or the full 10–15-scene pilot.

A signed-in learner can discover the pilot from the existing mobile Learn tab, play a five-scene Japanese messenger story, answer one language-based choice, replay authored Japanese through Vela's existing authenticated TTS/audio path, leave and resume, restart, and reach one ending.

HPA-287 owns one branch and one PR. This design and its implementation plan are the first commits on that PR; implementation, review fixes, and acceptance evidence stay on the same PR.

## Current State

The repository already has the required foundations:

- `apps/vela-mobile/src/pages/LearnPage.vue` is still a `Coming soon` stub.
- `MobileLayout.vue` owns bottom navigation, safe-area behavior, keyboard/footer behavior, and the shared `MobilePageHeader`.
- `router/diagnostic-routes.ts` owns authenticated core child routes. Only explicit development diagnostics bypass the mobile auth gate.
- `pushMobileRoute()` and `backOrFallback()` own mobile history semantics.
- `MobileAuthCoordinator.state` plus `selectMobileFeatureSessionStatus()` expose the current feature user without exposing tokens.
- `MobileTtsService.preparePronunciation({ userId, vocabularyId, text })` owns authenticated TTS preparation, session recovery, and caching.
- `HtmlAudioPlayer` already implements the mobile audio contract and is exercised by the TTS diagnostic flow.

No backend, `@vela/common`, infrastructure, native-plugin, or dependency change is needed.

## Product Scope

The slice has exactly three scene variants:

1. `message` — one authored messenger bubble plus Continue;
2. `choice` — one authored prompt with fixed answers, immediate feedback, and a deterministic next scene;
3. `ending` — the conclusive end of the slice.

The five-scene topology is linear apart from the answer selection:

```text
scene-01 message
  → scene-02 message
  → scene-03 choice
       ├─ correct answer ─┐
       └─ wrong answer ───┤
                         ↓
                    scene-04 message
                         ↓
                    scene-05 ending
```

Different answers may show different feedback, but both converge to `scene-04`. This slice validates the messenger learning loop, not branching narrative.

Included:

- one Learn-page pilot card;
- one authenticated `/learn/mystery-messenger` route;
- five authored scenes;
- chronological transcript rendering;
- one active choice composer;
- Japanese audio replay;
- one local progress snapshot per authenticated user/chapter;
- route re-entry and relaunch resume;
- restart;
- chapter-version reset;
- authored-content validation;
- focused tests; and
- iOS Simulator acceptance.

## Non-goals

Do not add:

- the full 10–15-scene pilot;
- `response-build`;
- missed-phrase recap or SRS writes;
- cloud persistence, API routes, DynamoDB, sync, event logs, idempotency, or reinstall recovery;
- branches or alternate endings;
- adaptive hints, case notes, familiarity models, relationship meters, inventory, evidence graphs, or city exploration;
- AI dialogue, speech input, or pronunciation scoring;
- Pinia or another state package;
- a narrative engine, registry, scripting runtime, CMS, or editor;
- shared narrative contracts in `@vela/common` before a second consumer exists;
- web parity; or
- a new E2E framework.

## Chosen Architecture

Keep the feature local to:

```text
apps/vela-mobile/src/features/mystery-messenger/
```

Planned modules:

```text
model.ts                 closed contracts + pure progression
content.ts               five-scene authored chapter + stable TTS IDs
validate-content.ts      pure authored-content validation
storage.ts               localStorage snapshot adapter
useMysteryMessenger.ts   auth-aware run/resume/restart orchestration
useMysteryAudio.ts       thin TTS + HtmlAudioPlayer adapter
components/
  MysteryTranscript.vue
  MysteryChoiceComposer.vue
MysteryMessengerPage.vue
```

Tests stay beside the feature files. Do not add a barrel file or a shared framework.

### Alternatives rejected

**Shared story engine now:** one five-scene consumer cannot establish stable abstractions; this adds indirection before product validation.

**Reuse a web learning page:** the flow needs mobile-owned navigation, transcript interaction, safe-area behavior, and local run state. Share later only if a stable second consumer exists.

**Cloud save first:** the pilot risk is whether the interaction is enjoyable, not cross-device continuity. Same-installation resume is sufficient.

## Feature Contract

Use one closed discriminated union:

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

`content.ts` exports:

```ts
export const MYSTERY_MESSENGER_VERTICAL_SLICE = {
  id: 'the-message-that-arrived-tomorrow',
  version: 1,
  title: 'The Message That Arrived Tomorrow',
  // five scenes
} satisfies MysteryChapter;
```

The exact Japanese wording can be polished during implementation, but the five-scene topology and closed variants do not change in this ticket.

## Progression Semantics

`model.ts` owns pure functions only:

```ts
export function createMysteryProgress(chapter: MysteryChapter): MysteryProgress;
export function getMysteryScene(chapter: MysteryChapter, sceneId: string): MysteryScene;
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
```

Rules:

- New run: start scene + empty history.
- Continue: append the current message once, then advance.
- Choice: append the current choice plus selected option ID once, then advance.
- Entering the ending sets `completed: true`; the ending remains the current scene so it restores after relaunch.
- Calling a pure transition for the wrong scene kind throws a fixed `mystery_invalid_transition` error.
- Transcript is reconstructed from `history` plus `currentSceneId`; rendered text is not persisted.

### Stale/double-tap guard

UI actions carry the scene ID that rendered the control:

```ts
continueMessage(sceneId: string): void;
chooseOption(sceneId: string, optionId: string): void;
```

`useMysteryMessenger` compares that `sceneId` with `progress.currentSceneId` before applying a transition. If they differ, the action is stale and is ignored. This prevents a rapid double tap on an old Continue button from advancing through the next message after the first tap has already changed state.

No mutex, event queue, or debounce framework is needed.

## Authenticated Run Ownership

`useMysteryMessenger.ts` injects `MOBILE_AUTH_KEY` and derives the feature user with `selectMobileFeatureSessionStatus()`.

- `usable`: load/create that user's run and enable mutations.
- `recovering` for the same user: retain the in-memory run but disable mutations.
- `unavailable` or user identity change: discard the prior in-memory run/audio state before loading anything for another user.

Mystery Messenger never reads or stores Cognito tokens.

## Local Persistence

Use `window.localStorage`; no new Capacitor storage plugin is needed.

```ts
export function mysteryProgressStorageKey(userId: string, chapterId: string): string {
  return `vela:mystery-messenger:${encodeURIComponent(userId)}:${encodeURIComponent(chapterId)}`;
}
```

The snapshot itself includes `chapterVersion`. This lets the feature detect and delete stale data rather than maintaining migration code.

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

Load behavior:

- missing → `null`;
- malformed JSON/shape → delete + `null`;
- chapter ID/version mismatch → delete + `null`;
- invalid current/history/choice references → delete + `null`.

Storage exceptions do not kill the run. The page continues in memory and shows one non-blocking “progress cannot be saved” warning. Do not add a retry queue or fallback persistence layer.

Restart clears the snapshot and immediately installs/saves a fresh run.

## Authored-Content Validation

Pure validator:

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

Check:

- unique scene IDs;
- unique choice IDs per choice scene;
- at least two choice options;
- valid start scene;
- valid message/choice next references;
- at least one ending; and
- at least one ending reachable from the start.

Use `Map` plus a small DFS/BFS. No schema or graph dependency.

## TTS and Audio Reuse

`useMysteryAudio.ts` reuses `MOBILE_AUTH_KEY`, `MOBILE_TTS_SERVICE_KEY`, and one feature-owned `HtmlAudioPlayer`.

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

Flow:

1. require a usable current user;
2. `preparePronunciation({ userId, vocabularyId: scene.ttsId, text })`;
3. `HtmlAudioPlayer.play(prepared.audioUrl)`;
4. keep any failure non-blocking for story progress;
5. on `media_unavailable`, invalidate only that `(userId, ttsId)` and let the next explicit tap prepare a fresh URL; no automatic retry loop;
6. stop/abort on page unmount or user loss/change.

Do not copy the diagnostic counters or state machine wholesale.

### Stable TTS IDs

The backend cache identity uses `vocabularyId` independently of text. Each authored `ttsId` therefore stays paired with exactly one text value:

```text
mystery-message-tomorrow-v1-scene-01
mystery-message-tomorrow-v1-scene-03-prompt
```

If cached Japanese text changes, bump the chapter version and corresponding TTS IDs. No cache migration is required.

## UI and Navigation

### Learn entry

Replace the Learn stub with one simple card:

- `Mystery Messenger`;
- `The Message That Arrived Tomorrow`;
- one short description;
- one primary `Play pilot` action.

The card always navigates with:

```ts
pushMobileRoute(router, '/learn/mystery-messenger');
```

Resume behavior belongs to the route controller. Learn does not read the snapshot merely to change Start/Resume copy. This avoids a second persistence consumer for cosmetic text.

Do not build a generic learning-activity catalog for one activity.

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

No auth bypass and no route-local back implementation.

### Transcript and composer

`MysteryTranscript.vue` is presentation-only: completed messages, selected choice + authored feedback, current scene, compact speaker label, audio buttons.

`MysteryChoiceComposer.vue` renders authored `q-btn` options and emits `select(optionId)` once. It owns no correctness rules.

For a message, the page renders Continue and passes that scene ID to `continueMessage(scene.id)`. For a choice it passes `chooseOption(scene.id, optionId)`. For the ending it renders completion + Restart.

No free text, typing animation, drag/drop, interaction registry, or branching map.

## Error States

Keep them small:

- invalid authored chapter in tests/development → fixed initialization error;
- recovering/unavailable session → visible status + mutations disabled;
- local storage failure → in-memory run + persistence warning;
- TTS failure → inline audio error; progression remains enabled;
- corrupt/stale save → silently discard and start fresh.

No telemetry, retry queue, recovery protocol, or migration UI.

## Testing

Use existing Vitest + Vue Test Utils.

Pure tests:

- valid fixture;
- duplicate/dangling/missing/unreachable content;
- initial progress;
- message advance;
- choice history;
- ending completion;
- restart;
- snapshot load/save;
- user isolation;
- version/corruption reset.

Composable/audio tests:

- same-user resume;
- user change isolation;
- stale scene action ignored;
- one valid action → one save;
- storage failure stays playable;
- audio request uses current user + stable TTS ID + exact authored text;
- TTS failure is non-blocking;
- audio is disposed on user loss/unmount.

Component/router tests:

- Learn card + mobile navigation;
- authenticated route meta;
- transcript has no duplicate entries;
- choice emits one selection;
- page advances, resumes, restarts, and reaches ending with fakes.

No Playwright/native automation is added.

## Verification Gates

Before marking the existing draft PR ready:

```bash
bun run --cwd apps/vela-mobile test:unit
bun run --cwd apps/vela-mobile lint
bun run --cwd apps/vela-mobile typecheck
bun run --cwd apps/vela-mobile build
```

Then use the existing iOS Simulator workflow and verify:

1. signed-in Learn → Mystery Messenger;
2. progress to the choice;
3. Japanese audio replay;
4. choose answer + feedback;
5. leave and return with no transcript duplication;
6. terminate/relaunch and resume;
7. restart to scene 1;
8. reach ending;
9. header/native back returns to Learn; and
10. no obvious safe-area/touch-target problem.

Physical-iPhone verification is deferred to the complete-pilot acceptance ticket.

## Follow-up Gate

Only after the five-scene loop is accepted in Simulator should the next slice add the full 10–15-scene chapter plus `response-build`.

Do not extract shared narrative abstractions during that expansion unless a second real consumer also exists.

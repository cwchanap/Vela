import { reactive } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type { MobileAuthState } from '../../auth/mobile-auth-contract';
import { MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER as chapter } from './content';
import {
  continueMysteryMessage,
  createMysteryProgress,
  type MysteryChapter,
  type MysteryProgress,
} from './model';
import type { MysteryProgressStorage } from './storage';
import { useMysteryMessenger } from './useMysteryMessenger';

function authState(overrides: Partial<MobileAuthState> = {}): MobileAuthState {
  return {
    phase: 'authenticated',
    operation: 'idle',
    sessionUsable: true,
    errorCode: null,
    retryAction: null,
    notice: null,
    user: { userId: 'user:a', email: null },
    ...overrides,
  };
}

function createStorage(overrides: Partial<MysteryProgressStorage> = {}): MysteryProgressStorage {
  return {
    load: vi.fn(() => null),
    save: vi.fn(() => true),
    clear: vi.fn(() => true),
    ...overrides,
  };
}

function progressAtScene02(): MysteryProgress {
  return continueMysteryMessage(chapter, createMysteryProgress(chapter), 'scene-01');
}

const RESPONSE_CHAPTER: MysteryChapter = {
  id: 'mystery-response-controller',
  version: 1,
  title: '返事',
  startSceneId: 'scene-01',
  targetPhrases: [],
  scenes: [
    {
      kind: 'message',
      id: 'scene-01',
      speaker: 'mina',
      text: '7時に来てください。',
      ttsId: 'tts-scene-01',
      nextSceneId: 'response-01',
    },
    {
      kind: 'response-build',
      id: 'response-01',
      prompt: '返事を作ってください。',
      tokens: [
        { id: 'time', text: '7時' },
        { id: 'ni', text: 'に' },
      ],
      correctTokenIds: ['time', 'ni'],
      feedback: { correct: '正しいです。', incorrect: 'もう一度確認しましょう。' },
      hint: '「7時」のあとに「に」を置きます。',
      explanation: '時間の後ろに「に」を使います。',
      targetPhraseIds: [],
      nextSceneId: 'ending',
    },
    {
      kind: 'ending',
      id: 'ending',
      title: 'あしたの約束',
      text: 'また明日。',
      ttsId: 'tts-ending',
    },
  ],
};

function progressAtResponseScene(): MysteryProgress {
  return continueMysteryMessage(
    RESPONSE_CHAPTER,
    createMysteryProgress(RESPONSE_CHAPTER),
    'scene-01',
  );
}

describe('useMysteryMessenger', () => {
  it('restores a stored run when the session is usable', () => {
    const stored = progressAtScene02();
    const storage = createStorage({ load: vi.fn(() => stored) });

    const controller = useMysteryMessenger({
      authState: reactive(authState()),
      storage,
      chapter,
    });

    expect(controller.progress.value).toEqual(stored);
    expect(controller.currentScene.value?.id).toBe('scene-02');
    expect(controller.transcript.value.at(-1)).toMatchObject({
      kind: 'message',
      sceneId: 'scene-02',
      active: true,
    });
    expect(controller.sessionStatus.value).toEqual({ kind: 'usable', userId: 'user:a' });
    expect(storage.save).not.toHaveBeenCalled();
    expect(controller.persistenceWarning.value).toBe(false);
  });

  it('creates and persists a fresh run for a new user', () => {
    const saved: MysteryProgress[] = [];
    const storage = createStorage({
      save: vi.fn((_userId: string, progress: MysteryProgress) => {
        saved.push(progress);
        return true;
      }),
    });

    const controller = useMysteryMessenger({
      authState: reactive(authState()),
      storage,
      chapter,
    });

    expect(controller.progress.value).toEqual(createMysteryProgress(chapter));
    expect(saved).toEqual([createMysteryProgress(chapter)]);
    expect(controller.persistenceWarning.value).toBe(false);
  });

  it('persists after each accepted transition', () => {
    const saved: MysteryProgress[] = [];
    const storage = createStorage({
      save: vi.fn((_userId: string, progress: MysteryProgress) => {
        saved.push(progress);
        return true;
      }),
    });
    const controller = useMysteryMessenger({
      authState: reactive(authState()),
      storage,
      chapter,
    });

    controller.continueMessage('scene-01');
    controller.continueMessage('scene-02');
    controller.chooseOption('scene-03', 'tomorrow-morning');

    expect(controller.progress.value?.currentSceneId).toBe('scene-04');
    expect(saved.map((progress) => progress.currentSceneId)).toEqual([
      'scene-01',
      'scene-02',
      'scene-03',
      'scene-04',
    ]);
  });

  it('keeps in-memory progress and warns when persistence fails', () => {
    const storage = createStorage({ save: vi.fn(() => false) });

    const controller = useMysteryMessenger({
      authState: reactive(authState()),
      storage,
      chapter,
    });

    expect(controller.persistenceWarning.value).toBe(true);
    expect(controller.progress.value).toEqual(createMysteryProgress(chapter));
  });

  it('restart clears storage and saves fresh progress', () => {
    const saved: MysteryProgress[] = [];
    const storage = createStorage({
      save: vi.fn((_userId: string, progress: MysteryProgress) => {
        saved.push(progress);
        return true;
      }),
    });
    const controller = useMysteryMessenger({
      authState: reactive(authState()),
      storage,
      chapter,
    });
    controller.continueMessage('scene-01');

    controller.restart();

    expect(storage.clear).toHaveBeenCalledWith('user:a', chapter.id);
    expect(controller.progress.value).toEqual(createMysteryProgress(chapter));
    expect(saved.at(-1)).toEqual(createMysteryProgress(chapter));
  });

  it("retains the same user's run but disables mutations while recovering", () => {
    const auth = reactive(authState());
    const controller = useMysteryMessenger({ authState: auth, storage: createStorage(), chapter });
    controller.continueMessage('scene-01');
    const retained = controller.progress.value;

    Object.assign(auth, { operation: 'refreshing' });

    expect(controller.sessionStatus.value).toEqual({
      kind: 'recovering',
      userId: 'user:a',
      sessionUsable: true,
    });
    expect(controller.progress.value).toBe(retained);

    controller.continueMessage('scene-02');
    controller.chooseOption('scene-03', 'tomorrow-morning');
    controller.restart();

    expect(controller.progress.value).toBe(retained);
  });

  it('clears the old run when signed out and loads the new user only when usable', () => {
    const storedForUserB = progressAtScene02();
    const load = vi.fn((userId: string) => (userId === 'user:b' ? storedForUserB : null));
    const storage = createStorage({ load });
    const auth = reactive(authState());
    const controller = useMysteryMessenger({ authState: auth, storage, chapter });
    const runForUserA = controller.progress.value;

    Object.assign(auth, {
      phase: 'signedOut',
      sessionUsable: false,
      user: null,
    });

    expect(controller.progress.value).toBeNull();
    expect(load).not.toHaveBeenCalledWith('user:b');

    Object.assign(auth, authState({ user: { userId: 'user:b', email: null } }));

    expect(controller.progress.value).toBe(storedForUserB);
    expect(load).toHaveBeenCalledWith('user:b', chapter);
    expect(runForUserA).not.toBe(storedForUserB);
  });

  it('clears the old run when identity changes during recovery', () => {
    const auth = reactive(authState());
    const controller = useMysteryMessenger({ authState: auth, storage: createStorage(), chapter });
    controller.continueMessage('scene-01');
    const oldRun = controller.progress.value;

    Object.assign(auth, {
      operation: 'refreshing',
      sessionUsable: false,
      user: { userId: 'user:b', email: null },
    });

    expect(controller.sessionStatus.value).toEqual({
      kind: 'recovering',
      userId: 'user:b',
      sessionUsable: false,
    });
    expect(controller.progress.value).toBeNull();
    expect(oldRun).not.toBeNull();
  });

  it('clears persistenceWarning when a new user loads after a prior save failure', () => {
    const auth = reactive(authState());
    const storage = createStorage({
      save: vi.fn((userId: string) => userId !== 'user:a'),
    });
    const controller = useMysteryMessenger({ authState: auth, storage, chapter });

    // user:a's fresh run failed to save.
    expect(controller.persistenceWarning.value).toBe(true);

    Object.assign(auth, {
      phase: 'signedOut',
      sessionUsable: false,
      user: null,
    });
    expect(controller.progress.value).toBeNull();
    // Bug: warning carried across sign-out before the fix.
    expect(controller.persistenceWarning.value).toBe(false);

    Object.assign(auth, authState({ user: { userId: 'user:b', email: null } }));
    // user:b's fresh run saves successfully; the prior user's warning
    // must not bleed into the new run.
    expect(controller.persistenceWarning.value).toBe(false);
  });

  it('clears persistenceWarning after a successful save follows a failed one', () => {
    const saves = [false, true];
    const storage = createStorage({
      save: vi.fn(() => saves.shift() ?? true),
    });
    const controller = useMysteryMessenger({
      authState: reactive(authState()),
      storage,
      chapter,
    });

    // Initial fresh-run save failed.
    expect(controller.persistenceWarning.value).toBe(true);

    controller.continueMessage('scene-01');

    // Next transition saves successfully; the stale warning must clear.
    expect(controller.persistenceWarning.value).toBe(false);
  });

  it('saves an accepted response submission once', () => {
    const saved: MysteryProgress[] = [];
    const storage = createStorage({
      save: vi.fn((_userId: string, progress: MysteryProgress) => {
        saved.push(progress);
        return true;
      }),
    });
    const controller = useMysteryMessenger({
      authState: reactive(authState()),
      storage,
      chapter: RESPONSE_CHAPTER,
    });
    controller.continueMessage('scene-01');
    expect(controller.progress.value).toEqual(progressAtResponseScene());
    const savesAfterSetup = vi.mocked(storage.save).mock.calls.length;

    controller.submitResponse('response-01', ['time', 'ni']);

    expect(controller.progress.value?.currentSceneId).toBe('ending');
    expect(controller.progress.value?.completed).toBe(true);
    expect(controller.progress.value?.history.at(-1)).toEqual({
      kind: 'response-build',
      sceneId: 'response-01',
      selectedTokenIds: ['time', 'ni'],
      hintUsed: false,
    });
    expect(vi.mocked(storage.save).mock.calls.length).toBe(savesAfterSetup + 1);
    expect(vi.mocked(storage.save).mock.lastCall?.[1].currentSceneId).toBe('ending');
    expect(controller.persistenceWarning.value).toBe(false);
  });

  it('does not save or replace progress on a stale response submission', () => {
    const storage = createStorage();
    const controller = useMysteryMessenger({
      authState: reactive(authState()),
      storage,
      chapter: RESPONSE_CHAPTER,
    });
    controller.continueMessage('scene-01');
    controller.submitResponse('response-01', ['time', 'ni']);
    const before = controller.progress.value;
    const savesAfterSubmission = vi.mocked(storage.save).mock.calls.length;

    controller.submitResponse('response-01', ['time', 'ni']);

    expect(controller.progress.value).toBe(before);
    expect(vi.mocked(storage.save).mock.calls.length).toBe(savesAfterSubmission);
  });

  it('keeps the run unchanged when recovering or unavailable during a response submission', () => {
    const auth = reactive(authState());
    const storage = createStorage();
    const controller = useMysteryMessenger({
      authState: auth,
      storage,
      chapter: RESPONSE_CHAPTER,
    });
    controller.continueMessage('scene-01');
    const retained = controller.progress.value;
    const savesAfterSetup = vi.mocked(storage.save).mock.calls.length;

    Object.assign(auth, { operation: 'refreshing' });
    controller.submitResponse('response-01', ['time', 'ni']);
    expect(controller.progress.value).toBe(retained);

    Object.assign(auth, { operation: 'idle', sessionUsable: false });
    expect(controller.sessionStatus.value).toEqual({ kind: 'unavailable' });
    controller.submitResponse('response-01', ['time', 'ni']);

    expect(vi.mocked(storage.save).mock.calls.length).toBe(savesAfterSetup);
  });

  it('advances in memory and warns when the response save fails', () => {
    const saves = [true, true, false];
    const storage = createStorage({ save: vi.fn(() => saves.shift() ?? true) });
    const controller = useMysteryMessenger({
      authState: reactive(authState()),
      storage,
      chapter: RESPONSE_CHAPTER,
    });
    controller.continueMessage('scene-01');
    expect(controller.persistenceWarning.value).toBe(false);

    controller.submitResponse('response-01', ['time', 'ni']);

    expect(controller.progress.value?.currentSceneId).toBe('ending');
    expect(controller.persistenceWarning.value).toBe(true);
  });

  it('does not save or replace progress on a stale transition', () => {
    const storage = createStorage();
    const controller = useMysteryMessenger({
      authState: reactive(authState()),
      storage,
      chapter,
    });
    controller.continueMessage('scene-01');
    const before = controller.progress.value;
    const savesAfterSetup = vi.mocked(storage.save).mock.calls.length;

    controller.continueMessage('scene-05');
    controller.chooseOption('scene-01', 'understood');

    expect(controller.progress.value).toBe(before);
    expect(vi.mocked(storage.save).mock.calls.length).toBe(savesAfterSetup);
  });
});

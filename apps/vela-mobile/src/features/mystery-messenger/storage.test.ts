import { describe, expect, it } from 'vitest';
import { MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER as chapter } from './content';
import {
  chooseMysteryOption,
  continueMysteryMessage,
  createMysteryProgress,
  type MysteryChapter,
  type MysteryProgress,
  type MysteryResponseBuildScene,
  type MysteryScene,
  submitMysteryResponse,
} from './model';
import { createBrowserMysteryProgressStorage, mysteryProgressStorageKey } from './storage';

type FakeBackend = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  has: (key: string) => boolean;
  set: (key: string, value: string) => void;
};

function createFakeBackend(): FakeBackend {
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
    has: (key) => entries.has(key),
    set: (key, value) => {
      entries.set(key, value);
    },
  };
}

const userId = 'user:a';
const chapterId = chapter.id;
const key = mysteryProgressStorageKey(userId, chapterId);

function sceneOf(id: string): MysteryScene {
  const authoredScene = chapter.scenes.find((candidate) => candidate.id === id);
  if (!authoredScene) throw new Error(`missing authored scene ${id}`);
  return authoredScene;
}

function responseSceneOf(id: string): MysteryResponseBuildScene {
  const authoredScene = sceneOf(id);
  if (authoredScene.kind !== 'response-build') {
    throw new Error(`expected response-build scene ${id}`);
  }
  return authoredScene;
}

const scene07 = responseSceneOf('scene-07');
const scene11 = responseSceneOf('scene-11');

function progressAtScene04(): MysteryProgress {
  let progress = createMysteryProgress(chapter);
  progress = continueMysteryMessage(chapter, progress, 'scene-01');
  progress = continueMysteryMessage(chapter, progress, 'scene-02');
  return chooseMysteryOption(chapter, progress, 'scene-03', 'tomorrow-morning');
}

function progressAtEnding(): MysteryProgress {
  let progress = progressAtScene04();
  progress = continueMysteryMessage(chapter, progress, 'scene-04');
  progress = chooseMysteryOption(chapter, progress, 'scene-05', 'minas-notebook');
  progress = continueMysteryMessage(chapter, progress, 'scene-06');
  progress = submitMysteryResponse(chapter, progress, 'scene-07', scene07.correctTokenIds);
  progress = continueMysteryMessage(chapter, progress, 'scene-08');
  progress = chooseMysteryOption(chapter, progress, 'scene-09', 'ask-when-tomorrow');
  progress = continueMysteryMessage(chapter, progress, 'scene-10');
  progress = submitMysteryResponse(chapter, progress, 'scene-11', scene11.correctTokenIds);
  return continueMysteryMessage(chapter, progress, 'scene-12');
}

const RESPONSE_STORAGE_CHAPTER: MysteryChapter = {
  id: 'mystery-storage-response-v1',
  version: 2,
  title: '返事の保存',
  startSceneId: 'scene-01',
  targetPhrases: [],
  scenes: [
    {
      kind: 'message',
      id: 'scene-01',
      speaker: 'mina',
      text: 'メッセージ。',
      ttsId: 't-scene-01',
      nextSceneId: 'response-01',
    },
    {
      kind: 'response-build',
      id: 'response-01',
      prompt: '返事を作ってください。',
      tokens: [
        { id: 'time', text: '7時' },
        { id: 'ni', text: 'に' },
        { id: 'train', text: '電車' },
      ],
      correctTokenIds: ['time', 'ni'],
      feedback: { correct: '正しい。', incorrect: '確認しましょう。' },
      hint: 'h',
      explanation: 'e',
      targetPhraseIds: [],
      nextSceneId: 'ending',
    },
    { kind: 'ending', id: 'ending', title: '終わり', text: '…', ttsId: 't-ending' },
  ],
};

const responseKey = mysteryProgressStorageKey(userId, RESPONSE_STORAGE_CHAPTER.id);

function responseProgress(): MysteryProgress {
  let progress = createMysteryProgress(RESPONSE_STORAGE_CHAPTER);
  progress = continueMysteryMessage(RESPONSE_STORAGE_CHAPTER, progress, 'scene-01');
  return submitMysteryResponse(RESPONSE_STORAGE_CHAPTER, progress, 'response-01', ['time', 'ni']);
}

function storedResponseProgress(patch: Record<string, unknown>): string {
  return JSON.stringify({ ...responseProgress(), ...patch });
}

describe('response history persistence', () => {
  it('round-trips a saved response-build history entry', () => {
    const backend = createFakeBackend();
    const storage = createBrowserMysteryProgressStorage(backend);
    const progress = responseProgress();

    expect(storage.save(userId, progress)).toBe(true);
    expect(storage.load(userId, RESPONSE_STORAGE_CHAPTER)).toEqual(progress);
  });

  it('resets a response entry whose scene is not a response-build scene', () => {
    const backend = createFakeBackend();
    const storage = createBrowserMysteryProgressStorage(backend);
    backend.set(
      responseKey,
      storedResponseProgress({
        history: [{ kind: 'response-build', sceneId: 'scene-01', selectedTokenIds: ['time'] }],
      }),
    );

    expect(storage.load(userId, RESPONSE_STORAGE_CHAPTER)).toBeNull();
    expect(backend.has(responseKey)).toBe(false);
  });

  it('resets a response entry whose selected ids are not an array', () => {
    const backend = createFakeBackend();
    const storage = createBrowserMysteryProgressStorage(backend);
    backend.set(
      responseKey,
      storedResponseProgress({
        history: [
          {
            kind: 'response-build',
            sceneId: 'response-01',
            selectedTokenIds: 'time',
          },
        ],
      }),
    );

    expect(storage.load(userId, RESPONSE_STORAGE_CHAPTER)).toBeNull();
    expect(backend.has(responseKey)).toBe(false);
  });

  it('resets a response entry with an unknown selected token id', () => {
    const backend = createFakeBackend();
    const storage = createBrowserMysteryProgressStorage(backend);
    backend.set(
      responseKey,
      storedResponseProgress({
        history: [
          {
            kind: 'response-build',
            sceneId: 'response-01',
            selectedTokenIds: ['time', 'nope'],
          },
        ],
      }),
    );

    expect(storage.load(userId, RESPONSE_STORAGE_CHAPTER)).toBeNull();
    expect(backend.has(responseKey)).toBe(false);
  });

  it('resets a response entry with a repeated selected token identity', () => {
    const backend = createFakeBackend();
    const storage = createBrowserMysteryProgressStorage(backend);
    backend.set(
      responseKey,
      storedResponseProgress({
        history: [
          {
            kind: 'response-build',
            sceneId: 'response-01',
            selectedTokenIds: ['time', 'time'],
          },
        ],
      }),
    );

    expect(storage.load(userId, RESPONSE_STORAGE_CHAPTER)).toBeNull();
    expect(backend.has(responseKey)).toBe(false);
  });

  it('resets version-1 progress loaded against version-2 content', () => {
    const backend = createFakeBackend();
    const storage = createBrowserMysteryProgressStorage(backend);
    backend.set(responseKey, storedResponseProgress({ chapterVersion: 1 }));

    expect(storage.load(userId, RESPONSE_STORAGE_CHAPTER)).toBeNull();
    expect(backend.has(responseKey)).toBe(false);
  });
});

describe('hint metadata persistence', () => {
  it('loads HPA-300 choice and response history without hintUsed unchanged', () => {
    const backend = createFakeBackend();
    const storage = createBrowserMysteryProgressStorage(backend);
    const legacyChoice = {
      ...progressAtScene04(),
      history: [
        { kind: 'message', sceneId: 'scene-01' },
        { kind: 'message', sceneId: 'scene-02' },
        { kind: 'choice', sceneId: 'scene-03', selectedOptionId: 'tomorrow-morning' },
      ],
    };
    const legacyResponse = {
      ...responseProgress(),
      history: [
        { kind: 'message', sceneId: 'scene-01' },
        {
          kind: 'response-build',
          sceneId: 'response-01',
          selectedTokenIds: ['time', 'ni'],
        },
      ],
    };

    backend.set(key, JSON.stringify(legacyChoice));
    expect(storage.load(userId, chapter)).toEqual(legacyChoice);

    backend.set(responseKey, JSON.stringify(legacyResponse));
    expect(storage.load(userId, RESPONSE_STORAGE_CHAPTER)).toEqual(legacyResponse);
  });

  it('round-trips hintUsed: true on choice and response entries', () => {
    const backend = createFakeBackend();
    const storage = createBrowserMysteryProgressStorage(backend);
    const storageResponse = createBrowserMysteryProgressStorage(backend);
    let progress = createMysteryProgress(chapter);
    progress = continueMysteryMessage(chapter, progress, 'scene-01');
    progress = continueMysteryMessage(chapter, progress, 'scene-02');
    progress = chooseMysteryOption(chapter, progress, 'scene-03', 'tomorrow-morning', true);
    let responseProgressHinted = createMysteryProgress(RESPONSE_STORAGE_CHAPTER);
    responseProgressHinted = continueMysteryMessage(
      RESPONSE_STORAGE_CHAPTER,
      responseProgressHinted,
      'scene-01',
    );
    responseProgressHinted = submitMysteryResponse(
      RESPONSE_STORAGE_CHAPTER,
      responseProgressHinted,
      'response-01',
      ['time', 'ni'],
      true,
    );

    expect(storage.save(userId, progress)).toBe(true);
    expect(storage.load(userId, chapter)).toEqual(progress);
    expect(storageResponse.save(userId, responseProgressHinted)).toBe(true);
    expect(storageResponse.load(userId, RESPONSE_STORAGE_CHAPTER)).toEqual(responseProgressHinted);
  });

  it('round-trips hintUsed: false on choice and response entries', () => {
    const backend = createFakeBackend();
    const storage = createBrowserMysteryProgressStorage(backend);
    const progress = progressAtScene04();
    const response = responseProgress();

    expect(storage.save(userId, progress)).toBe(true);
    expect(storage.load(userId, chapter)).toEqual(progress);
    expect(storage.save(userId, response)).toBe(true);
    expect(storage.load(userId, RESPONSE_STORAGE_CHAPTER)).toEqual(response);
  });

  it('rejects a persisted hintUsed that is not a boolean and resets the key', () => {
    const backend = createFakeBackend();
    const storage = createBrowserMysteryProgressStorage(backend);
    const base = progressAtScene04();
    backend.set(
      key,
      JSON.stringify({
        ...base,
        history: [
          ...base.history.slice(0, -1),
          {
            kind: 'choice',
            sceneId: 'scene-03',
            selectedOptionId: 'tomorrow-morning',
            hintUsed: 'yes',
          },
        ],
      }),
    );

    expect(storage.load(userId, chapter)).toBeNull();
    expect(backend.has(key)).toBe(false);
  });
});

describe('mysteryProgressStorageKey', () => {
  it('namespaces, encodes, and versions the key', () => {
    expect(mysteryProgressStorageKey('user:a', 'chapter/1')).toBe(
      'vela:mobile:mystery-messenger:user%3Aa:chapter%2F1:v1',
    );
  });
});

describe('createBrowserMysteryProgressStorage', () => {
  it('returns null when nothing is stored', () => {
    const storage = createBrowserMysteryProgressStorage(createFakeBackend());

    expect(storage.load(userId, chapter)).toBeNull();
  });

  it('round-trips a saved progress', () => {
    const backend = createFakeBackend();
    const storage = createBrowserMysteryProgressStorage(backend);
    const progress = progressAtScene04();

    expect(storage.save(userId, progress)).toBe(true);
    expect(storage.load(userId, chapter)).toEqual(progress);
  });

  it('clears stored progress', () => {
    const backend = createFakeBackend();
    const storage = createBrowserMysteryProgressStorage(backend);
    storage.save(userId, progressAtScene04());

    expect(storage.clear(userId, chapterId)).toBe(true);
    expect(backend.has(key)).toBe(false);
    expect(storage.load(userId, chapter)).toBeNull();
  });

  it('deletes and ignores malformed JSON', () => {
    const backend = createFakeBackend();
    const storage = createBrowserMysteryProgressStorage(backend);
    backend.set(key, '{not json');

    expect(storage.load(userId, chapter)).toBeNull();
    expect(backend.has(key)).toBe(false);
  });

  it('discards a snapshot whose chapter id does not match', () => {
    const backend = createFakeBackend();
    const storage = createBrowserMysteryProgressStorage(backend);
    backend.set(key, JSON.stringify({ ...progressAtScene04(), chapterId: 'chapter/0' }));

    expect(storage.load(userId, chapter)).toBeNull();
    expect(backend.has(key)).toBe(false);
  });

  it('discards a snapshot from an older chapter version under the same key', () => {
    const backend = createFakeBackend();
    const storage = createBrowserMysteryProgressStorage(backend);
    backend.set(key, JSON.stringify({ ...progressAtScene04(), chapterVersion: 0 }));

    expect(storage.load(userId, chapter)).toBeNull();
    expect(backend.has(key)).toBe(false);
  });

  it('rejects an unknown current scene', () => {
    const backend = createFakeBackend();
    const storage = createBrowserMysteryProgressStorage(backend);
    backend.set(key, JSON.stringify({ ...progressAtScene04(), currentSceneId: 'scene-x' }));

    expect(storage.load(userId, chapter)).toBeNull();
    expect(backend.has(key)).toBe(false);
  });

  it('rejects an unknown history scene', () => {
    const backend = createFakeBackend();
    const storage = createBrowserMysteryProgressStorage(backend);
    backend.set(
      key,
      JSON.stringify({
        ...progressAtScene04(),
        history: [{ kind: 'message', sceneId: 'scene-x' }],
      }),
    );

    expect(storage.load(userId, chapter)).toBeNull();
    expect(backend.has(key)).toBe(false);
  });

  it('rejects history whose kind does not match the scene', () => {
    const backend = createFakeBackend();
    const storage = createBrowserMysteryProgressStorage(backend);
    backend.set(
      key,
      JSON.stringify({
        ...progressAtScene04(),
        history: [{ kind: 'message', sceneId: 'scene-03' }],
      }),
    );

    expect(storage.load(userId, chapter)).toBeNull();
    expect(backend.has(key)).toBe(false);
  });

  it('rejects a history entry outside the closed message|choice union', () => {
    const backend = createFakeBackend();
    const storage = createBrowserMysteryProgressStorage(backend);
    backend.set(
      key,
      JSON.stringify({
        ...progressAtScene04(),
        history: [{ kind: 'ending', sceneId: 'scene-05' }],
      }),
    );

    expect(storage.load(userId, chapter)).toBeNull();
    expect(backend.has(key)).toBe(false);
  });

  it('rejects an unknown selected option', () => {
    const backend = createFakeBackend();
    const storage = createBrowserMysteryProgressStorage(backend);
    backend.set(
      key,
      JSON.stringify({
        ...progressAtScene04(),
        history: [{ kind: 'choice', sceneId: 'scene-03', selectedOptionId: 'nope' }],
      }),
    );

    expect(storage.load(userId, chapter)).toBeNull();
    expect(backend.has(key)).toBe(false);
  });

  it('rejects a completion flag that contradicts the current scene', () => {
    const backend = createFakeBackend();
    const storage = createBrowserMysteryProgressStorage(backend);

    backend.set(key, JSON.stringify({ ...progressAtScene04(), completed: true }));
    expect(storage.load(userId, chapter)).toBeNull();

    backend.set(key, JSON.stringify({ ...progressAtEnding(), completed: false }));
    expect(storage.load(userId, chapter)).toBeNull();
  });

  it('returns null when the backend throws on read', () => {
    const storage = createBrowserMysteryProgressStorage({
      getItem: () => {
        throw new Error('boom');
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    });

    expect(storage.load(userId, chapter)).toBeNull();
  });

  it('returns false when the backend throws on write', () => {
    const storage = createBrowserMysteryProgressStorage({
      getItem: () => null,
      setItem: () => {
        throw new Error('boom');
      },
      removeItem: () => undefined,
    });

    expect(storage.save(userId, progressAtScene04())).toBe(false);
  });

  it('returns false when the backend throws on clear', () => {
    const storage = createBrowserMysteryProgressStorage({
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => {
        throw new Error('boom');
      },
    });

    expect(storage.clear(userId, chapterId)).toBe(false);
  });

  it('still returns null when deleting invalid data throws', () => {
    const storage = createBrowserMysteryProgressStorage({
      getItem: () => '{bad',
      setItem: () => undefined,
      removeItem: () => {
        throw new Error('boom');
      },
    });

    expect(storage.load(userId, chapter)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { MYSTERY_MESSENGER_VERTICAL_SLICE as chapter } from './content';
import {
  chooseMysteryOption,
  continueMysteryMessage,
  createMysteryProgress,
  type MysteryProgress,
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

function progressAtScene04(): MysteryProgress {
  let progress = createMysteryProgress(chapter);
  progress = continueMysteryMessage(chapter, progress, 'scene-01');
  progress = continueMysteryMessage(chapter, progress, 'scene-02');
  return chooseMysteryOption(chapter, progress, 'scene-03', 'understood');
}

function progressAtEnding(): MysteryProgress {
  return continueMysteryMessage(chapter, progressAtScene04(), 'scene-04');
}

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

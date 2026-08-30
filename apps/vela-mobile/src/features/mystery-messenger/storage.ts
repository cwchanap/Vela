import type { MysteryChapter, MysteryProgress } from './model';

export type MysteryProgressStorage = {
  load(userId: string, chapter: MysteryChapter): MysteryProgress | null;
  save(userId: string, progress: MysteryProgress): boolean;
  clear(userId: string, chapterId: string): boolean;
};

export function mysteryProgressStorageKey(userId: string, chapterId: string): string {
  return `vela:mobile:mystery-messenger:${encodeURIComponent(userId)}:${encodeURIComponent(chapterId)}:v1`;
}

function isKnownProgress(progress: MysteryProgress, chapter: MysteryChapter): boolean {
  if (typeof progress !== 'object' || progress === null || !Array.isArray(progress.history)) {
    return false;
  }
  if (progress.chapterId !== chapter.id || progress.chapterVersion !== chapter.version) {
    return false;
  }
  const scenes = new Map(chapter.scenes.map((scene) => [scene.id, scene]));
  const current = scenes.get(progress.currentSceneId);
  if (!current) return false;

  for (const entry of progress.history) {
    // history is a closed message|choice union; an ending scene is only ever
    // represented by currentSceneId + completed and never lands in history
    if (entry?.kind !== 'message' && entry?.kind !== 'choice') return false;
    const scene = scenes.get(entry.sceneId);
    if (!scene || scene.kind !== entry.kind) return false;
    if (scene.kind === 'choice') {
      if (!scene.options.some((option) => option.id === entry.selectedOptionId)) return false;
    }
  }

  return progress.completed === (current.kind === 'ending');
}

export function createBrowserMysteryProgressStorage(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
): MysteryProgressStorage {
  return {
    load(userId, chapter) {
      const key = mysteryProgressStorageKey(userId, chapter.id);
      try {
        const raw = storage.getItem(key);
        if (raw === null) return null;
        const progress = JSON.parse(raw) as MysteryProgress;
        if (isKnownProgress(progress, chapter)) return progress;
      } catch {
        // fall through to reset
      }
      try {
        storage.removeItem(key);
      } catch {
        // nothing we can do; the stored value is left for the next load attempt
      }
      return null;
    },
    save(userId, progress) {
      try {
        storage.setItem(
          mysteryProgressStorageKey(userId, progress.chapterId),
          JSON.stringify(progress),
        );
        return true;
      } catch {
        return false;
      }
    },
    clear(userId, chapterId) {
      try {
        storage.removeItem(mysteryProgressStorageKey(userId, chapterId));
        return true;
      } catch {
        return false;
      }
    },
  };
}

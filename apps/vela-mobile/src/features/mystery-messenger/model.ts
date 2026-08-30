export type MysteryMessageScene = {
  kind: 'message';
  id: string;
  text: string;
  ttsId: string;
  nextSceneId: string;
};

export type MysteryChoiceOption = {
  id: string;
  label: string;
  feedback: string;
  nextSceneId: string;
};

export type MysteryChoiceScene = {
  kind: 'choice';
  id: string;
  prompt: string;
  ttsId: string;
  options: MysteryChoiceOption[];
};

export type MysteryEndingScene = {
  kind: 'ending';
  id: string;
  text: string;
  ttsId: string;
};

export type MysteryScene = MysteryMessageScene | MysteryChoiceScene | MysteryEndingScene;

export type MysteryChapter = {
  id: string;
  title: string;
  scenes: MysteryScene[];
};

export type MysteryHistoryEntry =
  | { kind: 'message'; sceneId: string }
  | { kind: 'choice'; sceneId: string; selectedOptionId: string };

export type MysteryProgress = {
  currentSceneId: string;
  history: MysteryHistoryEntry[];
  completed: boolean;
};

export type MysteryTranscriptItem =
  | { kind: 'message'; text: string; active: boolean }
  | { kind: 'choice-result'; selectedLabel: string; feedback: string; result: string }
  | { kind: 'choice-prompt'; prompt: string; options: Array<{ id: string; label: string }> }
  | { kind: 'ending'; text: string };

export function getMysteryScene(chapter: MysteryChapter, sceneId: string): MysteryScene {
  const scene = chapter.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) {
    throw new Error('mystery_scene_not_found');
  }
  return scene;
}

export function createMysteryProgress(chapter: MysteryChapter): MysteryProgress {
  const firstScene = chapter.scenes[0];
  if (!firstScene) {
    throw new Error('mystery_scene_not_found');
  }
  return { currentSceneId: firstScene.id, history: [], completed: false };
}

export function restartMysteryProgress(chapter: MysteryChapter): MysteryProgress {
  return createMysteryProgress(chapter);
}

export function continueMysteryMessage(
  chapter: MysteryChapter,
  progress: MysteryProgress,
  expectedSceneId: string,
): MysteryProgress {
  if (progress.currentSceneId !== expectedSceneId) return progress;

  const scene = getMysteryScene(chapter, progress.currentSceneId);
  if (scene.kind !== 'message') {
    throw new Error('mystery_invalid_transition');
  }
  const next = getMysteryScene(chapter, scene.nextSceneId);
  return {
    currentSceneId: next.id,
    history: [...progress.history, { kind: 'message', sceneId: scene.id }],
    completed: next.kind === 'ending',
  };
}

export function chooseMysteryOption(
  chapter: MysteryChapter,
  progress: MysteryProgress,
  expectedSceneId: string,
  optionId: string,
): MysteryProgress {
  if (progress.currentSceneId !== expectedSceneId) return progress;

  const scene = getMysteryScene(chapter, progress.currentSceneId);
  if (scene.kind !== 'choice') {
    throw new Error('mystery_invalid_transition');
  }
  const option = scene.options.find((candidate) => candidate.id === optionId);
  if (!option) {
    throw new Error('mystery_option_not_found');
  }
  const next = getMysteryScene(chapter, option.nextSceneId);
  return {
    currentSceneId: next.id,
    history: [
      ...progress.history,
      { kind: 'choice', sceneId: scene.id, selectedOptionId: option.id },
    ],
    completed: next.kind === 'ending',
  };
}

export function selectMysteryTranscript(
  chapter: MysteryChapter,
  progress: MysteryProgress,
): MysteryTranscriptItem[] {
  const items: MysteryTranscriptItem[] = progress.history.map((entry) => {
    switch (entry.kind) {
      case 'message': {
        const scene = getMysteryScene(chapter, entry.sceneId);
        if (scene.kind !== 'message') {
          throw new Error('mystery_invalid_transition');
        }
        return { kind: 'message', text: scene.text, active: false };
      }
      case 'choice': {
        const scene = getMysteryScene(chapter, entry.sceneId);
        if (scene.kind !== 'choice') {
          throw new Error('mystery_invalid_transition');
        }
        const option = scene.options.find((candidate) => candidate.id === entry.selectedOptionId);
        if (!option) {
          throw new Error('mystery_option_not_found');
        }
        return {
          kind: 'choice-result',
          selectedLabel: option.label,
          feedback: option.feedback,
          result: option.nextSceneId,
        };
      }
    }
  });

  const current = getMysteryScene(chapter, progress.currentSceneId);
  if (current.kind === 'message') {
    items.push({ kind: 'message', text: current.text, active: true });
  } else if (current.kind === 'choice') {
    items.push({
      kind: 'choice-prompt',
      prompt: current.prompt,
      options: current.options.map((option) => ({ id: option.id, label: option.label })),
    });
  } else {
    items.push({ kind: 'ending', text: current.text });
  }
  return items;
}

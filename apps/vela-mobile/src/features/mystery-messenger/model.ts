export type MysterySpeaker = 'mina' | 'haru';

export type MysteryMessageScene = {
  kind: 'message';
  id: string;
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
  kind: 'choice';
  id: string;
  speaker: MysterySpeaker;
  prompt: string;
  ttsId: string;
  options: readonly MysteryChoiceOption[];
};

export type MysteryEndingScene = {
  kind: 'ending';
  id: string;
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

export function getMysteryScene(chapter: MysteryChapter, sceneId: string): MysteryScene {
  const scene = chapter.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) {
    throw new Error('mystery_scene_not_found');
  }
  return scene;
}

export function createMysteryProgress(chapter: MysteryChapter): MysteryProgress {
  getMysteryScene(chapter, chapter.startSceneId);
  return {
    chapterId: chapter.id,
    chapterVersion: chapter.version,
    currentSceneId: chapter.startSceneId,
    history: [],
    completed: false,
  };
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
    ...progress,
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
    ...progress,
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
        return {
          kind: 'message',
          sceneId: scene.id,
          speaker: scene.speaker,
          text: scene.text,
          ttsId: scene.ttsId,
          active: false,
        };
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
          sceneId: scene.id,
          speaker: scene.speaker,
          prompt: scene.prompt,
          selectedLabel: option.label,
          feedback: option.feedback,
          result: option.result,
          ttsId: scene.ttsId,
        };
      }
    }
  });

  const current = getMysteryScene(chapter, progress.currentSceneId);
  if (current.kind === 'message') {
    items.push({
      kind: 'message',
      sceneId: current.id,
      speaker: current.speaker,
      text: current.text,
      ttsId: current.ttsId,
      active: true,
    });
  } else if (current.kind === 'choice') {
    items.push({
      kind: 'choice-prompt',
      sceneId: current.id,
      speaker: current.speaker,
      prompt: current.prompt,
      ttsId: current.ttsId,
    });
  } else {
    items.push({
      kind: 'ending',
      sceneId: current.id,
      title: current.title,
      text: current.text,
      ttsId: current.ttsId,
    });
  }
  return items;
}

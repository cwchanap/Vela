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

export type MysteryTargetPhrase = {
  id: string;
  text: string;
  reading: string;
  meaning: string;
};

export type MysteryChoiceAudioPrompt = { ttsId: string; text: string };
export type MysteryResponseToken = { id: string; text: string };
export type MysterySceneAudio = { ttsId: string; text: string };

export type MysteryChoiceScene = {
  kind: 'choice';
  id: string;
  speaker: MysterySpeaker;
  prompt: string;
  audioPrompt?: MysteryChoiceAudioPrompt;
  options: readonly MysteryChoiceOption[];
  hint: string;
  explanation: string;
  targetPhraseIds: readonly string[];
};

export type MysteryResponseBuildScene = {
  kind: 'response-build';
  id: string;
  prompt: string;
  tokens: readonly MysteryResponseToken[];
  correctTokenIds: readonly string[];
  alternateAnswerTokenIds?: readonly (readonly string[])[];
  feedback: { correct: string; incorrect: string };
  hint: string;
  explanation: string;
  targetPhraseIds: readonly string[];
  nextSceneId: string;
};

export type MysteryEndingScene = {
  kind: 'ending';
  id: string;
  title: string;
  text: string;
  ttsId: string;
};

export type MysteryScene =
  | MysteryMessageScene
  | MysteryChoiceScene
  | MysteryEndingScene
  | MysteryResponseBuildScene;

export type MysteryChapter = {
  id: string;
  version: number;
  title: string;
  startSceneId: string;
  scenes: readonly MysteryScene[];
  targetPhrases: readonly MysteryTargetPhrase[];
};

export type MysteryHistoryEntry =
  | { kind: 'message'; sceneId: string }
  | { kind: 'choice'; sceneId: string; selectedOptionId: string }
  | { kind: 'response-build'; sceneId: string; selectedTokenIds: readonly string[] };

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
      audio?: MysterySceneAudio;
      active: boolean;
    }
  | {
      kind: 'choice-result';
      sceneId: string;
      speaker: MysterySpeaker;
      prompt: string;
      selectedLabel: string;
      feedback: string;
      explanation: string;
      result: 'correct' | 'incorrect';
      audio?: MysterySceneAudio;
    }
  | {
      kind: 'choice-prompt';
      sceneId: string;
      speaker: MysterySpeaker;
      prompt: string;
      audio?: MysterySceneAudio;
    }
  | {
      kind: 'response-prompt';
      sceneId: string;
      prompt: string;
      audio?: MysterySceneAudio;
    }
  | {
      kind: 'response-result';
      sceneId: string;
      prompt: string;
      selectedText: string;
      correctText: string;
      feedback: string;
      explanation: string;
      result: 'correct' | 'incorrect';
      audio?: MysterySceneAudio;
    }
  | {
      kind: 'ending';
      sceneId: string;
      title: string;
      text: string;
      audio?: MysterySceneAudio;
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

export function submitMysteryResponse(
  chapter: MysteryChapter,
  progress: MysteryProgress,
  expectedSceneId: string,
  selectedTokenIds: readonly string[],
): MysteryProgress {
  if (progress.currentSceneId !== expectedSceneId) return progress;

  const scene = getMysteryScene(chapter, progress.currentSceneId);
  if (scene.kind !== 'response-build') {
    throw new Error('mystery_invalid_transition');
  }
  const seen = new Set<string>();
  for (const tokenId of selectedTokenIds) {
    if (!scene.tokens.some((token) => token.id === tokenId)) {
      throw new Error('mystery_response_token_not_found');
    }
    if (seen.has(tokenId)) {
      throw new Error('mystery_duplicate_response_token');
    }
    seen.add(tokenId);
  }
  const next = getMysteryScene(chapter, scene.nextSceneId);
  return {
    ...progress,
    currentSceneId: next.id,
    history: [
      ...progress.history,
      { kind: 'response-build', sceneId: scene.id, selectedTokenIds: [...selectedTokenIds] },
    ],
    completed: next.kind === 'ending',
  };
}

export function selectMysterySceneAudio(scene: MysteryScene): MysterySceneAudio | null {
  switch (scene.kind) {
    case 'message':
    case 'ending':
      return { ttsId: scene.ttsId, text: scene.text };
    case 'choice':
      return scene.audioPrompt ?? null;
    case 'response-build':
      return null;
  }
}

function audioOf(scene: MysteryScene): { audio?: MysterySceneAudio } {
  const audio = selectMysterySceneAudio(scene);
  return audio ? { audio } : {};
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
          ...audioOf(scene),
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
          explanation: scene.explanation,
          result: option.result,
          ...audioOf(scene),
        };
      }
      case 'response-build': {
        const scene = getMysteryScene(chapter, entry.sceneId);
        if (scene.kind !== 'response-build') {
          throw new Error('mystery_invalid_transition');
        }
        const textById = new Map(scene.tokens.map((token) => [token.id, token.text] as const));
        const visibleText = (tokenIds: readonly string[]): string =>
          tokenIds
            .map((tokenId) => {
              const tokenText = textById.get(tokenId);
              if (tokenText === undefined) {
                throw new Error('mystery_response_token_not_found');
              }
              return tokenText;
            })
            .join('');
        const selectedText = visibleText(entry.selectedTokenIds);
        const correctText = visibleText(scene.correctTokenIds);
        const result =
          selectedText === correctText ||
          (scene.alternateAnswerTokenIds ?? []).some((ids) => visibleText(ids) === selectedText)
            ? ('correct' as const)
            : ('incorrect' as const);
        return {
          kind: 'response-result',
          sceneId: scene.id,
          prompt: scene.prompt,
          selectedText,
          correctText,
          feedback: scene.feedback[result],
          explanation: scene.explanation,
          result,
        };
      }
    }
  });

  const current = getMysteryScene(chapter, progress.currentSceneId);
  switch (current.kind) {
    case 'message':
      items.push({
        kind: 'message',
        sceneId: current.id,
        speaker: current.speaker,
        text: current.text,
        ...audioOf(current),
        active: true,
      });
      break;
    case 'choice':
      items.push({
        kind: 'choice-prompt',
        sceneId: current.id,
        speaker: current.speaker,
        prompt: current.prompt,
        ...audioOf(current),
      });
      break;
    case 'response-build':
      items.push({
        kind: 'response-prompt',
        sceneId: current.id,
        prompt: current.prompt,
      });
      break;
    case 'ending':
      items.push({
        kind: 'ending',
        sceneId: current.id,
        title: current.title,
        text: current.text,
        ...audioOf(current),
      });
      break;
  }
  return items;
}

import { describe, expect, it } from 'vitest';
import { MYSTERY_MESSENGER_VERTICAL_SLICE as chapter } from './content';
import {
  chooseMysteryOption,
  continueMysteryMessage,
  createMysteryProgress,
  getMysteryScene,
  restartMysteryProgress,
  selectMysterySceneAudio,
  selectMysteryTranscript,
  submitMysteryResponse,
  type MysteryChapter,
  type MysteryChoiceScene,
  type MysteryProgress,
  type MysteryResponseBuildScene,
} from './model';

function progressAtScene03() {
  let progress = createMysteryProgress(chapter);
  progress = continueMysteryMessage(chapter, progress, 'scene-01');
  progress = continueMysteryMessage(chapter, progress, 'scene-02');
  return progress;
}

describe('mystery messenger model', () => {
  it('starts at startSceneId with chapter identity and empty history', () => {
    expect(createMysteryProgress(chapter)).toEqual({
      chapterId: 'mystery-message-tomorrow-v1',
      chapterVersion: 1,
      currentSceneId: 'scene-01',
      history: [],
      completed: false,
    });
  });

  it('throws for a missing start scene', () => {
    expect(() => createMysteryProgress({ ...chapter, startSceneId: 'scene-99' })).toThrow(
      'mystery_scene_not_found',
    );
  });

  it('continues a message scene and appends a closed history entry', () => {
    const start = createMysteryProgress(chapter);
    const next = continueMysteryMessage(chapter, start, 'scene-01');

    expect(next.history).toEqual([{ kind: 'message', sceneId: 'scene-01' }]);
    expect(next.chapterId).toBe('mystery-message-tomorrow-v1');
    expect(next.chapterVersion).toBe(1);
  });

  it('returns the same progress for a stale originating scene', () => {
    const start = createMysteryProgress(chapter);
    const next = continueMysteryMessage(chapter, start, 'scene-01');

    expect(continueMysteryMessage(chapter, next, 'scene-01')).toBe(next);
    expect(chooseMysteryOption(chapter, next, 'scene-01', 'understood')).toBe(next);
  });

  it('stores a closed choice history entry', () => {
    let progress = createMysteryProgress(chapter);
    progress = continueMysteryMessage(chapter, progress, 'scene-01');
    progress = continueMysteryMessage(chapter, progress, 'scene-02');
    progress = chooseMysteryOption(chapter, progress, 'scene-03', 'understood');

    expect(progress.history.at(-1)).toEqual({
      kind: 'choice',
      sceneId: 'scene-03',
      selectedOptionId: 'understood',
    });
  });

  it('rejects continuing a message on the current choice scene', () => {
    const progress = progressAtScene03();

    expect(() => continueMysteryMessage(chapter, progress, 'scene-03')).toThrow(
      'mystery_invalid_transition',
    );
  });

  it('rejects choosing an option on the current message scene', () => {
    const start = createMysteryProgress(chapter);

    expect(() => chooseMysteryOption(chapter, start, 'scene-01', 'understood')).toThrow(
      'mystery_invalid_transition',
    );
  });

  it('rejects a transition on the completed ending', () => {
    let progress = progressAtScene03();
    progress = chooseMysteryOption(chapter, progress, 'scene-03', 'understood');
    progress = continueMysteryMessage(chapter, progress, 'scene-04');

    expect(() => continueMysteryMessage(chapter, progress, 'scene-05')).toThrow(
      'mystery_invalid_transition',
    );
  });

  it('rejects an unknown current option', () => {
    const progress = progressAtScene03();

    expect(() => chooseMysteryOption(chapter, progress, 'scene-03', 'no-such-option')).toThrow(
      'mystery_option_not_found',
    );
  });

  it('completes at the ending without appending it to history', () => {
    let progress = progressAtScene03();
    progress = chooseMysteryOption(chapter, progress, 'scene-03', 'understood');
    progress = continueMysteryMessage(chapter, progress, 'scene-04');

    expect(progress).toEqual({
      chapterId: 'mystery-message-tomorrow-v1',
      chapterVersion: 1,
      currentSceneId: 'scene-05',
      history: [
        { kind: 'message', sceneId: 'scene-01' },
        { kind: 'message', sceneId: 'scene-02' },
        { kind: 'choice', sceneId: 'scene-03', selectedOptionId: 'understood' },
        { kind: 'message', sceneId: 'scene-04' },
      ],
      completed: true,
    });
  });

  it('restarts from the first scene', () => {
    let progress = progressAtScene03();
    progress = chooseMysteryOption(chapter, progress, 'scene-03', 'hesitant');
    progress = continueMysteryMessage(chapter, progress, 'scene-04');

    const restarted = restartMysteryProgress(chapter);

    expect(restarted).not.toBe(progress);
    expect(restarted).toEqual(createMysteryProgress(chapter));
  });

  it('throws for an unknown scene id', () => {
    expect(() => getMysteryScene(chapter, 'scene-99')).toThrow('mystery_scene_not_found');
  });
});

const responseScene: MysteryResponseBuildScene = {
  kind: 'response-build',
  id: 'response-01',
  prompt: '返事を作ってください。',
  tokens: [
    { id: 'time', text: '7時' },
    { id: 'ni-time', text: 'に' },
    { id: 'train', text: '電車' },
    { id: 'de', text: 'で' },
    { id: 'station', text: '駅' },
    { id: 'ni-place', text: 'に' },
    { id: 'go', text: '行きます' },
    { id: 'period', text: '。' },
  ],
  correctTokenIds: ['time', 'ni-time', 'train', 'de', 'station', 'ni-place', 'go', 'period'],
  alternateAnswerTokenIds: [
    ['train', 'de', 'time', 'ni-time', 'station', 'ni-place', 'go', 'period'],
  ],
  feedback: { correct: '正しいです。', incorrect: '自然な語順の例も確認しましょう。' },
  hint: '時間と行き先の「に」を見てください。',
  explanation: '時間と行き先に「に」を使います。',
  targetPhraseIds: [],
  nextSceneId: 'ending',
};

const RESPONSE_CHAPTER: MysteryChapter = {
  id: 'mystery-response-test-v1',
  version: 1,
  title: '返事の練習',
  startSceneId: 'response-01',
  targetPhrases: [],
  scenes: [
    responseScene,
    {
      kind: 'ending',
      id: 'ending',
      title: '終電の約束',
      text: '7時の電車に間に合いました。',
      ttsId: 'mystery-response-test-v1-ending',
    },
  ],
};

const CANONICAL = responseScene.correctTokenIds;
const ALTERNATE = responseScene.alternateAnswerTokenIds![0]!;

function submitResponse(
  tokenIds: readonly string[],
  progress: MysteryProgress = createMysteryProgress(RESPONSE_CHAPTER),
): MysteryProgress {
  return submitMysteryResponse(RESPONSE_CHAPTER, progress, 'response-01', tokenIds);
}

function responseResultOf(progress: MysteryProgress) {
  const item = selectMysteryTranscript(RESPONSE_CHAPTER, progress).find(
    (candidate) => candidate.kind === 'response-result',
  );
  if (item?.kind !== 'response-result') throw new Error('missing response-result transcript item');
  return item;
}

describe('submitMysteryResponse', () => {
  it('accepts the canonical token order and completes at the ending', () => {
    const progress = submitResponse(CANONICAL);

    expect(progress.currentSceneId).toBe('ending');
    expect(progress.completed).toBe(true);
    expect(progress.history.at(-1)).toEqual({
      kind: 'response-build',
      sceneId: 'response-01',
      selectedTokenIds: [...CANONICAL],
    });
  });

  it('accepts an authored alternate token order as correct', () => {
    const progress = submitResponse(ALTERNATE);

    expect(progress.currentSceneId).toBe('ending');
    expect(responseResultOf(progress).result).toBe('correct');
  });

  it('advances but marks an unauthored wrong order incorrect', () => {
    const progress = submitResponse([
      'go',
      'period',
      'station',
      'ni-place',
      'train',
      'de',
      'time',
      'ni-time',
    ]);

    expect(progress.currentSceneId).toBe('ending');
    const item = responseResultOf(progress);
    expect(item.result).toBe('incorrect');
    expect(item.feedback).toBe('自然な語順の例も確認しましょう。');
    expect(item.selectedText).toBe('行きます。駅に電車で7時に');
  });

  it('advances but marks an incomplete submission incorrect', () => {
    const progress = submitResponse(CANONICAL.slice(0, 5));

    expect(progress.currentSceneId).toBe('ending');
    expect(responseResultOf(progress).result).toBe('incorrect');
  });

  it('returns the same progress for a stale originating scene', () => {
    const progress = submitResponse(CANONICAL);

    expect(submitResponse(CANONICAL, progress)).toBe(progress);
  });

  it('rejects an unknown selected token id', () => {
    expect(() => submitResponse([...CANONICAL, 'ghost-token'])).toThrow(
      'mystery_response_token_not_found',
    );
  });

  it('rejects a duplicate selected token identity', () => {
    expect(() => submitResponse([...CANONICAL, 'ni-time'])).toThrow(
      'mystery_duplicate_response_token',
    );
  });

  it('accepts a swap of the duplicate-visible に particles as correct', () => {
    const swapped = [...CANONICAL];
    [swapped[1], swapped[5]] = [swapped[5]!, swapped[1]!];

    expect(responseResultOf(submitResponse(swapped)).result).toBe('correct');
  });

  it('marks a submission without the punctuation token incorrect', () => {
    expect(responseResultOf(submitResponse(CANONICAL.slice(0, -1))).result).toBe('incorrect');
  });

  it('reports the canonical correctText even when an alternate was accepted', () => {
    const item = responseResultOf(submitResponse(ALTERNATE));

    expect(item.result).toBe('correct');
    expect(item.selectedText).toBe('電車で7時に駅に行きます。');
    expect(item.correctText).toBe('7時に電車で駅に行きます。');
  });

  it('rejects submitting a response on a non-response scene', () => {
    const start = createMysteryProgress(chapter);

    expect(() => submitMysteryResponse(chapter, start, 'scene-01', CANONICAL)).toThrow(
      'mystery_invalid_transition',
    );
  });
});

describe('selectMysterySceneAudio', () => {
  it('pins the message scene audio', () => {
    expect(selectMysterySceneAudio(getMysteryScene(chapter, 'scene-01'))).toEqual({
      ttsId: 'mystery-message-tomorrow-v1-scene-01',
      text: 'こんにちは。これは「あした」からのメッセージです。',
    });
  });

  it('pins the ending scene audio', () => {
    expect(selectMysterySceneAudio(getMysteryScene(chapter, 'scene-05'))).toEqual({
      ttsId: 'mystery-message-tomorrow-v1-scene-05',
      text: '──あした、朝7時。ノートに新しい言葉が現れ、謎の相手との勉強が始まります。',
    });
  });

  it('returns the choice audioPrompt', () => {
    expect(selectMysterySceneAudio(getMysteryScene(chapter, 'scene-03'))).toEqual({
      ttsId: 'mystery-message-tomorrow-v1-scene-03-prompt',
      text: 'どう返事をしますか？',
    });
  });

  it('returns null for a synthetic text-only choice', () => {
    const scene: MysteryChoiceScene = {
      kind: 'choice',
      id: 'choice-silent',
      speaker: 'haru',
      prompt: '選んでください。',
      options: [],
      hint: '',
      explanation: '',
      targetPhraseIds: [],
    };

    expect(selectMysterySceneAudio(scene)).toBeNull();
  });

  it('returns null for a response-build scene', () => {
    expect(selectMysterySceneAudio(responseScene)).toBeNull();
  });
});

describe('selectMysteryTranscript', () => {
  it('renders a completed message as inactive', () => {
    let progress = createMysteryProgress(chapter);
    progress = continueMysteryMessage(chapter, progress, 'scene-01');
    progress = continueMysteryMessage(chapter, progress, 'scene-02');

    expect(selectMysteryTranscript(chapter, progress)[0]).toEqual({
      kind: 'message',
      sceneId: 'scene-01',
      speaker: 'mina',
      text: 'こんにちは。これは「あした」からのメッセージです。',
      audio: {
        ttsId: 'mystery-message-tomorrow-v1-scene-01',
        text: 'こんにちは。これは「あした」からのメッセージです。',
      },
      active: false,
    });
  });

  it('renders a completed choice as a choice result', () => {
    const progress = chooseMysteryOption(chapter, progressAtScene03(), 'scene-03', 'understood');

    expect(selectMysteryTranscript(chapter, progress)[2]).toEqual({
      kind: 'choice-result',
      sceneId: 'scene-03',
      speaker: 'mina',
      prompt: 'どう返事をしますか？',
      selectedLabel: 'わかりました',
      feedback: '「わかりました」という短い返事が送られました。',
      explanation: '「わかりました」は自然で丁寧な短い返事です。',
      result: 'correct',
      audio: {
        ttsId: 'mystery-message-tomorrow-v1-scene-03-prompt',
        text: 'どう返事をしますか？',
      },
    });
  });

  it('sources an incorrect result from the chosen option', () => {
    const progress = chooseMysteryOption(chapter, progressAtScene03(), 'scene-03', 'hesitant');

    expect(selectMysteryTranscript(chapter, progress)[2]).toMatchObject({
      kind: 'choice-result',
      selectedLabel: '少し待って…',
      result: 'incorrect',
    });
  });

  it('renders the active message as active', () => {
    let progress = createMysteryProgress(chapter);
    progress = continueMysteryMessage(chapter, progress, 'scene-01');

    expect(selectMysteryTranscript(chapter, progress).at(-1)).toEqual({
      kind: 'message',
      sceneId: 'scene-02',
      speaker: 'mina',
      text: 'あしたの朝7時、あなたはまだ知らない言葉と出会います。遅れないで来てください。',
      audio: {
        ttsId: 'mystery-message-tomorrow-v1-scene-02',
        text: 'あしたの朝7時、あなたはまだ知らない言葉と出会います。遅れないで来てください。',
      },
      active: true,
    });
  });

  it('renders the active choice as a choice prompt', () => {
    const progress = progressAtScene03();

    expect(selectMysteryTranscript(chapter, progress).at(-1)).toEqual({
      kind: 'choice-prompt',
      sceneId: 'scene-03',
      speaker: 'mina',
      prompt: 'どう返事をしますか？',
      audio: {
        ttsId: 'mystery-message-tomorrow-v1-scene-03-prompt',
        text: 'どう返事をしますか？',
      },
    });
  });

  it('renders the active response-build scene as a response prompt', () => {
    const progress = createMysteryProgress(RESPONSE_CHAPTER);

    expect(selectMysteryTranscript(RESPONSE_CHAPTER, progress)).toEqual([
      { kind: 'response-prompt', sceneId: 'response-01', prompt: '返事を作ってください。' },
    ]);
  });

  it('renders the ending scene once completed', () => {
    let progress = progressAtScene03();
    progress = chooseMysteryOption(chapter, progress, 'scene-03', 'hesitant');
    progress = continueMysteryMessage(chapter, progress, 'scene-04');

    expect(selectMysteryTranscript(chapter, progress).at(-1)).toEqual({
      kind: 'ending',
      sceneId: 'scene-05',
      title: 'あしたの約束',
      text: '──あした、朝7時。ノートに新しい言葉が現れ、謎の相手との勉強が始まります。',
      audio: {
        ttsId: 'mystery-message-tomorrow-v1-scene-05',
        text: '──あした、朝7時。ノートに新しい言葉が現れ、謎の相手との勉強が始まります。',
      },
    });
  });

  it('appends the current scene exactly once after the completed history', () => {
    let progress = progressAtScene03();
    progress = chooseMysteryOption(chapter, progress, 'scene-03', 'understood');
    progress = continueMysteryMessage(chapter, progress, 'scene-04');

    expect(selectMysteryTranscript(chapter, progress)).toHaveLength(progress.history.length + 1);
  });
});

describe('MYSTERY_MESSENGER_VERTICAL_SLICE', () => {
  it('pins the chapter version and start scene', () => {
    expect(chapter.version).toBe(1);
    expect(chapter.startSceneId).toBe('scene-01');
  });

  it('authors exactly five scenes in the linear topology', () => {
    expect(chapter.scenes.map((scene) => scene.id)).toEqual([
      'scene-01',
      'scene-02',
      'scene-03',
      'scene-04',
      'scene-05',
    ]);
  });

  it('pins the scene audio ids', () => {
    expect(chapter.scenes.map((scene) => selectMysterySceneAudio(scene)?.ttsId ?? null)).toEqual([
      'mystery-message-tomorrow-v1-scene-01',
      'mystery-message-tomorrow-v1-scene-02',
      'mystery-message-tomorrow-v1-scene-03-prompt',
      'mystery-message-tomorrow-v1-scene-04',
      'mystery-message-tomorrow-v1-scene-05',
    ]);
  });

  it('converges both scene-03 options onto scene-04', () => {
    const choice = chapter.scenes.find((scene) => scene.id === 'scene-03');
    expect(choice?.kind).toBe('choice');
    if (choice?.kind === 'choice') {
      expect(new Set(choice.options.map((option) => option.nextSceneId))).toEqual(
        new Set(['scene-04']),
      );
    }
  });

  it('ends at the single ending scene', () => {
    expect(chapter.scenes.filter((scene) => scene.kind === 'ending')).toEqual([
      expect.objectContaining({ id: 'scene-05', kind: 'ending' }),
    ]);
  });
});

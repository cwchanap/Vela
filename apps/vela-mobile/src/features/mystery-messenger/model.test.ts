import { describe, expect, it } from 'vitest';
import { MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER as chapter } from './content';
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
  type MysteryScene,
  type MysteryTargetPhrase,
} from './model';
import { validateMysteryChapter } from './validate-content';

function target(id: string): MysteryTargetPhrase {
  const phrase = chapter.targetPhrases.find((candidate) => candidate.id === id);
  if (!phrase) throw new Error(`missing target phrase ${id}`);
  return phrase;
}

function scene(id: string): MysteryScene {
  const authoredScene = chapter.scenes.find((candidate) => candidate.id === id);
  if (!authoredScene) throw new Error(`missing authored scene ${id}`);
  return authoredScene;
}

function responseSceneOf(id: string): MysteryResponseBuildScene {
  const authoredScene = scene(id);
  if (authoredScene.kind !== 'response-build') throw new Error(`expected response scene ${id}`);
  return authoredScene;
}

function progressAtScene03(): MysteryProgress {
  let progress = createMysteryProgress(chapter);
  progress = continueMysteryMessage(chapter, progress, 'scene-01');
  progress = continueMysteryMessage(chapter, progress, 'scene-02');
  return progress;
}

function progressAtScene07(): MysteryProgress {
  let progress = progressAtScene03();
  progress = chooseMysteryOption(chapter, progress, 'scene-03', 'tomorrow-morning');
  progress = continueMysteryMessage(chapter, progress, 'scene-04');
  progress = chooseMysteryOption(chapter, progress, 'scene-05', 'minas-notebook');
  progress = continueMysteryMessage(chapter, progress, 'scene-06');
  return progress;
}

function progressAtScene11(): MysteryProgress {
  let progress = progressAtScene07();
  progress = submitMysteryResponse(
    chapter,
    progress,
    'scene-07',
    responseSceneOf('scene-07').correctTokenIds,
  );
  progress = continueMysteryMessage(chapter, progress, 'scene-08');
  progress = chooseMysteryOption(chapter, progress, 'scene-09', 'ask-when-tomorrow');
  progress = continueMysteryMessage(chapter, progress, 'scene-10');
  return progress;
}

function progressAtEnding(): MysteryProgress {
  let progress = progressAtScene11();
  progress = submitMysteryResponse(
    chapter,
    progress,
    'scene-11',
    responseSceneOf('scene-11').correctTokenIds,
  );
  progress = continueMysteryMessage(chapter, progress, 'scene-12');
  return progress;
}

describe('mystery messenger model', () => {
  it('starts at startSceneId with chapter identity and empty history', () => {
    expect(createMysteryProgress(chapter)).toEqual({
      chapterId: 'mystery-message-tomorrow-v1',
      chapterVersion: 2,
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
    expect(next.chapterVersion).toBe(2);
  });

  it('returns the same progress for a stale originating scene', () => {
    const start = createMysteryProgress(chapter);
    const next = continueMysteryMessage(chapter, start, 'scene-01');

    expect(continueMysteryMessage(chapter, next, 'scene-01')).toBe(next);
    expect(chooseMysteryOption(chapter, next, 'scene-01', 'tomorrow-morning')).toBe(next);
  });

  it('stores a closed choice history entry', () => {
    let progress = progressAtScene03();
    progress = chooseMysteryOption(chapter, progress, 'scene-03', 'tomorrow-morning');

    expect(progress.history.at(-1)).toEqual({
      kind: 'choice',
      sceneId: 'scene-03',
      selectedOptionId: 'tomorrow-morning',
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

    expect(() => chooseMysteryOption(chapter, start, 'scene-01', 'tomorrow-morning')).toThrow(
      'mystery_invalid_transition',
    );
  });

  it('rejects a transition on the completed ending', () => {
    const progress = progressAtEnding();

    expect(() => continueMysteryMessage(chapter, progress, 'scene-13')).toThrow(
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
    const progress = progressAtEnding();

    expect(progress).toEqual({
      chapterId: 'mystery-message-tomorrow-v1',
      chapterVersion: 2,
      currentSceneId: 'scene-13',
      history: [
        { kind: 'message', sceneId: 'scene-01' },
        { kind: 'message', sceneId: 'scene-02' },
        { kind: 'choice', sceneId: 'scene-03', selectedOptionId: 'tomorrow-morning' },
        { kind: 'message', sceneId: 'scene-04' },
        { kind: 'choice', sceneId: 'scene-05', selectedOptionId: 'minas-notebook' },
        { kind: 'message', sceneId: 'scene-06' },
        {
          kind: 'response-build',
          sceneId: 'scene-07',
          selectedTokenIds: responseSceneOf('scene-07').correctTokenIds,
        },
        { kind: 'message', sceneId: 'scene-08' },
        { kind: 'choice', sceneId: 'scene-09', selectedOptionId: 'ask-when-tomorrow' },
        { kind: 'message', sceneId: 'scene-10' },
        {
          kind: 'response-build',
          sceneId: 'scene-11',
          selectedTokenIds: responseSceneOf('scene-11').correctTokenIds,
        },
        { kind: 'message', sceneId: 'scene-12' },
      ],
      completed: true,
    });
  });

  it('restarts from the first scene', () => {
    let progress = progressAtScene03();
    progress = chooseMysteryOption(chapter, progress, 'scene-03', 'today-morning');
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
      ttsId: 'mystery-message-tomorrow-v2-scene-01',
      text: 'こんにちは。これは「あした」からのメッセージです。',
    });
  });

  it('pins the ending scene audio', () => {
    expect(selectMysterySceneAudio(getMysteryScene(chapter, 'scene-13'))).toEqual({
      ttsId: 'mystery-message-tomorrow-v2-scene-13',
      text: '未来からのメッセージではありませんでした。きのう書いた「あした」のメッセージが、今日届いただけでした。青いノートもミナさんのものだと分かり、謎は解けました。',
    });
  });

  it('returns the choice audioPrompt', () => {
    expect(selectMysterySceneAudio(getMysteryScene(chapter, 'scene-03'))).toEqual({
      ttsId: 'mystery-message-tomorrow-v2-scene-03-prompt',
      text: 'ミナさんは、いつ駅に来てほしいですか？',
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
        ttsId: 'mystery-message-tomorrow-v2-scene-01',
        text: 'こんにちは。これは「あした」からのメッセージです。',
      },
      active: false,
    });
  });

  it('renders a completed choice as a choice result', () => {
    const progress = chooseMysteryOption(
      chapter,
      progressAtScene03(),
      'scene-03',
      'tomorrow-morning',
    );

    expect(selectMysteryTranscript(chapter, progress)[2]).toEqual({
      kind: 'choice-result',
      sceneId: 'scene-03',
      speaker: 'mina',
      prompt: 'ミナさんは、いつ駅に来てほしいですか？',
      selectedLabel: 'あしたの朝7時',
      feedback: '「あしたの朝7時」と答えました。',
      explanation: '「あしたの朝7時」は、今日の次の日の朝7時です。',
      result: 'correct',
      audio: {
        ttsId: 'mystery-message-tomorrow-v2-scene-03-prompt',
        text: 'ミナさんは、いつ駅に来てほしいですか？',
      },
    });
  });

  it('sources an incorrect result from the chosen option', () => {
    const progress = chooseMysteryOption(chapter, progressAtScene03(), 'scene-03', 'today-morning');

    expect(selectMysteryTranscript(chapter, progress)[2]).toMatchObject({
      kind: 'choice-result',
      selectedLabel: 'きょうの朝7時',
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
      text: 'あしたの朝7時、電車でさくら駅に来てください。青いノートを持ってきてください。',
      audio: {
        ttsId: 'mystery-message-tomorrow-v2-scene-02',
        text: 'あしたの朝7時、電車でさくら駅に来てください。青いノートを持ってきてください。',
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
      prompt: 'ミナさんは、いつ駅に来てほしいですか？',
      audio: {
        ttsId: 'mystery-message-tomorrow-v2-scene-03-prompt',
        text: 'ミナさんは、いつ駅に来てほしいですか？',
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
    const progress = progressAtEnding();

    expect(selectMysteryTranscript(chapter, progress).at(-1)).toEqual({
      kind: 'ending',
      sceneId: 'scene-13',
      title: '「あした」の正体',
      text: '未来からのメッセージではありませんでした。きのう書いた「あした」のメッセージが、今日届いただけでした。青いノートもミナさんのものだと分かり、謎は解けました。',
      audio: {
        ttsId: 'mystery-message-tomorrow-v2-scene-13',
        text: '未来からのメッセージではありませんでした。きのう書いた「あした」のメッセージが、今日届いただけでした。青いノートもミナさんのものだと分かり、謎は解けました。',
      },
    });
  });

  it('appends the current scene exactly once after the completed history', () => {
    const progress = progressAtEnding();

    expect(selectMysteryTranscript(chapter, progress)).toHaveLength(progress.history.length + 1);
  });
});

describe('MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER', () => {
  it('pins the chapter identity, version, title, and scene count', () => {
    expect(chapter.id).toBe('mystery-message-tomorrow-v1');
    expect(chapter.version).toBe(2);
    expect(chapter.title).toBe('明日からのメッセージ');
    expect(chapter.startSceneId).toBe('scene-01');
    expect(chapter.scenes).toHaveLength(13);
    expect(chapter.targetPhrases).toHaveLength(6);
    expect(validateMysteryChapter(chapter)).toEqual([]);
  });

  it('pins the frozen assessed target copy', () => {
    expect(target('tomorrow-seven').text).toBe('あしたの朝7時');
    expect(target('mina-possession').reading).toBe('ミナさんのです');
    expect(target('train-station-plan').text).toBe('7時に電車でさくら駅に行きます');
    expect(target('when-is-tomorrow').text).toBe('「あした」はいつですか？');
    expect(target('say-again').text).toBe('もう一度言ってください');
  });

  it('pins the scene-07 token bank, canonical answer, and both frozen alternates', () => {
    expect(responseSceneOf('scene-07').tokens).toEqual([
      { id: 'station', text: 'さくら駅' },
      { id: 'ni-time', text: 'に' },
      { id: 'period', text: '。' },
      { id: 'train', text: '電車' },
      { id: 'go', text: '行きます' },
      { id: 'time', text: '7時' },
      { id: 'de', text: 'で' },
      { id: 'ni-place', text: 'に' },
    ]);
    expect(responseSceneOf('scene-07').correctTokenIds).toEqual([
      'time',
      'ni-time',
      'train',
      'de',
      'station',
      'ni-place',
      'go',
      'period',
    ]);
    expect(responseSceneOf('scene-07').alternateAnswerTokenIds).toEqual([
      ['train', 'de', 'time', 'ni-time', 'station', 'ni-place', 'go', 'period'],
      ['time', 'ni-time', 'station', 'ni-place', 'train', 'de', 'go', 'period'],
    ]);
  });

  it('pins the scene-11 token bank and canonical answer with no alternate', () => {
    expect(responseSceneOf('scene-11').tokens).toEqual([
      { id: 'please', text: 'ください' },
      { id: 'period', text: '。' },
      { id: 'again', text: 'もう一度' },
      { id: 'say', text: '言って' },
    ]);
    expect(responseSceneOf('scene-11').correctTokenIds).toEqual([
      'again',
      'say',
      'please',
      'period',
    ]);
    expect(responseSceneOf('scene-11').alternateAnswerTokenIds).toBeUndefined();
  });

  it('pins the final choice audio', () => {
    const scene03 = scene('scene-03');
    const scene05 = scene('scene-05');
    const scene09 = scene('scene-09');
    if (scene03.kind !== 'choice' || scene05.kind !== 'choice' || scene09.kind !== 'choice') {
      throw new Error('expected choice scenes');
    }
    expect(scene03.audioPrompt).toEqual({
      ttsId: 'mystery-message-tomorrow-v2-scene-03-prompt',
      text: 'ミナさんは、いつ駅に来てほしいですか？',
    });
    expect(scene09.audioPrompt).toEqual({
      ttsId: 'mystery-message-tomorrow-v2-scene-09-prompt',
      text: '今、何を確認するのが一番いいですか？',
    });
    // scene 05 speaks its distinct listening line, never its visible instruction
    expect(scene05.audioPrompt).toEqual({
      ttsId: 'mystery-message-tomorrow-v2-scene-05-audio',
      text: '青いノートはミナさんのです。きのう、駅に忘れました。',
    });
    expect(scene05.audioPrompt?.text).not.toBe(scene05.prompt);
  });

  it('keeps every authored TTS text free of markup', () => {
    for (const authoredScene of chapter.scenes) {
      const audio = selectMysterySceneAudio(authoredScene);
      if (audio) expect(audio.text).not.toMatch(/<[^>]+>/);
    }
  });

  it('pins exactly one ending and both speakers', () => {
    expect(chapter.scenes.filter((authoredScene) => authoredScene.kind === 'ending')).toEqual([
      expect.objectContaining({ id: 'scene-13', kind: 'ending' }),
    ]);
    expect(
      new Set(
        chapter.scenes
          .filter((authoredScene) => authoredScene.kind === 'message')
          .map((authoredScene) => authoredScene.speaker),
      ),
    ).toEqual(new Set(['mina', 'haru']));
  });

  it('converges every choice onto a single next scene', () => {
    for (const authoredScene of chapter.scenes) {
      if (authoredScene.kind === 'choice') {
        expect(new Set(authoredScene.options.map((option) => option.nextSceneId)).size).toBe(1);
      }
    }
  });

  it('walks every scene id exactly once to the single ending', () => {
    const visited: string[] = [];
    let progress = createMysteryProgress(chapter);
    const record = (): void => {
      visited.push(progress.currentSceneId);
    };
    record();
    progress = continueMysteryMessage(chapter, progress, 'scene-01');
    record();
    progress = continueMysteryMessage(chapter, progress, 'scene-02');
    record();
    progress = chooseMysteryOption(chapter, progress, 'scene-03', 'tomorrow-morning');
    record();
    progress = continueMysteryMessage(chapter, progress, 'scene-04');
    record();
    progress = chooseMysteryOption(chapter, progress, 'scene-05', 'minas-notebook');
    record();
    progress = continueMysteryMessage(chapter, progress, 'scene-06');
    record();
    progress = submitMysteryResponse(
      chapter,
      progress,
      'scene-07',
      responseSceneOf('scene-07').correctTokenIds,
    );
    record();
    progress = continueMysteryMessage(chapter, progress, 'scene-08');
    record();
    progress = chooseMysteryOption(chapter, progress, 'scene-09', 'ask-when-tomorrow');
    record();
    progress = continueMysteryMessage(chapter, progress, 'scene-10');
    record();
    progress = submitMysteryResponse(
      chapter,
      progress,
      'scene-11',
      responseSceneOf('scene-11').correctTokenIds,
    );
    record();
    progress = continueMysteryMessage(chapter, progress, 'scene-12');
    record();

    expect(visited).toEqual([
      'scene-01',
      'scene-02',
      'scene-03',
      'scene-04',
      'scene-05',
      'scene-06',
      'scene-07',
      'scene-08',
      'scene-09',
      'scene-10',
      'scene-11',
      'scene-12',
      'scene-13',
    ]);
    expect(progress.completed).toBe(true);
  });
});

describe('real chapter response semantics', () => {
  const SCENE_07 = responseSceneOf('scene-07');
  const SCENE_07_CANONICAL = SCENE_07.correctTokenIds;

  function realChapterResponseResultOf(progress: MysteryProgress) {
    const results = selectMysteryTranscript(chapter, progress).filter(
      (candidate) => candidate.kind === 'response-result',
    );
    const item = results.at(-1);
    if (item?.kind !== 'response-result') throw new Error('missing response-result item');
    return item;
  }

  function submitScene07(tokenIds: readonly string[]): MysteryProgress {
    return submitMysteryResponse(chapter, progressAtScene07(), 'scene-07', tokenIds);
  }

  it('accepts the canonical scene-07 order and reports the canonical correct text', () => {
    const progress = submitScene07(SCENE_07_CANONICAL);
    const item = realChapterResponseResultOf(progress);

    expect(item.result).toBe('correct');
    expect(item.selectedText).toBe('7時に電車でさくら駅に行きます。');
    expect(item.correctText).toBe('7時に電車でさくら駅に行きます。');
    expect(item.feedback).toBe('予定をはっきり伝えられました。');
  });

  it.each(SCENE_07.alternateAnswerTokenIds ?? [])(
    'accepts the reviewer-approved alternate %# as correct',
    (...alternateIds: string[]) => {
      const item = realChapterResponseResultOf(submitScene07(alternateIds));

      expect(item.result).toBe('correct');
      expect(item.correctText).toBe('7時に電車でさくら駅に行きます。');
    },
  );

  it('accepts swapped duplicate-visible に identities as correct', () => {
    const swapped = [...SCENE_07_CANONICAL];
    [swapped[1], swapped[5]] = [swapped[5]!, swapped[1]!];

    const item = realChapterResponseResultOf(submitScene07(swapped));

    expect(item.result).toBe('correct');
    expect(item.selectedText).toBe('7時に電車でさくら駅に行きます。');
  });

  it('marks a scene-07 submission without the period token incorrect', () => {
    const item = realChapterResponseResultOf(submitScene07(SCENE_07_CANONICAL.slice(0, -1)));

    expect(item.result).toBe('incorrect');
    expect(item.feedback).toBe('返事を送りました。自然な語順の例も確認しておきましょう。');
  });

  it('accepts the canonical scene-11 order', () => {
    let progress = progressAtScene11();
    progress = submitMysteryResponse(
      chapter,
      progress,
      'scene-11',
      responseSceneOf('scene-11').correctTokenIds,
    );
    const item = realChapterResponseResultOf(progress);

    expect(item.result).toBe('correct');
    expect(item.selectedText).toBe('もう一度言ってください。');
    expect(item.correctText).toBe('もう一度言ってください。');
  });
});

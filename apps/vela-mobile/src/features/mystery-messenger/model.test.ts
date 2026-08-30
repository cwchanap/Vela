import { describe, expect, it } from 'vitest';
import { MYSTERY_MESSENGER_VERTICAL_SLICE as chapter } from './content';
import {
  chooseMysteryOption,
  continueMysteryMessage,
  createMysteryProgress,
  getMysteryScene,
  restartMysteryProgress,
  selectMysteryTranscript,
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
      ttsId: 'mystery-message-tomorrow-v1-scene-01',
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
      result: 'correct',
      ttsId: 'mystery-message-tomorrow-v1-scene-03-prompt',
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
      ttsId: 'mystery-message-tomorrow-v1-scene-02',
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
      ttsId: 'mystery-message-tomorrow-v1-scene-03-prompt',
    });
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
      ttsId: 'mystery-message-tomorrow-v1-scene-05',
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

  it('pins the scene tts ids', () => {
    expect(chapter.scenes.map((scene) => scene.ttsId)).toEqual([
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

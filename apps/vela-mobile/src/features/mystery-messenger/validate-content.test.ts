import { describe, expect, it } from 'vitest';
import { MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER } from './content';
import type { MysteryChapter, MysteryResponseBuildScene } from './model';
import { validateMysteryChapter } from './validate-content';

function cloneChapter(): MysteryChapter {
  return JSON.parse(JSON.stringify(MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER)) as MysteryChapter;
}

function codes(chapter: MysteryChapter): string[] {
  return validateMysteryChapter(chapter).map((issue) => issue.code);
}

function sceneOf(chapter: MysteryChapter, sceneId: string) {
  const scene = chapter.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) throw new Error(`missing fixture scene ${sceneId}`);
  return scene;
}

const RESPONSE_TOKENS = [
  { id: 'time', text: '7時' },
  { id: 'ni', text: 'に' },
  { id: 'train', text: '電車' },
];

/** Real chapter with the scene-04 message swapped for a response-build scene. */
function chapterWithResponseScene(): MysteryChapter {
  const chapter = cloneChapter();
  const responseScene: MysteryResponseBuildScene = {
    kind: 'response-build',
    id: 'scene-04',
    prompt: '返事を作ってください。',
    tokens: RESPONSE_TOKENS,
    correctTokenIds: ['time', 'ni'],
    feedback: { correct: '正しい。', incorrect: '確認しましょう。' },
    hint: 'h',
    explanation: 'e',
    targetPhraseIds: [],
    nextSceneId: 'scene-05',
  };
  chapter.scenes = chapter.scenes.map((scene) => (scene.id === 'scene-04' ? responseScene : scene));
  return chapter;
}

function responseSceneOf(chapter: MysteryChapter): MysteryResponseBuildScene {
  const scene = sceneOf(chapter, 'scene-04');
  if (scene.kind !== 'response-build') throw new Error('expected response-build scene');
  return scene;
}

describe('validateMysteryChapter', () => {
  it('accepts the real chapter', () => {
    expect(validateMysteryChapter(MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER)).toEqual([]);
  });

  it('reports duplicate scene ids', () => {
    const chapter = cloneChapter();
    chapter.scenes = [...chapter.scenes, structuredClone(chapter.scenes[0]!)];

    expect(codes(chapter)).toContain('duplicate_scene_id');
  });

  it('reports a missing start scene', () => {
    const chapter = cloneChapter();
    chapter.scenes = [];

    expect(codes(chapter)).toContain('missing_start_scene');
  });

  it('reports dangling scene references with the offending ids', () => {
    const chapter = cloneChapter();
    const scene01 = sceneOf(chapter, 'scene-01');
    if (scene01.kind !== 'message') throw new Error('expected message scene');
    scene01.nextSceneId = 'scene-missing';

    expect(validateMysteryChapter(chapter)).toContainEqual({
      code: 'dangling_scene_reference',
      sceneId: 'scene-01',
      referenceId: 'scene-missing',
    });
  });

  it('reports a chapter without an ending', () => {
    const chapter = cloneChapter();
    chapter.scenes = chapter.scenes.filter((scene) => scene.id !== 'scene-13');
    const scene12 = sceneOf(chapter, 'scene-12');
    if (scene12.kind !== 'message') throw new Error('expected message scene');
    scene12.nextSceneId = 'scene-12';

    expect(codes(chapter)).toContain('missing_ending');
  });

  it('reports an ending no path reaches', () => {
    const chapter = cloneChapter();
    const scene04 = sceneOf(chapter, 'scene-04');
    if (scene04.kind !== 'message') throw new Error('expected message scene');
    scene04.nextSceneId = 'scene-01';

    expect(codes(chapter)).toEqual(['unreachable_ending']);
  });

  it('reports duplicate choice option ids', () => {
    const chapter = cloneChapter();
    const scene03 = sceneOf(chapter, 'scene-03');
    if (scene03.kind !== 'choice') throw new Error('expected choice scene');
    scene03.options = [
      {
        id: 'understood',
        label: 'わかりました',
        result: 'correct',
        feedback: 'a',
        nextSceneId: 'scene-04',
      },
      {
        id: 'understood',
        label: 'もう一度',
        result: 'incorrect',
        feedback: 'b',
        nextSceneId: 'scene-04',
      },
    ];

    expect(codes(chapter)).toContain('duplicate_choice_id');
  });

  it('reports choice scenes without options', () => {
    const chapter = cloneChapter();
    const scene03 = sceneOf(chapter, 'scene-03');
    if (scene03.kind !== 'choice') throw new Error('expected choice scene');
    scene03.options = [];

    expect(codes(chapter)).toContain('empty_choice_options');
  });

  it('reports choice scenes with a single option', () => {
    const chapter = cloneChapter();
    const scene03 = sceneOf(chapter, 'scene-03');
    if (scene03.kind !== 'choice') throw new Error('expected choice scene');
    scene03.options = [scene03.options[0]!];

    expect(codes(chapter)).toContain('empty_choice_options');
  });

  it('accepts a chapter whose path traverses a response-build scene', () => {
    expect(codes(chapterWithResponseScene())).toEqual([]);
  });

  it('reports a dangling response-build edge', () => {
    const chapter = chapterWithResponseScene();
    responseSceneOf(chapter).nextSceneId = 'scene-missing';

    expect(validateMysteryChapter(chapter)).toContainEqual({
      code: 'dangling_scene_reference',
      sceneId: 'scene-04',
      referenceId: 'scene-missing',
    });
  });

  it('reports an ending no path reaches through a response-build scene', () => {
    const chapter = chapterWithResponseScene();
    responseSceneOf(chapter).nextSceneId = 'scene-01';

    expect(codes(chapter)).toContain('unreachable_ending');
  });

  it('reports duplicate response token ids', () => {
    const chapter = chapterWithResponseScene();
    responseSceneOf(chapter).tokens = [...RESPONSE_TOKENS, { id: 'time', text: '7時' }];

    expect(codes(chapter)).toContain('duplicate_response_token_id');
  });

  it('reports an unknown token in the canonical answer', () => {
    const chapter = chapterWithResponseScene();
    responseSceneOf(chapter).correctTokenIds = ['time', 'nope'];

    expect(codes(chapter)).toContain('invalid_response_answer_token');
  });

  it('reports a repeated token in the canonical answer', () => {
    const chapter = chapterWithResponseScene();
    responseSceneOf(chapter).correctTokenIds = ['time', 'time'];

    expect(codes(chapter)).toContain('invalid_response_answer_token');
  });

  it('reports an unknown token in an alternate answer', () => {
    const chapter = chapterWithResponseScene();
    responseSceneOf(chapter).alternateAnswerTokenIds = [['train', 'nope']];

    expect(codes(chapter)).toContain('invalid_response_answer_token');
  });

  it('reports a repeated token in an alternate answer', () => {
    const chapter = chapterWithResponseScene();
    responseSceneOf(chapter).alternateAnswerTokenIds = [['train', 'train']];

    expect(codes(chapter)).toContain('invalid_response_answer_token');
  });

  it('reports duplicate target phrase ids', () => {
    const chapter = cloneChapter();
    chapter.targetPhrases = [
      { id: 'phrase-1', text: '約束', reading: 'やくそく', meaning: 'promise' },
      { id: 'phrase-1', text: '返事', reading: 'へんじ', meaning: 'reply' },
    ];

    expect(codes(chapter)).toContain('duplicate_target_phrase_id');
  });

  it('reports a choice scene referencing an unknown target phrase', () => {
    const chapter = cloneChapter();
    const scene03 = sceneOf(chapter, 'scene-03');
    if (scene03.kind !== 'choice') throw new Error('expected choice scene');
    scene03.targetPhraseIds = ['nope'];

    expect(validateMysteryChapter(chapter)).toContainEqual({
      code: 'unknown_target_phrase_reference',
      sceneId: 'scene-03',
      referenceId: 'nope',
    });
  });

  it('reports a response-build scene referencing an unknown target phrase', () => {
    const chapter = chapterWithResponseScene();
    responseSceneOf(chapter).targetPhraseIds = ['nope'];

    expect(validateMysteryChapter(chapter)).toContainEqual({
      code: 'unknown_target_phrase_reference',
      sceneId: 'scene-04',
      referenceId: 'nope',
    });
  });

  it('reports multiple endings', () => {
    const chapter = cloneChapter();
    chapter.scenes = [
      ...chapter.scenes,
      { kind: 'ending', id: 'scene-06', title: '二つ目', text: '…', ttsId: 't-scene-06' },
    ];

    expect(codes(chapter)).toContain('multiple_endings');
  });

  it('reports exactly one ending issue when two endings exist', () => {
    const chapter = cloneChapter();
    chapter.scenes = [
      ...chapter.scenes,
      { kind: 'ending', id: 'scene-06', title: '二つ目', text: '…', ttsId: 't-scene-06' },
    ];

    expect(codes(chapter).filter((code) => code === 'multiple_endings')).toHaveLength(1);
    expect(codes(chapter)).not.toContain('missing_ending');
  });
});

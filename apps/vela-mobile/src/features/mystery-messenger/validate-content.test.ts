import { describe, expect, it } from 'vitest';
import { MYSTERY_MESSENGER_VERTICAL_SLICE } from './content';
import type { MysteryChapter } from './model';
import { validateMysteryChapter } from './validate-content';

function cloneChapter(): MysteryChapter {
  return JSON.parse(JSON.stringify(MYSTERY_MESSENGER_VERTICAL_SLICE)) as MysteryChapter;
}

function codes(chapter: MysteryChapter): string[] {
  return validateMysteryChapter(chapter).map((issue) => issue.code);
}

function sceneOf(chapter: MysteryChapter, sceneId: string) {
  const scene = chapter.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) throw new Error(`missing fixture scene ${sceneId}`);
  return scene;
}

describe('validateMysteryChapter', () => {
  it('accepts the real vertical slice', () => {
    expect(validateMysteryChapter(MYSTERY_MESSENGER_VERTICAL_SLICE)).toEqual([]);
  });

  it('reports duplicate scene ids', () => {
    const chapter = cloneChapter();
    chapter.scenes.push(structuredClone(chapter.scenes[0]!));

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
    chapter.scenes = chapter.scenes.filter((scene) => scene.id !== 'scene-05');
    const scene04 = sceneOf(chapter, 'scene-04');
    if (scene04.kind !== 'message') throw new Error('expected message scene');
    scene04.nextSceneId = 'scene-04';

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
      { id: 'understood', label: 'わかりました', feedback: 'a', nextSceneId: 'scene-04' },
      { id: 'understood', label: 'もう一度', feedback: 'b', nextSceneId: 'scene-04' },
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
});

import type { MysteryChapter, MysteryScene } from './model';

export type MysteryContentIssue = {
  code:
    | 'duplicate_scene_id'
    | 'missing_start_scene'
    | 'dangling_scene_reference'
    | 'missing_ending'
    | 'unreachable_ending'
    | 'duplicate_choice_id'
    | 'empty_choice_options';
  sceneId?: string;
  referenceId?: string;
};

export function validateMysteryChapter(chapter: MysteryChapter): MysteryContentIssue[] {
  const issues: MysteryContentIssue[] = [];
  const sceneMap = new Map<string, MysteryScene>();

  for (const scene of chapter.scenes) {
    if (sceneMap.has(scene.id)) {
      issues.push({ code: 'duplicate_scene_id', sceneId: scene.id });
      continue;
    }
    sceneMap.set(scene.id, scene);
  }

  for (const scene of sceneMap.values()) {
    if (scene.kind === 'message') {
      if (!sceneMap.has(scene.nextSceneId)) {
        issues.push({
          code: 'dangling_scene_reference',
          sceneId: scene.id,
          referenceId: scene.nextSceneId,
        });
      }
    } else if (scene.kind === 'choice') {
      if (scene.options.length < 2) {
        issues.push({ code: 'empty_choice_options', sceneId: scene.id });
      }
      const optionIds = new Set<string>();
      for (const option of scene.options) {
        if (optionIds.has(option.id)) {
          issues.push({
            code: 'duplicate_choice_id',
            sceneId: scene.id,
            referenceId: option.id,
          });
        }
        optionIds.add(option.id);
        if (!sceneMap.has(option.nextSceneId)) {
          issues.push({
            code: 'dangling_scene_reference',
            sceneId: scene.id,
            referenceId: option.nextSceneId,
          });
        }
      }
    }
  }

  const endingIds = chapter.scenes
    .filter((scene) => scene.kind === 'ending')
    .map((scene) => scene.id);
  if (endingIds.length === 0) {
    issues.push({ code: 'missing_ending' });
  }

  if (!sceneMap.has(chapter.startSceneId)) {
    issues.push({ code: 'missing_start_scene' });
  } else if (endingIds.length > 0) {
    const visited = new Set<string>();
    const stack = [chapter.startSceneId];
    while (stack.length > 0) {
      const sceneId = stack.pop()!;
      if (visited.has(sceneId)) continue;
      visited.add(sceneId);
      const scene = sceneMap.get(sceneId);
      if (!scene) continue;
      if (scene.kind === 'message') {
        stack.push(scene.nextSceneId);
      } else if (scene.kind === 'choice') {
        for (const option of scene.options) stack.push(option.nextSceneId);
      }
    }
    if (!endingIds.some((endingId) => visited.has(endingId))) {
      issues.push({ code: 'unreachable_ending' });
    }
  }

  return issues;
}

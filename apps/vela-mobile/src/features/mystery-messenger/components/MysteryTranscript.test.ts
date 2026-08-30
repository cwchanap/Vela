import { mount } from '@vue/test-utils';
import { Quasar } from 'quasar';
import { describe, expect, it } from 'vitest';
import type { MysteryTranscriptItem } from '../model';
import MysteryTranscript from './MysteryTranscript.vue';

const ITEMS: readonly MysteryTranscriptItem[] = [
  {
    kind: 'message',
    sceneId: 'scene-01',
    speaker: 'mina',
    text: 'こんにちは。これは「あした」からのメッセージです。',
    ttsId: 'tts-scene-01',
    active: true,
  },
  {
    kind: 'choice-result',
    sceneId: 'scene-03',
    speaker: 'mina',
    prompt: 'どう返事をしますか？',
    selectedLabel: 'わかりました',
    feedback: '「わかりました」という短い返事が送られました。',
    result: 'correct',
    ttsId: 'tts-scene-03',
  },
  {
    kind: 'choice-prompt',
    sceneId: 'scene-04',
    speaker: 'haru',
    prompt: 'どう返事をしますか？',
    ttsId: 'tts-scene-04',
  },
  {
    kind: 'ending',
    sceneId: 'scene-05',
    title: 'あしたの約束',
    text: '──あした、朝7時。ノートに新しい言葉が現れます。',
    ttsId: 'tts-scene-05',
  },
];

function mountTranscript(items: readonly MysteryTranscriptItem[] = ITEMS) {
  return mount(MysteryTranscript, {
    props: { items },
    global: { plugins: [Quasar] },
  });
}

describe('MysteryTranscript', () => {
  it('renders every item kind in order with authored Japanese in lang=ja containers', () => {
    const wrapper = mountTranscript();

    const rendered = wrapper.findAll('[data-testid^="mystery-transcript-"]');
    expect(rendered.map((element) => element.attributes('data-testid'))).toEqual([
      'mystery-transcript-message',
      'mystery-transcript-choice-result',
      'mystery-transcript-choice-prompt',
      'mystery-transcript-ending',
    ]);
    expect(rendered[0]!.text()).toContain('こんにちは。これは「あした」からのメッセージです。');
    expect(rendered[1]!.text()).toContain('「わかりました」という短い返事が送られました。');
    expect(rendered[2]!.text()).toContain('どう返事をしますか？');
    expect(rendered[3]!.text()).toContain('あしたの約束');
    expect(rendered[3]!.text()).toContain('──あした、朝7時。ノートに新しい言葉が現れます。');

    const jaContainers = wrapper.findAll('[lang="ja"]');
    expect(jaContainers).toHaveLength(6);
    for (const container of jaContainers) {
      expect(container.attributes('lang')).toBe('ja');
    }
  });

  it('renders the selected label and feedback for a choice result', () => {
    const wrapper = mountTranscript();

    const feedback = wrapper.get('[data-testid="mystery-choice-feedback-scene-03"]');
    expect(feedback.text()).toContain('わかりました');
    expect(feedback.text()).toContain('「わかりました」という短い返事が送られました。');
  });

  it('emits replay with the scene id for every item', async () => {
    const wrapper = mountTranscript();

    for (const sceneId of ['scene-01', 'scene-03', 'scene-04', 'scene-05']) {
      await wrapper.get(`[data-testid="mystery-replay-${sceneId}"]`).trigger('click');
    }

    expect(wrapper.emitted('replay')).toEqual([
      ['scene-01'],
      ['scene-03'],
      ['scene-04'],
      ['scene-05'],
    ]);
  });
});

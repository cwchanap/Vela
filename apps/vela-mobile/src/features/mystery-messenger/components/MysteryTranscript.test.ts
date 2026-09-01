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
    audio: { ttsId: 'tts-scene-01', text: 'こんにちは。これは「あした」からのメッセージです。' },
    active: true,
  },
  {
    kind: 'choice-result',
    sceneId: 'scene-03',
    speaker: 'mina',
    prompt: 'どう返事をしますか？',
    selectedLabel: 'わかりました',
    feedback: '「わかりました」という短い返事が送られました。',
    explanation: '「わかりました」は自然で丁寧な短い返事です。',
    result: 'correct',
    audio: { ttsId: 'tts-scene-03', text: 'どう返事をしますか？' },
  },
  {
    kind: 'choice-prompt',
    sceneId: 'scene-04',
    speaker: 'haru',
    prompt: 'どう返事をしますか？',
  },
  {
    kind: 'response-prompt',
    sceneId: 'response-02',
    prompt: '返事を作ってください。',
  },
  {
    kind: 'response-result',
    sceneId: 'response-01',
    prompt: '返事を作ってください。',
    selectedText: '7時に電車で駅に行きます。',
    correctText: '7時に電車で駅に行きます。',
    feedback: '正しいです。',
    explanation: '時間と行き先に「に」を使います。',
    result: 'correct',
  },
  {
    kind: 'ending',
    sceneId: 'scene-05',
    title: 'あしたの約束',
    text: '──あした、朝7時。ノートに新しい言葉が現れます。',
    audio: { ttsId: 'tts-scene-05', text: '──あした、朝7時。ノートに新しい言葉が現れます。' },
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
      'mystery-transcript-response-prompt',
      'mystery-transcript-response-result',
      'mystery-transcript-ending',
    ]);
    expect(rendered[0]!.text()).toContain('こんにちは。これは「あした」からのメッセージです。');
    expect(rendered[1]!.text()).toContain('「わかりました」という短い返事が送られました。');
    expect(rendered[2]!.text()).toContain('どう返事をしますか？');
    expect(rendered[3]!.text()).toContain('返事を作ってください。');
    expect(rendered[4]!.text()).toContain('正しいです。');
    expect(rendered[5]!.text()).toContain('あしたの約束');
    expect(rendered[5]!.text()).toContain('──あした、朝7時。ノートに新しい言葉が現れます。');

    const jaContainers = wrapper.findAll('[lang="ja"]');
    expect(jaContainers).toHaveLength(11);
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

  it('renders response-result feedback and explanation', () => {
    const wrapper = mountTranscript();

    const feedback = wrapper.get('[data-testid="mystery-response-feedback-response-01"]');
    expect(feedback.text()).toContain('7時に電車で駅に行きます。');
    expect(feedback.text()).toContain('正しいです。');
    expect(
      wrapper.get('[data-testid="mystery-response-explanation-response-01"]').text(),
    ).toContain('時間と行き先に「に」を使います。');
  });

  it('renders replay buttons only for items with audio', () => {
    const wrapper = mountTranscript();

    const replayButtons = wrapper.findAll('[data-testid^="mystery-replay-"]');
    expect(replayButtons.map((element) => element.attributes('data-testid'))).toEqual([
      'mystery-replay-scene-01',
      'mystery-replay-scene-03',
      'mystery-replay-scene-05',
    ]);
    // no-audio choice, response prompt, and response result never render replay
    expect(wrapper.find('[data-testid="mystery-replay-scene-04"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="mystery-replay-response-01"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="mystery-replay-response-02"]').exists()).toBe(false);
  });

  it('emits replay with the scene id for audio items', async () => {
    const wrapper = mountTranscript();

    for (const sceneId of ['scene-01', 'scene-03', 'scene-05']) {
      await wrapper.get(`[data-testid="mystery-replay-${sceneId}"]`).trigger('click');
    }

    expect(wrapper.emitted('replay')).toEqual([['scene-01'], ['scene-03'], ['scene-05']]);
  });
});

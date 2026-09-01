import { mount } from '@vue/test-utils';
import { Quasar } from 'quasar';
import { describe, expect, it } from 'vitest';
import type { MysteryResponseBuildScene } from '../model';
import MysteryResponseBuildComposer from './MysteryResponseBuildComposer.vue';

const SCENE: MysteryResponseBuildScene = {
  kind: 'response-build',
  id: 'response-01',
  prompt: '返事を作ってください。',
  tokens: [
    { id: 'train', text: '電車' },
    { id: 'ni-time', text: 'に' },
    { id: 'time', text: '7時' },
    { id: 'period', text: '。' },
    { id: 'ni-place', text: 'に' },
  ],
  correctTokenIds: ['time', 'ni-time', 'train', 'ni-place', 'period'],
  feedback: { correct: '正しいです。', incorrect: 'もう一度確認しましょう。' },
  hint: '「7時」のあとに「に」を置きます。',
  explanation: '時間の後ろに「に」を使います。',
  targetPhraseIds: [],
  nextSceneId: 'ending',
};

function mountComposer(disabled = false) {
  return mount(MysteryResponseBuildComposer, {
    props: { scene: SCENE, disabled },
    global: { plugins: [Quasar] },
  });
}

describe('MysteryResponseBuildComposer', () => {
  it('renders every authored token as its own button, including duplicate-visible and punctuation tokens', () => {
    const wrapper = mountComposer();

    expect(wrapper.findAll('[data-testid^="mystery-response-token-"]')).toHaveLength(5);
    expect(wrapper.get('[data-testid="mystery-response-token-train"]').text()).toBe('電車');
    expect(wrapper.get('[data-testid="mystery-response-token-ni-time"]').text()).toBe('に');
    expect(wrapper.get('[data-testid="mystery-response-token-ni-place"]').text()).toBe('に');
    expect(wrapper.get('[data-testid="mystery-response-token-period"]').text()).toBe('。');
  });

  it('adds the exact tapped token id to the selection in authored form', async () => {
    const wrapper = mountComposer();

    await wrapper.get('[data-testid="mystery-response-token-train"]').trigger('click');
    await wrapper.get('[data-testid="mystery-response-token-time"]').trigger('click');

    expect(wrapper.find('[data-testid="mystery-response-token-train"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="mystery-response-selected-train"]').text()).toBe('電車');
    expect(wrapper.get('[data-testid="mystery-response-selected-time"]').text()).toBe('7時');
  });

  it('removes exactly the tapped selected token, keeping the duplicate-visible twin selected', async () => {
    const wrapper = mountComposer();

    await wrapper.get('[data-testid="mystery-response-token-ni-time"]').trigger('click');
    await wrapper.get('[data-testid="mystery-response-token-ni-place"]').trigger('click');
    await wrapper.get('[data-testid="mystery-response-selected-ni-time"]').trigger('click');

    expect(wrapper.find('[data-testid="mystery-response-selected-ni-time"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="mystery-response-selected-ni-place"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="mystery-response-token-ni-time"]').exists()).toBe(true);
  });

  it('keeps punctuation tokens selectable and ordered', async () => {
    const wrapper = mountComposer();

    await wrapper.get('[data-testid="mystery-response-token-time"]').trigger('click');
    await wrapper.get('[data-testid="mystery-response-token-period"]').trigger('click');

    expect(wrapper.get('[data-testid="mystery-response-selected-period"]').text()).toBe('。');
  });

  it('empties the selection on Clear', async () => {
    const wrapper = mountComposer();

    await wrapper.get('[data-testid="mystery-response-token-time"]').trigger('click');
    await wrapper.get('[data-testid="mystery-response-token-period"]').trigger('click');
    await wrapper.get('[data-testid="mystery-response-clear"]').trigger('click');

    expect(wrapper.findAll('[data-testid^="mystery-response-selected-"]')).toHaveLength(0);
    expect(wrapper.findAll('[data-testid^="mystery-response-token-"]')).toHaveLength(5);
  });

  it('toggles the authored hint copy inline', async () => {
    const wrapper = mountComposer();

    expect(wrapper.find('[data-testid="mystery-response-hint-copy"]').exists()).toBe(false);

    await wrapper.get('[data-testid="mystery-response-hint"]').trigger('click');
    expect(wrapper.get('[data-testid="mystery-response-hint-copy"]').text()).toBe(SCENE.hint);

    await wrapper.get('[data-testid="mystery-response-hint"]').trigger('click');
    expect(wrapper.find('[data-testid="mystery-response-hint-copy"]').exists()).toBe(false);
  });

  it('emits submit with the selected ids in selection order', async () => {
    const wrapper = mountComposer();

    await wrapper.get('[data-testid="mystery-response-token-time"]').trigger('click');
    await wrapper.get('[data-testid="mystery-response-token-ni-time"]').trigger('click');
    await wrapper.get('[data-testid="mystery-response-token-train"]').trigger('click');
    await wrapper.get('[data-testid="mystery-response-token-period"]').trigger('click');
    await wrapper.get('[data-testid="mystery-response-send"]').trigger('click');

    expect(wrapper.emitted('submit')).toEqual([[['time', 'ni-time', 'train', 'period']]]);
  });

  it('disables Send while nothing is selected', () => {
    const wrapper = mountComposer();

    const send = wrapper.get('[data-testid="mystery-response-send"]');
    expect(send.attributes('disabled')).toBeDefined();
  });

  it('disables every control and emits nothing when the parent disables transitions', async () => {
    const wrapper = mountComposer(true);

    for (const testId of [
      'mystery-response-token-train',
      'mystery-response-clear',
      'mystery-response-hint',
      'mystery-response-send',
    ]) {
      expect(wrapper.get(`[data-testid="${testId}"]`).attributes('disabled')).toBeDefined();
    }

    await wrapper.get('[data-testid="mystery-response-token-train"]').trigger('click');
    await wrapper.get('[data-testid="mystery-response-hint"]').trigger('click');
    await wrapper.get('[data-testid="mystery-response-send"]').trigger('click');

    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(wrapper.find('[data-testid="mystery-response-hint-copy"]').exists()).toBe(false);
    expect(wrapper.findAll('[data-testid^="mystery-response-selected-"]')).toHaveLength(0);
  });
});

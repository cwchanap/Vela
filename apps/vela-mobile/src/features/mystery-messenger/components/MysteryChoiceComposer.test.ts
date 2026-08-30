import { mount } from '@vue/test-utils';
import { Quasar } from 'quasar';
import { describe, expect, it } from 'vitest';
import { MYSTERY_MESSENGER_VERTICAL_SLICE as chapter } from '../content';
import type { MysteryChoiceScene } from '../model';
import MysteryChoiceComposer from './MysteryChoiceComposer.vue';

const CHOICE_SCENE = chapter.scenes.find((scene) => scene.kind === 'choice') as MysteryChoiceScene;

function mountComposer(disabled: boolean) {
  return mount(MysteryChoiceComposer, {
    props: { scene: CHOICE_SCENE, disabled },
    global: { plugins: [Quasar] },
  });
}

describe('MysteryChoiceComposer', () => {
  it('renders every option label as a button', () => {
    const wrapper = mountComposer(false);

    expect(wrapper.findAll('[data-testid^="mystery-option-"]')).toHaveLength(2);
    expect(wrapper.get('[data-testid="mystery-option-understood"]').text()).toContain(
      'わかりました',
    );
    expect(wrapper.get('[data-testid="mystery-option-hesitant"]').text()).toContain('少し待って…');
  });

  it('emits choose with the option id for an enabled option', async () => {
    const wrapper = mountComposer(false);

    await wrapper.get('[data-testid="mystery-option-understood"]').trigger('click');

    expect(wrapper.emitted('choose')).toEqual([['understood']]);
  });

  it('does not emit for disabled options', async () => {
    const wrapper = mountComposer(true);

    expect(
      wrapper.get('[data-testid="mystery-option-understood"]').attributes('disabled'),
    ).toBeDefined();
    expect(
      wrapper.get('[data-testid="mystery-option-hesitant"]').attributes('disabled'),
    ).toBeDefined();

    await wrapper.get('[data-testid="mystery-option-understood"]').trigger('click');
    await wrapper.get('[data-testid="mystery-option-hesitant"]').trigger('click');

    expect(wrapper.emitted('choose')).toBeUndefined();
  });
});

import { mount } from '@vue/test-utils';
import { Quasar } from 'quasar';
import { describe, expect, it } from 'vitest';
import { MESSAGE_THAT_ARRIVED_TOMORROW_CHAPTER as chapter } from '../content';
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
    expect(wrapper.get('[data-testid="mystery-option-tomorrow-morning"]').text()).toContain(
      'あしたの朝7時',
    );
    expect(wrapper.get('[data-testid="mystery-option-today-morning"]').text()).toContain(
      'きょうの朝7時',
    );
  });

  it('emits choose with the option id for an enabled option', async () => {
    const wrapper = mountComposer(false);

    await wrapper.get('[data-testid="mystery-option-tomorrow-morning"]').trigger('click');

    expect(wrapper.emitted('choose')).toEqual([['tomorrow-morning']]);
  });

  it('does not emit for disabled options', async () => {
    const wrapper = mountComposer(true);

    expect(
      wrapper.get('[data-testid="mystery-option-tomorrow-morning"]').attributes('disabled'),
    ).toBeDefined();
    expect(
      wrapper.get('[data-testid="mystery-option-today-morning"]').attributes('disabled'),
    ).toBeDefined();

    await wrapper.get('[data-testid="mystery-option-tomorrow-morning"]').trigger('click');
    await wrapper.get('[data-testid="mystery-option-today-morning"]').trigger('click');

    expect(wrapper.emitted('choose')).toBeUndefined();
  });

  it('toggles the authored hint copy inline', async () => {
    const wrapper = mountComposer(false);

    expect(wrapper.find('[data-testid="mystery-choice-hint-copy"]').exists()).toBe(false);

    await wrapper.get('[data-testid="mystery-choice-hint"]').trigger('click');
    expect(wrapper.get('[data-testid="mystery-choice-hint-copy"]').text()).toBe(CHOICE_SCENE.hint);

    await wrapper.get('[data-testid="mystery-choice-hint"]').trigger('click');
    expect(wrapper.find('[data-testid="mystery-choice-hint-copy"]').exists()).toBe(false);
  });

  it('does not open the hint for a disabled composer', async () => {
    const wrapper = mountComposer(true);

    expect(wrapper.get('[data-testid="mystery-choice-hint"]').attributes('disabled')).toBeDefined();

    await wrapper.get('[data-testid="mystery-choice-hint"]').trigger('click');

    expect(wrapper.find('[data-testid="mystery-choice-hint-copy"]').exists()).toBe(false);
  });
});

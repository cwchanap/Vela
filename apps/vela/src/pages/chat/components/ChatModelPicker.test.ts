import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { mount, flushPromises, VueWrapper } from '@vue/test-utils';
import { Quasar } from 'quasar';
import ChatModelPicker from './ChatModelPicker.vue';
import { LLM_PROVIDER_REGISTRY } from '@vela/common';
import {
  OPENROUTER_CUSTOM_VALUE,
  buildLlmModelOptions,
  llmPairOption,
  type LlmModelOption,
} from 'src/utils/llmModelOptions';

const stubs = {
  'q-select': {
    template:
      '<select :value="modelValue" :disabled="disable" data-testid-stub @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="o in options" :key="optionValue(o)" :value="optionValue(o)" :disabled="!!(o && o.disabled)">{{ optionLabel(o) }}</option></select>',
    props: ['modelValue', 'options', 'disable'],
    emits: ['update:modelValue'],
    methods: {
      optionValue(o: unknown) {
        return typeof o === 'object' && o !== null ? (o as { value: unknown }).value : o;
      },
      optionLabel(o: unknown) {
        return typeof o === 'object' && o !== null ? (o as { label: unknown }).label : o;
      },
    },
  },
  'q-input': {
    template:
      '<div class="q-input-stub"><input :value="modelValue" :disabled="disable" @input="$emit(\'update:modelValue\', $event.target.value)" /><slot name="append" /></div>',
    props: ['modelValue', 'disable'],
    emits: ['update:modelValue'],
  },
  'q-btn': {
    template: '<button :disabled="disable" @click="$emit(\'click\')"><slot /></button>',
    props: ['disable'],
    emits: ['click'],
  },
};

const GOOGLE_MODELS = LLM_PROVIDER_REGISTRY.google.models ?? [];

const mountPicker = (
  props: Partial<InstanceType<typeof ChatModelPicker>['$props']> & {
    options: LlmModelOption[];
  },
): VueWrapper =>
  mount(ChatModelPicker, {
    props: { pair: null, thinking: null, disabled: false, ...props },
    global: { plugins: [Quasar], stubs },
  });

describe('ChatModelPicker', () => {
  describe('model options', () => {
    it('renders one option per available model option', () => {
      const options = buildLlmModelOptions({ google: 'key', openai: 'key' });
      const wrapper = mountPicker({ options });
      const values = wrapper.findAll('option').map((o) => (o.element as HTMLOptionElement).value);
      expect(values).toEqual(options.map((option) => option.value));
    });

    it('emits the decoded pair when a fixed model is chosen', async () => {
      const options = buildLlmModelOptions({ google: 'key', openai: 'key' });
      const wrapper = mountPicker({
        options,
        pair: { provider: 'google', model: 'gemini-3.8-flash' },
      });
      await wrapper.find('select').setValue('openai::gpt-6.1-sol');
      expect(wrapper.emitted('update:pair')).toEqual([
        [{ provider: 'openai', model: 'gpt-6.1-sol' }],
      ]);
    });
  });

  describe('unavailable current model', () => {
    it('keeps an unavailable current pair visible and disabled without fallback', () => {
      const options = [
        ...buildLlmModelOptions({ google: 'key' }),
        { ...llmPairOption('anthropic', 'claude-opus-5-5'), disabled: true },
      ];
      const wrapper = mountPicker({
        options,
        pair: { provider: 'anthropic', model: 'claude-opus-5-5' },
      });
      const select = wrapper.find('select');
      expect((select.element as HTMLSelectElement).value).toBe('anthropic::claude-opus-5-5');
      const currentOption = select
        .findAll('option')
        .find((o) => (o.element as HTMLOptionElement).value === 'anthropic::claude-opus-5-5')!;
      expect(currentOption.element.disabled).toBe(true);
      expect(wrapper.find('[data-testid="chat-model-unavailable"]').exists()).toBe(true);
    });

    it('shows no unavailable hint while the current pair is selectable', () => {
      const options = buildLlmModelOptions({ google: 'key' });
      const wrapper = mountPicker({
        options,
        pair: { provider: 'google', model: 'gemini-3.8-flash' },
      });
      expect(wrapper.find('[data-testid="chat-model-unavailable"]').exists()).toBe(false);
    });

    it('flags a missing current pair even when no disabled option was supplied', () => {
      const options = buildLlmModelOptions({ google: 'key' });
      const wrapper = mountPicker({
        options,
        pair: { provider: 'openai', model: 'gpt-6.1-sol' },
      });
      expect(wrapper.find('[data-testid="chat-model-unavailable"]').exists()).toBe(true);
    });
  });

  describe('OpenRouter custom model ID', () => {
    it('shows the current custom id and emits the trimmed pair on apply', async () => {
      const options = buildLlmModelOptions({ openrouter: 'key' });
      const wrapper = mountPicker({
        options,
        pair: { provider: 'openrouter', model: 'acme/old:free' },
      });
      const input = wrapper.find('[data-testid="chat-custom-model-input"] input');
      expect(input.exists()).toBe(true);
      expect((input.element as HTMLInputElement).value).toBe('acme/old:free');

      await input.setValue('  acme/new:free  ');
      await wrapper.find('[data-testid="chat-custom-model-apply"]').trigger('click');
      expect(wrapper.emitted('update:pair')).toEqual([
        [{ provider: 'openrouter', model: 'acme/new:free' }],
      ]);
    });

    it('confirms a custom id with Enter', async () => {
      const options = buildLlmModelOptions({ openrouter: 'key' });
      const wrapper = mountPicker({
        options,
        pair: { provider: 'openrouter', model: 'acme/old:free' },
      });
      const input = wrapper.find('[data-testid="chat-custom-model-input"] input');
      await input.setValue('acme/enter:free');
      await input.trigger('keydown.enter');
      expect(wrapper.emitted('update:pair')).toEqual([
        [{ provider: 'openrouter', model: 'acme/enter:free' }],
      ]);
    });

    it('requires a nonempty trimmed id before applying', async () => {
      const options = buildLlmModelOptions({ openrouter: 'key' });
      const wrapper = mountPicker({
        options,
        pair: { provider: 'openrouter', model: 'acme/old:free' },
      });
      const input = wrapper.find('[data-testid="chat-custom-model-input"] input');
      await input.setValue('   ');
      expect(
        (wrapper.find('[data-testid="chat-custom-model-apply"]').element as HTMLButtonElement)
          .disabled,
      ).toBe(true);
      await input.trigger('keydown.enter');
      expect(wrapper.emitted('update:pair')).toBeUndefined();
    });

    it('starts an empty draft when the custom entry is chosen without an active pair', async () => {
      const options = [...buildLlmModelOptions({ google: 'key', openrouter: 'key' })];
      const wrapper = mountPicker({
        options,
        pair: { provider: 'google', model: 'gemini-3.8-flash' },
      });
      await wrapper.find('select').setValue(OPENROUTER_CUSTOM_VALUE);
      expect(wrapper.emitted('update:pair')).toBeUndefined();
      const input = wrapper.find('[data-testid="chat-custom-model-input"] input');
      expect(input.exists()).toBe(true);
      expect((input.element as HTMLInputElement).value).toBe('');
    });
  });

  describe('thinking control', () => {
    it('offers Default plus the model native efforts for registry models', async () => {
      const options = buildLlmModelOptions({ google: 'key' });
      const wrapper = mountPicker({
        options,
        pair: { provider: 'google', model: 'gemini-3.8-flash' },
      });
      const thinking = wrapper.find('[data-testid="chat-thinking-select"]');
      expect(thinking.exists()).toBe(true);
      const values = thinking.findAll('option').map((o) => (o.element as HTMLOptionElement).value);
      expect(values).toEqual(['', ...GOOGLE_MODELS[0]!.efforts]);
      expect(thinking.findAll('option')[0]!.text()).toBe('Default');

      await thinking.setValue('high');
      expect(wrapper.emitted('update:thinking')).toEqual([['high']]);
    });

    it('emits null when Default is chosen', async () => {
      const options = buildLlmModelOptions({ google: 'key' });
      const wrapper = mountPicker({
        options,
        pair: { provider: 'google', model: 'gemini-3.8-flash' },
        thinking: 'high',
      });
      const thinking = wrapper.find('[data-testid="chat-thinking-select"]');
      expect((thinking.element as HTMLSelectElement).value).toBe('high');
      await thinking.setValue('');
      expect(wrapper.emitted('update:thinking')).toEqual([[null]]);
    });

    it('hides the effort control for free-form OpenRouter pairs', () => {
      const options = buildLlmModelOptions({ openrouter: 'key' });
      const wrapper = mountPicker({
        options,
        pair: { provider: 'openrouter', model: 'acme/model:free' },
      });
      expect(wrapper.find('[data-testid="chat-thinking-select"]').exists()).toBe(false);
    });

    it('hides the effort control for unknown model ids', () => {
      const options = buildLlmModelOptions({ google: 'key' });
      const wrapper = mountPicker({
        options,
        pair: { provider: 'google', model: 'not-in-registry' },
      });
      expect(wrapper.find('[data-testid="chat-thinking-select"]').exists()).toBe(false);
    });
  });

  describe('disabled state', () => {
    it('disables the controls while pending', () => {
      const options = buildLlmModelOptions({ google: 'key', openrouter: 'key' });
      const wrapper = mountPicker({
        options,
        pair: { provider: 'openrouter', model: 'acme/model:free' },
        disabled: true,
      });
      expect((wrapper.find('select').element as HTMLSelectElement).disabled).toBe(true);
      expect(
        (wrapper.find('[data-testid="chat-custom-model-input"] input').element as HTMLInputElement)
          .disabled,
      ).toBe(true);
    });
  });

  // The option-disable mapping and provider sections are QSelect rendering
  // behavior a native-select stub cannot exercise: these use the real QSelect
  // with its menu teleported to document.body (clicks inside the menu must
  // not bubble into the field, so Teleport is not stubbed here).
  describe('real QSelect menu', () => {
    let wrapper: VueWrapper | null = null;

    beforeAll(() => {
      // jsdom lacks Element.scrollTo; Quasar's virtual scroll calls it on a
      // rAF after the menu opens to reveal the selected option.
      if (!Element.prototype.scrollTo) {
        Element.prototype.scrollTo = () => {};
      }
    });

    afterEach(() => {
      wrapper?.unmount();
      wrapper = null;
    });

    const mountRealPicker = (props: {
      options: LlmModelOption[];
      pair: InstanceType<typeof ChatModelPicker>['$props']['pair'];
    }): VueWrapper =>
      (wrapper = mount(ChatModelPicker, {
        props: { thinking: null, disabled: false, ...props },
        global: { plugins: [Quasar] },
      }));

    const menuItems = () => Array.from(document.querySelectorAll<HTMLElement>('.q-menu .q-item'));

    const openMenu = async (mounted: VueWrapper) => {
      await mounted.find('.chat-model-select').trigger('click');
      await flushPromises();
      return menuItems();
    };

    it('renders one labeled section per provider with a single custom entry', async () => {
      const options = buildLlmModelOptions({ google: 'key', openai: 'key', openrouter: 'key' });
      const mounted = mountRealPicker({
        options,
        pair: { provider: 'google', model: 'gemini-3.8-flash' },
      });
      await openMenu(mounted);

      const groups = Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="chat-model-group"]'),
      ).map((group) => group.textContent?.trim());
      expect(groups).toEqual(['Google', 'OpenAI', 'OpenRouter']);

      const items = menuItems().map((item) => item.textContent?.trim());
      expect(items).toHaveLength(options.length);
      expect(items!.filter((text) => text!.includes('OpenRouter'))).toHaveLength(1);
    });

    it('keeps a display-only unavailable option unselectable and sections it separately', async () => {
      const options = [
        ...buildLlmModelOptions({ google: 'key' }),
        { ...llmPairOption('anthropic', 'claude-opus-5-5'), disabled: true },
      ];
      const mounted = mountRealPicker({
        options,
        pair: { provider: 'google', model: 'gemini-3.8-flash' },
      });
      await openMenu(mounted);

      const groups = Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="chat-model-group"]'),
      ).map((group) => group.textContent?.trim());
      expect(groups).toEqual(['Google', 'Anthropic']);

      const disabledItem = menuItems().find((item) =>
        item.textContent?.includes('claude-opus-5-5'),
      )!;
      expect(disabledItem.classList.contains('disabled')).toBe(true);
      expect(disabledItem.getAttribute('aria-disabled')).toBe('true');

      disabledItem.click();
      await flushPromises();
      expect(mounted.emitted('update:pair')).toBeUndefined();

      // A normal option still selects through the custom option slot.
      const enabledItem = menuItems().find((item) => item.textContent?.includes('gemini-4-argon'))!;
      enabledItem.click();
      await flushPromises();
      expect(mounted.emitted('update:pair')).toEqual([
        [{ provider: 'google', model: 'gemini-4-argon' }],
      ]);
    });
  });
});

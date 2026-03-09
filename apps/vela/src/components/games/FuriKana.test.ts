import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import FuriKana from './FuriKana.vue';

describe('FuriKana', () => {
  describe('when text has kanji and reading is provided', () => {
    it('renders a ruby element', () => {
      const wrapper = mount(FuriKana, { props: { text: '猫', reading: 'ねこ' } });
      expect(wrapper.find('ruby').exists()).toBe(true);
    });

    it('renders the kanji text inside ruby', () => {
      const wrapper = mount(FuriKana, { props: { text: '猫', reading: 'ねこ' } });
      expect(wrapper.find('ruby').text()).toContain('猫');
    });

    it('renders the reading inside an rt element', () => {
      const wrapper = mount(FuriKana, { props: { text: '猫', reading: 'ねこ' } });
      expect(wrapper.find('rt').text()).toBe('ねこ');
    });

    it('works for multi-kanji words', () => {
      const wrapper = mount(FuriKana, { props: { text: '日本語', reading: 'にほんご' } });
      expect(wrapper.find('ruby').exists()).toBe(true);
      expect(wrapper.find('rt').text()).toBe('にほんご');
    });

    it('works for mixed kanji and kana text', () => {
      const wrapper = mount(FuriKana, { props: { text: '食べる', reading: 'たべる' } });
      expect(wrapper.find('ruby').exists()).toBe(true);
      expect(wrapper.find('rt').text()).toBe('たべる');
    });

    it('does not render a span', () => {
      const wrapper = mount(FuriKana, { props: { text: '猫', reading: 'ねこ' } });
      expect(wrapper.find('span').exists()).toBe(false);
    });
  });

  describe('when text has kanji but no reading is provided', () => {
    it('renders a span instead of ruby', () => {
      const wrapper = mount(FuriKana, { props: { text: '猫' } });
      expect(wrapper.find('span').exists()).toBe(true);
      expect(wrapper.find('ruby').exists()).toBe(false);
    });

    it('renders the text in the span', () => {
      const wrapper = mount(FuriKana, { props: { text: '猫' } });
      expect(wrapper.find('span').text()).toBe('猫');
    });
  });

  describe('when text has no kanji', () => {
    it('renders a span for pure hiragana even with a reading', () => {
      const wrapper = mount(FuriKana, { props: { text: 'ねこ', reading: 'ねこ' } });
      expect(wrapper.find('span').exists()).toBe(true);
      expect(wrapper.find('ruby').exists()).toBe(false);
    });

    it('renders a span for pure katakana even with a reading', () => {
      const wrapper = mount(FuriKana, { props: { text: 'ネコ', reading: 'ねこ' } });
      expect(wrapper.find('span').exists()).toBe(true);
      expect(wrapper.find('ruby').exists()).toBe(false);
    });

    it('renders a span for romaji text', () => {
      const wrapper = mount(FuriKana, { props: { text: 'neko', reading: 'ねこ' } });
      expect(wrapper.find('span').exists()).toBe(true);
      expect(wrapper.find('ruby').exists()).toBe(false);
    });

    it('renders the text in the span', () => {
      const wrapper = mount(FuriKana, { props: { text: 'ねこ' } });
      expect(wrapper.find('span').text()).toBe('ねこ');
    });
  });
});

import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { Quasar } from 'quasar';
import FlashcardCard from './FlashcardCard.vue';
import type { Vocabulary } from 'src/types/database';

describe('FlashcardCard', () => {
  const mockVocabulary: Vocabulary = {
    id: 'vocab-1',
    japanese_word: '猫',
    hiragana: 'ねこ',
    romaji: 'neko',
    english_translation: 'cat',
    example_sentence_jp: '猫が好きです。',
    example_sentence_en: 'I like cats.',
    created_at: '2024-01-01T00:00:00Z',
    jlpt_level: 5,
  };

  const mountComponent = (props = {}) => {
    return mount(FlashcardCard, {
      props: {
        vocabulary: mockVocabulary,
        direction: 'jp-to-en' as const,
        showFurigana: true,
        isFlipped: false,
        ...props,
      },
      global: {
        plugins: [Quasar],
      },
    });
  };

  describe('Japanese to English mode', () => {
    it('should show Japanese word on front when not flipped', () => {
      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('猫');
    });

    it('should show furigana when enabled', () => {
      const wrapper = mountComponent({ showFurigana: true });

      const ruby = wrapper.find('ruby');
      expect(ruby.exists()).toBe(true);
      expect(wrapper.text()).toContain('ねこ');
    });

    it('should hide furigana when disabled', () => {
      const wrapper = mountComponent({ showFurigana: false });

      const ruby = wrapper.find('.flashcard-front ruby');
      expect(ruby.exists()).toBe(false);
    });

    it('should show romaji when furigana disabled', () => {
      const wrapper = mountComponent({ showFurigana: false });

      expect(wrapper.text()).toContain('neko');
    });

    it('should show English translation on back when flipped', () => {
      const wrapper = mountComponent({ isFlipped: true });

      expect(wrapper.text()).toContain('cat');
    });

    it('should show example sentence on back if available', () => {
      const wrapper = mountComponent({ isFlipped: true });

      expect(wrapper.text()).toContain('猫が好きです。');
      expect(wrapper.text()).toContain('I like cats.');
    });
  });

  describe('English to Japanese mode (reverse)', () => {
    it('should show English on front when not flipped', () => {
      const wrapper = mountComponent({
        direction: 'en-to-jp',
        isFlipped: false,
      });

      // Front should show English
      const front = wrapper.find('.flashcard-front');
      expect(front.text()).toContain('cat');
    });

    it('should show Japanese on back when flipped', () => {
      const wrapper = mountComponent({
        direction: 'en-to-jp',
        isFlipped: true,
      });

      // Back should show Japanese
      expect(wrapper.text()).toContain('猫');
    });
  });

  describe('flip behavior', () => {
    it('should emit flip event when card is clicked and not flipped', async () => {
      const wrapper = mountComponent({ isFlipped: false });

      const cardWrapper = wrapper.find('.flashcard-wrapper');
      await cardWrapper.trigger('click');

      expect(wrapper.emitted('flip')).toBeTruthy();
    });

    it('should not emit flip event when card is already flipped', async () => {
      const wrapper = mountComponent({ isFlipped: true });

      const cardWrapper = wrapper.find('.flashcard-wrapper');
      await cardWrapper.trigger('click');

      expect(wrapper.emitted('flip')).toBeFalsy();
    });

    it('should have is-flipped class when flipped', () => {
      const wrapper = mountComponent({ isFlipped: true });

      const cardWrapper = wrapper.find('.flashcard-wrapper');
      expect(cardWrapper.classes()).toContain('is-flipped');
    });

    it('should not have is-flipped class when not flipped', () => {
      const wrapper = mountComponent({ isFlipped: false });

      const cardWrapper = wrapper.find('.flashcard-wrapper');
      expect(cardWrapper.classes()).not.toContain('is-flipped');
    });
  });

  describe('pronunciation', () => {
    it('should have pronounce button', () => {
      const wrapper = mountComponent();

      const pronounceBtn = wrapper.find('[data-testid="btn-pronounce"]');
      expect(pronounceBtn.exists()).toBe(true);
    });

    it('should emit pronounce event when button clicked', async () => {
      const wrapper = mountComponent();

      const pronounceBtn = wrapper.find('[data-testid="btn-pronounce"]');
      await pronounceBtn.trigger('click');

      expect(wrapper.emitted('pronounce')).toBeTruthy();
      expect(wrapper.emitted('pronounce')?.[0]).toEqual([mockVocabulary]);
    });

    it('should not trigger flip when pronounce button clicked', async () => {
      const wrapper = mountComponent({ isFlipped: false });

      const pronounceBtn = wrapper.find('[data-testid="btn-pronounce"]');
      await pronounceBtn.trigger('click');

      // Should not emit flip
      expect(wrapper.emitted('flip')).toBeFalsy();
    });
  });

  describe('flip hint', () => {
    it('should show tap hint when not flipped', () => {
      const wrapper = mountComponent({ isFlipped: false });

      expect(wrapper.text()).toContain('Tap to reveal answer');
    });
  });

  describe('vocabulary without optional fields', () => {
    it('should handle vocabulary without hiragana', () => {
      const vocabNoHiragana: Vocabulary = {
        id: 'vocab-2',
        japanese_word: '犬',
        english_translation: 'dog',
        created_at: '2024-01-01T00:00:00Z',
      };

      const wrapper = mountComponent({
        vocabulary: vocabNoHiragana,
        showFurigana: true,
      });

      // Should still render without error
      expect(wrapper.text()).toContain('犬');
    });

    it('should handle vocabulary without example sentences', () => {
      const vocabNoExample: Vocabulary = {
        id: 'vocab-2',
        japanese_word: '犬',
        hiragana: 'いぬ',
        english_translation: 'dog',
        created_at: '2024-01-01T00:00:00Z',
      };

      const wrapper = mountComponent({
        vocabulary: vocabNoExample,
        isFlipped: true,
      });

      // Should render without example section
      expect(wrapper.find('.example-section').exists()).toBe(false);
    });

    it('should handle vocabulary without romaji', () => {
      const vocabNoRomaji: Vocabulary = {
        id: 'vocab-2',
        japanese_word: '犬',
        hiragana: 'いぬ',
        english_translation: 'dog',
        created_at: '2024-01-01T00:00:00Z',
      };

      const wrapper = mountComponent({
        vocabulary: vocabNoRomaji,
        showFurigana: false,
      });

      // Should not show romaji section
      expect(wrapper.find('.romaji-text').exists()).toBe(false);
    });
  });

  describe('card structure', () => {
    it('should have front and back faces', () => {
      const wrapper = mountComponent();

      expect(wrapper.find('.flashcard-front').exists()).toBe(true);
      expect(wrapper.find('.flashcard-back').exists()).toBe(true);
    });

    it('should use Quasar card component', () => {
      const wrapper = mountComponent();

      const cards = wrapper.findAllComponents({ name: 'QCard' });
      expect(cards.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('ruby annotation', () => {
    it('should use ruby element for furigana display', () => {
      const wrapper = mountComponent({ showFurigana: true });

      const ruby = wrapper.find('ruby');
      const rt = wrapper.find('rt');

      expect(ruby.exists()).toBe(true);
      expect(rt.exists()).toBe(true);
      expect(rt.text()).toBe('ねこ');
    });
  });
});

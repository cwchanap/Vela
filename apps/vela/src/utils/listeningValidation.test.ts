import { describe, it, expect } from 'vitest';
import { normalizeAnswer, isDictationCorrect } from './listeningValidation';
import type { ListeningQuestion } from '../types/listening';

describe('normalizeAnswer', () => {
  it('removes ASCII spaces', () => {
    expect(normalizeAnswer('hello world')).toBe('helloworld');
  });

  it('removes full-width spaces', () => {
    expect(normalizeAnswer('こんにちは\u3000世界')).toBe('こんにちは世界');
  });

  it('lowercases ASCII letters', () => {
    expect(normalizeAnswer('NEKO')).toBe('neko');
  });

  it('handles empty string', () => {
    expect(normalizeAnswer('')).toBe('');
  });

  it('preserves Japanese characters unchanged', () => {
    expect(normalizeAnswer('猫')).toBe('猫');
    expect(normalizeAnswer('ねこ')).toBe('ねこ');
  });
});

const vocabQuestion: ListeningQuestion = {
  kind: 'vocabulary',
  id: 'v1',
  text: '猫',
  reading: 'ねこ',
  romaji: 'neko',
  englishTranslation: 'cat',
  distractors: ['dog', 'bird'],
  raw: {
    id: 'v1',
    japanese_word: '猫',
    hiragana: 'ねこ',
    romaji: 'neko',
    english_translation: 'cat',
    difficulty_level: 1,
    category: 'animals',
    created_at: '2024-01-01T00:00:00Z',
  },
};

const vocabQuestionNoReading: ListeningQuestion = {
  kind: 'vocabulary',
  id: 'v2',
  text: '猫',
  englishTranslation: 'cat',
  distractors: [],
  raw: {
    id: 'v2',
    japanese_word: '猫',
    english_translation: 'cat',
    difficulty_level: 1,
    category: 'animals',
    created_at: '2024-01-01T00:00:00Z',
  },
};

const sentenceQuestion: ListeningQuestion = {
  kind: 'sentence',
  id: 's1',
  text: '猫がいる',
  englishTranslation: 'There is a cat',
  distractors: ['There is a dog'],
  raw: {
    id: 's1',
    japanese_sentence: '猫がいる',
    english_translation: 'There is a cat',
    created_at: '2024-01-01T00:00:00Z',
  },
};

describe('isDictationCorrect', () => {
  describe('empty / blank input', () => {
    it('returns false for empty string', () => {
      expect(isDictationCorrect('', vocabQuestion)).toBe(false);
    });

    it('returns false for whitespace-only input', () => {
      expect(isDictationCorrect('   ', vocabQuestion)).toBe(false);
    });
  });

  describe('vocabulary question — japanese text match', () => {
    it('accepts exact kanji text', () => {
      expect(isDictationCorrect('猫', vocabQuestion)).toBe(true);
    });

    it('accepts text with surrounding whitespace stripped', () => {
      expect(isDictationCorrect(' 猫 ', vocabQuestion)).toBe(true);
    });
  });

  describe('vocabulary question — hiragana reading match', () => {
    it('accepts hiragana reading', () => {
      expect(isDictationCorrect('ねこ', vocabQuestion)).toBe(true);
    });

    it('accepts hiragana with full-width spaces', () => {
      expect(isDictationCorrect('ね\u3000こ', vocabQuestion)).toBe(true);
    });

    it('returns false when no reading field and hiragana entered', () => {
      expect(isDictationCorrect('ねこ', vocabQuestionNoReading)).toBe(false);
    });
  });

  describe('vocabulary question — romaji match', () => {
    it('accepts romaji (lowercase)', () => {
      expect(isDictationCorrect('neko', vocabQuestion)).toBe(true);
    });

    it('accepts romaji (uppercase)', () => {
      expect(isDictationCorrect('NEKO', vocabQuestion)).toBe(true);
    });

    it('accepts romaji (mixed case)', () => {
      expect(isDictationCorrect('Neko', vocabQuestion)).toBe(true);
    });
  });

  describe('vocabulary question — wrong answers', () => {
    it('rejects wrong kanji', () => {
      expect(isDictationCorrect('犬', vocabQuestion)).toBe(false);
    });

    it('rejects wrong romaji', () => {
      expect(isDictationCorrect('inu', vocabQuestion)).toBe(false);
    });

    it('rejects the english translation', () => {
      expect(isDictationCorrect('cat', vocabQuestion)).toBe(false);
    });
  });

  describe('sentence question — text match', () => {
    it('accepts exact sentence', () => {
      expect(isDictationCorrect('猫がいる', sentenceQuestion)).toBe(true);
    });

    it('accepts sentence with spaces removed', () => {
      expect(isDictationCorrect('猫 が いる', sentenceQuestion)).toBe(true);
    });
  });

  describe('sentence question — no reading/romaji fallbacks', () => {
    it('does not accept hiragana-only input for sentence question', () => {
      expect(isDictationCorrect('ねこがいる', sentenceQuestion)).toBe(false);
    });
  });
});

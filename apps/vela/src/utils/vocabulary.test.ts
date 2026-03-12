import { describe, it, expect } from 'vitest';
import { normalizeVocabulary, toVocabularyOption } from './vocabulary';
import type { Vocabulary } from 'src/types/database';

describe('toVocabularyOption', () => {
  const mockVocabularyWithHiragana: Vocabulary = {
    id: 'vocab-1',
    japanese_word: '猫',
    hiragana: 'ねこ',
    romaji: 'neko',
    english_translation: 'cat',
    difficulty_level: 1,
    category: 'animals',
    created_at: '2024-01-01T00:00:00Z',
  };

  const mockVocabularyWithoutHiragana: Vocabulary = {
    id: 'vocab-2',
    japanese_word: '猫',
    romaji: 'neko',
    english_translation: 'cat',
    difficulty_level: 1,
    category: 'animals',
    created_at: '2024-01-01T00:00:00Z',
  };

  it('should create VocabularyOption with text and reading when hiragana is present', () => {
    const result = toVocabularyOption(mockVocabularyWithHiragana);

    expect(result).toEqual({
      id: 'vocab-1',
      text: '猫',
      reading: 'ねこ',
    });
  });

  it('should create VocabularyOption with text only when hiragana is absent', () => {
    const result = toVocabularyOption(mockVocabularyWithoutHiragana);

    expect(result).toEqual({
      id: 'vocab-2',
      text: '猫',
    });
    expect(result.reading).toBeUndefined();
  });

  it('should use japanese_word as text', () => {
    const vocab: Vocabulary = {
      id: 'vocab-3',
      japanese_word: '犬',
      hiragana: 'いぬ',
      english_translation: 'dog',
      created_at: '2024-01-01T00:00:00Z',
    };

    const result = toVocabularyOption(vocab);

    expect(result.text).toBe('犬');
  });

  it('should handle katakana in hiragana field', () => {
    const vocab: Vocabulary = {
      id: 'vocab-4',
      japanese_word: 'コンピューター',
      hiragana: 'コンピューター',
      english_translation: 'computer',
      created_at: '2024-01-01T00:00:00Z',
    };

    const result = toVocabularyOption(vocab);

    expect(result).toEqual({
      id: 'vocab-4',
      text: 'コンピューター',
      reading: 'コンピューター',
    });
  });

  it('should handle mixed kanji and kana', () => {
    const vocab: Vocabulary = {
      id: 'vocab-5',
      japanese_word: '勉強',
      hiragana: 'べんきょう',
      english_translation: 'study',
      created_at: '2024-01-01T00:00:00Z',
    };

    const result = toVocabularyOption(vocab);

    expect(result).toEqual({
      id: 'vocab-5',
      text: '勉強',
      reading: 'べんきょう',
    });
  });

  it('should handle empty hiragana string', () => {
    const vocab: Vocabulary = {
      id: 'vocab-6',
      japanese_word: '猫',
      hiragana: '',
      english_translation: 'cat',
      created_at: '2024-01-01T00:00:00Z',
    };

    const result = toVocabularyOption(vocab);

    expect(result.text).toBe('猫');
    // Omit result.reading when hiragana is blank so consumers do not receive a meaningless empty reading.
    expect(result.reading).toBeUndefined();
  });
});

describe('normalizeVocabulary', () => {
  it('should populate japanese_word from the legacy japanese field', () => {
    const result = normalizeVocabulary({
      id: 'vocab-legacy',
      japanese_word: '',
      japanese: '猫',
      english_translation: 'cat',
      created_at: '2024-01-01T00:00:00Z',
    });

    expect(result).toEqual({
      id: 'vocab-legacy',
      japanese_word: '猫',
      english_translation: 'cat',
      created_at: '2024-01-01T00:00:00Z',
    });
  });

  it('should return null when japanese_word and japanese are both missing', () => {
    const result = normalizeVocabulary({
      id: 'vocab-empty',
      japanese_word: '',
      english_translation: 'cat',
      created_at: '2024-01-01T00:00:00Z',
    });

    expect(result).toBeNull();
  });
});

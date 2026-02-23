import { describe, it, expect } from 'vitest';
import {
  isHiragana,
  isKatakana,
  isKanji,
  isJapanese,
  analyzeText,
  hiraganaToRomaji,
  assessDifficulty,
  parseFurigana,
} from './japanese';

describe('isHiragana', () => {
  it('returns true for hiragana characters', () => {
    expect(isHiragana('あ')).toBe(true);
    expect(isHiragana('ん')).toBe(true);
    expect(isHiragana('を')).toBe(true);
  });

  it('returns false for katakana', () => {
    expect(isHiragana('ア')).toBe(false);
  });

  it('returns false for kanji', () => {
    expect(isHiragana('猫')).toBe(false);
  });

  it('returns false for ASCII', () => {
    expect(isHiragana('a')).toBe(false);
    expect(isHiragana('1')).toBe(false);
  });
});

describe('isKatakana', () => {
  it('returns true for katakana characters', () => {
    expect(isKatakana('ア')).toBe(true);
    expect(isKatakana('ン')).toBe(true);
    expect(isKatakana('ヲ')).toBe(true);
  });

  it('returns false for hiragana', () => {
    expect(isKatakana('あ')).toBe(false);
  });

  it('returns false for kanji', () => {
    expect(isKatakana('猫')).toBe(false);
  });

  it('returns false for ASCII', () => {
    expect(isKatakana('A')).toBe(false);
  });
});

describe('isKanji', () => {
  it('returns true for CJK unified ideographs', () => {
    expect(isKanji('猫')).toBe(true);
    expect(isKanji('語')).toBe(true);
    expect(isKanji('日')).toBe(true);
  });

  it('returns false for hiragana', () => {
    expect(isKanji('あ')).toBe(false);
  });

  it('returns false for katakana', () => {
    expect(isKanji('ア')).toBe(false);
  });

  it('returns false for ASCII', () => {
    expect(isKanji('a')).toBe(false);
  });
});

describe('isJapanese', () => {
  it('returns true for hiragana', () => {
    expect(isJapanese('あ')).toBe(true);
  });

  it('returns true for katakana', () => {
    expect(isJapanese('ア')).toBe(true);
  });

  it('returns true for kanji', () => {
    expect(isJapanese('猫')).toBe(true);
  });

  it('returns false for ASCII', () => {
    expect(isJapanese('a')).toBe(false);
    expect(isJapanese('1')).toBe(false);
  });

  it('returns false for spaces', () => {
    expect(isJapanese(' ')).toBe(false);
  });
});

describe('analyzeText', () => {
  it('counts hiragana correctly', () => {
    const result = analyzeText('あいう');
    expect(result.hiragana).toBe(3);
    expect(result.katakana).toBe(0);
    expect(result.kanji).toBe(0);
    expect(result.other).toBe(0);
    expect(result.total).toBe(3);
  });

  it('counts katakana correctly', () => {
    const result = analyzeText('アイウ');
    expect(result.katakana).toBe(3);
    expect(result.hiragana).toBe(0);
  });

  it('counts kanji correctly', () => {
    const result = analyzeText('猫犬');
    expect(result.kanji).toBe(2);
  });

  it('counts mixed text correctly', () => {
    const result = analyzeText('猫がいる');
    expect(result.kanji).toBe(1);
    expect(result.hiragana).toBe(3);
    expect(result.total).toBe(4);
  });

  it('counts ASCII as other', () => {
    const result = analyzeText('hello');
    expect(result.other).toBe(5);
    expect(result.total).toBe(5);
  });

  it('handles empty string', () => {
    const result = analyzeText('');
    expect(result.total).toBe(0);
    expect(result.hiragana).toBe(0);
  });

  it('handles all four character types together', () => {
    const result = analyzeText('猫アあa');
    expect(result.kanji).toBe(1);
    expect(result.katakana).toBe(1);
    expect(result.hiragana).toBe(1);
    expect(result.other).toBe(1);
    expect(result.total).toBe(4);
  });
});

describe('hiraganaToRomaji', () => {
  it('converts basic vowels', () => {
    expect(hiraganaToRomaji('あいうえお')).toBe('aiueo');
  });

  it('converts ka-row', () => {
    expect(hiraganaToRomaji('かきくけこ')).toBe('kakikukeko');
  });

  it('converts sa-row', () => {
    expect(hiraganaToRomaji('さしすせそ')).toBe('sashisuseso');
  });

  it('converts ta-row', () => {
    expect(hiraganaToRomaji('たちつてと')).toBe('tachitsuteto');
  });

  it('converts na-row', () => {
    expect(hiraganaToRomaji('なにぬねの')).toBe('naninuneno');
  });

  it('converts ha-row', () => {
    expect(hiraganaToRomaji('はひふへほ')).toBe('hahifuheho');
  });

  it('converts ma-row', () => {
    expect(hiraganaToRomaji('まみむめも')).toBe('mamimumemo');
  });

  it('converts ya-row', () => {
    expect(hiraganaToRomaji('やゆよ')).toBe('yayuyo');
  });

  it('converts ra-row', () => {
    expect(hiraganaToRomaji('らりるれろ')).toBe('rarirurero');
  });

  it('converts wa-row', () => {
    expect(hiraganaToRomaji('わゐゑを')).toBe('wawiwewo');
  });

  it('converts voiced (dakuten) consonants', () => {
    expect(hiraganaToRomaji('がぎぐげご')).toBe('gagigugego');
  });

  it('converts semi-voiced (handakuten) consonants', () => {
    expect(hiraganaToRomaji('ぱぴぷぺぽ')).toBe('papipupepo');
  });

  it('converts ん to n', () => {
    expect(hiraganaToRomaji('ん')).toBe('n');
  });

  it('passes through unknown characters unchanged', () => {
    expect(hiraganaToRomaji('cat')).toBe('cat');
  });

  it('handles mixed known and unknown characters', () => {
    expect(hiraganaToRomaji('あcat')).toBe('acat');
  });

  it('handles empty string', () => {
    expect(hiraganaToRomaji('')).toBe('');
  });
});

describe('assessDifficulty', () => {
  it('returns 1 for empty string', () => {
    expect(assessDifficulty('')).toBe(1);
  });

  it('returns 1 for short hiragana-only text', () => {
    expect(assessDifficulty('あいう')).toBe(1);
  });

  it('increases difficulty for kanji (1 kanji → rounds to 2)', () => {
    // base=1, +0.5 → 1.5 → round → 2
    expect(assessDifficulty('猫')).toBe(2);
  });

  it('increases difficulty for 5 katakana', () => {
    // base=1, +min(5*0.2,1)=1 → 2
    expect(assessDifficulty('アイウエオ')).toBe(2);
  });

  it('increases difficulty for long hiragana text (15 chars)', () => {
    // base=1, 5 chars over 10 → +0.5 → 1.5 → round → 2
    expect(assessDifficulty('あいうえおかきくけこさしすせそ')).toBe(2);
  });

  it('caps at 5 for text with many kanji', () => {
    // 15 kanji: kanji bonus = min(15*0.5, 3) = 3, length bonus = min((15-10)*0.1, 2) = 0.5
    // total = 1 + 3 + 0.5 = 4.5 → round → 5 (capped at 5)
    const result = assessDifficulty('猫犬鳥魚虫花人山川木石竹馬鹿熊');
    expect(result).toBe(5);
  });

  it('returns a number between 1 and 5', () => {
    const texts = ['', 'あ', '猫がいる', 'アイウエオ', '猫犬鳥魚虫花'];
    for (const text of texts) {
      const result = assessDifficulty(text);
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(5);
    }
  });
});

describe('parseFurigana', () => {
  it('returns empty array for empty string', () => {
    expect(parseFurigana('')).toEqual([]);
  });

  it('marks kanji characters as isKanji=true', () => {
    const result = parseFurigana('猫');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ text: '猫', isKanji: true });
  });

  it('marks hiragana as isKanji=false', () => {
    const result = parseFurigana('あ');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ text: 'あ', isKanji: false });
  });

  it('handles mixed text char by char', () => {
    const result = parseFurigana('猫が');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ text: '猫', isKanji: true });
    expect(result[1]).toEqual({ text: 'が', isKanji: false });
  });

  it('does not set reading field', () => {
    const result = parseFurigana('猫');
    expect(result[0]?.reading).toBeUndefined();
  });
});

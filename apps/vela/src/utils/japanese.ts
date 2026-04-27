import type { Token } from '@vela/common/tokenizer';

// Japanese language utilities

// Character type detection
export const isHiragana = (char: string): boolean => {
  const code = char.charCodeAt(0);
  return code >= 0x3040 && code <= 0x309f;
};

export const isKatakana = (char: string): boolean => {
  const code = char.charCodeAt(0);
  return code >= 0x30a0 && code <= 0x30ff;
};

export const isKanji = (char: string): boolean => {
  const code = char.charCodeAt(0);
  return (code >= 0x4e00 && code <= 0x9faf) || (code >= 0x3400 && code <= 0x4dbf);
};

export const isJapanese = (char: string): boolean => {
  return isHiragana(char) || isKatakana(char) || isKanji(char);
};

// Text analysis
export const analyzeText = (text: string) => {
  const chars = Array.from(text);
  const analysis = {
    hiragana: 0,
    katakana: 0,
    kanji: 0,
    other: 0,
    total: chars.length,
  };

  chars.forEach((char) => {
    if (isHiragana(char)) {
      analysis.hiragana++;
    } else if (isKatakana(char)) {
      analysis.katakana++;
    } else if (isKanji(char)) {
      analysis.kanji++;
    } else {
      analysis.other++;
    }
  });

  return analysis;
};

// Romanization helpers (basic implementation)
export const hiraganaToRomaji = (hiragana: string): string => {
  const map: Record<string, string> = {
    あ: 'a',
    い: 'i',
    う: 'u',
    え: 'e',
    お: 'o',
    か: 'ka',
    き: 'ki',
    く: 'ku',
    け: 'ke',
    こ: 'ko',
    が: 'ga',
    ぎ: 'gi',
    ぐ: 'gu',
    げ: 'ge',
    ご: 'go',
    さ: 'sa',
    し: 'shi',
    す: 'su',
    せ: 'se',
    そ: 'so',
    ざ: 'za',
    じ: 'ji',
    ず: 'zu',
    ぜ: 'ze',
    ぞ: 'zo',
    た: 'ta',
    ち: 'chi',
    つ: 'tsu',
    て: 'te',
    と: 'to',
    だ: 'da',
    ぢ: 'ji',
    づ: 'zu',
    で: 'de',
    ど: 'do',
    な: 'na',
    に: 'ni',
    ぬ: 'nu',
    ね: 'ne',
    の: 'no',
    は: 'ha',
    ひ: 'hi',
    ふ: 'fu',
    へ: 'he',
    ほ: 'ho',
    ば: 'ba',
    び: 'bi',
    ぶ: 'bu',
    べ: 'be',
    ぼ: 'bo',
    ぱ: 'pa',
    ぴ: 'pi',
    ぷ: 'pu',
    ぺ: 'pe',
    ぽ: 'po',
    ま: 'ma',
    み: 'mi',
    む: 'mu',
    め: 'me',
    も: 'mo',
    や: 'ya',
    ゆ: 'yu',
    よ: 'yo',
    ら: 'ra',
    り: 'ri',
    る: 'ru',
    れ: 're',
    ろ: 'ro',
    わ: 'wa',
    ゐ: 'wi',
    ゑ: 'we',
    を: 'wo',
    ん: 'n',
    // Add more mappings as needed
  };

  return Array.from(hiragana)
    .map((char) => map[char] || char)
    .join('');
};

// Difficulty assessment
export const assessDifficulty = (text: string): number => {
  const analysis = analyzeText(text);
  let difficulty = 1;

  // Base difficulty on character types
  if (analysis.kanji > 0) {
    difficulty += Math.min(analysis.kanji * 0.5, 3);
  }

  if (analysis.katakana > 0) {
    difficulty += Math.min(analysis.katakana * 0.2, 1);
  }

  // Length factor
  if (text.length > 10) {
    difficulty += Math.min((text.length - 10) * 0.1, 2);
  }

  return Math.min(Math.round(difficulty), 5);
};

// Furigana utilities
export interface FuriganaSegment {
  text: string;
  reading?: string;
  isKanji: boolean;
}

export const parseFurigana = (text: string): FuriganaSegment[] => {
  // This is a simplified implementation
  // In a real app, you'd use a proper Japanese parsing library
  const segments: FuriganaSegment[] = [];
  const chars = Array.from(text);

  chars.forEach((char) => {
    segments.push({
      text: char,
      isKanji: isKanji(char),
    });
  });

  return segments;
};

const CONTENT_POS = new Set(['名詞', '動詞', '形容詞']);

export function isContentWord(token: Token): boolean {
  return CONTENT_POS.has(token.pos);
}

/**
 * Compute a JLPT-style difficulty label from kuromoji tokens.
 * Counts kanji-containing content words (名詞/動詞/形容詞):
 *   0 → N5, 1–2 → N4, 3–4 → N3, 5–7 → N2, 8+ → N1
 * Returns "—" when there are no content words at all.
 */
export function computeDifficulty(tokens: Token[]): string {
  const contentWords = tokens.filter((t) => isContentWord(t));
  if (contentWords.length === 0) return '—';

  const kanjiCount = contentWords.filter((t) => Array.from(t.surface_form).some(isKanji)).length;

  if (kanjiCount === 0) return 'N5';
  if (kanjiCount <= 2) return 'N4';
  if (kanjiCount <= 4) return 'N3';
  if (kanjiCount <= 7) return 'N2';
  return 'N1';
}

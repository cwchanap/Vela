import type { ListeningQuestion } from '../types/listening';

/** Normalize answers for comparison using NFKC, whitespace removal, ASCII lowercasing, and katakana-to-hiragana conversion. */
export function normalizeAnswer(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[\s\u3000]+/g, '') // collapses and removes all ASCII and full-width spaces
    .toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));
}

/**
 * Check if a dictation answer is correct.
 * Accepts: the Japanese text, plus reading or romaji when provided on the question.
 */
export function isDictationCorrect(userInput: string, question: ListeningQuestion): boolean {
  if (!userInput.trim()) return false;

  const normalized = normalizeAnswer(userInput);

  if (normalized === normalizeAnswer(question.text)) return true;

  if (question.reading && normalized === normalizeAnswer(question.reading)) return true;
  if (question.romaji && normalized === normalizeAnswer(question.romaji)) return true;

  return false;
}

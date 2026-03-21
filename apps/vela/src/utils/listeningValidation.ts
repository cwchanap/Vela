import type { ListeningQuestion } from '../types/listening';

/** Normalize Japanese input for comparison: collapse whitespace and trim */
export function normalizeAnswer(s: string): string {
  return s
    .replace(/[\s\u3000]+/g, '') // collapses and removes all ASCII and full-width spaces
    .toLowerCase();
}

/**
 * Check if a dictation answer is correct.
 * Accepts: the Japanese text, hiragana reading (vocabulary only), or romaji (vocabulary only).
 */
export function isDictationCorrect(userInput: string, question: ListeningQuestion): boolean {
  if (!userInput.trim()) return false;

  const normalized = normalizeAnswer(userInput);

  if (normalized === normalizeAnswer(question.text)) return true;

  if (question.reading && normalized === normalizeAnswer(question.reading)) return true;
  if (question.romaji && normalized === normalizeAnswer(question.romaji)) return true;

  return false;
}

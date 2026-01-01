export interface Sentence {
  id: string;
  japanese_sentence: string;
  english_translation: string;
  difficulty_level?: number;
  category?: string;
  created_at: string;
  words_array: string[];
  jlpt_level?: JLPTLevel;
}

/**
 * JLPT Level encoding:
 * - 5 = N5 (easiest, ~800 vocabulary)
 * - 4 = N4 (~1,500 vocabulary)
 * - 3 = N3 (~3,750 vocabulary)
 * - 2 = N2 (~6,000 vocabulary)
 * - 1 = N1 (hardest, ~10,000 vocabulary)
 */
export type JLPTLevel = 1 | 2 | 3 | 4 | 5;

export interface Vocabulary {
  id: string;
  japanese_word: string;
  hiragana?: string;
  katakana?: string;
  romaji?: string;
  english_translation: string;
  difficulty_level?: number;
  category?: string;
  example_sentence_jp?: string;
  example_sentence_en?: string;
  audio_url?: string;
  created_at: string;
  /** JLPT level (1-5, where 5=N5 easiest, 1=N1 hardest) */
  jlpt_level?: JLPTLevel;
}

/**
 * User's SRS progress for a specific vocabulary item.
 * Tracked per user-vocabulary pair using SM-2 spaced repetition algorithm.
 */
export interface UserVocabularyProgress {
  /** Composite key: user_id */
  user_id: string;
  /** Composite key: vocabulary_id */
  vocabulary_id: string;
  /** ISO date string of next scheduled review */
  next_review_date: string;
  /** SM-2 ease factor (minimum 1.3, default 2.5) */
  ease_factor: number;
  /** Current interval in days between reviews */
  interval: number;
  /** Number of successful consecutive repetitions */
  repetitions: number;
  /** Last quality rating (0-5) */
  last_quality?: number;
  /** ISO date string of last review */
  last_reviewed_at?: string;
  /** ISO date string when first learned */
  first_learned_at: string;
  /** Total number of reviews */
  total_reviews: number;
  /** Number of correct answers (quality >= 3) */
  correct_count: number;
}

import type { Sentence, Vocabulary } from './database';

export interface SentenceQuestion {
  sentence: Sentence;
  scrambled: string[];
  correctAnswer: string;
}

export interface VocabularyOption {
  /** Unique identifier for the vocabulary item */
  id: string;
  /** Japanese word text (may contain kanji) */
  text: string;
  /** Hiragana reading for furigana display */
  reading?: string;
}

export interface Question {
  word: Vocabulary;
  options: VocabularyOption[];
  /** id of the correct answer vocabulary */
  correctAnswer: string;
}

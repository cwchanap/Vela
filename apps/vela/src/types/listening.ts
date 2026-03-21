import type { Vocabulary, Sentence, JLPTLevel } from './database';

export type ListeningMode = 'multiple-choice' | 'dictation';
export type ListeningSource = 'vocabulary' | 'sentences';

export interface ListeningConfig {
  mode: ListeningMode;
  source: ListeningSource;
  jlptLevels: JLPTLevel[];
}

export type ListeningQuestion =
  | {
      kind: 'vocabulary';
      /** vocabulary.id — used as TTS S3 cache key */
      id: string;
      /** japanese_word — passed to TTS API */
      text: string;
      /** hiragana reading — accepted as correct dictation answer */
      reading?: string;
      /** romaji — accepted as correct dictation answer */
      romaji?: string;
      englishTranslation: string;
      /** Three wrong English translations for multiple-choice mode */
      distractors: string[];
      raw: Vocabulary;
    }
  | {
      kind: 'sentence';
      /** sentence.id — used as TTS S3 cache key */
      id: string;
      /** japanese_sentence — passed to TTS API */
      text: string;
      /** hiragana reading — accepted as correct dictation answer when provided */
      reading?: string;
      /** romaji — accepted as correct dictation answer when provided */
      romaji?: string;
      englishTranslation: string;
      /** Three wrong English translations for multiple-choice mode */
      distractors: string[];
      raw: Sentence;
    };

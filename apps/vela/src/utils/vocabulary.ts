import type { VocabularyOption } from 'src/stores/games';
import type { Vocabulary } from 'src/types/database';
import { shuffleArray } from './array';

export type LegacyVocabularyPayload = Omit<Vocabulary, 'japanese_word'> & {
  japanese_word?: string | null;
  japanese?: string | null;
};

/**
 * Normalize vocabulary from APIs that may still send the legacy `japanese` field.
 */
export function normalizeVocabulary(vocabulary: LegacyVocabularyPayload): Vocabulary | null {
  const japaneseWord = vocabulary.japanese_word?.trim() || vocabulary.japanese?.trim() || '';

  if (!japaneseWord) {
    console.warn(
      '[normalizeVocabulary] Rejected vocabulary item with missing japanese_word:',
      vocabulary,
    );
    return null;
  }

  const { japanese: _legacyJapanese, japanese_word: _currentJapaneseWord, ...rest } = vocabulary;

  return {
    ...rest,
    japanese_word: japaneseWord,
  };
}

/**
 * Convert a Vocabulary database record to a VocabularyOption.
 * This ensures consistent mapping across the application.
 *
 * @param vocabulary - The vocabulary record from the database
 * @returns A VocabularyOption with text and optional reading
 */
export function toVocabularyOption(vocabulary: Vocabulary): VocabularyOption {
  return {
    id: vocabulary.id,
    text: vocabulary.japanese_word,
    ...(vocabulary.hiragana ? { reading: vocabulary.hiragana } : {}),
  };
}

export function buildDistractors(
  targetWord: Vocabulary,
  vocabulary: Vocabulary[],
  additionalWords: Vocabulary[] = [],
  count = 3,
): VocabularyOption[] {
  const distractors: VocabularyOption[] = [];
  const seenTexts = new Set<string>([targetWord.japanese_word]);

  const addUniqueDistractors = (pool: Vocabulary[]) => {
    for (const candidate of shuffleArray(pool)) {
      if (candidate.id === targetWord.id || seenTexts.has(candidate.japanese_word)) {
        continue;
      }

      seenTexts.add(candidate.japanese_word);
      distractors.push(toVocabularyOption(candidate));

      if (distractors.length === count) {
        return;
      }
    }
  };

  addUniqueDistractors(vocabulary);

  if (distractors.length < count) {
    addUniqueDistractors(additionalWords);
  }

  return distractors;
}

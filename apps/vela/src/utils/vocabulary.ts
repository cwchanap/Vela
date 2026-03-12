import type { VocabularyOption } from 'src/stores/games';
import type { Vocabulary } from 'src/types/database';

type LegacyVocabulary = Omit<Vocabulary, 'japanese_word'> & {
  japanese_word?: string | null;
  japanese?: string | null;
};

/**
 * Normalize vocabulary from APIs that may still send the legacy `japanese` field.
 */
export function normalizeVocabulary(vocabulary: LegacyVocabulary): Vocabulary | null {
  const japaneseWord = vocabulary.japanese_word?.trim() || vocabulary.japanese?.trim() || '';

  if (!japaneseWord) {
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

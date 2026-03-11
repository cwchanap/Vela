import type { VocabularyOption } from 'src/stores/games';
import type { Vocabulary } from 'src/types/database';

/**
 * Convert a Vocabulary database record to a VocabularyOption.
 * This ensures consistent mapping across the application.
 *
 * @param vocabulary - The vocabulary record from the database
 * @returns A VocabularyOption with text and optional reading
 */
export function toVocabularyOption(vocabulary: Vocabulary): VocabularyOption {
  return {
    text: vocabulary.japanese_word,
    ...(vocabulary.hiragana !== undefined ? { reading: vocabulary.hiragana } : {}),
  };
}

import { config } from 'src/config';
import { httpJson, httpJsonAuth } from 'src/utils/httpClient';

export interface JishoResult {
  word: string;
  reading: string;
  meanings: string[];
  jlpt?: string;
  common: boolean;
}

export interface AddFlashcardPayload {
  japanese_word: string;
  reading: string;
  english_translation: string;
  example_sentence_jp?: string;
  source_url?: string;
  jlpt_level?: 1 | 2 | 3 | 4 | 5;
}

export interface AddFlashcardResult {
  vocabulary_id: string;
  created: boolean;
  alreadyInSRS: boolean;
}

/**
 * Look up a word via the Jisho proxy. Returns null if not found.
 */
export async function lookupWord(dictionaryForm: string): Promise<JishoResult | null> {
  try {
    const encoded = encodeURIComponent(dictionaryForm);
    return await httpJson<JishoResult>(
      `${config.api.url}dictionary/lookup?word=${encoded}`,
    );
  } catch {
    return null;
  }
}

/**
 * Add a word to the user's SRS flashcard deck.
 */
export async function addFlashcard(payload: AddFlashcardPayload): Promise<AddFlashcardResult> {
  return httpJsonAuth<AddFlashcardResult>(`${config.api.url}vocabulary/from-word`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

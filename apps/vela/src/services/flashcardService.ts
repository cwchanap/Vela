import type { Vocabulary, JLPTLevel } from 'src/types/database';
import { srsService, type DueItemsResponse, type ReviewInput, httpJson } from './srsService';
import { getApiUrl } from 'src/utils/api';

/**
 * Response from vocabulary API
 */
interface VocabularyResponse {
  vocabulary: Vocabulary[];
  filters: {
    jlpt_levels: JLPTLevel[] | 'all';
    limit: number;
  };
}

/**
 * Fetch vocabulary for cram mode (all vocabulary regardless of SRS schedule)
 * @param limit - Maximum number of items to fetch
 * @param jlptLevels - Optional JLPT level filter
 */
async function getVocabularyForCram(limit = 20, jlptLevels?: JLPTLevel[]): Promise<Vocabulary[]> {
  let url = getApiUrl(`games/vocabulary?limit=${limit}`);

  if (jlptLevels && jlptLevels.length > 0) {
    url += `&jlpt=${jlptLevels.join(',')}`;
  }

  const data = await httpJson<VocabularyResponse>(url);
  return data.vocabulary;
}

/**
 * Fetch vocabulary due for SRS review
 * @param limit - Maximum number of items to fetch
 * @param jlptLevels - Optional JLPT level filter
 */
async function getVocabularyForSRS(
  limit = 20,
  jlptLevels?: JLPTLevel[],
): Promise<{ vocabulary: Vocabulary[]; totalDue: number }> {
  const response: DueItemsResponse = await srsService.getDueItems(limit, jlptLevels);

  // Extract vocabulary from due items, filtering out any null entries
  const vocabulary = response.items
    .map((item) => item.vocabulary)
    .filter((v): v is Vocabulary => v !== null);

  return {
    vocabulary,
    totalDue: response.total ?? 0,
  };
}

/**
 * Validate a user's answer against the vocabulary
 * Checks against japanese_word, hiragana, katakana, and romaji
 * @param userAnswer - The user's typed answer
 * @param vocabulary - The vocabulary to check against
 * @returns Whether the answer is correct
 */
function validateAnswer(userAnswer: string, vocabulary: Vocabulary): boolean {
  const normalizedAnswer = userAnswer.trim().toLowerCase();

  if (!normalizedAnswer) return false;

  // Build list of valid answers
  const validAnswers: string[] = [];

  if (vocabulary.japanese_word) {
    validAnswers.push(vocabulary.japanese_word.toLowerCase().trim());
  }
  if (vocabulary.hiragana) {
    validAnswers.push(vocabulary.hiragana.toLowerCase().trim());
  }
  if (vocabulary.katakana) {
    validAnswers.push(vocabulary.katakana.toLowerCase().trim());
  }
  if (vocabulary.romaji) {
    validAnswers.push(vocabulary.romaji.toLowerCase().trim());
  }

  return validAnswers.includes(normalizedAnswer);
}

/**
 * Record a review for a vocabulary item
 * @param vocabularyId - The vocabulary ID
 * @param quality - Quality rating (0-5)
 */
async function recordReview(vocabularyId: string, quality: ReviewInput['quality']): Promise<void> {
  await srsService.recordReview(vocabularyId, quality);
}

/**
 * Record multiple reviews at once
 * @param reviews - Array of review inputs with quality constrained to 0-5
 */
async function recordBatchReview(reviews: ReviewInput[]): Promise<void> {
  if (reviews.length === 0) return;
  await srsService.recordBatchReview(reviews);
}

/**
 * Get SRS statistics
 * @param jlptLevels - Optional JLPT level filter
 */
async function getStats(jlptLevels?: JLPTLevel[]) {
  return srsService.getStats(jlptLevels);
}

export const flashcardService = {
  getVocabularyForCram,
  getVocabularyForSRS,
  validateAnswer,
  recordReview,
  recordBatchReview,
  getStats,
};

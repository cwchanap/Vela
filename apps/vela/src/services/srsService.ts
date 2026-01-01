import type { UserVocabularyProgress, Vocabulary, JLPTLevel } from 'src/types/database';
import { getApiUrl } from 'src/utils/api';

/**
 * SRS statistics returned from the API
 */
export interface SRSStats {
  total_items: number;
  due_today: number;
  mastery_breakdown: {
    new: number;
    learning: number;
    reviewing: number;
    mastered: number;
  };
  average_ease_factor: number;
  total_reviews: number;
  accuracy_rate: number;
}

/**
 * Due item with vocabulary data
 */
export interface DueItem {
  progress: UserVocabularyProgress;
  vocabulary: Vocabulary;
}

/**
 * Response from getDueItems
 */
export interface DueItemsResponse {
  items: DueItem[];
  total: number;
}

/**
 * Response from recordReview
 */
export interface ReviewResponse {
  progress: UserVocabularyProgress;
}

/**
 * Review input for batch review
 */
export interface ReviewInput {
  vocabulary_id: string;
  quality: number;
}

/**
 * Response from batch review
 */
export interface BatchReviewResponse {
  results: Array<{
    vocabulary_id: string;
    success: boolean;
    error?: string;
  }>;
}

/**
 * Progress response
 */
export interface ProgressResponse {
  progress: UserVocabularyProgress | null;
}

/**
 * Helper to make authenticated JSON requests
 */
async function httpJson<T>(
  input: RequestInfo,
  accessToken: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = await res.json();
      if (data?.error) msg = data.error as string;
    } catch {
      // ignore parse error
    }
    throw new Error(msg);
  }

  return res.json() as Promise<T>;
}

/**
 * Get vocabulary items due for review
 * @param accessToken - User's access token
 * @param limit - Maximum number of items to return (default 20)
 * @param jlptLevels - Optional JLPT level filter
 */
async function getDueItems(
  accessToken: string,
  limit = 20,
  jlptLevels?: JLPTLevel[],
): Promise<DueItemsResponse> {
  let url = getApiUrl(`srs/due?limit=${limit}`);
  if (jlptLevels && jlptLevels.length > 0) {
    url += `&jlpt=${jlptLevels.join(',')}`;
  }
  return httpJson<DueItemsResponse>(url, accessToken);
}

/**
 * Get SRS statistics for the current user
 * @param accessToken - User's access token
 */
async function getStats(accessToken: string): Promise<SRSStats> {
  return httpJson<SRSStats>(getApiUrl('srs/stats'), accessToken);
}

/**
 * Record a review result for a vocabulary item
 * @param accessToken - User's access token
 * @param vocabularyId - The vocabulary ID being reviewed
 * @param quality - Quality rating (0-5)
 */
async function recordReview(
  accessToken: string,
  vocabularyId: string,
  quality: number,
): Promise<ReviewResponse> {
  return httpJson<ReviewResponse>(getApiUrl('srs/review'), accessToken, {
    method: 'POST',
    body: JSON.stringify({ vocabulary_id: vocabularyId, quality }),
  });
}

/**
 * Record multiple reviews at once
 * @param accessToken - User's access token
 * @param reviews - Array of review inputs
 */
async function recordBatchReview(
  accessToken: string,
  reviews: ReviewInput[],
): Promise<BatchReviewResponse> {
  return httpJson<BatchReviewResponse>(getApiUrl('srs/batch-review'), accessToken, {
    method: 'POST',
    body: JSON.stringify({ reviews }),
  });
}

/**
 * Get progress for a specific vocabulary item
 * @param accessToken - User's access token
 * @param vocabularyId - The vocabulary ID
 */
async function getProgress(accessToken: string, vocabularyId: string): Promise<ProgressResponse> {
  return httpJson<ProgressResponse>(getApiUrl(`srs/progress/${vocabularyId}`), accessToken);
}

/**
 * Delete progress for a specific vocabulary item (reset)
 * @param accessToken - User's access token
 * @param vocabularyId - The vocabulary ID
 */
async function deleteProgress(
  accessToken: string,
  vocabularyId: string,
): Promise<{ success: boolean }> {
  return httpJson<{ success: boolean }>(getApiUrl(`srs/progress/${vocabularyId}`), accessToken, {
    method: 'DELETE',
  });
}

/**
 * Convert answer correctness to SM-2 quality rating
 *
 * Quality ratings:
 * - 5: Perfect response with fast recall
 * - 4: Correct response with good recall
 * - 3: Correct response but required significant effort
 * - 2: Incorrect but the correct answer seemed easy to recall
 * - 1: Incorrect with some memory of the correct answer
 * - 0: Complete blackout, no memory at all
 *
 * @param isCorrect - Whether the answer was correct
 * @param wasFast - Whether the response was quick (optional)
 * @param wasHesitant - Whether user hesitated before answering (optional)
 * @param wasClose - For incorrect answers, whether it was close (optional)
 * @param wasBlackout - Complete failure to recall (optional)
 */
function qualityFromCorrectness(
  isCorrect: boolean,
  wasFast = false,
  wasHesitant = false,
  wasClose = false,
  wasBlackout = false,
): number {
  if (isCorrect) {
    if (wasFast) return 5;
    if (wasHesitant) return 3;
    return 4;
  } else {
    if (wasBlackout) return 0;
    if (wasClose) return 2;
    return 1;
  }
}

export const srsService = {
  getDueItems,
  getStats,
  recordReview,
  recordBatchReview,
  getProgress,
  deleteProgress,
  qualityFromCorrectness,
};

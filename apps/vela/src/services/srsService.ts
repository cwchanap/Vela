import type { UserVocabularyProgress, Vocabulary, JLPTLevel } from 'src/types/database';
import { getApiUrl } from 'src/utils/api';
import { fetchAuthSession } from 'aws-amplify/auth';

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
 * Get Authorization header with JWT token
 */
async function getAuthHeader(): Promise<Record<string, string>> {
  try {
    const session = await fetchAuthSession();
    const idToken = session.tokens?.idToken?.toString();

    if (!idToken) {
      throw new Error('No authentication token available');
    }

    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    };
  } catch (error) {
    console.error('Failed to get auth token:', error);
    throw new Error('Authentication required. Please sign in.');
  }
}

/**
 * Helper to make authenticated JSON requests
 */
async function httpJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const headers = await getAuthHeader();

  const res = await fetch(input, {
    ...init,
    headers: {
      ...headers,
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
 * @param limit - Maximum number of items to return (default 20)
 * @param jlptLevels - Optional JLPT level filter
 */
async function getDueItems(limit = 20, jlptLevels?: JLPTLevel[]): Promise<DueItemsResponse> {
  let url = getApiUrl(`srs/due?limit=${limit}`);
  if (jlptLevels && jlptLevels.length > 0) {
    url += `&jlpt=${jlptLevels.join(',')}`;
  }
  return httpJson<DueItemsResponse>(url);
}

/**
 * Get SRS statistics for the current user
 * @param jlptLevels - Optional JLPT level filter
 */
async function getStats(jlptLevels?: JLPTLevel[]): Promise<SRSStats> {
  let url = getApiUrl('srs/stats');
  if (jlptLevels && jlptLevels.length > 0) {
    url += `?jlpt=${jlptLevels.join(',')}`;
  }
  return httpJson<SRSStats>(url);
}

/**
 * Record a review result for a vocabulary item
 * @param vocabularyId - The vocabulary ID being reviewed
 * @param quality - Quality rating (0-5)
 */
async function recordReview(vocabularyId: string, quality: number): Promise<ReviewResponse> {
  return httpJson<ReviewResponse>(getApiUrl('srs/review'), {
    method: 'POST',
    body: JSON.stringify({ vocabulary_id: vocabularyId, quality }),
  });
}

/**
 * Record multiple reviews at once
 * @param reviews - Array of review inputs
 */
async function recordBatchReview(reviews: ReviewInput[]): Promise<BatchReviewResponse> {
  return httpJson<BatchReviewResponse>(getApiUrl('srs/batch-review'), {
    method: 'POST',
    body: JSON.stringify({ reviews }),
  });
}

/**
 * Get progress for a specific vocabulary item
 * @param vocabularyId - The vocabulary ID
 */
async function getProgress(vocabularyId: string): Promise<ProgressResponse> {
  if (!vocabularyId || typeof vocabularyId !== 'string') {
    throw new Error('vocabularyId is required and must be a non-empty string');
  }
  const encodedVocabularyId = encodeURIComponent(vocabularyId);
  return httpJson<ProgressResponse>(getApiUrl(`srs/progress/${encodedVocabularyId}`));
}

/**
 * Delete progress for a specific vocabulary item (reset)
 * @param vocabularyId - The vocabulary ID
 */
async function deleteProgress(vocabularyId: string): Promise<{ success: boolean }> {
  if (!vocabularyId || typeof vocabularyId !== 'string') {
    throw new Error('vocabularyId is required and must be a non-empty string');
  }
  const encodedVocabularyId = encodeURIComponent(vocabularyId);
  return httpJson<{ success: boolean }>(getApiUrl(`srs/progress/${encodedVocabularyId}`), {
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

/**
 * Utility functions for flashcard review operations
 */

import type { ReviewInput } from 'src/services/srsService';

/**
 * Chunk an array into smaller arrays of specified size
 */
export function chunkArray<T>(array: T[], size: number): T[][] {
  if (size <= 0) {
    throw new Error('Chunk size must be a positive integer');
  }
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Merge multiple review lists, deduplicating by vocabulary_id (latest rating wins)
 */
export function mergeReviews(...lists: ReviewInput[][]): ReviewInput[] {
  const merged = new Map<string, ReviewInput>();
  lists.forEach((list) => {
    list.forEach((review: ReviewInput) => {
      // Use vocabulary_id as key for deduplication (latest rating wins)
      merged.set(review.vocabulary_id, review);
    });
  });
  return Array.from(merged.values());
}

/**
 * Type guard to check if a value is a valid ReviewInput
 */
export function isReviewInput(value: unknown): value is ReviewInput {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.vocabulary_id === 'string' &&
    typeof record.quality === 'number' &&
    record.quality >= 0 &&
    record.quality <= 5
  );
}

/**
 * Parse and validate pending reviews from localStorage JSON
 * Returns valid reviews and optionally logs warnings
 */
export function parsePendingReviews(
  jsonString: string,
  options?: { logWarnings?: boolean },
): { reviews: ReviewInput[]; hadErrors: boolean } {
  try {
    const parsed = JSON.parse(jsonString) as unknown;
    if (!Array.isArray(parsed)) {
      if (options?.logWarnings) {
        console.warn('Invalid pending flashcard reviews data. Clearing.');
      }
      return { reviews: [], hadErrors: true };
    }

    const reviews: ReviewInput[] = [];
    let hadErrors = false;

    for (const item of parsed) {
      if (isReviewInput(item)) {
        reviews.push(item);
      } else {
        hadErrors = true;
      }
    }

    if (hadErrors && options?.logWarnings) {
      console.warn('Some pending flashcard reviews were invalid and removed.');
    }

    return { reviews, hadErrors };
  } catch (error) {
    if (options?.logWarnings) {
      console.error('Failed to parse pending flashcard reviews:', error);
    }
    return { reviews: [], hadErrors: true };
  }
}

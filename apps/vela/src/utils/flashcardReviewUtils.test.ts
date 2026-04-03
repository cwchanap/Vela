import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  chunkArray,
  mergeReviews,
  isReviewInput,
  parsePendingReviews,
  extractFailedReviews,
} from './flashcardReviewUtils';
import type { ReviewInput, BatchReviewResponse } from 'src/services/srsService';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('chunkArray', () => {
  it('splits array into chunks of specified size', () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns single chunk when size >= array length', () => {
    expect(chunkArray([1, 2, 3], 5)).toEqual([[1, 2, 3]]);
  });

  it('returns empty array for empty input', () => {
    expect(chunkArray([], 3)).toEqual([]);
  });

  it('handles exact division', () => {
    expect(chunkArray([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it('throws for zero chunk size', () => {
    expect(() => chunkArray([1, 2, 3], 0)).toThrow('Chunk size must be a positive integer');
  });

  it('throws for negative chunk size', () => {
    expect(() => chunkArray([1, 2, 3], -1)).toThrow('Chunk size must be a positive integer');
  });

  it('throws for non-integer chunk size', () => {
    expect(() => chunkArray([1, 2, 3], 1.5)).toThrow('Chunk size must be a positive integer');
  });
});

describe('mergeReviews', () => {
  const r1: ReviewInput = { vocabulary_id: 'a', quality: 3 };
  const r2: ReviewInput = { vocabulary_id: 'b', quality: 4 };
  const r3: ReviewInput = { vocabulary_id: 'a', quality: 5 };

  it('merges multiple lists', () => {
    const result = mergeReviews([r1], [r2]);
    expect(result).toHaveLength(2);
  });

  it('deduplicates by vocabulary_id with latest winning', () => {
    const result = mergeReviews([r1], [r3]);
    expect(result).toHaveLength(1);
    expect(result[0]?.quality).toBe(5);
  });

  it('handles empty lists', () => {
    expect(mergeReviews([], [])).toEqual([]);
  });

  it('handles single list', () => {
    expect(mergeReviews([r1, r2])).toEqual([r1, r2]);
  });

  it('later list overrides earlier for same id', () => {
    const result = mergeReviews([r3], [r1]);
    expect(result[0]?.quality).toBe(3);
  });
});

describe('isReviewInput', () => {
  it('returns true for valid review input', () => {
    expect(isReviewInput({ vocabulary_id: 'abc', quality: 3 })).toBe(true);
  });

  it('returns true for quality boundary values 0 and 5', () => {
    expect(isReviewInput({ vocabulary_id: 'x', quality: 0 })).toBe(true);
    expect(isReviewInput({ vocabulary_id: 'x', quality: 5 })).toBe(true);
  });

  it('returns false for missing vocabulary_id', () => {
    expect(isReviewInput({ quality: 3 })).toBe(false);
  });

  it('returns false for non-string vocabulary_id', () => {
    expect(isReviewInput({ vocabulary_id: 123, quality: 3 })).toBe(false);
  });

  it('returns false for missing quality', () => {
    expect(isReviewInput({ vocabulary_id: 'x' })).toBe(false);
  });

  it('returns false for non-integer quality', () => {
    expect(isReviewInput({ vocabulary_id: 'x', quality: 2.5 })).toBe(false);
  });

  it('returns false for out-of-range quality', () => {
    expect(isReviewInput({ vocabulary_id: 'x', quality: 6 })).toBe(false);
    expect(isReviewInput({ vocabulary_id: 'x', quality: -1 })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isReviewInput(null)).toBe(false);
  });

  it('returns false for non-object', () => {
    expect(isReviewInput('string')).toBe(false);
    expect(isReviewInput(42)).toBe(false);
  });
});

describe('parsePendingReviews', () => {
  it('parses valid JSON array with valid reviews', () => {
    const json = JSON.stringify([{ vocabulary_id: 'a', quality: 3 }]);
    const { reviews, hadErrors } = parsePendingReviews(json);
    expect(reviews).toHaveLength(1);
    expect(hadErrors).toBe(false);
  });

  it('filters out invalid reviews', () => {
    const json = JSON.stringify([
      { vocabulary_id: 'a', quality: 3 },
      { vocabulary_id: 'b', quality: 99 },
    ]);
    const { reviews, hadErrors } = parsePendingReviews(json);
    expect(reviews).toHaveLength(1);
    expect(hadErrors).toBe(true);
  });

  it('logs a warning when invalid reviews are removed and warnings are enabled', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = parsePendingReviews(
      JSON.stringify([
        { vocabulary_id: 'a', quality: 3 },
        { vocabulary_id: 'b', quality: 99 },
      ]),
      { logWarnings: true },
    );

    expect(result).toEqual({
      reviews: [{ vocabulary_id: 'a', quality: 3 }],
      hadErrors: true,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      'Some pending flashcard reviews were invalid and removed.',
    );
  });

  it('returns empty and hadErrors for non-array JSON', () => {
    const { reviews, hadErrors } = parsePendingReviews('{"key":"value"}');
    expect(reviews).toEqual([]);
    expect(hadErrors).toBe(true);
  });

  it('logs a warning when non-array JSON is provided and warnings are enabled', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = parsePendingReviews('{"key":"value"}', { logWarnings: true });

    expect(result).toEqual({ reviews: [], hadErrors: true });
    expect(warnSpy).toHaveBeenCalledWith('Invalid pending flashcard reviews data. Clearing.');
  });

  it('returns empty and hadErrors for invalid JSON', () => {
    const { reviews, hadErrors } = parsePendingReviews('not-json');
    expect(reviews).toEqual([]);
    expect(hadErrors).toBe(true);
  });

  it('returns empty array for empty array JSON', () => {
    const { reviews, hadErrors } = parsePendingReviews('[]');
    expect(reviews).toEqual([]);
    expect(hadErrors).toBe(false);
  });

  it('does not log warnings when logWarnings is false', () => {
    const warnSpy = vi.spyOn(console, 'warn');
    const errorSpy = vi.spyOn(console, 'error');

    parsePendingReviews('not-json', { logWarnings: false });

    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('logs errors when logWarnings is true and JSON is unparseable', () => {
    const errorSpy = vi.spyOn(console, 'error');

    parsePendingReviews('not-json', { logWarnings: true });

    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('extractFailedReviews', () => {
  const reviews: ReviewInput[] = [
    { vocabulary_id: 'a', quality: 3 },
    { vocabulary_id: 'b', quality: 4 },
    { vocabulary_id: 'c', quality: 2 },
  ];

  it('returns reviews that failed in the response', () => {
    const response: BatchReviewResponse = {
      results: [
        { vocabulary_id: 'a', success: false },
        { vocabulary_id: 'b', success: true },
        { vocabulary_id: 'c', success: false },
      ],
    };
    const failed = extractFailedReviews(reviews, response);
    expect(failed).toHaveLength(2);
    expect(failed.map((r) => r.vocabulary_id)).toEqual(['a', 'c']);
  });

  it('returns empty array when all succeeded', () => {
    const response: BatchReviewResponse = {
      results: [
        { vocabulary_id: 'a', success: true },
        { vocabulary_id: 'b', success: true },
      ],
    };
    expect(extractFailedReviews(reviews, response)).toEqual([]);
  });

  it('returns empty array when response results is empty', () => {
    const response: BatchReviewResponse = { results: [] };
    expect(extractFailedReviews(reviews, response)).toEqual([]);
  });
});

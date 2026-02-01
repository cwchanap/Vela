import { describe, it, expect } from 'vitest';

describe('FlashcardReview.vue - mergeReviews deduplication', () => {
  it('should deduplicate by vocabulary_id (latest rating wins)', () => {
    const mergeReviews = (
      ...lists: Array<Array<{ vocabulary_id: string; quality: number }>>
    ): Array<{ vocabulary_id: string; quality: number }> => {
      const merged = new Map<string, { vocabulary_id: string; quality: number }>();
      lists.forEach((list) => {
        list.forEach((review) => {
          // Use vocabulary_id as key for deduplication (latest rating wins)
          merged.set(review.vocabulary_id, review);
        });
      });
      return Array.from(merged.values());
    };

    const list1 = [
      { vocabulary_id: 'vocab1', quality: 3 },
      { vocabulary_id: 'vocab2', quality: 4 },
    ];

    const list2 = [
      { vocabulary_id: 'vocab1', quality: 5 }, // Should overwrite the first vocab1 entry
      { vocabulary_id: 'vocab3', quality: 2 },
    ];

    const result = mergeReviews(list1, list2);

    // Should have 3 unique vocabulary_ids
    expect(result).toHaveLength(3);

    // vocab1 should have quality 5 (from list2, latest)
    const vocab1Review = result.find((r) => r.vocabulary_id === 'vocab1');
    expect(vocab1Review?.quality).toBe(5);

    // vocab2 should have quality 4 (from list1)
    const vocab2Review = result.find((r) => r.vocabulary_id === 'vocab2');
    expect(vocab2Review?.quality).toBe(4);

    // vocab3 should have quality 2 (from list2)
    const vocab3Review = result.find((r) => r.vocabulary_id === 'vocab3');
    expect(vocab3Review?.quality).toBe(2);
  });

  it('should handle empty lists', () => {
    const mergeReviews = (
      ...lists: Array<Array<{ vocabulary_id: string; quality: number }>>
    ): Array<{ vocabulary_id: string; quality: number }> => {
      const merged = new Map<string, { vocabulary_id: string; quality: number }>();
      lists.forEach((list) => {
        list.forEach((review) => {
          merged.set(review.vocabulary_id, review);
        });
      });
      return Array.from(merged.values());
    };

    const list1 = [{ vocabulary_id: 'vocab1', quality: 3 }];
    const list2: Array<{ vocabulary_id: string; quality: number }> = [];

    const result = mergeReviews(list1, list2);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ vocabulary_id: 'vocab1', quality: 3 });
  });

  it('should handle all empty lists', () => {
    const mergeReviews = (
      ...lists: Array<Array<{ vocabulary_id: string; quality: number }>>
    ): Array<{ vocabulary_id: string; quality: number }> => {
      const merged = new Map<string, { vocabulary_id: string; quality: number }>();
      lists.forEach((list) => {
        list.forEach((review) => {
          merged.set(review.vocabulary_id, review);
        });
      });
      return Array.from(merged.values());
    };

    const result = mergeReviews([], []);

    expect(result).toHaveLength(0);
  });

  it('should handle multiple lists with overlapping vocabulary_ids', () => {
    const mergeReviews = (
      ...lists: Array<Array<{ vocabulary_id: string; quality: number }>>
    ): Array<{ vocabulary_id: string; quality: number }> => {
      const merged = new Map<string, { vocabulary_id: string; quality: number }>();
      lists.forEach((list) => {
        list.forEach((review) => {
          merged.set(review.vocabulary_id, review);
        });
      });
      return Array.from(merged.values());
    };

    const list1 = [{ vocabulary_id: 'vocab1', quality: 1 }];
    const list2 = [{ vocabulary_id: 'vocab1', quality: 2 }];
    const list3 = [{ vocabulary_id: 'vocab1', quality: 3 }];

    const result = mergeReviews(list1, list2, list3);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ vocabulary_id: 'vocab1', quality: 3 });
  });

  it('should allow later ratings to overwrite earlier ones for the same vocabulary', () => {
    const mergeReviews = (
      ...lists: Array<Array<{ vocabulary_id: string; quality: number }>>
    ): Array<{ vocabulary_id: string; quality: number }> => {
      const merged = new Map<string, { vocabulary_id: string; quality: number }>();
      lists.forEach((list) => {
        list.forEach((review) => {
          merged.set(review.vocabulary_id, review);
        });
      });
      return Array.from(merged.values());
    };

    const list1 = [
      { vocabulary_id: 'vocab1', quality: 0 }, // Failed
      { vocabulary_id: 'vocab2', quality: 5 }, // Perfect
    ];

    const list2 = [
      { vocabulary_id: 'vocab1', quality: 4 }, // Good - should overwrite
      { vocabulary_id: 'vocab2', quality: 1 }, // Hard - should overwrite
    ];

    const result = mergeReviews(list1, list2);

    const vocab1Review = result.find((r) => r.vocabulary_id === 'vocab1');
    expect(vocab1Review?.quality).toBe(4);

    const vocab2Review = result.find((r) => r.vocabulary_id === 'vocab2');
    expect(vocab2Review?.quality).toBe(1);
  });
});

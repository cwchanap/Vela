import { describe, it, expect } from 'vitest';
import { calculateNextReview, isDue, calculateDueItems, SRS_DEFAULTS, type SRSItem } from './srs';

describe('SRS SM-2 Algorithm', () => {
  describe('calculateNextReview', () => {
    describe('initial state (first review)', () => {
      it('should set interval to 1 day for quality >= 3 on first correct review', () => {
        const result = calculateNextReview({
          quality: 4,
          easeFactor: SRS_DEFAULTS.EASE_FACTOR,
          interval: 0,
          repetitions: 0,
        });

        expect(result.interval).toBe(1);
        expect(result.repetitions).toBe(1);
      });

      it('should reset to initial state for quality < 3 (incorrect answer)', () => {
        const result = calculateNextReview({
          quality: 1,
          easeFactor: 2.5,
          interval: 10,
          repetitions: 5,
        });

        expect(result.interval).toBe(1);
        expect(result.repetitions).toBe(0);
      });
    });

    describe('quality ratings 0-5', () => {
      it('should handle quality 0 (complete blackout) - reset', () => {
        const result = calculateNextReview({
          quality: 0,
          easeFactor: 2.5,
          interval: 6,
          repetitions: 3,
        });

        expect(result.repetitions).toBe(0);
        expect(result.interval).toBe(1);
      });

      it('should handle quality 1 (incorrect, remembered upon seeing answer)', () => {
        const result = calculateNextReview({
          quality: 1,
          easeFactor: 2.5,
          interval: 6,
          repetitions: 3,
        });

        expect(result.repetitions).toBe(0);
        expect(result.interval).toBe(1);
      });

      it('should handle quality 2 (incorrect, easy to recall)', () => {
        const result = calculateNextReview({
          quality: 2,
          easeFactor: 2.5,
          interval: 6,
          repetitions: 3,
        });

        expect(result.repetitions).toBe(0);
        expect(result.interval).toBe(1);
      });

      it('should handle quality 3 (correct with serious difficulty)', () => {
        const result = calculateNextReview({
          quality: 3,
          easeFactor: 2.5,
          interval: 6,
          repetitions: 3,
        });

        expect(result.repetitions).toBe(4);
        expect(result.interval).toBeGreaterThan(6);
      });

      it('should handle quality 4 (correct with hesitation)', () => {
        const result = calculateNextReview({
          quality: 4,
          easeFactor: 2.5,
          interval: 6,
          repetitions: 3,
        });

        expect(result.repetitions).toBe(4);
        expect(result.interval).toBeGreaterThan(6);
      });

      it('should handle quality 5 (perfect response)', () => {
        const result = calculateNextReview({
          quality: 5,
          easeFactor: 2.5,
          interval: 6,
          repetitions: 3,
        });

        expect(result.repetitions).toBe(4);
        expect(result.interval).toBeGreaterThan(6);
        expect(result.easeFactor).toBeGreaterThan(2.5);
      });
    });

    describe('ease factor bounds', () => {
      it('should never go below minimum ease factor of 1.3', () => {
        let result = calculateNextReview({
          quality: 0,
          easeFactor: 1.5,
          interval: 1,
          repetitions: 1,
        });

        expect(result.easeFactor).toBeGreaterThanOrEqual(SRS_DEFAULTS.MIN_EASE_FACTOR);

        result = calculateNextReview({
          quality: 0,
          easeFactor: 1.3,
          interval: 1,
          repetitions: 0,
        });

        expect(result.easeFactor).toBe(SRS_DEFAULTS.MIN_EASE_FACTOR);
      });

      it('should allow ease factor to increase without upper bound', () => {
        const result = calculateNextReview({
          quality: 5,
          easeFactor: 3.0,
          interval: 10,
          repetitions: 5,
        });

        expect(result.easeFactor).toBeGreaterThan(3.0);
      });
    });

    describe('interval progression', () => {
      it('should follow SM-2 interval progression: 1 -> 6 -> (6 * EF)', () => {
        const first = calculateNextReview({
          quality: 4,
          easeFactor: 2.5,
          interval: 0,
          repetitions: 0,
        });
        expect(first.interval).toBe(1);
        expect(first.repetitions).toBe(1);

        const second = calculateNextReview({
          quality: 4,
          easeFactor: first.easeFactor,
          interval: first.interval,
          repetitions: first.repetitions,
        });
        expect(second.interval).toBe(6);
        expect(second.repetitions).toBe(2);

        const third = calculateNextReview({
          quality: 4,
          easeFactor: second.easeFactor,
          interval: second.interval,
          repetitions: second.repetitions,
        });
        expect(third.interval).toBe(Math.round(6 * second.easeFactor));
        expect(third.repetitions).toBe(3);
      });

      it('should calculate correct next review date', () => {
        const now = new Date('2024-12-30T10:00:00Z');

        const result = calculateNextReview(
          {
            quality: 4,
            easeFactor: 2.5,
            interval: 0,
            repetitions: 0,
          },
          now,
        );

        const expectedDate = new Date('2024-12-31T10:00:00Z');
        expect(result.nextReviewDate).toBe(expectedDate.toISOString());
      });
    });

    describe('edge cases', () => {
      it('should handle very long intervals', () => {
        const result = calculateNextReview({
          quality: 5,
          easeFactor: 2.5,
          interval: 365,
          repetitions: 10,
        });

        expect(result.interval).toBeGreaterThan(365);
        expect(typeof result.nextReviewDate).toBe('string');
      });

      it('should handle minimum valid inputs', () => {
        const result = calculateNextReview({
          quality: 0,
          easeFactor: SRS_DEFAULTS.MIN_EASE_FACTOR,
          interval: 0,
          repetitions: 0,
        });

        expect(result).toBeDefined();
        expect(result.easeFactor).toBe(SRS_DEFAULTS.MIN_EASE_FACTOR);
      });
    });
  });

  describe('isDue', () => {
    const mockNow = new Date('2024-12-30T12:00:00Z');

    it('should return true for past dates', () => {
      expect(isDue('2024-12-29T12:00:00Z', mockNow)).toBe(true);
      expect(isDue('2024-12-01T00:00:00Z', mockNow)).toBe(true);
      expect(isDue('2023-01-01T00:00:00Z', mockNow)).toBe(true);
    });

    it('should return true for current date/time', () => {
      expect(isDue('2024-12-30T12:00:00Z', mockNow)).toBe(true);
    });

    it('should return false for future dates', () => {
      expect(isDue('2024-12-31T12:00:00Z', mockNow)).toBe(false);
      expect(isDue('2025-01-01T00:00:00Z', mockNow)).toBe(false);
    });

    it('should handle date-only strings (assumes start of day)', () => {
      expect(isDue('2024-12-29', mockNow)).toBe(true);
      expect(isDue('2024-12-30', mockNow)).toBe(true);
      expect(isDue('2024-12-31', mockNow)).toBe(false);
    });
  });

  describe('calculateDueItems', () => {
    const mockNow = new Date('2024-12-30T12:00:00Z');

    const mockItems: SRSItem[] = [
      {
        vocabulary_id: 'vocab-1',
        user_id: 'user-1',
        next_review_date: '2024-12-29T00:00:00Z',
        ease_factor: 2.5,
        interval: 1,
        repetitions: 1,
      },
      {
        vocabulary_id: 'vocab-2',
        user_id: 'user-1',
        next_review_date: '2024-12-31T00:00:00Z',
        ease_factor: 2.5,
        interval: 6,
        repetitions: 2,
      },
      {
        vocabulary_id: 'vocab-3',
        user_id: 'user-1',
        next_review_date: '2024-12-28T00:00:00Z',
        ease_factor: 2.3,
        interval: 1,
        repetitions: 1,
      },
      {
        vocabulary_id: 'vocab-4',
        user_id: 'user-1',
        next_review_date: '2024-12-30T10:00:00Z',
        ease_factor: 2.5,
        interval: 3,
        repetitions: 2,
      },
    ];

    it('should filter only due items', () => {
      const dueItems = calculateDueItems(mockItems, mockNow);

      expect(dueItems).toHaveLength(3);
      expect(dueItems.map((i) => i.vocabulary_id)).toContain('vocab-1');
      expect(dueItems.map((i) => i.vocabulary_id)).toContain('vocab-3');
      expect(dueItems.map((i) => i.vocabulary_id)).toContain('vocab-4');
      expect(dueItems.map((i) => i.vocabulary_id)).not.toContain('vocab-2');
    });

    it('should sort by overdue time (most overdue first)', () => {
      const dueItems = calculateDueItems(mockItems, mockNow);

      expect(dueItems[0].vocabulary_id).toBe('vocab-3');
      expect(dueItems[1].vocabulary_id).toBe('vocab-1');
      expect(dueItems[2].vocabulary_id).toBe('vocab-4');
    });

    it('should return empty array when no items are due', () => {
      const futureItems: SRSItem[] = [
        {
          vocabulary_id: 'vocab-1',
          user_id: 'user-1',
          next_review_date: '2024-12-31T00:00:00Z',
          ease_factor: 2.5,
          interval: 1,
          repetitions: 1,
        },
      ];

      const dueItems = calculateDueItems(futureItems, mockNow);
      expect(dueItems).toHaveLength(0);
    });

    it('should handle empty input array', () => {
      const dueItems = calculateDueItems([], mockNow);
      expect(dueItems).toHaveLength(0);
    });
  });
});

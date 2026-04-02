import { describe, test, expect, beforeAll, mock } from 'bun:test';
import type { SRSItem } from '../../src/utils/srs';

type SrsModule = typeof import('../../src/utils/srs');

// Lazy references — populated in beforeAll after restoring real module
let calculateNextReview: SrsModule['calculateNextReview'];
let srsItemToResult: SrsModule['srsItemToResult'];
let isDue: SrsModule['isDue'];
let calculateDueItems: SrsModule['calculateDueItems'];
let SRS_DEFAULTS: SrsModule['SRS_DEFAULTS'];

beforeAll(async () => {
  // Bun's module registry is shared across test files in the same worker process.
  // Other test files (e.g. test/routes/srs.test.ts) mock this module via mock.module().
  // Calling mock.restore() here resets the registry so the dynamic import below
  // resolves to the real implementation, not the mock.
  mock.restore();
  const srsModule = await import('../../src/utils/srs');
  calculateNextReview = srsModule.calculateNextReview;
  srsItemToResult = srsModule.srsItemToResult;
  isDue = srsModule.isDue;
  calculateDueItems = srsModule.calculateDueItems;
  SRS_DEFAULTS = srsModule.SRS_DEFAULTS;
});

const FIXED_NOW = new Date('2026-01-15T12:00:00.000Z');

describe('SRS_DEFAULTS', () => {
  test('has expected default values', () => {
    expect(SRS_DEFAULTS.EASE_FACTOR).toBe(2.5);
    expect(SRS_DEFAULTS.MIN_EASE_FACTOR).toBe(1.3);
    expect(SRS_DEFAULTS.INITIAL_INTERVAL).toBe(1);
    expect(SRS_DEFAULTS.SECOND_INTERVAL).toBe(6);
  });
});

describe('calculateNextReview', () => {
  describe('incorrect answers (quality < 3)', () => {
    test('resets repetitions to 0 and interval to 1 for quality 0', () => {
      const result = calculateNextReview(
        { quality: 0, easeFactor: 2.5, interval: 10, repetitions: 3 },
        FIXED_NOW,
      );
      expect(result.repetitions).toBe(0);
      expect(result.interval).toBe(1);
      expect(result.easeFactor).toBe(2.5);
    });

    test('resets repetitions to 0 and interval to 1 for quality 1', () => {
      const result = calculateNextReview(
        { quality: 1, easeFactor: 2.5, interval: 10, repetitions: 5 },
        FIXED_NOW,
      );
      expect(result.repetitions).toBe(0);
      expect(result.interval).toBe(1);
    });

    test('resets repetitions to 0 and interval to 1 for quality 2', () => {
      const result = calculateNextReview(
        { quality: 2, easeFactor: 2.5, interval: 6, repetitions: 2 },
        FIXED_NOW,
      );
      expect(result.repetitions).toBe(0);
      expect(result.interval).toBe(1);
    });

    test('does not modify ease factor for incorrect answers', () => {
      const result = calculateNextReview(
        { quality: 2, easeFactor: 2.5, interval: 10, repetitions: 2 },
        FIXED_NOW,
      );
      expect(result.easeFactor).toBe(2.5);
    });

    test('schedules next review 1 day from now', () => {
      const result = calculateNextReview(
        { quality: 1, easeFactor: 2.5, interval: 10, repetitions: 3 },
        FIXED_NOW,
      );
      const expected = new Date('2026-01-16T12:00:00.000Z');
      expect(new Date(result.nextReviewDate).toDateString()).toBe(expected.toDateString());
    });
  });

  describe('correct answers (quality >= 3)', () => {
    test('sets interval to 1 on first successful repetition (repetitions becomes 1)', () => {
      const result = calculateNextReview(
        { quality: 4, easeFactor: 2.5, interval: 0, repetitions: 0 },
        FIXED_NOW,
      );
      expect(result.repetitions).toBe(1);
      expect(result.interval).toBe(1);
    });

    test('sets interval to 6 on second successful repetition (repetitions becomes 2)', () => {
      const result = calculateNextReview(
        { quality: 4, easeFactor: 2.5, interval: 1, repetitions: 1 },
        FIXED_NOW,
      );
      expect(result.repetitions).toBe(2);
      expect(result.interval).toBe(6);
    });

    test('multiplies interval by new ease factor for third+ repetition', () => {
      const result = calculateNextReview(
        { quality: 4, easeFactor: 2.5, interval: 6, repetitions: 2 },
        FIXED_NOW,
      );
      expect(result.repetitions).toBe(3);
      // quality 4: EF' = 2.5 + (0.1 - (5-4)*(0.08 + (5-4)*0.02)) = 2.5 + (0.1 - 0.1) = 2.5
      expect(result.easeFactor).toBeCloseTo(2.5);
      expect(result.interval).toBe(Math.round(6 * result.easeFactor));
    });

    test('increases ease factor for perfect response (quality 5)', () => {
      const result = calculateNextReview(
        { quality: 5, easeFactor: 2.5, interval: 1, repetitions: 1 },
        FIXED_NOW,
      );
      // EF' = 2.5 + (0.1 - 0*(0.08 + 0*0.02)) = 2.5 + 0.1 = 2.6
      expect(result.easeFactor).toBeCloseTo(2.6);
    });

    test('decreases ease factor for barely correct response (quality 3)', () => {
      const result = calculateNextReview(
        { quality: 3, easeFactor: 2.5, interval: 1, repetitions: 1 },
        FIXED_NOW,
      );
      // EF' = 2.5 + (0.1 - (5-3)*(0.08 + (5-3)*0.02)) = 2.5 + (0.1 - 2*(0.08+0.04)) = 2.5 + (0.1 - 0.24) = 2.36
      expect(result.easeFactor).toBeCloseTo(2.36);
    });

    test('clamps ease factor at minimum (1.3)', () => {
      const result = calculateNextReview(
        { quality: 3, easeFactor: 1.3, interval: 6, repetitions: 2 },
        FIXED_NOW,
      );
      expect(result.easeFactor).toBeGreaterThanOrEqual(SRS_DEFAULTS.MIN_EASE_FACTOR);
    });

    test('schedules next review in correct number of days', () => {
      const result = calculateNextReview(
        { quality: 5, easeFactor: 2.5, interval: 0, repetitions: 0 },
        FIXED_NOW,
      );
      // First repetition: interval = 1
      const expected = new Date('2026-01-16T12:00:00.000Z');
      expect(new Date(result.nextReviewDate).toDateString()).toBe(expected.toDateString());
    });

    test('returns nextReviewDate as ISO string', () => {
      const result = calculateNextReview(
        { quality: 4, easeFactor: 2.5, interval: 0, repetitions: 0 },
        FIXED_NOW,
      );
      expect(typeof result.nextReviewDate).toBe('string');
      expect(Number.isNaN(new Date(result.nextReviewDate).getTime())).toBe(false);
    });
  });

  describe('uses current time when now is not provided', () => {
    test('returns a future nextReviewDate when now is omitted', () => {
      const result = calculateNextReview({
        quality: 4,
        easeFactor: 2.5,
        interval: 0,
        repetitions: 0,
      });
      const nextDate = new Date(result.nextReviewDate);
      expect(nextDate.getTime()).toBeGreaterThan(Date.now());
    });
  });
});

describe('srsItemToResult', () => {
  const dbItem: SRSItem = {
    vocabulary_id: 'vocab-1',
    user_id: 'user-1',
    next_review_date: '2026-02-01T00:00:00.000Z',
    ease_factor: 2.3,
    interval: 10,
    repetitions: 4,
  };

  test('maps snake_case db fields to camelCase result fields', () => {
    const result = srsItemToResult(dbItem);
    expect(result.easeFactor).toBe(2.3);
    expect(result.interval).toBe(10);
    expect(result.repetitions).toBe(4);
    expect(result.nextReviewDate).toBe('2026-02-01T00:00:00.000Z');
  });

  test('does not include vocabulary_id or user_id in result', () => {
    const result = srsItemToResult(dbItem);
    expect('vocabulary_id' in result).toBe(false);
    expect('user_id' in result).toBe(false);
  });

  test('preserves exact numeric values', () => {
    const item: SRSItem = {
      vocabulary_id: 'v',
      user_id: 'u',
      next_review_date: '2026-01-01T00:00:00.000Z',
      ease_factor: 1.3,
      interval: 0,
      repetitions: 0,
    };
    const result = srsItemToResult(item);
    expect(result.easeFactor).toBe(1.3);
    expect(result.interval).toBe(0);
    expect(result.repetitions).toBe(0);
  });
});

describe('isDue', () => {
  test('returns true when review date is in the past', () => {
    const past = new Date(FIXED_NOW.getTime() - 86_400_000).toISOString(); // yesterday
    expect(isDue(past, FIXED_NOW)).toBe(true);
  });

  test('returns true when review date equals now', () => {
    expect(isDue(FIXED_NOW.toISOString(), FIXED_NOW)).toBe(true);
  });

  test('returns false when review date is in the future', () => {
    const future = new Date(FIXED_NOW.getTime() + 86_400_000).toISOString(); // tomorrow
    expect(isDue(future, FIXED_NOW)).toBe(false);
  });

  test('uses current time when now is omitted', () => {
    const pastDate = new Date(Date.now() - 86_400_000).toISOString();
    expect(isDue(pastDate)).toBe(true);

    const futureDate = new Date(Date.now() + 86_400_000).toISOString();
    expect(isDue(futureDate)).toBe(false);
  });
});

describe('calculateDueItems', () => {
  const makeItem = (id: string, daysOffset: number): SRSItem => ({
    vocabulary_id: id,
    user_id: 'user-1',
    next_review_date: new Date(FIXED_NOW.getTime() + daysOffset * 86_400_000).toISOString(),
    ease_factor: 2.5,
    interval: 1,
    repetitions: 0,
  });

  test('returns only items that are due', () => {
    const items = [
      makeItem('past-2', -2), // due 2 days ago
      makeItem('past-1', -1), // due yesterday
      makeItem('future-1', 1), // due tomorrow
    ];
    const due = calculateDueItems(items, FIXED_NOW);
    expect(due).toHaveLength(2);
    expect(due.map((i) => i.vocabulary_id)).toEqual(expect.arrayContaining(['past-2', 'past-1']));
  });

  test('returns empty array when no items are due', () => {
    const items = [makeItem('future-1', 1), makeItem('future-2', 7)];
    const due = calculateDueItems(items, FIXED_NOW);
    expect(due).toHaveLength(0);
  });

  test('sorts due items by most overdue first', () => {
    const items = [
      makeItem('overdue-1d', -1),
      makeItem('overdue-3d', -3),
      makeItem('overdue-2d', -2),
    ];
    const due = calculateDueItems(items, FIXED_NOW);
    expect(due[0].vocabulary_id).toBe('overdue-3d');
    expect(due[1].vocabulary_id).toBe('overdue-2d');
    expect(due[2].vocabulary_id).toBe('overdue-1d');
  });

  test('includes item due exactly now', () => {
    const items = [makeItem('now', 0)];
    const due = calculateDueItems(items, FIXED_NOW);
    expect(due).toHaveLength(1);
  });

  test('returns empty array for empty input', () => {
    expect(calculateDueItems([], FIXED_NOW)).toHaveLength(0);
  });
});

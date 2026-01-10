/**
 * SM-2 Spaced Repetition Algorithm Implementation
 *
 * This implements the SuperMemo 2 (SM-2) algorithm for spaced repetition.
 * The algorithm calculates the optimal time to review items based on
 * performance quality.
 *
 * Quality ratings:
 * 0 - Complete blackout, no recall
 * 1 - Incorrect, but upon seeing answer, remembered
 * 2 - Incorrect, but answer seemed easy to recall
 * 3 - Correct with serious difficulty
 * 4 - Correct with some hesitation
 * 5 - Perfect response
 */

/**
 * Default values for SRS calculations
 */
export const SRS_DEFAULTS = {
  /** Initial ease factor for new items */
  EASE_FACTOR: 2.5,
  /** Minimum ease factor (items don't get harder than this) */
  MIN_EASE_FACTOR: 1.3,
  /** Initial interval for first successful review (in days) */
  INITIAL_INTERVAL: 1,
  /** Interval after second successful review (in days) */
  SECOND_INTERVAL: 6,
} as const;

/**
 * Represents an item being tracked in the SRS system
 *
 * DB-facing type: Uses snake_case to match database column names.
 * This represents the raw database row structure.
 */
export interface SRSItem {
  vocabulary_id: string;
  user_id: string;
  next_review_date: string;
  ease_factor: number;
  interval: number;
  repetitions: number;
}

/**
 * Input parameters for calculating the next review
 */
export interface SRSInput {
  /** Quality of response (0-5) */
  quality: number;
  /** Current ease factor */
  easeFactor: number;
  /** Current interval in days */
  interval: number;
  /** Number of successful repetitions */
  repetitions: number;
}

/**
 * Result of the SRS calculation
 *
 * Application-facing type: Uses camelCase to match JavaScript/TypeScript conventions.
 * This represents the transformed application object used in business logic.
 */
export interface SRSResult {
  /** New ease factor */
  easeFactor: number;
  /** New interval in days */
  interval: number;
  /** Updated repetition count */
  repetitions: number;
  /** ISO string of the next review date */
  nextReviewDate: string;
}

/**
 * Calculate the next review parameters using the SM-2 algorithm
 *
 * @param input - Current SRS state and quality of response
 * @param now - Optional date to use as "now" (for testing)
 * @returns Updated SRS parameters including next review date
 */
export function calculateNextReview(input: SRSInput, now?: Date): SRSResult {
  const { quality, easeFactor, interval, repetitions } = input;

  let newEaseFactor = easeFactor;
  let newInterval: number;
  let newRepetitions: number;

  // If quality < 3, reset the repetition count (incorrect answer)
  if (quality < 3) {
    newRepetitions = 0;
    newInterval = SRS_DEFAULTS.INITIAL_INTERVAL;
  } else {
    // Correct answer - calculate new ease factor first
    // EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
    // Where q is quality (0-5) and EF is ease factor
    newEaseFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));

    // Ensure ease factor doesn't go below minimum
    newEaseFactor = Math.max(newEaseFactor, SRS_DEFAULTS.MIN_EASE_FACTOR);

    newRepetitions = repetitions + 1;

    if (newRepetitions === 1) {
      // First successful review
      newInterval = SRS_DEFAULTS.INITIAL_INTERVAL;
    } else if (newRepetitions === 2) {
      // Second successful review
      newInterval = SRS_DEFAULTS.SECOND_INTERVAL;
    } else {
      // Subsequent reviews: interval = previous interval * NEW ease factor
      // This ensures the interval immediately reflects the current quality rating
      newInterval = Math.round(interval * newEaseFactor);
    }
  }

  // Calculate next review date
  const currentDate = now ?? new Date();
  const nextReviewDate = new Date(currentDate);
  nextReviewDate.setDate(nextReviewDate.getDate() + newInterval);

  return {
    easeFactor: newEaseFactor,
    interval: newInterval,
    repetitions: newRepetitions,
    nextReviewDate: nextReviewDate.toISOString(),
  };
}

/**
 * Convert a DB-facing SRSItem (snake_case) to an application-facing object (camelCase)
 *
 * This mapper function documents the DB boundary and transforms between conventions.
 * Use this when transitioning data from the database layer to the application layer.
 *
 * @param item - DB-facing SRS item with snake_case fields
 * @returns Application-facing object with camelCase fields
 */
export function srsItemToResult(item: SRSItem): SRSResult {
  return {
    easeFactor: item.ease_factor,
    interval: item.interval,
    repetitions: item.repetitions,
    nextReviewDate: item.next_review_date,
  };
}

/**
 * Check if an item is due for review
 *
 * @param nextReviewDate - ISO date string of when item is due
 * @param now - Optional date to use as "now" (for testing)
 * @returns true if the item is due for review
 */
export function isDue(nextReviewDate: string, now?: Date): boolean {
  const reviewDate = new Date(nextReviewDate);
  const currentDate = now ?? new Date();
  return reviewDate <= currentDate;
}

/**
 * Filter and sort items that are due for review
 *
 * @param items - Array of SRS items to filter
 * @param now - Optional date to use as "now" (for testing)
 * @returns Array of due items, sorted by most overdue first
 */
export function calculateDueItems(items: SRSItem[], now?: Date): SRSItem[] {
  return items
    .filter((item) => isDue(item.next_review_date, now))
    .sort((a, b) => {
      const aDate = new Date(a.next_review_date);
      const bDate = new Date(b.next_review_date);
      return aDate.getTime() - bDate.getTime();
    });
}

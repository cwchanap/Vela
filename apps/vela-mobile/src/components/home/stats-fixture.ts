import type { SRSStats } from '@vela/common';

export function dueReviewStats(dueToday: number): SRSStats {
  return {
    total_items: dueToday,
    due_today: dueToday,
    mastery_breakdown: { new: 0, learning: 0, reviewing: dueToday, mastered: 0 },
    average_ease_factor: 2.5,
    total_reviews: 0,
    accuracy_rate: 100,
  };
}

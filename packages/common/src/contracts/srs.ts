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

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`invalid_srs_stats:${field}`);
  }
  return value as Record<string, unknown>;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new TypeError(`invalid_srs_stats:${field}`);
  }
  return value as number;
}

function finiteNonNegative(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`invalid_srs_stats:${field}`);
  }
  return value;
}

export function parseSrsStats(value: unknown): SRSStats {
  const root = record(value, 'root');
  const mastery = record(root.mastery_breakdown, 'mastery_breakdown');
  const accuracyRate = finiteNonNegative(root.accuracy_rate, 'accuracy_rate');

  if (accuracyRate > 100) {
    throw new TypeError('invalid_srs_stats:accuracy_rate');
  }

  return {
    total_items: nonNegativeInteger(root.total_items, 'total_items'),
    due_today: nonNegativeInteger(root.due_today, 'due_today'),
    mastery_breakdown: {
      new: nonNegativeInteger(mastery.new, 'mastery_breakdown.new'),
      learning: nonNegativeInteger(mastery.learning, 'mastery_breakdown.learning'),
      reviewing: nonNegativeInteger(mastery.reviewing, 'mastery_breakdown.reviewing'),
      mastered: nonNegativeInteger(mastery.mastered, 'mastery_breakdown.mastered'),
    },
    average_ease_factor: finiteNonNegative(root.average_ease_factor, 'average_ease_factor'),
    total_reviews: nonNegativeInteger(root.total_reviews, 'total_reviews'),
    accuracy_rate: accuracyRate,
  };
}

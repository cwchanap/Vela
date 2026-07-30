import { describe, expect, it } from 'vitest';
import { parseSrsStats, type SRSStats } from './srs';

const validStats: SRSStats = {
  total_items: 12,
  due_today: 3,
  mastery_breakdown: {
    new: 2,
    learning: 4,
    reviewing: 3,
    mastered: 3,
  },
  average_ease_factor: 2.47,
  total_reviews: 31,
  accuracy_rate: 87,
};

describe('parseSrsStats', () => {
  it('parses the complete production response and ignores additive fields', () => {
    expect(parseSrsStats({ ...validStats, generated_at: '2026-07-30T00:00:00Z' })).toEqual(
      validStats,
    );
  });

  it.each([
    ['total_items', { ...validStats, total_items: -1 }],
    ['due_today', { ...validStats, due_today: 1.5 }],
    [
      'mastery_breakdown.new',
      {
        ...validStats,
        mastery_breakdown: { ...validStats.mastery_breakdown, new: Number.NaN },
      },
    ],
    ['average_ease_factor', { ...validStats, average_ease_factor: Number.POSITIVE_INFINITY }],
    ['accuracy_rate', { ...validStats, accuracy_rate: 101 }],
  ])('rejects invalid %s', (field, value) => {
    expect(() => parseSrsStats(value)).toThrow(`invalid_srs_stats:${field}`);
  });

  it('rejects a missing nested field', () => {
    const { mastered: _mastered, ...mastery_breakdown } = validStats.mastery_breakdown;
    void _mastered;
    expect(() => parseSrsStats({ ...validStats, mastery_breakdown })).toThrow(
      'invalid_srs_stats:mastery_breakdown.mastered',
    );
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { MobileApiClient } from './mobile-api-client';
import { createMobileSrsService } from './mobile-srs';

const stats = {
  total_items: 12,
  due_today: 4,
  mastery_breakdown: { new: 1, learning: 2, reviewing: 3, mastered: 6 },
  average_ease_factor: 2.5,
  total_reviews: 21,
  accuracy_rate: 80,
};

describe('mobile SRS service', () => {
  it('loads stats through the exact authenticated SRS path and caller signal', async () => {
    const signal = new AbortController().signal;
    const apiClient: MobileApiClient = { getJson: vi.fn().mockResolvedValue(stats) };

    await expect(createMobileSrsService(apiClient).getStats({ signal })).resolves.toEqual(stats);
    expect(apiClient.getJson).toHaveBeenCalledWith('srs/stats', { signal });
  });

  it('maps malformed stats to invalid_response', async () => {
    const apiClient: MobileApiClient = { getJson: vi.fn().mockResolvedValue({ due_today: -1 }) };

    await expect(createMobileSrsService(apiClient).getStats()).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
});

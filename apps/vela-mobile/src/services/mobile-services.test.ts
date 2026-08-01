import type { App } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import type { MobileAuthCoordinator } from '../auth/mobile-auth-contract';
import {
  MOBILE_API_CLIENT_KEY,
  MOBILE_SRS_SERVICE_KEY,
  MOBILE_TTS_SERVICE_KEY,
  provideMobileServices,
} from './mobile-services';

describe('mobile service provisioning', () => {
  it('provides SRS and TTS services from one API client', async () => {
    const coordinator = {
      state: {},
      requestAuthenticatedApi: vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: vi.fn().mockResolvedValue({
          total_items: 0,
          due_today: 0,
          mastery_breakdown: { new: 0, learning: 0, reviewing: 0, mastered: 0 },
          average_ease_factor: 0,
          total_reviews: 0,
          accuracy_rate: 0,
        }),
      }),
    } as unknown as MobileAuthCoordinator;
    const app = { provide: vi.fn() } as unknown as App;

    provideMobileServices(app, coordinator);

    const apiClient = (app.provide as ReturnType<typeof vi.fn>).mock.calls.find(
      ([key]) => key === MOBILE_API_CLIENT_KEY,
    )?.[1];
    const srsService = (app.provide as ReturnType<typeof vi.fn>).mock.calls.find(
      ([key]) => key === MOBILE_SRS_SERVICE_KEY,
    )?.[1];
    const ttsService = (app.provide as ReturnType<typeof vi.fn>).mock.calls.find(
      ([key]) => key === MOBILE_TTS_SERVICE_KEY,
    )?.[1];
    await expect(srsService.getStats()).resolves.toMatchObject({ due_today: 0 });
    expect(apiClient).toBeDefined();
    expect(ttsService).toBeDefined();
    expect(coordinator.requestAuthenticatedApi).toHaveBeenCalledOnce();
  });
});

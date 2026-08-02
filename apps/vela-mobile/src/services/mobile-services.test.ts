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

  it('gives SRS and TTS the exact API client instance returned by the registry', async () => {
    const coordinator = {
      state: {},
      requestAuthenticatedApi: vi.fn(),
    } as unknown as MobileAuthCoordinator;
    const app = { provide: vi.fn() } as unknown as App;
    const services = provideMobileServices(app, coordinator);
    const getJson = vi.fn().mockImplementation(async (path: string) =>
      path === 'srs/stats'
        ? {
            total_items: 0,
            due_today: 0,
            mastery_breakdown: { new: 0, learning: 0, reviewing: 0, mastered: 0 },
            average_ease_factor: 0,
            total_reviews: 0,
            accuracy_rate: 0,
          }
        : { provider: 'openai', voiceId: 'alloy', model: 'tts-1', hasApiKey: true },
    );
    const postJson = vi.fn().mockResolvedValue({
      audioUrl: 'https://audio.example.test/tts/user/vocabulary/settings-hash',
      cached: false,
    });
    services.apiClient.getJson = getJson;
    services.apiClient.postJson = postJson;

    await services.srsService.getStats();
    await services.ttsService.preparePronunciation({
      userId: 'user-1',
      vocabularyId: '水:ミズ',
      text: '水',
    });

    expect(getJson).toHaveBeenCalledWith('srs/stats', {});
    expect(getJson).toHaveBeenCalledWith('tts/settings');
    expect(postJson).toHaveBeenCalledWith(
      'tts/generate',
      { vocabularyId: '水:ミズ', text: '水' },
      { timeoutMs: 45_000 },
    );
    expect(coordinator.requestAuthenticatedApi).not.toHaveBeenCalled();
  });
});

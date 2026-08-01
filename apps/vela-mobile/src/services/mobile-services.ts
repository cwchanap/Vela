import type { App, InjectionKey } from 'vue';
import type { MobileAuthCoordinator } from '../auth/mobile-auth-contract';
import { createMobileApiClient, type MobileApiClient } from './mobile-api-client';
import { createMobileSrsService, type MobileSrsService } from './mobile-srs';
import { createMobileTtsService, type MobileTtsService } from './mobile-tts';

export const MOBILE_API_CLIENT_KEY: InjectionKey<MobileApiClient> = Symbol('mobile-api-client');
export const MOBILE_SRS_SERVICE_KEY: InjectionKey<MobileSrsService> = Symbol('mobile-srs-service');
export const MOBILE_TTS_SERVICE_KEY: InjectionKey<MobileTtsService> = Symbol('mobile-tts-service');

export type MobileServices = {
  apiClient: MobileApiClient;
  srsService: MobileSrsService;
  ttsService: MobileTtsService;
};

export function provideMobileServices(
  app: App,
  coordinator: MobileAuthCoordinator,
): MobileServices {
  const apiClient = createMobileApiClient(coordinator);
  const srsService = createMobileSrsService(apiClient);
  const ttsService = createMobileTtsService(apiClient);

  app.provide(MOBILE_API_CLIENT_KEY, apiClient);
  app.provide(MOBILE_SRS_SERVICE_KEY, srsService);
  app.provide(MOBILE_TTS_SERVICE_KEY, ttsService);

  return { apiClient, srsService, ttsService };
}

import type { App, InjectionKey } from 'vue';
import type { MobileAuthCoordinator } from '../auth/mobile-auth-contract';
import { createMobileApiClient, type MobileApiClient } from './mobile-api-client';
import { createMobileSrsService, type MobileSrsService } from './mobile-srs';

export const MOBILE_API_CLIENT_KEY: InjectionKey<MobileApiClient> = Symbol('mobile-api-client');
export const MOBILE_SRS_SERVICE_KEY: InjectionKey<MobileSrsService> = Symbol('mobile-srs-service');

export function provideMobileServices(app: App, coordinator: MobileAuthCoordinator): void {
  const apiClient = createMobileApiClient(coordinator);
  const srsService = createMobileSrsService(apiClient);

  app.provide(MOBILE_API_CLIENT_KEY, apiClient);
  app.provide(MOBILE_SRS_SERVICE_KEY, srsService);
}

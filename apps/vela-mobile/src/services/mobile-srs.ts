import { parseSrsStats, type SRSStats } from '@vela/common';
import { MobileApiError, type MobileApiClient } from './mobile-api-client';

export type MobileSrsService = {
  getStats(options?: { signal?: AbortSignal }): Promise<SRSStats>;
};

export function createMobileSrsService(apiClient: MobileApiClient): MobileSrsService {
  return {
    async getStats(options = {}) {
      const value = await apiClient.getJson('srs/stats', options);
      try {
        return parseSrsStats(value);
      } catch (error) {
        throw new MobileApiError('invalid_response', { cause: error });
      }
    },
  };
}

import { defineBoot } from '#q-app/wrappers';
import type { Router } from 'vue-router';
import { IOS_DIAGNOSTIC_DETAIL_PATH, IOS_DIAGNOSTIC_ROOT_PATH } from 'src/router/diagnostic-routes';
import { replaceColdMobileRoute, type MobileNavigationResult } from 'src/router/mobile-navigation';

export const DIAGNOSTIC_COLD_ENTRY_KEY = 'vela:dev:ios-interaction-cold-entry';

const allowedDiagnosticEntries = new Set([IOS_DIAGNOSTIC_ROOT_PATH, IOS_DIAGNOSTIC_DETAIL_PATH]);

export function stageDiagnosticColdEntry(storage: Storage, target: string): void {
  if (!allowedDiagnosticEntries.has(target)) {
    throw new Error(`Disallowed diagnostic cold-entry target: ${target}`);
  }
  storage.setItem(DIAGNOSTIC_COLD_ENTRY_KEY, target);
}

export async function consumeDiagnosticColdEntry(
  router: Router,
  storage: Storage,
): Promise<MobileNavigationResult | null> {
  const target = storage.getItem(DIAGNOSTIC_COLD_ENTRY_KEY);
  if (target === null) return null;
  storage.removeItem(DIAGNOSTIC_COLD_ENTRY_KEY);
  return replaceColdMobileRoute(router, target, allowedDiagnosticEntries);
}

export default defineBoot(async ({ router }) => {
  await consumeDiagnosticColdEntry(router, window.localStorage);
});

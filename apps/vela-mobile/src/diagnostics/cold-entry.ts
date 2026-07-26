import type { Router } from 'vue-router';
import {
  DIAGNOSTIC_COLD_ENTRY_KEY,
  IOS_DIAGNOSTIC_DETAIL_PATH,
  IOS_DIAGNOSTIC_ROOT_PATH,
} from 'src/diagnostics/ios-interaction-contract';
import { replaceColdMobileRoute, type MobileNavigationResult } from 'src/router/mobile-navigation';

export { DIAGNOSTIC_COLD_ENTRY_KEY } from 'src/diagnostics/ios-interaction-contract';

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

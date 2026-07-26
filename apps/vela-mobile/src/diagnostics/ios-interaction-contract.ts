export const IOS_INTERACTION_DIAGNOSTICS_MARKER = 'ios-interaction-diagnostics';
export const IOS_INTERACTION_ENTRY_TEST_ID = 'ios-interaction-entry';
export const IOS_INTERACTION_DIAGNOSTICS_LABEL = 'iOS Interaction Diagnostics';
export const IOS_DIAGNOSTIC_ROOT_PATH = '/diagnostics/ios-interactions';
export const IOS_DIAGNOSTIC_DETAIL_PATH = '/diagnostics/ios-interactions/detail';

// localStorage key used by the dev-only diagnostic cold-entry boot file. The
// key is a diagnostic-specific token: if it appears in a production bundle,
// diagnostic code leaked. Listed in the production-forbidden tokens so the
// verify-production-diagnostics scanner catches future regressions even
// though the boot file is currently dev-only (boot-files.ts gates it behind
// isDevelopment).
export const DIAGNOSTIC_COLD_ENTRY_KEY = 'vela:dev:ios-interaction-cold-entry';

export const IOS_INTERACTION_PRODUCTION_FORBIDDEN_TOKENS = [
  IOS_INTERACTION_DIAGNOSTICS_MARKER,
  IOS_INTERACTION_ENTRY_TEST_ID,
  IOS_INTERACTION_DIAGNOSTICS_LABEL,
  IOS_DIAGNOSTIC_ROOT_PATH,
  DIAGNOSTIC_COLD_ENTRY_KEY,
] as const;

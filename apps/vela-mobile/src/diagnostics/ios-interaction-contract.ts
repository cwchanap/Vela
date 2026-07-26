export const IOS_INTERACTION_DIAGNOSTICS_MARKER = 'ios-interaction-diagnostics';
export const IOS_INTERACTION_DIAGNOSTICS_LABEL = 'iOS Interaction Diagnostics';
export const IOS_DIAGNOSTIC_ROOT_PATH = '/diagnostics/ios-interactions';
export const IOS_DIAGNOSTIC_DETAIL_PATH = '/diagnostics/ios-interactions/detail';

export const IOS_INTERACTION_PRODUCTION_FORBIDDEN_TOKENS = [
  IOS_INTERACTION_DIAGNOSTICS_MARKER,
  IOS_INTERACTION_DIAGNOSTICS_LABEL,
  IOS_DIAGNOSTIC_ROOT_PATH,
] as const;

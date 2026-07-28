export function getMobileBootFiles(flags: {
  isCapacitor: boolean;
  isDevelopment: boolean;
}): string[] {
  return [
    'main',
    'mobile-auth',
    ...(flags.isCapacitor ? ['capacitor-lifecycle'] : []),
    ...(flags.isDevelopment ? ['diagnostic-cold-entry'] : []),
  ];
}

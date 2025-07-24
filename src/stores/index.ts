// Export all stores from this index file for easy importing
export * from './auth';
export * from './games';
export * from './chat';
export * from './progress';

// Default export for Quasar compatibility (not used since we use Pinia boot file)
export default function () {
  // This is not used since we configure Pinia in boot/pinia.ts
  // But Quasar expects this export to exist
  return null;
}

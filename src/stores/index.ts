import { createPinia } from 'pinia';

// Export all stores from this index file for easy importing
export * from './auth';
export * from './games';
export * from './chat';
export * from './progress';
export * from './llmSettings';

// Default export for Quasar compatibility - return Pinia instance
export default function () {
  return createPinia();
}

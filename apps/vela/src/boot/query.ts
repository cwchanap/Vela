import { defineBoot } from '#q-app';
import { VueQueryPlugin } from '@tanstack/vue-query';
import { createQueryClient, QUERY_STALE_TIME, QUERY_GC_TIME } from '@vela/common';

// Create a QueryClient instance with shared configuration
export const queryClient = createQueryClient();

// Re-export constants for use in stores
export { QUERY_STALE_TIME, QUERY_GC_TIME };

export default defineBoot(({ app }) => {
  // Install Vue Query plugin
  app.use(VueQueryPlugin, {
    queryClient,
  });

  console.log('✅ TanStack Query initialized');
});

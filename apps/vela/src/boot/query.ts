import { boot } from 'quasar/wrappers';
import { VueQueryPlugin, QueryClient } from '@tanstack/vue-query';

// Create a QueryClient instance with default options
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Stale time of 5 minutes - data is considered fresh for this duration
      staleTime: 5 * 60 * 1000,
      // Cache time of 10 minutes - unused data stays in cache
      gcTime: 10 * 60 * 1000,
      // Retry failed requests 2 times before showing error
      retry: 2,
      // Retry with exponential backoff
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      // Refetch on window focus for fresh data
      refetchOnWindowFocus: true,
      // Don't refetch on reconnect automatically
      refetchOnReconnect: false,
      // Don't refetch on mount if data is fresh
      refetchOnMount: true,
    },
    mutations: {
      // Retry failed mutations once
      retry: 1,
    },
  },
});

export default boot(({ app }) => {
  // Install Vue Query plugin
  app.use(VueQueryPlugin, {
    queryClient,
  });

  console.log('✅ TanStack Query initialized');
});

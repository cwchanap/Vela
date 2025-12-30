import { QueryClient } from '@tanstack/vue-query';

/**
 * Shared constants for query cache timing
 */
export const QUERY_STALE_TIME = 5 * 60 * 1000; // 5 minutes - data is considered fresh
export const QUERY_GC_TIME = 10 * 60 * 1000; // 10 minutes - unused data stays in cache

/**
 * Creates a configured QueryClient instance with shared defaults
 * Can be used by both the web app and browser extension
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Data is considered fresh for 5 minutes
        staleTime: QUERY_STALE_TIME,
        // Unused data stays in cache for 10 minutes
        gcTime: QUERY_GC_TIME,
        // Retry failed requests 2 times before showing error
        retry: 2,
        // Retry with exponential backoff
        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
        // Refetch on window focus for fresh data
        refetchOnWindowFocus: true,
        // Don't refetch on reconnect automatically
        refetchOnReconnect: false,
        // Refetch on mount if data is stale
        refetchOnMount: true,
      },
      mutations: {
        // Retry failed mutations once
        retry: 1,
      },
    },
  });
}

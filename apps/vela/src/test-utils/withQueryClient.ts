import { VueQueryPlugin, QueryClient } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { afterEach } from 'vitest';

/**
 * Shared test utility that mounts a composable inside a Vue component
 * with a fresh QueryClient and VueQueryPlugin installed.
 *
 * Automatically unmounts the wrapper and clears the query cache after each
 * test to prevent stale observers from interfering with subsequent tests.
 *
 * @returns `{ result, queryClient, wrapper }` — the composable return value,
 * the QueryClient instance so tests can spy on cache operations, and the
 * VueWrapper for additional assertions if needed.
 */
export function withQueryClient<T>(composableFn: () => T): {
  result: T;
  queryClient: QueryClient;
  wrapper: ReturnType<typeof mount>;
} {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // Set gcTime to 0 to evict inactive queries immediately
  (queryClient as { gcTime?: number }).gcTime = 0;
  let result!: T;
  const Wrapper = defineComponent({
    setup() {
      result = composableFn();
      return {};
    },
    template: '<div />',
  });
  const wrapper = mount(Wrapper, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } });
  afterEach(() => {
    wrapper.unmount();
    queryClient.clear();
  });
  return { result, queryClient, wrapper };
}

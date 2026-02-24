import { VueQueryPlugin, QueryClient } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';

/**
 * Shared test utility that mounts a composable inside a Vue component
 * with a fresh QueryClient and VueQueryPlugin installed.
 *
 * Returns a cleanup function that should be called in afterEach to unmount
 * the wrapper and clear the query cache, preventing stale observers from
 * interfering with subsequent tests.
 *
 * @returns `{ result, queryClient, wrapper, cleanup }` — the composable return value,
 * the QueryClient instance so tests can spy on cache operations, the VueWrapper
 * for additional assertions, and a cleanup function for afterEach.
 */
export function withQueryClient<T>(composableFn: () => T): {
  result: T;
  queryClient: QueryClient;
  wrapper: ReturnType<typeof mount>;
  cleanup: () => void;
} {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  let result!: T;
  const Wrapper = defineComponent({
    setup() {
      result = composableFn();
      return {};
    },
    template: '<div />',
  });
  const wrapper = mount(Wrapper, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } });
  const cleanup = () => {
    wrapper.unmount();
    queryClient.clear();
  };
  return { result, queryClient, wrapper, cleanup };
}

import { VueQueryPlugin, QueryClient } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';

/**
 * Shared test utility that mounts a composable inside a Vue component
 * with a fresh QueryClient and VueQueryPlugin installed.
 *
 * @returns `{ result, queryClient, wrapper }` — the composable return value,
 * the QueryClient instance so tests can spy on cache operations, and the
 * VueWrapper so tests can call `wrapper.unmount()` to clean up side effects.
 */
export function withQueryClient<T>(composableFn: () => T): {
  result: T;
  queryClient: QueryClient;
  wrapper: ReturnType<typeof mount>;
} {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
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
  return { result, queryClient, wrapper };
}

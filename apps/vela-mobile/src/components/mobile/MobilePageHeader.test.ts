import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { flushPromises, mount } from '@vue/test-utils';
import { QLayout, QPageContainer, Quasar } from 'quasar';
import { defineComponent } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMemoryHistory,
  createRouter,
  isNavigationFailure,
  NavigationFailureType,
} from 'vue-router';
import { readMobileDepth } from '../../router/mobile-navigation';
import MobilePageHeader from './MobilePageHeader.vue';

const routes = [
  { path: '/', component: { template: '<div />' } },
  {
    path: '/detail',
    component: { template: '<div />' },
    meta: { mobileHeader: { title: 'Details', fallback: '/fallback' } },
  },
  { path: '/fallback', component: { template: '<div />' } },
];

async function mountHeader(initialPath: string, mobileDepth?: number) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes,
  });
  await router.push('/');
  await router.push({
    path: initialPath,
    ...(mobileDepth === undefined ? {} : { state: { mobileDepth } }),
  });
  await router.isReady();
  const HeaderHarness = defineComponent({
    components: { MobilePageHeader, QLayout, QPageContainer },
    template: '<q-layout view="hHh lpR fFf"><mobile-page-header/><q-page-container/></q-layout>',
  });
  const unhandledEventError = vi.fn();
  const wrapper = mount(HeaderHarness, {
    global: {
      plugins: [Quasar, router],
      config: { errorHandler: unhandledEventError },
    },
  });
  return { router, unhandledEventError, wrapper };
}

describe('MobilePageHeader', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the title from route metadata', async () => {
    const { wrapper } = await mountHeader('/detail');
    expect(wrapper.get('.q-toolbar__title').text()).toBe('Details');
  });

  it('renders a 44-by-44 minimum back target', async () => {
    const { wrapper } = await mountHeader('/detail');
    expect(wrapper.get('.mobile-back-target').classes()).toContain('mobile-touch-target');

    const appScss = readFileSync(resolve(__dirname, '../../css/app.scss'), 'utf8');
    expect(appScss).toContain('.mobile-back-target');
    expect(appScss).toContain('min-width: 44px');
    expect(appScss).toContain('min-height: 44px');
  });

  it('navigates back when mobile depth is positive', async () => {
    const { router, wrapper } = await mountHeader('/detail', 1);
    await wrapper.get('[aria-label="Back"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/');
  });

  it('replaces with the fallback at depth zero when depth is absent', async () => {
    const { router, wrapper } = await mountHeader('/detail');
    await wrapper.get('[aria-label="Back"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/fallback');
    expect(router.options.history.state.mobileDepth).toBe(0);
  });

  it('contains and logs an aborted fallback navigation', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { router, unhandledEventError, wrapper } = await mountHeader('/detail');
    router.beforeEach((to) => (to.path === '/fallback' ? false : true));

    await wrapper.get('[aria-label="Back"]').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.fullPath).toBe('/detail');
    expect(unhandledEventError).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith('Mobile header navigation failed', expect.anything());
    const failure = consoleError.mock.calls[0]?.[1];
    expect(isNavigationFailure(failure, NavigationFailureType.aborted)).toBe(true);
  });

  it('recovers to the fallback when mobileDepth is stale and router.back() is a no-op', async () => {
    vi.useFakeTimers();
    try {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      // mobileDepth=5 with no real prior pushes — router.back() has nothing
      // to pop, so the settle timeout fires and backOrFallback must recover.
      const { router, wrapper } = await mountHeader('/detail', 5);
      expect(readMobileDepth(router)).toBe(5);

      await wrapper.get('[aria-label="Back"]').trigger('click');
      // Advance past the settle timeout so the no-op recovery fires.
      vi.advanceTimersByTime(2000);
      await flushPromises();

      expect(router.currentRoute.value.fullPath).toBe('/fallback');
      expect(readMobileDepth(router)).toBe(0);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

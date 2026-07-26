import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper, type DOMWrapper } from '@vue/test-utils';
import { Quasar, Dark } from 'quasar';
import {
  createRouter,
  createMemoryHistory,
  isNavigationFailure,
  NavigationFailureType,
} from 'vue-router';
import { nextTick } from 'vue';
import { safeAreaPolicy } from '../ios/safe-area-policy';
import MobileLayout from './MobileLayout.vue';

type TestKeyboardEvent = 'keyboardWillShow' | 'keyboardDidShow' | 'keyboardDidHide';

const keyboardListeners = vi.hoisted(
  () => new Map<TestKeyboardEvent, (info?: { keyboardHeight: number }) => void>(),
);

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
}));

vi.mock('@capacitor/keyboard', () => ({
  Keyboard: {
    addListener: vi.fn(
      async (name: TestKeyboardEvent, listener: (info?: { keyboardHeight: number }) => void) => {
        keyboardListeners.set(name, listener);
        return { remove: vi.fn(async () => undefined) };
      },
    ),
  },
}));

const routes = [
  { path: '/', component: { template: '<div/>' } },
  { path: '/review', component: { template: '<div/>' } },
  { path: '/learn', component: { template: '<div/>' } },
  { path: '/words', component: { template: '<div/>' } },
  { path: '/more', component: { template: '<div/>' } },
];

const mountLayout = async (initialPath = '/', errorHandler?: (error: unknown) => void) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes,
  });
  await router.push({ path: initialPath, state: { mobileDepth: 0 } });
  await router.isReady();
  const wrapper = mount(MobileLayout, {
    global: {
      plugins: [Quasar, router],
      ...(errorHandler ? { config: { errorHandler } } : {}),
    },
  });
  // Wait for route-tab active state to settle after navigation.
  await nextTick();
  await nextTick();
  return wrapper;
};

const tabByLabel = (wrapper: VueWrapper, label: string): DOMWrapper<Element> => {
  const tab = wrapper.findAll('.q-tab').find((t) => t.text().includes(label));
  if (!tab) throw new Error(`Tab with label "${label}" not found`);
  return tab;
};

const isActive = (el: DOMWrapper<Element>) => el.classes().includes('q-router-link--active');

describe('MobileLayout', () => {
  beforeEach(() => {
    keyboardListeners.clear();
  });

  afterEach(() => {
    Dark.set(false);
    vi.restoreAllMocks();
  });

  it('renders a q-layout', async () => {
    const wrapper = await mountLayout();
    expect(wrapper.findComponent({ name: 'QLayout' }).exists()).toBe(true);
  });

  it('renders 5 route tabs in the bottom navigation', async () => {
    const wrapper = await mountLayout();
    const tabs = wrapper.findAllComponents({ name: 'QRouteTab' });
    expect(tabs).toHaveLength(5);
  });

  it('includes tabs for all 5 sections', async () => {
    const wrapper = await mountLayout();
    const tabLabels = wrapper.findAll('.q-tab__label').map((t) => t.text());
    expect(tabLabels).toContain('Home');
    expect(tabLabels).toContain('Review');
    expect(tabLabels).toContain('Learn');
    expect(tabLabels).toContain('Words');
    expect(tabLabels).toContain('More');
  });

  it('marks only the Home tab active when on /', async () => {
    const wrapper = await mountLayout('/');
    const home = tabByLabel(wrapper, 'Home');
    const review = tabByLabel(wrapper, 'Review');
    expect(isActive(home)).toBe(true);
    expect(isActive(review)).toBe(false);
  });

  it('does NOT mark Home active on a sub-path (exact match)', async () => {
    const wrapper = await mountLayout('/review');
    const home = tabByLabel(wrapper, 'Home');
    const review = tabByLabel(wrapper, 'Review');
    expect(isActive(home)).toBe(false);
    expect(isActive(review)).toBe(true);
  });

  it('marks the matching tab active for each section', async () => {
    const labels: Record<string, string> = {
      '/learn': 'Learn',
      '/words': 'Words',
      '/more': 'More',
    };
    for (const path of ['/learn', '/words', '/more']) {
      const label = labels[path];
      if (!label) throw new Error(`No label mapped for path ${path}`);
      const wrapper = await mountLayout(path);
      const active = tabByLabel(wrapper, label);
      const home = tabByLabel(wrapper, 'Home');
      expect(isActive(active)).toBe(true);
      expect(isActive(home)).toBe(false);
    }
  });

  it('applies dark nav classes when Quasar dark mode is active', async () => {
    Dark.set(true);
    const wrapper = await mountLayout('/');
    const tabs = wrapper.find('.nav-tabs');
    expect(tabs.classes()).toContain('bg-grey-9');
    expect(tabs.classes()).not.toContain('bg-white');
  });

  it('applies light nav classes when Quasar dark mode is inactive', async () => {
    const wrapper = await mountLayout('/');
    const tabs = wrapper.find('.nav-tabs');
    expect(tabs.classes()).toContain('bg-white');
    expect(tabs.classes()).not.toContain('bg-grey-9');
  });

  it.each([
    ['/more', 'Home', '/'],
    ['/', 'Review', '/review'],
    ['/', 'Learn', '/learn'],
    ['/', 'Words', '/words'],
    ['/', 'More', '/more'],
  ])('delegates %s -> %s to chronological mobile navigation', async (start, label, target) => {
    const wrapper = await mountLayout(start);
    await tabByLabel(wrapper, label).trigger('click');
    await flushPromises();
    await nextTick();
    await nextTick();
    expect(wrapper.vm.$router.currentRoute.value.fullPath).toBe(target);
    expect(wrapper.vm.$router.options.history.state.mobileDepth).toBe(1);
    await vi.waitFor(() => {
      expect(tabByLabel(wrapper, label).classes()).toContain('q-tab--active');
    });
  });

  it('does not duplicate navigation to the active tab', async () => {
    const wrapper = await mountLayout('/more');
    await tabByLabel(wrapper, 'More').trigger('click');
    await flushPromises();
    expect(wrapper.vm.$router.currentRoute.value.fullPath).toBe('/more');
    expect(wrapper.vm.$router.options.history.state.mobileDepth).toBe(0);
  });

  it('contains and logs an aborted tab navigation', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const unhandledEventError = vi.fn();
    const wrapper = await mountLayout('/', unhandledEventError);
    wrapper.vm.$router.beforeEach((to) => (to.path === '/review' ? false : true));

    await tabByLabel(wrapper, 'Review').trigger('click');
    await flushPromises();

    expect(wrapper.vm.$router.currentRoute.value.fullPath).toBe('/');
    expect(unhandledEventError).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith('Mobile tab navigation failed', expect.anything());
    const failure = consoleError.mock.calls[0]?.[1];
    expect(isNavigationFailure(failure, NavigationFailureType.aborted)).toBe(true);
  });

  it('removes the footer while the keyboard is visible and restores it once', async () => {
    const wrapper = await mountLayout('/');
    await flushPromises();
    keyboardListeners.get('keyboardWillShow')?.({ keyboardHeight: 320 });
    await nextTick();
    expect(wrapper.findComponent({ name: 'QFooter' }).exists()).toBe(false);
    keyboardListeners.get('keyboardDidHide')?.();
    await nextTick();
    expect(wrapper.findAllComponents({ name: 'QFooter' })).toHaveLength(1);
  });

  it('applies only the selected headerless-top owner', async () => {
    const wrapper = await mountLayout('/');
    const container = wrapper.getComponent({ name: 'QPageContainer' });
    expect(container.classes()).toContain('mobile-page-container--headerless');
    expect(container.classes().includes('mobile-page-container--css-safe-top')).toBe(
      safeAreaPolicy.headerlessTopOwner === 'css',
    );
  });

  it('pins horizontal safe areas for fixed header and footer content', () => {
    const appScss = readFileSync(resolve(__dirname, '../css/app.scss'), 'utf8');
    expect(appScss).toContain('.mobile-header .q-toolbar');
    expect(appScss).toContain('.mobile-nav .q-tabs__content');
    expect(appScss).toContain('.mobile-touch-target');
    expect(appScss).toContain('env(safe-area-inset-left, 0px)');
    expect(appScss).toContain('env(safe-area-inset-right, 0px)');
  });
});

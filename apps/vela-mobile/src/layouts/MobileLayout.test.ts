import { describe, it, expect, afterEach } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { Quasar, Dark } from 'quasar';
import { createRouter, createMemoryHistory } from 'vue-router';
import { nextTick } from 'vue';
import MobileLayout from './MobileLayout.vue';

const routes = [
  { path: '/', component: { template: '<div/>' } },
  { path: '/review', component: { template: '<div/>' } },
  { path: '/learn', component: { template: '<div/>' } },
  { path: '/words', component: { template: '<div/>' } },
  { path: '/more', component: { template: '<div/>' } },
];

const mountLayout = async (initialPath = '/') => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes,
  });
  await router.push(initialPath);
  await router.isReady();
  const wrapper = mount(MobileLayout, { global: { plugins: [Quasar, router] } });
  // Wait for route-tab active state to settle after navigation.
  await nextTick();
  await nextTick();
  return wrapper;
};

const tabByLabel = (wrapper: VueWrapper, label: string) =>
  wrapper.findAll('.q-tab').find((t) => t.text().includes(label));

const isActive = (el: VueWrapper | ReturnType<VueWrapper['find']>) =>
  el.classes().includes('q-router-link--active');

describe('MobileLayout', () => {
  afterEach(() => {
    Dark.set(false);
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
      const wrapper = await mountLayout(path);
      const active = tabByLabel(wrapper, labels[path]);
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
});

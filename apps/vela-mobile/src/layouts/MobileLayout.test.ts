import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { Quasar } from 'quasar';
import { createRouter, createMemoryHistory } from 'vue-router';
import MobileLayout from './MobileLayout.vue';

const mountLayout = () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div/>' } },
      { path: '/review', component: { template: '<div/>' } },
      { path: '/learn', component: { template: '<div/>' } },
      { path: '/words', component: { template: '<div/>' } },
      { path: '/more', component: { template: '<div/>' } },
    ],
  });
  return mount(MobileLayout, { global: { plugins: [Quasar, router] } });
};

describe('MobileLayout', () => {
  it('renders a q-layout', () => {
    const wrapper = mountLayout();
    expect(wrapper.findComponent({ name: 'QLayout' }).exists()).toBe(true);
  });

  it('renders 5 route tabs in the bottom navigation', () => {
    const wrapper = mountLayout();
    const tabs = wrapper.findAllComponents({ name: 'QRouteTab' });
    expect(tabs).toHaveLength(5);
  });

  it('includes tabs for all 5 sections', () => {
    const wrapper = mountLayout();
    const tabLabels = wrapper.findAll('.q-tab__label').map((t) => t.text());
    expect(tabLabels).toContain('Home');
    expect(tabLabels).toContain('Review');
    expect(tabLabels).toContain('Learn');
    expect(tabLabels).toContain('Words');
    expect(tabLabels).toContain('More');
  });
});

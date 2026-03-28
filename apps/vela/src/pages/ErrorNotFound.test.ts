import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { Quasar } from 'quasar';
import { createRouter, createMemoryHistory } from 'vue-router';
import ErrorNotFound from './ErrorNotFound.vue';

const createTestRouter = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/:catchAll(.*)*', component: ErrorNotFound },
    ],
  });

describe('ErrorNotFound', () => {
  let router: ReturnType<typeof createTestRouter>;

  beforeEach(() => {
    setActivePinia(createPinia());
    router = createTestRouter();
  });

  const mountComponent = () =>
    mount(ErrorNotFound, {
      global: {
        plugins: [Quasar, router],
        stubs: {
          'q-btn': {
            template: '<a :to="to"><slot /></a>',
            props: ['to', 'label', 'color', 'textColor', 'unelevated', 'noCaps'],
          },
        },
      },
    });

  it('renders without errors', () => {
    const wrapper = mountComponent();
    expect(wrapper.exists()).toBe(true);
    wrapper.unmount();
  });

  it('displays 404 text', () => {
    const wrapper = mountComponent();
    expect(wrapper.text()).toContain('404');
    wrapper.unmount();
  });

  it('displays "Oops. Nothing here..." message', () => {
    const wrapper = mountComponent();
    expect(wrapper.text()).toContain('Oops. Nothing here...');
    wrapper.unmount();
  });

  it('renders a Go Home button', () => {
    const wrapper = mountComponent();
    const btn = wrapper.find('a');
    expect(btn.exists()).toBe(true);
    wrapper.unmount();
  });

  it('has a link to the home page', () => {
    const wrapper = mountComponent();
    // The q-btn stub has to="/"
    const btn = wrapper.find('a');
    expect(btn.attributes('to')).toBe('/');
    wrapper.unmount();
  });

  it('has the correct CSS classes for full-screen display', () => {
    const wrapper = mountComponent();
    const container = wrapper.find('.fullscreen');
    expect(container.exists()).toBe(true);
    wrapper.unmount();
  });
});

import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { Quasar } from 'quasar';
import AuthLayout from './AuthLayout.vue';

describe('AuthLayout', () => {
  const createTestRouter = () =>
    createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<div>Home</div>' } }],
    });

  const mountComponent = async () => {
    const router = createTestRouter();
    await router.push('/');
    await router.isReady();
    return mount(AuthLayout, {
      global: {
        plugins: [Quasar, router],
        stubs: {
          'q-layout': { name: 'QLayout', template: '<div><slot /></div>' },
          'q-page-container': { name: 'QPageContainer', template: '<div><slot /></div>' },
          'router-view': true,
        },
      },
    });
  };

  it('renders without errors', async () => {
    const wrapper = await mountComponent();
    expect(wrapper.exists()).toBe(true);
    wrapper.unmount();
  });

  it('renders q-layout component', async () => {
    const wrapper = await mountComponent();
    const layout = wrapper.findComponent({ name: 'QLayout' });
    expect(layout.exists()).toBe(true);
    wrapper.unmount();
  });

  it('renders q-page-container inside q-layout', async () => {
    const wrapper = await mountComponent();
    expect(wrapper.findComponent({ name: 'QPageContainer' }).exists()).toBe(true);
    wrapper.unmount();
  });

  it('renders router-view inside the layout', async () => {
    const wrapper = await mountComponent();
    expect(wrapper.find('router-view-stub').exists()).toBe(true);
    wrapper.unmount();
  });
});

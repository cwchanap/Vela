import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import App from './App.vue';

const mountApp = async () => {
  const Routed = defineComponent({ template: '<div data-test="routed">routed</div>' });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: Routed }],
  });
  await router.push('/');
  await router.isReady();
  return mount(App, { global: { plugins: [router] } });
};

describe('App', () => {
  it('renders the matched route via router-view', async () => {
    const wrapper = await mountApp();
    expect(wrapper.find('[data-test="routed"]').exists()).toBe(true);
  });
});

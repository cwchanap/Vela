import { flushPromises, mount } from '@vue/test-utils';
import { Quasar, QLayout, QPageContainer } from 'quasar';
import { createMemoryHistory, createRouter } from 'vue-router';
import { defineComponent } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import LearnPage from './LearnPage.vue';
import { pushMobileRoute } from 'src/router/mobile-navigation';

vi.mock('src/router/mobile-navigation', () => ({
  pushMobileRoute: vi.fn().mockResolvedValue({ kind: 'pushed' }),
}));

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/', component: { template: '<div />' } }],
});

// q-page must be a deep child of q-layout; wrap so Quasar renders under jsdom.
function mountPage() {
  const Host = defineComponent({
    components: { QLayout, QPageContainer, LearnPage },
    template:
      '<q-layout view="hHh Lpr fFf"><q-page-container><learn-page/></q-page-container></q-layout>',
  });
  return mount(Host, {
    global: {
      plugins: [Quasar, router],
    },
  });
}

describe('LearnPage', () => {
  it('renders the Mystery Messenger card copy', () => {
    const wrapper = mountPage();
    expect(wrapper.text()).toContain('Mystery Messenger');
    expect(wrapper.text()).toContain('The Message That Arrived Tomorrow');
    expect(wrapper.text()).toContain('Play pilot');
  });

  it('navigates to the mystery messenger route when Play pilot is clicked', async () => {
    const wrapper = mountPage();

    await wrapper.get('[data-testid="mystery-messenger-entry"]').trigger('click');

    expect(pushMobileRoute).toHaveBeenCalledWith(router, '/learn/mystery-messenger');
  });

  it('logs a console error when navigation is rejected', async () => {
    vi.mocked(pushMobileRoute).mockRejectedValueOnce(new Error('navigation failed'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const wrapper = mountPage();

    await wrapper.get('[data-testid="mystery-messenger-entry"]').trigger('click');
    await flushPromises();

    expect(consoleError).toHaveBeenCalledWith(
      'Mystery Messenger navigation failed',
      expect.any(Error),
    );
  });
});

import { flushPromises, mount } from '@vue/test-utils';
import { QLayout, QPageContainer, Quasar } from 'quasar';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { describe, expect, it } from 'vitest';
import { mobileLifecycleState, resetMobileLifecycleForTests } from 'src/services/mobile-lifecycle';
import IosInteractionDetailPage from './IosInteractionDetailPage.vue';

describe('IosInteractionDetailPage', () => {
  it('keeps its route identity and ignores repeated current navigation', async () => {
    resetMobileLifecycleForTests();
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/diagnostics/ios-interactions/detail',
          component: IosInteractionDetailPage,
        },
      ],
    });
    await router.replace({
      path: '/diagnostics/ios-interactions/detail',
      state: { mobileDepth: 2 },
    });
    await router.isReady();
    const Host = defineComponent({
      components: { QLayout, QPageContainer },
      template:
        '<q-layout view="hHh Lpr fFf"><q-page-container><router-view /></q-page-container></q-layout>',
    });
    const wrapper = mount(Host, {
      global: { plugins: [Quasar, router] },
    });
    await flushPromises();

    expect(wrapper.get('[data-testid="detail-route-identity"]').text()).toContain(
      'nested iOS interaction route',
    );
    await wrapper.get('[data-testid="repeat-detail-navigation"]').trigger('click');
    await wrapper.get('[data-testid="simulate-entry-again"]').trigger('click');
    await wrapper.get('[data-testid="simulate-resume"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe('/diagnostics/ios-interactions/detail');
    expect(router.options.history.state.mobileDepth).toBe(2);
    expect(mobileLifecycleState.resumeCount.value).toBe(1);
    for (const selector of [
      '[data-testid="repeat-detail-navigation"]',
      '[data-testid="simulate-entry-again"]',
      '[data-testid="simulate-resume"]',
    ]) {
      expect(wrapper.get(selector).classes()).toContain('mobile-touch-target');
    }
  });
});

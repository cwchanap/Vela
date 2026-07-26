import { flushPromises, mount } from '@vue/test-utils';
import { QLayout, QPageContainer, Quasar } from 'quasar';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IOS_INTERACTION_DIAGNOSTICS_MARKER } from 'src/diagnostics/ios-interaction-contract';
import { resetMobileLifecycleForTests, mobileLifecycleState } from 'src/services/mobile-lifecycle';
import IosInteractionDetailPage from './IosInteractionDetailPage.vue';
import IosInteractionDiagnosticsPage from './IosInteractionDiagnosticsPage.vue';

const ROOT_PATH = '/diagnostics/ios-interactions';
const DETAIL_PATH = '/diagnostics/ios-interactions/detail';

const JourneyHost = defineComponent({
  components: { QLayout, QPageContainer },
  template:
    '<q-layout view="hHh Lpr fFf"><q-page-container><router-view /></q-page-container></q-layout>',
});

async function mountJourney() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: ROOT_PATH, component: IosInteractionDiagnosticsPage },
      { path: DETAIL_PATH, component: IosInteractionDetailPage },
    ],
  });
  await router.replace({ path: ROOT_PATH, state: { mobileDepth: 1 } });
  await router.isReady();
  const wrapper = mount(JourneyHost, {
    global: { plugins: [Quasar, router] },
  });
  await flushPromises();
  return { router, wrapper };
}

beforeEach(() => {
  window.localStorage.clear();
  resetMobileLifecycleForTests();
});

describe('iOS interaction diagnostic journey', () => {
  it('renders the canonical marker, Japanese samples, and IME probe', async () => {
    const { wrapper } = await mountJourney();
    expect(wrapper.find(`[data-testid="${IOS_INTERACTION_DIAGNOSTICS_MARKER}"]`).exists()).toBe(
      true,
    );
    expect(wrapper.text()).toContain('日本語');
    expect(wrapper.text()).toContain('かな');
    expect(wrapper.findComponent({ name: 'JapaneseInputProbe' }).exists()).toBe(true);
    expect(wrapper.find('[data-testid="ime-model"]').exists()).toBe(true);
  });

  it('pushes Detail and repeats navigation only from the visible Detail control', async () => {
    const { router, wrapper } = await mountJourney();
    await wrapper.get('[data-testid="navigate-detail"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe(DETAIL_PATH);
    expect(router.options.history.state.mobileDepth).toBe(2);
    expect(wrapper.find('[data-testid="navigate-detail"]').exists()).toBe(false);

    await wrapper.get('[data-testid="repeat-detail-navigation"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe(DETAIL_PATH);
    expect(router.options.history.state.mobileDepth).toBe(2);
  });

  it('pushes in-session entry once, then keeps repeated entry and resume route-neutral', async () => {
    const { router, wrapper } = await mountJourney();
    await wrapper.get('[data-testid="simulate-entry"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe(DETAIL_PATH);
    expect(router.options.history.state.mobileDepth).toBe(2);

    await wrapper.get('[data-testid="simulate-entry-again"]').trigger('click');
    await wrapper.get('[data-testid="simulate-resume"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe(DETAIL_PATH);
    expect(router.options.history.state.mobileDepth).toBe(2);
    expect(mobileLifecycleState.resumeCount.value).toBe(1);
  });

  it('stages the allowlisted detail route for one cold entry', async () => {
    const { wrapper } = await mountJourney();
    await wrapper.get('[data-testid="stage-cold-entry"]').trigger('click');
    expect(window.localStorage.getItem('vela:dev:ios-interaction-cold-entry')).toBe(DETAIL_PATH);
  });

  it('surfaces an aborted navigation in the visible outcome', async () => {
    const { router, wrapper } = await mountJourney();
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    router.beforeEach(() => false);
    await wrapper.get('[data-testid="navigate-detail"]').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe(ROOT_PATH);
    expect(wrapper.get('[data-testid="navigation-outcome"]').text()).toContain(
      'push-detail:failed:',
    );
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it('applies the shared 44-point class to every visible diagnostic action', async () => {
    const { wrapper } = await mountJourney();
    for (const selector of [
      '[data-testid="navigate-detail"]',
      '[data-testid="simulate-entry"]',
      '[data-testid="stage-cold-entry"]',
      '[data-testid="ime-done"]',
      '[data-testid="ime-submit"]',
    ]) {
      expect(wrapper.get(selector).classes()).toContain('mobile-touch-target');
    }
  });
});

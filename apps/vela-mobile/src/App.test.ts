import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, nextTick, onMounted, reactive } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import { describe, expect, it, vi } from 'vitest';
import type { MobileAuthCoordinator, MobileAuthState } from './auth/mobile-auth-contract';
import { MOBILE_AUTH_KEY } from './services/mobile-auth';
import App from './App.vue';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('App', () => {
  it('keeps route components unmounted until verified auth lands on home', async () => {
    const mountedRoutes: string[] = [];
    const routedComponent = (label: string) =>
      defineComponent({
        setup() {
          onMounted(() => mountedRoutes.push(label));
          return { label };
        },
        template: '<div :data-testid="`${label}-route`">{{ label }}</div>',
      });

    const Home = routedComponent('home');
    const Review = routedComponent('review');
    const state = reactive<MobileAuthState>({
      phase: 'signedOut',
      operation: 'idle',
      sessionUsable: false,
      errorCode: null,
      retryAction: null,
      notice: null,
      user: null,
    });
    const coordinator: MobileAuthCoordinator = {
      state,
      initialize: vi.fn().mockResolvedValue(undefined),
      startSignIn: vi.fn().mockResolvedValue(undefined),
      completeCallback: vi.fn().mockResolvedValue(undefined),
      retryCurrentOperation: vi.fn().mockResolvedValue(undefined),
      signOut: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
    };
    const landing = deferred();
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: Home },
        { path: '/review', component: Review },
      ],
    });
    await router.push('/review');
    await router.isReady();
    const originalReplace = router.replace.bind(router);
    vi.spyOn(router, 'replace').mockImplementation(async (to) => {
      await landing.promise;
      return originalReplace(to);
    });

    const wrapper = mount(App, {
      global: {
        plugins: [router],
        provide: {
          [MOBILE_AUTH_KEY as symbol]: coordinator,
        },
      },
    });

    expect(mountedRoutes).toEqual([]);
    expect(wrapper.find('[data-testid$="-route"]').exists()).toBe(false);

    state.phase = 'authenticated';
    state.sessionUsable = true;
    state.user = { userId: 'user-1', email: null };
    await nextTick();

    expect(router.replace).toHaveBeenCalledWith('/');
    expect(mountedRoutes).toEqual([]);

    landing.resolve();
    await flushPromises();
    await nextTick();

    expect(router.currentRoute.value.fullPath).toBe('/');
    expect(mountedRoutes).toEqual(['home']);
    expect(wrapper.find('[data-testid="review-route"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="home-route"]').text()).toBe('home');

    Object.assign(state, {
      phase: 'authenticated',
      operation: 'signingOut',
      sessionUsable: false,
      errorCode: null,
      retryAction: null,
      notice: null,
      user: { userId: 'user-1', email: null },
    });
    await nextTick();

    expect(wrapper.find('[data-testid="home-route"]').exists()).toBe(false);
    expect(wrapper.get('[role="status"]').text()).toContain('Signing out…');
  });
});

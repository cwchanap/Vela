import { defineComponent, nextTick, reactive } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router';
import { describe, expect, it, vi } from 'vitest';
import type { MobileAuthCoordinator, MobileAuthState } from '../../auth/mobile-auth-contract';
import { MOBILE_AUTH_KEY } from '../../services/mobile-auth';
import MobileAuthGate from './MobileAuthGate.vue';

const ProtectedSlot = defineComponent({
  template: '<div data-testid="protected-slot">Protected content</div>',
});

const routes: RouteRecordRaw[] = [
  { path: '/', component: ProtectedSlot },
  { path: '/review', component: ProtectedSlot },
];

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'];
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function mountGate(path = '/review') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes,
  });
  await router.push(path);
  await router.isReady();

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
  const wrapper = mount(MobileAuthGate, {
    slots: { default: ProtectedSlot },
    global: {
      plugins: [router],
      provide: {
        [MOBILE_AUTH_KEY as symbol]: coordinator,
      },
    },
  });
  await nextTick();

  return { router, state, wrapper };
}

function authenticate(state: MobileAuthState): void {
  Object.assign(state, {
    phase: 'authenticated',
    operation: 'idle',
    sessionUsable: true,
    errorCode: null,
    retryAction: null,
    notice: null,
    user: { userId: 'user-1', email: null },
  });
}

function signOut(state: MobileAuthState): void {
  Object.assign(state, {
    phase: 'signedOut',
    operation: 'idle',
    sessionUsable: false,
    errorCode: null,
    retryAction: null,
    notice: null,
    user: null,
  });
}

describe('MobileAuthGate landing navigation races', () => {
  it('ignores a stale successful replacement after the session becomes unusable', async () => {
    const landing = deferred<void>();
    const { router, state, wrapper } = await mountGate();
    const originalReplace = router.replace.bind(router);
    vi.spyOn(router, 'replace').mockImplementation(async (target) => {
      await landing.promise;
      return originalReplace(target);
    });

    authenticate(state);
    await nextTick();
    signOut(state);
    await nextTick();
    landing.resolve();
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="protected-slot"]').exists()).toBe(false);
  });

  it('ignores a stale rejected replacement after the session becomes unusable', async () => {
    const landing = deferred<void>();
    const { router, state, wrapper } = await mountGate();
    vi.spyOn(router, 'replace').mockImplementation(async () => {
      await landing.promise;
      throw new Error('navigation failed');
    });

    authenticate(state);
    await nextTick();
    signOut(state);
    await nextTick();
    landing.resolve();
    await flushPromises();
    await nextTick();

    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="protected-slot"]').exists()).toBe(false);
  });

  it('accepts a duplicated replacement when the router is already at home', async () => {
    const { router, state, wrapper } = await mountGate('/');

    authenticate(state);
    await flushPromises();
    await nextTick();

    expect(router.currentRoute.value.fullPath).toBe('/');
    expect(wrapper.get('[data-testid="protected-slot"]').text()).toBe('Protected content');
  });
});

import { defineComponent, nextTick, reactive } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router';
import { describe, expect, it, vi } from 'vitest';
import type {
  MobileAuthCoordinator,
  MobileAuthErrorCode,
  MobileAuthPhase,
  MobileAuthState,
} from '../../auth/mobile-auth-contract';
import { MOBILE_AUTH_KEY } from '../../services/mobile-auth';
import MobileAuthGate, { shouldBypassMobileAuth } from './MobileAuthGate.vue';

const ProtectedSlot = defineComponent({
  template: '<div data-testid="protected-slot">Protected content</div>',
});

const user = { userId: 'user-1', email: 'vela@example.com' };

const routes: RouteRecordRaw[] = [
  { path: '/', component: ProtectedSlot },
  { path: '/review', component: ProtectedSlot },
  {
    path: '/diagnostics',
    component: ProtectedSlot,
    meta: { bypassMobileAuth: true },
  },
  {
    path: '/diagnostics-without-bypass',
    component: ProtectedSlot,
  },
];

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'];
  let reject!: Deferred<T>['reject'];
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function parseRgb(value: string): [number, number, number] {
  const channels = value
    .match(/\d+(?:\.\d+)?/gu)
    ?.slice(0, 3)
    .map(Number);
  if (!channels || channels.length !== 3) {
    throw new Error(`Expected an RGB color, received ${value}`);
  }
  return channels as [number, number, number];
}

function relativeLuminance([red, green, blue]: [number, number, number]): number {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

function contrastRatio(first: [number, number, number], second: [number, number, number]): number {
  const brighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (brighter + 0.05) / (darker + 0.05);
}

function createFakeCoordinator(
  initial: Partial<MobileAuthState> = {},
  overrides: Partial<MobileAuthCoordinator> = {},
): { coordinator: MobileAuthCoordinator; state: MobileAuthState } {
  const state = reactive<MobileAuthState>({
    phase: 'initializing',
    operation: 'idle',
    sessionUsable: false,
    errorCode: null,
    retryAction: null,
    notice: null,
    user: null,
    ...initial,
  });
  const coordinator: MobileAuthCoordinator = {
    state,
    initialize: vi.fn().mockResolvedValue(undefined),
    startSignIn: vi.fn().mockResolvedValue(undefined),
    completeCallback: vi.fn().mockResolvedValue(undefined),
    retryCurrentOperation: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { coordinator, state };
}

async function mountGate(
  initial: Partial<MobileAuthState>,
  options: {
    path?: string;
    coordinator?: MobileAuthCoordinator;
    attachTo?: Element;
  } = {},
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes,
  });
  await router.push(options.path ?? '/review');
  await router.isReady();

  const fake = options.coordinator
    ? { coordinator: options.coordinator, state: options.coordinator.state as MobileAuthState }
    : createFakeCoordinator(initial);
  const wrapper = mount(MobileAuthGate, {
    ...(options.attachTo ? { attachTo: options.attachTo } : {}),
    slots: { default: ProtectedSlot },
    global: {
      plugins: [router],
      provide: {
        [MOBILE_AUTH_KEY as symbol]: fake.coordinator,
      },
    },
  });
  await nextTick();

  return { ...fake, router, wrapper };
}

describe('MobileAuthGate', () => {
  it('announces initialization and keeps protected content unmounted', async () => {
    const { wrapper } = await mountGate({ phase: 'initializing' });

    expect(wrapper.get('[role="status"]').text()).toContain('Preparing secure sign-in');
    expect(wrapper.find('[data-testid="protected-slot"]').exists()).toBe(false);
  });

  it('shows one Google action while signed out and keeps protected content unmounted', async () => {
    const { wrapper } = await mountGate({ phase: 'signedOut' });

    expect(wrapper.get('h1').text()).toBe('Vela');
    expect(wrapper.findAll('button')).toHaveLength(1);
    expect(wrapper.get('button').text()).toBe('Continue with Google');
    expect(wrapper.find('[data-testid="protected-slot"]').exists()).toBe(false);
  });

  it.each<[MobileAuthPhase, string]>([
    ['openingBrowser', 'Opening Google sign-in'],
    ['awaitingCallback', 'Waiting for Google sign-in'],
    ['exchangingCode', 'Completing secure sign-in'],
    ['verifyingSession', 'Verifying your Vela session'],
  ])('announces distinct %s progress', async (phase, expectedCopy) => {
    const { wrapper } = await mountGate({ phase });

    const status = wrapper.get('[role="status"]');
    expect(status.attributes('aria-live')).toBe('polite');
    expect(status.text()).toContain(expectedCopy);
    expect(wrapper.find('[data-testid="protected-slot"]').exists()).toBe(false);
  });

  it('retries only API session verification for session_verification_failed', async () => {
    const retryCurrentOperation = vi.fn().mockResolvedValue(undefined);
    const { coordinator } = createFakeCoordinator(
      {
        phase: 'error',
        errorCode: 'session_verification_failed',
        retryAction: 'verify',
      },
      { retryCurrentOperation },
    );
    const { wrapper } = await mountGate({}, { coordinator });

    const alert = wrapper.get('[role="alert"]');
    expect(alert.text()).toContain('Vela could not verify your session');
    expect(wrapper.findAll('button').map((button) => button.text())).toEqual([
      'Retry',
      'Sign out and start over',
    ]);
    await wrapper.findAll('button')[0]?.trigger('click');

    expect(retryCurrentOperation).toHaveBeenCalledOnce();
    expect(coordinator.startSignIn).not.toHaveBeenCalled();
  });

  it.each<MobileAuthErrorCode>([
    'browser_launch_failed',
    'cancelled',
    'interrupted',
    'transaction_expired',
    'malformed_callback',
    'provider_error',
    'code_exchange_failed',
    'token_validation_failed',
    'session_unauthorized',
  ])('restarts Google sign-in for %s without rendering raw errors', async (errorCode) => {
    const startSignIn = vi.fn().mockResolvedValue(undefined);
    const { coordinator, state } = createFakeCoordinator(
      { phase: 'error', errorCode },
      { startSignIn },
    );
    Object.assign(state, { errorMessage: 'SECRET raw native failure' });
    const { wrapper } = await mountGate({}, { coordinator });

    expect(wrapper.get('[role="alert"]').text()).not.toContain('SECRET');
    expect(wrapper.findAll('button')).toHaveLength(1);
    await wrapper.get('button').trigger('click');

    expect(startSignIn).toHaveBeenCalledOnce();
    expect(coordinator.retryCurrentOperation).not.toHaveBeenCalled();
  });

  it('renders configuration_error without a retry loop', async () => {
    const { coordinator } = createFakeCoordinator({
      phase: 'error',
      errorCode: 'configuration_error',
    });
    const { wrapper } = await mountGate({}, { coordinator });

    expect(wrapper.get('[role="alert"]').text()).toContain('configured');
    expect(wrapper.find('button').exists()).toBe(false);
    expect(coordinator.startSignIn).not.toHaveBeenCalled();
    expect(coordinator.retryCurrentOperation).not.toHaveBeenCalled();
  });

  it('keeps content closed until the authenticated home replacement settles', async () => {
    const landing = deferred<void>();
    const { state, router, wrapper } = await mountGate({ phase: 'signedOut' });
    const originalReplace = router.replace.bind(router);
    const replace = vi.spyOn(router, 'replace').mockImplementation(async (target) => {
      await landing.promise;
      return originalReplace(target);
    });

    state.phase = 'authenticated';
    state.sessionUsable = true;
    state.user = { userId: 'user-1', email: 'vela@example.com' };
    await nextTick();

    expect(replace).toHaveBeenCalledWith('/');
    expect(wrapper.find('[data-testid="protected-slot"]').exists()).toBe(false);

    landing.resolve();
    await flushPromises();
    await nextTick();

    expect(wrapper.get('[data-testid="protected-slot"]').text()).toBe('Protected content');
  });

  it('keeps the old route closed after an aborted home replacement and recovers on retry', async () => {
    let abortHome = true;
    const { state, router, wrapper } = await mountGate({ phase: 'signedOut' }, { path: '/review' });
    const removeGuard = router.beforeEach((to) => {
      if (to.path === '/' && abortHome) {
        return false;
      }
    });

    state.phase = 'authenticated';
    state.sessionUsable = true;
    state.user = { userId: 'user-1', email: null };
    await flushPromises();
    await nextTick();

    expect(router.currentRoute.value.fullPath).toBe('/review');
    expect(wrapper.find('[data-testid="protected-slot"]').exists()).toBe(false);
    expect(wrapper.get('[role="alert"]').text()).toContain('could not open your home');

    abortHome = false;
    await wrapper.get('button').trigger('click');
    await flushPromises();
    await nextTick();

    expect(router.currentRoute.value.fullPath).toBe('/');
    expect(wrapper.find('[data-testid="protected-slot"]').exists()).toBe(true);
    removeGuard();
  });

  it('keeps the competing route closed after a cancelled home replacement and recovers on retry', async () => {
    const pendingHomeGuard = deferred<void>();
    let holdHome = true;
    const { state, router, wrapper } = await mountGate({ phase: 'signedOut' }, { path: '/review' });
    const removeGuard = router.beforeEach(async (to) => {
      if (to.path === '/' && holdHome) {
        await pendingHomeGuard.promise;
      }
    });

    state.phase = 'authenticated';
    state.sessionUsable = true;
    state.user = { userId: 'user-1', email: null };
    await nextTick();
    await router.push('/diagnostics-without-bypass');
    pendingHomeGuard.resolve();
    await flushPromises();
    await nextTick();

    expect(router.currentRoute.value.fullPath).toBe('/diagnostics-without-bypass');
    expect(wrapper.find('[data-testid="protected-slot"]').exists()).toBe(false);
    expect(wrapper.get('[role="alert"]').text()).toContain('could not open your home');

    holdHome = false;
    await wrapper.get('button').trigger('click');
    await flushPromises();
    await nextTick();

    expect(router.currentRoute.value.fullPath).toBe('/');
    expect(wrapper.find('[data-testid="protected-slot"]').exists()).toBe(true);
    removeGuard();
  });

  it('keeps the old route closed after a rejected home replacement without rendering raw errors', async () => {
    const { state, router, wrapper } = await mountGate({ phase: 'signedOut' }, { path: '/review' });
    const originalReplace = router.replace.bind(router);
    vi.spyOn(router, 'replace')
      .mockRejectedValueOnce(new Error('SECRET navigation failure'))
      .mockImplementation(originalReplace);

    state.phase = 'authenticated';
    state.sessionUsable = true;
    state.user = { userId: 'user-1', email: null };
    await flushPromises();
    await nextTick();

    const alert = wrapper.get('[role="alert"]');
    expect(alert.text()).toContain('could not open your home');
    expect(alert.text()).not.toContain('SECRET');
    expect(router.currentRoute.value.fullPath).toBe('/review');
    expect(wrapper.find('[data-testid="protected-slot"]').exists()).toBe(false);

    await wrapper.get('button').trigger('click');
    await flushPromises();
    await nextTick();

    expect(router.currentRoute.value.fullPath).toBe('/');
    expect(wrapper.find('[data-testid="protected-slot"]').exists()).toBe(true);
  });

  it('renders authenticated content only after replacing the active route with home', async () => {
    const { state, router, wrapper } = await mountGate({ phase: 'signedOut' }, { path: '/review' });

    state.phase = 'authenticated';
    state.sessionUsable = true;
    state.user = { userId: 'user-1', email: null };
    await flushPromises();
    await nextTick();

    expect(router.currentRoute.value.fullPath).toBe('/');
    expect(wrapper.find('[data-testid="protected-slot"]').exists()).toBe(true);
  });

  it('keeps protected content unmounted when the authenticated phase is not usable', async () => {
    const { wrapper } = await mountGate({
      phase: 'authenticated',
      sessionUsable: false,
      errorCode: 'session_refresh_failed',
      retryAction: 'refresh',
      user: { userId: 'user-1', email: null },
    });

    await flushPromises();
    await nextTick();

    expect(wrapper.find('[data-testid="protected-slot"]').exists()).toBe(false);
  });

  it('suppresses duplicate sign-in actions while the first action is pending', async () => {
    const pending = deferred<void>();
    const startSignIn = vi.fn(() => pending.promise);
    const { coordinator } = createFakeCoordinator({ phase: 'signedOut' }, { startSignIn });
    const { wrapper } = await mountGate({}, { coordinator });
    const button = wrapper.get('button');

    button.element.click();
    button.element.click();
    await nextTick();

    expect(startSignIn).toHaveBeenCalledOnce();
    expect(button.attributes('disabled')).toBeDefined();

    pending.resolve();
    await flushPromises();
  });

  it('returns focus to the error heading after browser completion fails', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const { state, wrapper } = await mountGate({ phase: 'awaitingCallback' }, { attachTo: host });

    state.phase = 'error';
    state.errorCode = 'cancelled';
    await nextTick();
    await nextTick();

    expect(document.activeElement).toBe(wrapper.get('[data-testid="auth-error-heading"]').element);
  });

  it('returns focus to the primary action when browser completion returns signed out', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const { state, wrapper } = await mountGate({ phase: 'awaitingCallback' }, { attachTo: host });

    state.phase = 'signedOut';
    await nextTick();
    await nextTick();

    expect(document.activeElement).toBe(wrapper.get('button').element);
  });

  it.each<MobileAuthPhase>([
    'initializing',
    'openingBrowser',
    'awaitingCallback',
    'exchangingCode',
    'verifyingSession',
  ])('keeps diagnostics unmounted during %s', async (phase) => {
    const { wrapper } = await mountGate({ phase }, { path: '/diagnostics' });

    expect(wrapper.find('[role="status"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="protected-slot"]').exists()).toBe(false);
  });

  it('allows explicitly marked development diagnostics while signed out', async () => {
    const { wrapper } = await mountGate({ phase: 'signedOut' }, { path: '/diagnostics' });

    expect(wrapper.find('[data-testid="protected-slot"]').exists()).toBe(true);
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('keeps marked diagnostics usable for configuration_error', async () => {
    const { wrapper } = await mountGate(
      { phase: 'error', errorCode: 'configuration_error' },
      { path: '/diagnostics' },
    );

    expect(wrapper.find('[data-testid="protected-slot"]').exists()).toBe(true);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('allows marked development diagnostics for unsupported browser boot', async () => {
    const { wrapper } = await mountGate(
      {
        phase: 'error',
        operation: 'idle',
        sessionUsable: false,
        errorCode: 'unsupported_platform',
        retryAction: null,
        notice: null,
        user: null,
      },
      { path: '/diagnostics' },
    );

    expect(wrapper.find('[data-testid="protected-slot"]').exists()).toBe(true);
  });

  it('shows non-configuration auth errors instead of marked diagnostics', async () => {
    const { wrapper } = await mountGate(
      { phase: 'error', errorCode: 'provider_error' },
      { path: '/diagnostics' },
    );

    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="protected-slot"]').exists()).toBe(false);
  });

  it('requires the development build flag and explicit metadata for a bypass', async () => {
    const signedOut: MobileAuthState = {
      phase: 'signedOut',
      operation: 'idle',
      sessionUsable: false,
      errorCode: null,
      retryAction: null,
      notice: null,
      user: null,
    };
    expect(shouldBypassMobileAuth(true, true, signedOut)).toBe(true);
    expect(shouldBypassMobileAuth(false, true, signedOut)).toBe(false);
    expect(shouldBypassMobileAuth(true, false, signedOut)).toBe(false);
    expect(
      shouldBypassMobileAuth(true, true, {
        ...signedOut,
        phase: 'error',
        errorCode: 'unsupported_platform',
      }),
    ).toBe(true);
    expect(
      shouldBypassMobileAuth(true, true, {
        ...signedOut,
        notice: 'session_unusable',
      }),
    ).toBe(false);
    expect(
      shouldBypassMobileAuth(true, true, {
        ...signedOut,
        operation: 'signingOut',
      }),
    ).toBe(false);
    expect(
      shouldBypassMobileAuth(true, true, {
        ...signedOut,
        errorCode: 'session_cleanup_failed',
        retryAction: 'cleanup',
        notice: 'cleanup_incomplete',
      }),
    ).toBe(false);

    const { wrapper } = await mountGate(
      { phase: 'signedOut' },
      { path: '/diagnostics-without-bypass' },
    );
    expect(wrapper.find('[data-testid="protected-slot"]').exists()).toBe(false);
  });

  it('keeps gate copy at enhanced contrast against the gate surface', async () => {
    const { wrapper } = await mountGate({ phase: 'signedOut' });
    const styles = getComputedStyle(wrapper.get('.mobile-auth-gate').element);
    const ratio = contrastRatio(parseRgb(styles.color), parseRgb(styles.backgroundColor));

    expect(ratio).toBeGreaterThanOrEqual(7);
  });

  it('renders retry and start-over for an expired refresh failure', async () => {
    const { wrapper, coordinator } = await mountGate({
      phase: 'authenticated',
      operation: 'idle',
      sessionUsable: false,
      errorCode: 'session_refresh_failed',
      retryAction: 'refresh',
      notice: null,
      user,
    });

    expect(wrapper.find('[data-testid="protected-slot"]').exists()).toBe(false);
    expect(wrapper.findAll('button').map((button) => button.text())).toEqual([
      'Retry',
      'Sign out and start over',
    ]);
    await wrapper.findAll('button')[1]?.trigger('click');
    expect(coordinator.signOut).toHaveBeenCalledOnce();
  });

  it('renders a non-blocking retry banner over usable content', async () => {
    const retryCurrentOperation = vi.fn().mockResolvedValue(undefined);
    const { coordinator } = createFakeCoordinator(
      {
        phase: 'authenticated',
        operation: 'idle',
        sessionUsable: true,
        errorCode: 'session_refresh_failed',
        retryAction: 'refresh',
        notice: null,
        user,
      },
      { retryCurrentOperation },
    );
    const { wrapper } = await mountGate({}, { coordinator });
    await flushPromises();

    expect(wrapper.find('[data-testid="protected-slot"]').exists()).toBe(true);
    const alert = wrapper.get('[role="alert"]');
    expect(alert.text()).toContain('Vela cannot use this session');
    expect(alert.get('button').text()).toBe('Retry');
    await alert.get('button').trigger('click');
    expect(retryCurrentOperation).toHaveBeenCalledOnce();
  });

  it.each<[MobileAuthState['operation'], string]>([
    ['restoring', 'Restoring your Vela session…'],
    ['refreshing', 'Refreshing your Vela session…'],
    ['persisting', 'Securing your Vela session…'],
    ['verifying', 'Verifying your Vela session…'],
    ['signingOut', 'Signing out…'],
    ['cleaningUp', 'Finishing secure sign-out…'],
  ])('announces blocking %s operation with exact copy', async (operation, copy) => {
    const operationState: Partial<MobileAuthState> =
      operation === 'restoring'
        ? { phase: 'initializing', operation }
        : operation === 'refreshing'
          ? { phase: 'authenticated', operation, user }
          : operation === 'persisting'
            ? { phase: 'exchangingCode', operation }
            : operation === 'verifying'
              ? { phase: 'verifyingSession', operation }
              : { phase: 'signedOut', operation };
    const { wrapper } = await mountGate(operationState);

    const status = wrapper.get('[role="status"]');
    expect(status.attributes('aria-live')).toBe('polite');
    expect(status.text()).toContain(copy);
    expect(wrapper.find('[data-testid="protected-slot"]').exists()).toBe(false);
  });

  it('does not announce a successful background refresh while content stays usable', async () => {
    const { wrapper } = await mountGate({
      phase: 'authenticated',
      operation: 'refreshing',
      sessionUsable: true,
      user,
    });
    await flushPromises();

    expect(wrapper.find('[data-testid="protected-slot"]').exists()).toBe(true);
    expect(wrapper.find('[aria-live]').exists()).toBe(false);
  });

  it('offers only cleanup retry with the exact incomplete-cleanup warning', async () => {
    const { wrapper, coordinator } = await mountGate({
      phase: 'signedOut',
      operation: 'idle',
      sessionUsable: false,
      errorCode: 'session_cleanup_failed',
      retryAction: 'cleanup',
      notice: 'cleanup_incomplete',
      user: null,
    });

    const alert = wrapper.get('[role="alert"]');
    expect(alert.text()).toContain(
      'Vela could not finish secure sign-out. Your session may return if you close and reopen the app before cleanup succeeds.',
    );
    expect(wrapper.findAll('button').map((button) => button.text())).toEqual(['Retry']);
    await wrapper.get('button').trigger('click');
    expect(coordinator.retryCurrentOperation).toHaveBeenCalledOnce();
    expect(coordinator.signOut).not.toHaveBeenCalled();
  });

  it('renders the terminal session notice as an alert with a Google action', async () => {
    const { wrapper } = await mountGate({
      phase: 'signedOut',
      notice: 'session_unusable',
    });

    const alert = wrapper.get('[role="alert"]');
    expect(alert.text()).toContain(
      'Your Vela session is no longer usable. Continue with Google to sign in again.',
    );
    expect(alert.get('button').text()).toBe('Continue with Google');
  });

  it('deduplicates blocking retry actions and disables both recovery controls', async () => {
    const pending = deferred<void>();
    const retryCurrentOperation = vi.fn(() => pending.promise);
    const { coordinator } = createFakeCoordinator(
      {
        phase: 'error',
        errorCode: 'session_restore_failed',
        retryAction: 'restore',
      },
      { retryCurrentOperation },
    );
    const { wrapper } = await mountGate({}, { coordinator });
    const [retry, startOver] = wrapper.findAll('button');

    retry?.element.click();
    retry?.element.click();
    startOver?.element.click();
    await nextTick();

    expect(retryCurrentOperation).toHaveBeenCalledOnce();
    expect(coordinator.signOut).not.toHaveBeenCalled();
    expect(retry?.attributes('disabled')).toBeDefined();
    expect(startOver?.attributes('disabled')).toBeDefined();
    pending.resolve();
    await flushPromises();
  });

  it('returns focus when a background refresh becomes a blocking failure', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const { state, wrapper } = await mountGate(
      {
        phase: 'authenticated',
        operation: 'refreshing',
        sessionUsable: false,
        user,
      },
      { attachTo: host },
    );

    Object.assign(state, {
      operation: 'idle',
      errorCode: 'session_refresh_failed',
      retryAction: 'refresh',
    });
    await nextTick();
    await nextTick();

    expect(document.activeElement).toBe(wrapper.get('[data-testid="auth-error-heading"]').element);
  });

  it('fails closed and emits only the sanitized diagnostic once per invalid-state entry', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { state, wrapper } = await mountGate({
      phase: 'signedOut',
      sessionUsable: true,
    });

    expect(wrapper.find('[data-testid="protected-slot"]').exists()).toBe(false);
    expect(wrapper.get('[role="alert"]').text()).not.toContain('signedOut');
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenLastCalledWith('mobile_auth_invalid_state');

    state.errorCode = 'provider_error';
    await nextTick();
    expect(error).toHaveBeenCalledTimes(1);

    Object.assign(state, {
      phase: 'signedOut',
      sessionUsable: false,
      errorCode: null,
    });
    await nextTick();
    state.sessionUsable = true;
    await nextTick();

    expect(error).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenLastCalledWith('mobile_auth_invalid_state');
    error.mockRestore();
  });
});

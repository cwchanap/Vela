import { flushPromises, mount } from '@vue/test-utils';
import { Quasar, QLayout, QPageContainer } from 'quasar';
import { defineComponent } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import {
  MobileAuthenticatedApiRequestError,
  type MobileAuthCoordinator,
  type MobileAuthState,
} from '../auth/mobile-auth-contract';
import { MOBILE_AUTH_KEY } from '../services/mobile-auth';
import MorePage from './MorePage.vue';

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

const authenticatedState: MobileAuthState = {
  phase: 'authenticated',
  operation: 'idle',
  sessionUsable: true,
  errorCode: null,
  retryAction: null,
  notice: null,
  user: { userId: 'user-1', email: 'vela@example.com' },
};

function createCoordinatorStub(
  overrides: Partial<MobileAuthCoordinator> = {},
): MobileAuthCoordinator {
  return {
    state: authenticatedState,
    initialize: vi.fn().mockResolvedValue(undefined),
    startSignIn: vi.fn().mockResolvedValue(undefined),
    completeCallback: vi.fn().mockResolvedValue(undefined),
    requestAuthenticatedApi: vi
      .fn()
      .mockRejectedValue(new MobileAuthenticatedApiRequestError('session_unavailable')),
    retryCurrentOperation: vi.fn().mockResolvedValue(undefined),
    signOut: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function mountMorePage(coordinator: MobileAuthCoordinator) {
  const Host = defineComponent({
    components: { QLayout, QPageContainer, MorePage },
    template:
      '<q-layout view="hHh Lpr fFf"><q-page-container><more-page /></q-page-container></q-layout>',
  });
  return mount(Host, {
    global: {
      plugins: [Quasar],
      provide: {
        [MOBILE_AUTH_KEY as symbol]: coordinator,
      },
      stubs: {
        DevelopmentDiagnosticsEntry: true,
      },
    },
  });
}

describe('MorePage sign out', () => {
  it('calls the mobile coordinator once and exposes progress', async () => {
    const signOut = deferred<void>();
    const coordinator = createCoordinatorStub({
      signOut: vi.fn(() => signOut.promise),
    });
    const wrapper = mountMorePage(coordinator);

    const button = wrapper.get('[aria-label="Sign out of Vela"]');
    void button.trigger('click');
    void button.trigger('click');
    await flushPromises();

    expect(button.attributes('disabled')).toBeDefined();
    expect(button.attributes('aria-disabled')).toBe('true');
    expect(coordinator.signOut).toHaveBeenCalledOnce();

    signOut.resolve();
    await flushPromises();
    expect(button.attributes('disabled')).toBeUndefined();
  });

  it('requires the mobile auth coordinator', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() =>
        mount(MorePage, {
          global: {
            plugins: [Quasar],
            stubs: { DevelopmentDiagnosticsEntry: true },
          },
        }),
      ).toThrowError('Mobile auth coordinator was not provided');
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });
});

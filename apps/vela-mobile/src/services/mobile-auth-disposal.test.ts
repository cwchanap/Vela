import { describe, expect, it, vi } from 'vitest';
import { MOBILE_OAUTH_CALLBACK_URI } from '../auth/mobile-auth-contract';
import {
  createMobileAuthCoordinator,
  type MobileAuthCoordinatorDependencies,
} from './mobile-auth';

function createDependencies(): MobileAuthCoordinatorDependencies {
  return {
    app: {} as MobileAuthCoordinatorDependencies['app'],
    browser: {} as MobileAuthCoordinatorDependencies['browser'],
    transactionStore: {} as MobileAuthCoordinatorDependencies['transactionStore'],
    tokenTransport: {} as MobileAuthCoordinatorDependencies['tokenTransport'],
    sessionStore: {} as MobileAuthCoordinatorDependencies['sessionStore'],
    installationStore: {} as MobileAuthCoordinatorDependencies['installationStore'],
    isNativeIos: true,
    crypto: undefined,
    isSecureContext: true,
    fetch: vi.fn() as unknown as typeof fetch,
    now: () => 0,
    config: {
      apiUrl: 'https://vela.example/api/',
      userPoolId: 'us-east-1_example',
      mobileClientId: 'mobile-client-id',
      oauthDomain: 'vela.auth.us-east-1.amazoncognito.com',
      region: 'us-east-1',
      callbackUri: MOBILE_OAUTH_CALLBACK_URI,
    },
  };
}

describe('mobile auth disposal', () => {
  it('coalesces concurrent disposal callers onto the serialized operation tail', async () => {
    const coordinator = createMobileAuthCoordinator(createDependencies());

    const firstDisposal = coordinator.dispose();
    const concurrentDisposal = coordinator.dispose();

    await expect(Promise.all([firstDisposal, concurrentDisposal])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(coordinator.state).toEqual({
      phase: 'signedOut',
      operation: 'idle',
      sessionUsable: false,
      errorCode: null,
      retryAction: null,
      notice: null,
      user: null,
    });
  });
});

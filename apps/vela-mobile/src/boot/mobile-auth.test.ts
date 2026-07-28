import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MobileAuthCoordinatorDependencies } from '../services/mobile-auth';

const mocks = vi.hoisted(() => {
  const coordinator = {
    initialize: vi.fn(() => new Promise<void>(() => {})),
  };
  return {
    appPlugin: {
      addListener: vi.fn(),
      getLaunchUrl: vi.fn(),
    },
    browserPlugin: {
      addListener: vi.fn(),
      open: vi.fn(),
      close: vi.fn(),
    },
    preferencesPlugin: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
    },
    capacitorHttpRequest: vi.fn(),
    transactionStore: {
      replace: vi.fn(),
      load: vi.fn(),
      clear: vi.fn(),
    },
    coordinator,
    createCoordinator: vi.fn((_dependencies: unknown) => coordinator),
    createTransactionStore: vi.fn(),
  };
});

vi.mock('@capacitor/app', () => ({ App: mocks.appPlugin }));
vi.mock('@capacitor/browser', () => ({ Browser: mocks.browserPlugin }));
vi.mock('@capacitor/preferences', () => ({ Preferences: mocks.preferencesPlugin }));
vi.mock('@capacitor/core', () => ({
  CapacitorHttp: { request: mocks.capacitorHttpRequest },
}));
vi.mock('../services/mobile-auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/mobile-auth')>();
  return {
    ...original,
    createMobileAuthCoordinator: mocks.createCoordinator,
  };
});
vi.mock('../auth/oauth-transaction-store', () => ({
  createOAuthTransactionStore: mocks.createTransactionStore,
}));

import { MOBILE_AUTH_KEY } from '../services/mobile-auth';
import { config } from '../config';
import boot from './mobile-auth';

describe('mobile auth boot', () => {
  const runBoot = boot as unknown as (params: {
    app: { provide: ReturnType<typeof vi.fn> };
  }) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createTransactionStore.mockReturnValue(mocks.transactionStore);
  });

  it('provides the coordinator and starts initialization without blocking app mount', () => {
    const app = { provide: vi.fn() };

    const result = runBoot({ app });

    expect(result).toBeUndefined();
    expect(app.provide).toHaveBeenCalledWith(MOBILE_AUTH_KEY, mocks.coordinator);
    expect(mocks.coordinator.initialize).toHaveBeenCalledOnce();
  });

  it('maps Capacitor, browser, preferences, Web Crypto, fetch, and config adapters', async () => {
    const app = { provide: vi.fn() };
    const originalSecureContext = window.isSecureContext;
    const fetchImplementation = vi.fn();
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(window, 'fetch', { configurable: true, value: fetchImplementation });

    try {
      runBoot({ app });
      expect(mocks.createTransactionStore).toHaveBeenCalledWith(mocks.preferencesPlugin, Date.now);

      const dependencies = mocks.createCoordinator.mock.calls[0]?.[0] as
        | MobileAuthCoordinatorDependencies
        | undefined;
      expect(dependencies).toMatchObject({
        app: mocks.appPlugin,
        browser: mocks.browserPlugin,
        transactionStore: mocks.transactionStore,
        crypto: window.crypto,
        isSecureContext: true,
        now: Date.now,
        config: {
          apiUrl: config.api.url,
          userPoolId: config.auth.userPoolId,
          mobileClientId: config.auth.mobileClientId,
          oauthDomain: config.auth.oauthDomain,
          region: config.auth.region,
          callbackUri: config.auth.callbackUri,
        },
      });

      const tokenRequest = {
        url: 'https://auth.example/oauth2/token',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: 'grant_type=authorization_code',
      } as const;
      await dependencies?.tokenTransport.request(tokenRequest);
      expect(mocks.capacitorHttpRequest).toHaveBeenCalledWith(tokenRequest);

      dependencies?.fetch('/session');
      expect(fetchImplementation).toHaveBeenCalledWith('/session');
    } finally {
      Object.defineProperty(window, 'isSecureContext', {
        configurable: true,
        value: originalSecureContext,
      });
      Reflect.deleteProperty(window, 'fetch');
    }
  });
});

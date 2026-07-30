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
    secureStorage: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
    },
    capacitor: {
      isNativePlatform: vi.fn(),
      getPlatform: vi.fn(),
    },
    capacitorHttpRequest: vi.fn(),
    transactionStore: {
      replace: vi.fn(),
      load: vi.fn(),
      clear: vi.fn(),
    },
    sessionStore: {
      loadRefreshToken: vi.fn(),
      saveRefreshToken: vi.fn(),
      clearRefreshToken: vi.fn(),
    },
    unsupportedSessionStore: {
      loadRefreshToken: vi.fn(),
      saveRefreshToken: vi.fn(),
      clearRefreshToken: vi.fn(),
    },
    installationStore: {
      isCurrentInstallationMarked: vi.fn(),
      markCurrentInstallation: vi.fn(),
    },
    coordinator,
    createCoordinator: vi.fn((_dependencies: unknown) => coordinator),
    provideMobileServices: vi.fn(),
    createTransactionStore: vi.fn(),
    createIosStore: vi.fn(),
    createUnsupportedStore: vi.fn(),
    createInstallationStore: vi.fn(),
  };
});

vi.mock('@aparajita/capacitor-secure-storage', () => ({
  SecureStorage: mocks.secureStorage,
}));
vi.mock('@capacitor/app', () => ({ App: mocks.appPlugin }));
vi.mock('@capacitor/browser', () => ({ Browser: mocks.browserPlugin }));
vi.mock('@capacitor/preferences', () => ({ Preferences: mocks.preferencesPlugin }));
vi.mock('@capacitor/core', () => ({
  Capacitor: mocks.capacitor,
  CapacitorHttp: { request: mocks.capacitorHttpRequest },
}));
vi.mock('../services/mobile-auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/mobile-auth')>();
  return {
    ...original,
    createMobileAuthCoordinator: mocks.createCoordinator,
  };
});
vi.mock('../services/mobile-services', () => ({
  provideMobileServices: mocks.provideMobileServices,
}));
vi.mock('../auth/oauth-transaction-store', () => ({
  createOAuthTransactionStore: mocks.createTransactionStore,
}));
vi.mock('../auth/mobile-session-store', () => ({
  createIosKeychainSessionStore: mocks.createIosStore,
  createUnsupportedMobileSessionStore: mocks.createUnsupportedStore,
}));
vi.mock('../auth/mobile-installation-store', () => ({
  createMobileInstallationStore: mocks.createInstallationStore,
}));

import { MOBILE_AUTH_KEY } from '../services/mobile-auth';
import { config } from '../config';
import {
  captureConsoleCalls,
  createSecretLeakAssertions,
  searchable,
  storageSnapshot,
} from '../test/secret-leak-helpers';
import boot from './mobile-auth';

const { expectNoSecretLeak } = createSecretLeakAssertions({
  installationKey: 'vela:installation:boot-test',
});

describe('mobile auth boot', () => {
  const runBoot = boot as unknown as (params: {
    app: { provide: ReturnType<typeof vi.fn> };
  }) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.capacitor.isNativePlatform.mockReturnValue(true);
    mocks.capacitor.getPlatform.mockReturnValue('ios');
    mocks.createTransactionStore.mockReturnValue(mocks.transactionStore);
    mocks.createIosStore.mockReturnValue(mocks.sessionStore);
    mocks.createUnsupportedStore.mockReturnValue(mocks.unsupportedSessionStore);
    mocks.createInstallationStore.mockReturnValue(mocks.installationStore);
  });

  it('injects Keychain storage only on native iOS', () => {
    mocks.capacitor.isNativePlatform.mockReturnValue(true);
    mocks.capacitor.getPlatform.mockReturnValue('ios');

    runBoot({ app: { provide: vi.fn() } });

    expect(mocks.createIosStore).toHaveBeenCalledWith({
      secureStorage: mocks.secureStorage,
      runtime: mocks.capacitor,
      config: {
        userPoolId: config.auth.userPoolId,
        mobileClientId: config.auth.mobileClientId,
      },
    });
    expect(mocks.createUnsupportedStore).not.toHaveBeenCalled();
  });

  it.each([
    [false, 'web'],
    [true, 'android'],
  ] as const)('injects the unsupported store for native=%s platform=%s', (isNative, platform) => {
    mocks.capacitor.isNativePlatform.mockReturnValue(isNative);
    mocks.capacitor.getPlatform.mockReturnValue(platform);

    runBoot({ app: { provide: vi.fn() } });

    expect(mocks.createUnsupportedStore).toHaveBeenCalledOnce();
    expect(mocks.createIosStore).not.toHaveBeenCalled();
    const dependencies = mocks.createCoordinator.mock.calls[0]?.[0] as
      | MobileAuthCoordinatorDependencies
      | undefined;
    expect(dependencies).toMatchObject({
      sessionStore: mocks.unsupportedSessionStore,
      installationStore: mocks.installationStore,
      isNativeIos: false,
    });
    expect(mocks.secureStorage.get).not.toHaveBeenCalled();
    expect(mocks.secureStorage.set).not.toHaveBeenCalled();
    expect(mocks.secureStorage.remove).not.toHaveBeenCalled();
  });

  it('provides services with the coordinator before starting initialization without blocking mount', () => {
    const app = { provide: vi.fn() };

    const result = runBoot({ app });

    expect(result).toBeUndefined();
    expect(app.provide).toHaveBeenCalledWith(MOBILE_AUTH_KEY, mocks.coordinator);
    expect(mocks.provideMobileServices).toHaveBeenCalledWith(app, mocks.coordinator);
    expect(mocks.coordinator.initialize).toHaveBeenCalledOnce();
    expect(mocks.provideMobileServices.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.coordinator.initialize.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
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
      expect(mocks.createInstallationStore).toHaveBeenCalledWith(mocks.preferencesPlugin, {
        userPoolId: config.auth.userPoolId,
        mobileClientId: config.auth.mobileClientId,
      });

      const dependencies = mocks.createCoordinator.mock.calls[0]?.[0] as
        | MobileAuthCoordinatorDependencies
        | undefined;
      expect(dependencies).toMatchObject({
        app: mocks.appPlugin,
        browser: mocks.browserPlugin,
        transactionStore: mocks.transactionStore,
        sessionStore: mocks.sessionStore,
        installationStore: mocks.installationStore,
        isNativeIos: true,
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

      // The adapter strips timeoutMs (CapacitorHttp does not understand it)
      // and maps it to connectTimeout/readTimeout so the native layer can
      // terminate a hung token exchange instead of leaving the coordinator
      // pinned in exchangingCode.
      await dependencies?.tokenTransport.request({ ...tokenRequest, timeoutMs: 15_000 });
      expect(mocks.capacitorHttpRequest).toHaveBeenLastCalledWith({
        url: tokenRequest.url,
        method: tokenRequest.method,
        headers: tokenRequest.headers,
        data: tokenRequest.data,
        connectTimeout: 15_000,
        readTimeout: 15_000,
      });

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

  it('keeps secret-bearing native transport results and exceptions out of logging and non-secure storage', async () => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    const consoleCapture = captureConsoleCalls();
    const app = { provide: vi.fn() };
    const originalFetch = window.fetch;
    Object.defineProperty(window, 'fetch', {
      configurable: true,
      value: vi.fn(),
    });
    const rawResponse = {
      status: 400,
      data: {
        accessToken: 'SECRET-access-token',
        idToken: 'SECRET-id-token',
        refreshToken: 'SECRET-refresh-token',
        rotatedRefreshToken: 'SECRET-rotated-refresh-token',
        email: 'SECRET-claim-email',
        rawResponse: 'SECRET-raw-response',
      },
    };
    const nativeFailure = Object.assign(
      new Error('SECRET-access-token SECRET-id-token SECRET-refresh-token'),
      {
        authorizationUrl: 'SECRET-authorization-url',
        callbackCode: 'SECRET-callback-code',
        codeVerifier: 'SECRET-code-verifier',
        nonce: 'SECRET-nonce',
        decodedClaimEmail: 'SECRET-claim-email',
        rawRequest: 'SECRET-raw-request',
        rawResponse: 'SECRET-raw-response',
        nativeException: 'SECRET-native-exception',
      },
    );
    mocks.capacitorHttpRequest
      .mockResolvedValueOnce(rawResponse)
      .mockRejectedValueOnce(nativeFailure);

    try {
      runBoot({ app });
      const dependencies = mocks.createCoordinator.mock.calls[0]?.[0] as
        | MobileAuthCoordinatorDependencies
        | undefined;
      const request = {
        url: 'https://example.invalid/SECRET-authorization-url',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: [
          'code=SECRET-callback-code',
          'code_verifier=SECRET-code-verifier',
          'nonce=SECRET-nonce',
          'access_token=SECRET-access-token',
          'refresh_token=SECRET-refresh-token',
        ].join('&'),
      } as const;

      await expect(dependencies?.tokenTransport.request(request)).resolves.toEqual(rawResponse);
      await expect(dependencies?.tokenTransport.request(request)).rejects.toBe(nativeFailure);

      expectNoSecretLeak({
        consoleCalls: consoleCapture.calls(),
        preferenceCalls: mocks.preferencesPlugin.set.mock.calls,
        renderedText: '',
      });
      expect(searchable(consoleCapture.calls())).not.toContain('SECRET-');
      expect(mocks.preferencesPlugin.set).not.toHaveBeenCalled();
      expect(storageSnapshot(window.localStorage)).toBe('');
      expect(storageSnapshot(window.sessionStorage)).toBe('');
    } finally {
      if (originalFetch === undefined) {
        Reflect.deleteProperty(window, 'fetch');
      } else {
        Object.defineProperty(window, 'fetch', {
          configurable: true,
          value: originalFetch,
        });
      }
      consoleCapture.restore();
      window.localStorage.clear();
      window.sessionStorage.clear();
    }
  });
});

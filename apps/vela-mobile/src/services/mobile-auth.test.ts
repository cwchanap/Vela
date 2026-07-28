import { describe, expect, it, vi } from 'vitest';
import {
  MOBILE_OAUTH_CALLBACK_URI,
  MOBILE_OAUTH_TRANSACTION_KEY,
  MOBILE_OAUTH_TRANSACTION_TTL_MS,
  type MobileAppAdapter,
  type MobileAuthState,
  type MobileBrowserAdapter,
  type MobileOAuthConfig,
  type MobileTokenRequest,
  type MobileTokenTransportAdapter,
  type OAuthTransaction,
} from '../auth/mobile-auth-contract';
import {
  createOAuthTransactionStore,
  type OAuthTransactionPreferences,
} from '../auth/oauth-transaction-store';
import { createMobileAuthCoordinator, MOBILE_AUTH_NETWORK_TIMEOUT_MS } from './mobile-auth';

const NOW = 1_000_000;

const config: MobileOAuthConfig = {
  apiUrl: 'https://vela.example/api/',
  userPoolId: 'us-east-1_example',
  mobileClientId: 'mobile-client-id',
  oauthDomain: 'vela.auth.us-east-1.amazoncognito.com',
  region: 'us-east-1',
  callbackUri: MOBILE_OAUTH_CALLBACK_URI,
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function deterministicCrypto(seed = 0): Crypto {
  let call = seed;
  return {
    getRandomValues<T extends ArrayBufferView | null>(array: T): T {
      if (!(array instanceof Uint8Array)) {
        throw new TypeError('Expected Uint8Array');
      }
      for (let index = 0; index < array.length; index += 1) {
        array[index] = (call + index) % 256;
      }
      call += array.length;
      return array;
    },
    subtle: globalThis.crypto.subtle,
  } as Crypto;
}

function base64UrlJson(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

function idToken(transaction: OAuthTransaction, overrides: Record<string, unknown> = {}): string {
  const claims = {
    token_use: 'id',
    aud: config.mobileClientId,
    iss: `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`,
    nonce: transaction.nonce,
    exp: 2_000,
    ...overrides,
  };
  return `${base64UrlJson({ alg: 'none' })}.${base64UrlJson(claims)}.unsigned`;
}

function callback(transaction: OAuthTransaction, code = 'authorization-code'): string {
  return `${MOBILE_OAUTH_CALLBACK_URI}?code=${code}&state=${transaction.state}`;
}

function response(status: number, value: unknown, jsonError?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jsonError ? vi.fn().mockRejectedValue(jsonError) : vi.fn().mockResolvedValue(value),
  } as unknown as Response;
}

class FakePreferences implements OAuthTransactionPreferences {
  value: string | null = null;
  readonly calls: string[] = [];
  setGate: Promise<void> | undefined;
  removeGate: Promise<void> | undefined;
  getFailure: unknown;
  setFailure: unknown;
  removeFailure: unknown;

  async get({ key }: { key: string }): Promise<{ value: string | null }> {
    expect(key).toBe(MOBILE_OAUTH_TRANSACTION_KEY);
    this.calls.push('preferences:get');
    if (this.getFailure) {
      throw this.getFailure;
    }
    return { value: this.value };
  }

  async set({ key, value }: { key: string; value: string }): Promise<void> {
    expect(key).toBe(MOBILE_OAUTH_TRANSACTION_KEY);
    this.calls.push('preferences:set:start');
    if (this.setFailure) {
      throw this.setFailure;
    }
    this.value = value;
    await this.setGate;
    this.calls.push('preferences:set:complete');
  }

  async remove({ key }: { key: string }): Promise<void> {
    expect(key).toBe(MOBILE_OAUTH_TRANSACTION_KEY);
    this.calls.push('preferences:remove');
    await this.removeGate;
    if (this.removeFailure) {
      throw this.removeFailure;
    }
    this.value = null;
  }

  transaction(): OAuthTransaction {
    if (this.value === null) {
      throw new Error('No persisted transaction');
    }
    return JSON.parse(this.value) as OAuthTransaction;
  }
}

class FakeApp implements MobileAppAdapter {
  readonly order: string[];
  launchUrl: { url: string } | undefined;
  listener: ((event: { url: string }) => void) | undefined;
  failAdd = false;
  failLaunch = false;
  removeCalls = 0;
  failRemove = false;

  constructor(order: string[]) {
    this.order = order;
  }

  async addListener(
    eventName: 'appUrlOpen',
    listener: (event: { url: string }) => void,
  ): Promise<{ remove(): Promise<void> }> {
    this.order.push(`app:add:${eventName}`);
    if (this.failAdd) {
      throw new Error('SECRET-app-plugin-failure');
    }
    this.listener = listener;
    return {
      remove: async () => {
        this.removeCalls += 1;
        if (this.failRemove) {
          throw new Error('SECRET-app-remove-failure');
        }
        this.listener = undefined;
      },
    };
  }

  async getLaunchUrl(): Promise<{ url: string } | undefined> {
    this.order.push('app:getLaunchUrl');
    if (this.failLaunch) {
      throw new Error('SECRET-launch-url-failure');
    }
    return this.launchUrl;
  }

  emit(url: string): void {
    this.listener?.({ url });
  }
}

class FakeBrowser implements MobileBrowserAdapter {
  readonly order: string[];
  listener: (() => void) | undefined;
  readonly openCalls: string[] = [];
  closeCalls = 0;
  removeCalls = 0;
  failAdd = false;
  failOpen = false;
  failClose = false;
  failRemove = false;
  finishOnClose = false;
  openGate: Promise<void> | undefined;
  onClose: (() => void) | undefined;

  constructor(order: string[]) {
    this.order = order;
  }

  async addListener(
    eventName: 'browserFinished',
    listener: () => void,
  ): Promise<{ remove(): Promise<void> }> {
    this.order.push(`browser:add:${eventName}`);
    if (this.failAdd) {
      throw new Error('SECRET-browser-plugin-failure');
    }
    this.listener = listener;
    return {
      remove: async () => {
        this.removeCalls += 1;
        if (this.failRemove) {
          throw new Error('SECRET-browser-remove-failure');
        }
        this.listener = undefined;
      },
    };
  }

  async open({ url }: { url: string }): Promise<void> {
    this.order.push('browser:open');
    this.openCalls.push(url);
    await this.openGate;
    if (this.failOpen) {
      throw new Error('SECRET-browser-launch-failure');
    }
  }

  async close(): Promise<void> {
    this.closeCalls += 1;
    this.onClose?.();
    if (this.failClose) {
      throw new Error('SECRET-browser-close-failure');
    }
    if (this.finishOnClose) {
      this.listener?.();
    }
  }

  finish(): void {
    this.listener?.();
  }
}

class FakeTokenTransport implements MobileTokenTransportAdapter {
  readonly requests: MobileTokenRequest[] = [];
  result: { status: number; data: unknown } = { status: 500, data: {} };
  failure: unknown;
  gate: Promise<{ status: number; data: unknown }> | undefined;

  async request(options: MobileTokenRequest): Promise<{ status: number; data: unknown }> {
    this.requests.push(options);
    if (this.failure) {
      throw this.failure;
    }
    return this.gate ?? this.result;
  }
}

type HarnessOptions = {
  app?: FakeApp;
  browser?: FakeBrowser;
  preferences?: FakePreferences;
  tokenTransport?: FakeTokenTransport;
  crypto?: Crypto | undefined;
  isSecureContext?: boolean;
  authConfig?: MobileOAuthConfig;
  isDevelopment?: boolean;
};

function makeHarness(options: HarnessOptions = {}) {
  const order: string[] = [];
  const app = options.app ?? new FakeApp(order);
  const browser = options.browser ?? new FakeBrowser(order);
  const preferences = options.preferences ?? new FakePreferences();
  const tokenTransport = options.tokenTransport ?? new FakeTokenTransport();
  const sessionFetch = vi.fn().mockResolvedValue(
    response(200, {
      authenticated: true,
      user: { userId: 'user-123', email: 'person@example.com' },
    }),
  );
  const transactionStore = createOAuthTransactionStore(preferences, () => NOW);
  const crypto = Object.hasOwn(options, 'crypto') ? options.crypto : deterministicCrypto();
  const coordinator = createMobileAuthCoordinator({
    app,
    browser,
    transactionStore,
    tokenTransport,
    crypto,
    isSecureContext: options.isSecureContext ?? true,
    fetch: sessionFetch as unknown as typeof fetch,
    now: () => NOW,
    config: options.authConfig ?? config,
    isDevelopment: options.isDevelopment ?? false,
  });

  async function persist(transaction: OAuthTransaction): Promise<void> {
    await transactionStore.replace(transaction);
  }

  function prepareSuccessfulExchange(transaction: OAuthTransaction): void {
    tokenTransport.result = {
      status: 200,
      data: {
        access_token: 'SECRET-access-token',
        id_token: idToken(transaction),
        refresh_token: 'SECRET-refresh-token',
        expires_in: 3_600,
      },
    };
  }

  // Drains the coordinator serialization queue by issuing an intentionally
  // unrelated callback URL so the previous serialized operation resolves.
  async function flush(): Promise<void> {
    await coordinator.completeCallback('https://unrelated.example/path');
  }

  return {
    app,
    browser,
    coordinator,
    order,
    preferences,
    sessionFetch,
    tokenTransport,
    persist,
    prepareSuccessfulExchange,
    flush,
  };
}

function snapshot(state: Readonly<MobileAuthState>): string {
  return JSON.stringify(state);
}

const activeTransaction: OAuthTransaction = {
  state: 'SECRET-state',
  codeVerifier: 'SECRET-verifier',
  nonce: 'SECRET-nonce',
  createdAt: NOW - 1,
};

describe('mobile auth initialization', () => {
  it('registers both listeners before reading the cold-launch URL', async () => {
    const harness = makeHarness();

    await harness.coordinator.initialize();

    expect(harness.order).toEqual([
      'app:add:appUrlOpen',
      'browser:add:browserFinished',
      'app:getLaunchUrl',
    ]);
    expect(harness.coordinator.state).toEqual({
      phase: 'signedOut',
      errorCode: null,
      user: null,
    });
  });

  it.each([
    ['expired', NOW - MOBILE_OAUTH_TRANSACTION_TTL_MS, 'transaction_expired'],
    ['future-corrupt', NOW + 1, 'interrupted'],
  ] as const)('clears an %s startup transaction', async (_name, createdAt, errorCode) => {
    const harness = makeHarness();
    harness.preferences.value = JSON.stringify({ ...activeTransaction, createdAt });

    await harness.coordinator.initialize();

    expect(harness.preferences.value).toBeNull();
    expect(harness.coordinator.state).toMatchObject({ phase: 'error', errorCode });
  });

  it('retains a fresh interrupted transaction for a late warm callback', async () => {
    const harness = makeHarness();
    await harness.persist(activeTransaction);
    harness.prepareSuccessfulExchange(activeTransaction);

    await harness.coordinator.initialize();

    expect(harness.coordinator.state).toMatchObject({
      phase: 'error',
      errorCode: 'interrupted',
    });
    expect(harness.preferences.value).not.toBeNull();

    harness.app.emit(callback(activeTransaction));
    await harness.flush();

    expect(harness.coordinator.state).toEqual({
      phase: 'authenticated',
      errorCode: null,
      user: { userId: 'user-123', email: 'person@example.com' },
    });
    expect(harness.preferences.value).toBeNull();
  });

  it('uses the callback completion path for a cold launch', async () => {
    const harness = makeHarness();
    await harness.persist(activeTransaction);
    harness.prepareSuccessfulExchange(activeTransaction);
    harness.app.launchUrl = { url: callback(activeTransaction) };

    await harness.coordinator.initialize();

    expect(harness.tokenTransport.requests).toHaveLength(1);
    expect(harness.coordinator.state.phase).toBe('authenticated');
  });

  it.each([
    ['mismatched-state', `${MOBILE_OAUTH_CALLBACK_URI}?code=authorization-code&state=WRONG-state`],
    // Multiple `code` params parse as `malformed` — same scheme/path as a
    // real callback, so it is not `unrelated`, but structurally invalid.
    ['malformed-callback', `${MOBILE_OAUTH_CALLBACK_URI}?code=one&code=two&state=SECRET-state`],
  ] as const)(
    'falls through to resumeStoredTransaction when a cold-launch %s is ignored',
    async (_name, launchUrlString) => {
      const harness = makeHarness();
      await harness.persist(activeTransaction);
      harness.app.launchUrl = { url: launchUrlString };

      await harness.coordinator.initialize();

      // The ignored callback must not strand the coordinator in
      // `initializing`. resumeStoredTransactionUnlocked runs and
      // surfaces the interrupted transaction so the user can retry.
      expect(harness.coordinator.state).toMatchObject({
        phase: 'error',
        errorCode: 'interrupted',
      });
      expect(harness.tokenTransport.requests).toHaveLength(0);
      // The stored transaction is preserved for a late warm callback.
      expect(harness.preferences.value).not.toBeNull();
    },
  );

  it('ignores unexpected warm URLs without changing state', async () => {
    const harness = makeHarness();
    await harness.coordinator.initialize();

    harness.app.emit('https://vela.example/not-an-oauth-callback');
    await harness.flush();

    expect(harness.coordinator.state.phase).toBe('signedOut');
    expect(harness.tokenTransport.requests).toHaveLength(0);
  });

  it.each(['app-listener', 'browser-listener', 'launch-url'] as const)(
    'surfaces %s plugin failure as a safe configuration error',
    async (failure) => {
      const harness = makeHarness();
      harness.app.failAdd = failure === 'app-listener';
      harness.browser.failAdd = failure === 'browser-listener';
      harness.app.failLaunch = failure === 'launch-url';

      await harness.coordinator.initialize();

      expect(harness.coordinator.state).toMatchObject({
        phase: 'error',
        errorCode: 'configuration_error',
      });
    },
  );

  it('surfaces invalid development configuration without registering native listeners', async () => {
    const harness = makeHarness({
      authConfig: { ...config, mobileClientId: '' },
      isDevelopment: true,
    });

    await harness.coordinator.initialize();

    expect(harness.order).toEqual([]);
    expect(harness.coordinator.state).toMatchObject({
      phase: 'error',
      errorCode: 'configuration_error',
    });
  });

  it('rejects a whitespace-bearing user pool before registering native listeners', async () => {
    const harness = makeHarness({
      authConfig: { ...config, userPoolId: 'us-east-1_example value' },
      isDevelopment: true,
    });

    await harness.coordinator.initialize();

    expect(harness.order).toEqual([]);
    expect(harness.preferences.calls).toEqual([]);
    expect(harness.coordinator.state).toMatchObject({
      phase: 'error',
      errorCode: 'configuration_error',
    });
  });

  it('surfaces malformed URL configuration without registering native listeners', async () => {
    const harness = makeHarness({
      authConfig: { ...config, apiUrl: 'not a URL' },
      isDevelopment: true,
    });

    await harness.coordinator.initialize();

    expect(harness.order).toEqual([]);
    expect(harness.coordinator.state).toMatchObject({
      phase: 'error',
      errorCode: 'configuration_error',
    });
  });

  it.each([
    ['production build', false],
    ['development build', true],
  ] as const)('rejects a non-loopback http API URL in %s', async (_name, isDevelopment) => {
    const harness = makeHarness({
      authConfig: { ...config, apiUrl: 'http://vela.example/api/' },
      isDevelopment,
    });

    await harness.coordinator.initialize();

    expect(harness.order).toEqual([]);
    expect(harness.coordinator.state).toMatchObject({
      phase: 'error',
      errorCode: 'configuration_error',
    });
  });

  it('rejects a loopback http API URL outside development', async () => {
    const harness = makeHarness({
      authConfig: { ...config, apiUrl: 'http://127.0.0.1:9005/api/' },
      isDevelopment: false,
    });

    await harness.coordinator.initialize();

    expect(harness.order).toEqual([]);
    expect(harness.coordinator.state).toMatchObject({
      phase: 'error',
      errorCode: 'configuration_error',
    });
  });

  it.each([
    ['localhost', 'http://localhost:9005/api/'],
    ['127.0.0.1', 'http://127.0.0.1:9005/api/'],
  ] as const)('accepts a loopback http API URL in development (%s)', async (_name, apiUrl) => {
    const harness = makeHarness({
      authConfig: { ...config, apiUrl },
      isDevelopment: true,
    });

    await harness.coordinator.initialize();

    expect(harness.coordinator.state.phase).toBe('signedOut');
  });

  it('maps transaction-storage startup failure to configuration error', async () => {
    const harness = makeHarness();
    harness.preferences.getFailure = new Error('SECRET-preferences-get');

    await harness.coordinator.initialize();

    expect(harness.coordinator.state).toMatchObject({
      phase: 'error',
      errorCode: 'configuration_error',
    });
  });

  it('does not register duplicate listeners when initialized twice', async () => {
    const harness = makeHarness();

    await harness.coordinator.initialize();
    await harness.coordinator.initialize();

    expect(harness.order).toEqual([
      'app:add:appUrlOpen',
      'browser:add:browserFinished',
      'app:getLaunchUrl',
    ]);
  });
});

describe('starting and cancelling sign-in', () => {
  it('does not start before serialized initialization finishes', async () => {
    const harness = makeHarness();

    await harness.coordinator.startSignIn();

    expect(harness.browser.openCalls).toEqual([]);
    expect(harness.preferences.value).toBeNull();
    expect(harness.coordinator.state.phase).toBe('initializing');
  });

  it.each([
    ['insecure context', deterministicCrypto(), false],
    ['missing crypto', undefined, true],
    ['missing digest', { getRandomValues: deterministicCrypto().getRandomValues } as Crypto, true],
  ] as const)('rejects %s before persistence or browser launch', async (_name, crypto, secure) => {
    const harness = makeHarness({ crypto, isSecureContext: secure });
    await harness.coordinator.initialize();
    harness.preferences.calls.length = 0;

    await harness.coordinator.startSignIn();

    expect(harness.coordinator.state).toMatchObject({
      phase: 'error',
      errorCode: 'configuration_error',
    });
    expect(harness.preferences.calls).toEqual([]);
    expect(harness.browser.openCalls).toEqual([]);
  });

  it('awaits transaction persistence before opening the exact authorization URL', async () => {
    const persistence = deferred<void>();
    const preferences = new FakePreferences();
    preferences.setGate = persistence.promise;
    const harness = makeHarness({ preferences });
    await harness.coordinator.initialize();

    const starting = harness.coordinator.startSignIn();
    await vi.waitFor(() => expect(preferences.calls).toContain('preferences:set:start'));

    expect(harness.browser.openCalls).toEqual([]);
    persistence.resolve();
    await starting;

    expect(preferences.calls).toContain('preferences:set:complete');
    expect(harness.browser.openCalls).toHaveLength(1);
    const url = new URL(harness.browser.openCalls[0]!);
    const stored = preferences.transaction();
    expect(url.origin).toBe('https://vela.auth.us-east-1.amazoncognito.com');
    expect(url.pathname).toBe('/oauth2/authorize');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: 'mobile-client-id',
      response_type: 'code',
      redirect_uri: MOBILE_OAUTH_CALLBACK_URI,
      identity_provider: 'Google',
      state: stored.state,
      nonce: stored.nonce,
      code_challenge_method: 'S256',
    });
    expect(harness.coordinator.state.phase).toBe('awaitingCallback');
  });

  it('rejects duplicate starts by phase after serialization', async () => {
    const harness = makeHarness();
    await harness.coordinator.initialize();

    await harness.coordinator.startSignIn();
    await harness.coordinator.startSignIn();

    expect(harness.browser.openCalls).toHaveLength(1);
    expect(harness.coordinator.state.phase).toBe('awaitingCallback');
  });

  it('never logs the secret-bearing authorization URL', async () => {
    const spies = (['debug', 'info', 'log', 'warn', 'error'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const harness = makeHarness({ isDevelopment: true });
    await harness.coordinator.initialize();

    await harness.coordinator.startSignIn();

    expect(harness.browser.openCalls).toHaveLength(1);
    const openedUrl = harness.browser.openCalls[0]!;
    const output = spies.flatMap((spy) => spy.mock.calls.flat()).join(' ');
    expect(output).not.toContain(openedUrl);
    for (const spy of spies) {
      spy.mockRestore();
    }
  });

  it('clears the transaction when browser launch fails', async () => {
    const harness = makeHarness();
    harness.browser.failOpen = true;
    await harness.coordinator.initialize();

    await harness.coordinator.startSignIn();

    expect(harness.preferences.value).toBeNull();
    expect(harness.coordinator.state).toMatchObject({
      phase: 'error',
      errorCode: 'browser_launch_failed',
    });
  });

  it('maps transaction persistence failure to configuration error without opening the browser', async () => {
    const harness = makeHarness();
    await harness.coordinator.initialize();
    harness.preferences.setFailure = new Error('SECRET-preferences-set');

    await harness.coordinator.startSignIn();

    expect(harness.browser.openCalls).toEqual([]);
    expect(harness.coordinator.state).toMatchObject({
      phase: 'error',
      errorCode: 'configuration_error',
    });
  });

  it('cancels only while awaiting callback and logs one stable development category', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const harness = makeHarness({ isDevelopment: true });
    await harness.coordinator.initialize();
    await harness.coordinator.startSignIn();

    harness.browser.finish();
    await harness.flush();

    expect(harness.preferences.value).toBeNull();
    expect(harness.coordinator.state).toMatchObject({ phase: 'error', errorCode: 'cancelled' });
    expect(info).toHaveBeenCalledWith(expect.stringContaining('browser_closed_before_callback'));
    expect(info.mock.calls[0]?.[0]).toMatch(/verify the deployed.*client ID.*redirect URI/i);
    expect(info.mock.calls.flat().join(' ')).not.toMatch(/vela\.auth|oauth|SECRET|mobile-client/u);
    info.mockRestore();
  });

  it('sets callback progress before close and ignores close-triggered browser completion', async () => {
    const harness = makeHarness();
    await harness.persist(activeTransaction);
    harness.prepareSuccessfulExchange(activeTransaction);
    harness.browser.finishOnClose = true;
    let phaseAtClose: MobileAuthState['phase'] | undefined;
    harness.browser.onClose = () => {
      phaseAtClose = harness.coordinator.state.phase;
    };
    await harness.coordinator.initialize();

    await harness.coordinator.completeCallback(callback(activeTransaction));
    await harness.flush();

    expect(harness.browser.closeCalls).toBe(1);
    expect(phaseAtClose).toBe('exchangingCode');
    expect(harness.coordinator.state.phase).toBe('authenticated');
  });

  it('continues callback processing when browser close fails', async () => {
    const harness = makeHarness();
    await harness.persist(activeTransaction);
    harness.prepareSuccessfulExchange(activeTransaction);
    harness.browser.failClose = true;
    await harness.coordinator.initialize();

    await harness.coordinator.completeCallback(callback(activeTransaction));

    expect(harness.coordinator.state.phase).toBe('authenticated');
  });

  it('queues a callback that arrives while browser opening is finishing', async () => {
    const opening = deferred<void>();
    const harness = makeHarness();
    harness.browser.openGate = opening.promise;
    await harness.coordinator.initialize();

    const starting = harness.coordinator.startSignIn();
    await vi.waitFor(() => expect(harness.browser.openCalls).toHaveLength(1));
    const transaction = harness.preferences.transaction();
    harness.prepareSuccessfulExchange(transaction);
    const completing = harness.coordinator.completeCallback(callback(transaction));

    expect(harness.tokenTransport.requests).toHaveLength(0);
    opening.resolve();
    await Promise.all([starting, completing]);

    expect(harness.tokenTransport.requests).toHaveLength(1);
    expect(harness.coordinator.state.phase).toBe('authenticated');
  });
});

describe('callback completion and cleanup', () => {
  it.each([
    [
      'provider cancellation',
      `${MOBILE_OAUTH_CALLBACK_URI}?error=access_denied&state=${activeTransaction.state}`,
      'cancelled',
    ],
    [
      'provider failure',
      `${MOBILE_OAUTH_CALLBACK_URI}?error=server_error&state=${activeTransaction.state}`,
      'provider_error',
    ],
  ] as const)('clears the transaction for %s', async (_name, url, errorCode) => {
    const harness = makeHarness();
    await harness.persist(activeTransaction);
    await harness.coordinator.initialize();

    await harness.coordinator.completeCallback(url);

    expect(harness.preferences.value).toBeNull();
    expect(harness.tokenTransport.requests).toHaveLength(0);
    expect(harness.coordinator.state).toMatchObject({ phase: 'error', errorCode });
  });

  it.each([
    ['malformed callback', `${MOBILE_OAUTH_CALLBACK_URI}?code=code-without-state`],
    ['state mismatch', `${MOBILE_OAUTH_CALLBACK_URI}?error=access_denied&state=wrong-state`],
    [
      'unsolicited success callback',
      `${MOBILE_OAUTH_CALLBACK_URI}?code=foreign-code&state=foreign-state`,
    ],
  ] as const)(
    'preserves the current transaction when %s arrives with an active flow',
    async (_name, url) => {
      const harness = makeHarness();
      await harness.persist(activeTransaction);
      await harness.coordinator.initialize();
      const phaseBefore = harness.coordinator.state.phase;
      const errorCodeBefore = harness.coordinator.state.errorCode;

      await harness.coordinator.completeCallback(url);

      // The transaction, phase, and error code are unchanged — the callback
      // is ignored because it cannot be matched to the stored transaction.
      expect(harness.preferences.value).not.toBeNull();
      expect(harness.browser.closeCalls).toBe(0);
      expect(harness.tokenTransport.requests).toHaveLength(0);
      expect(harness.coordinator.state.phase).toBe(phaseBefore);
      expect(harness.coordinator.state.errorCode).toBe(errorCodeBefore);
    },
  );

  it('surfaces malformed_callback when no transaction is stored', async () => {
    const harness = makeHarness();
    await harness.coordinator.initialize();
    await harness.coordinator.startSignIn();
    // Simulate the transaction being lost after the browser opened.
    harness.preferences.value = null;

    await harness.coordinator.completeCallback(
      `${MOBILE_OAUTH_CALLBACK_URI}?code=code-without-state`,
    );

    expect(harness.preferences.value).toBeNull();
    expect(harness.tokenTransport.requests).toHaveLength(0);
    expect(harness.coordinator.state).toMatchObject({
      phase: 'error',
      errorCode: 'malformed_callback',
    });
  });

  it('preserves a replacement sign-in when a stale callback from an interrupted transaction arrives', async () => {
    const harness = makeHarness();
    // Simulate an interrupted transaction from a previous session.
    await harness.persist(activeTransaction);
    await harness.coordinator.initialize();
    expect(harness.coordinator.state).toMatchObject({
      phase: 'error',
      errorCode: 'interrupted',
    });

    // The user starts a replacement sign-in, which replaces the stored
    // transaction with a new one.
    await harness.coordinator.startSignIn();
    const newTransaction = harness.preferences.transaction();
    expect(newTransaction.state).not.toBe(activeTransaction.state);
    expect(harness.coordinator.state.phase).toBe('awaitingCallback');
    harness.prepareSuccessfulExchange(newTransaction);

    // The old callback for the interrupted transaction arrives late.
    // Its state matches the old transaction, not the replacement.
    await harness.coordinator.completeCallback(callback(activeTransaction));

    // The replacement transaction is preserved; the browser stays open and
    // the phase is unchanged so the legitimate callback can still complete.
    expect(harness.browser.closeCalls).toBe(0);
    expect(harness.preferences.value).not.toBeNull();
    expect(harness.preferences.transaction()).toEqual(newTransaction);
    expect(harness.coordinator.state.phase).toBe('awaitingCallback');
    expect(harness.tokenTransport.requests).toHaveLength(0);

    // The legitimate callback for the replacement transaction completes.
    await harness.coordinator.completeCallback(callback(newTransaction));

    expect(harness.tokenTransport.requests).toHaveLength(1);
    expect(harness.coordinator.state.phase).toBe('authenticated');
  });

  it.each([
    ['missing', null, 'interrupted'],
    ['corrupt', '{not-json', 'interrupted'],
    [
      'expired',
      JSON.stringify({
        ...activeTransaction,
        createdAt: NOW - MOBILE_OAUTH_TRANSACTION_TTL_MS,
      }),
      'transaction_expired',
    ],
  ] as const)(
    'handles a %s transaction without exchanging a code',
    async (_name, value, errorCode) => {
      const harness = makeHarness();
      await harness.coordinator.initialize();
      await harness.coordinator.startSignIn();
      harness.preferences.value = value;

      await harness.coordinator.completeCallback(callback(activeTransaction));

      expect(harness.preferences.value).toBeNull();
      expect(harness.tokenTransport.requests).toHaveLength(0);
      expect(harness.coordinator.state).toMatchObject({ phase: 'error', errorCode });
    },
  );

  it.each([
    ['transport rejection', undefined, new Error('SECRET-native-request'), 'code_exchange_failed'],
    [
      'HTTP rejection',
      { status: 400, data: { error: 'SECRET-provider' } },
      null,
      'code_exchange_failed',
    ],
    ['invalid JSON', { status: 200, data: '{not-json' }, null, 'code_exchange_failed'],
    [
      'invalid shape',
      { status: 200, data: { id_token: 'SECRET-id' } },
      null,
      'code_exchange_failed',
    ],
  ] as const)(
    'maps %s safely and clears the transaction',
    async (_name, result, failure, errorCode) => {
      const harness = makeHarness();
      await harness.persist(activeTransaction);
      if (result) {
        harness.tokenTransport.result = result;
      }
      harness.tokenTransport.failure = failure;
      await harness.coordinator.initialize();

      await harness.coordinator.completeCallback(callback(activeTransaction, 'SECRET-code'));

      expect(harness.preferences.value).toBeNull();
      expect(harness.coordinator.state).toMatchObject({ phase: 'error', errorCode });
      expect(harness.sessionFetch).not.toHaveBeenCalled();
    },
  );

  it('distinguishes ID-token claim failure from code exchange failure', async () => {
    const harness = makeHarness();
    await harness.persist(activeTransaction);
    harness.tokenTransport.result = {
      status: 200,
      data: {
        access_token: 'SECRET-access-token',
        id_token: idToken(activeTransaction, { nonce: 'SECRET-wrong-nonce' }),
        expires_in: 3_600,
      },
    };
    await harness.coordinator.initialize();

    await harness.coordinator.completeCallback(callback(activeTransaction));

    expect(harness.preferences.value).toBeNull();
    expect(harness.coordinator.state).toMatchObject({
      phase: 'error',
      errorCode: 'token_validation_failed',
    });
    expect(harness.sessionFetch).not.toHaveBeenCalled();
  });

  it('maps transaction-load failure safely without exchanging the code', async () => {
    const harness = makeHarness();
    await harness.coordinator.initialize();
    await harness.coordinator.startSignIn();
    harness.preferences.getFailure = new Error('SECRET-preferences-get');

    await harness.coordinator.completeCallback(callback(activeTransaction));

    expect(harness.tokenTransport.requests).toHaveLength(0);
    expect(harness.coordinator.state).toMatchObject({
      phase: 'error',
      errorCode: 'interrupted',
    });
  });

  it('does not verify a session when successful exchange cleanup fails', async () => {
    const harness = makeHarness();
    await harness.persist(activeTransaction);
    harness.prepareSuccessfulExchange(activeTransaction);
    await harness.coordinator.initialize();
    harness.preferences.removeFailure = new Error('SECRET-preferences-remove');

    await harness.coordinator.completeCallback(callback(activeTransaction));

    expect(harness.sessionFetch).not.toHaveBeenCalled();
    expect(harness.coordinator.state).toMatchObject({
      phase: 'error',
      errorCode: 'code_exchange_failed',
    });
  });

  it('uses native transport only for token exchange and ordinary fetch for session proof', async () => {
    const harness = makeHarness();
    await harness.persist(activeTransaction);
    harness.prepareSuccessfulExchange(activeTransaction);
    await harness.coordinator.initialize();

    await harness.coordinator.completeCallback(callback(activeTransaction, 'SECRET-code'));

    expect(harness.tokenTransport.requests).toEqual([
      {
        url: 'https://vela.auth.us-east-1.amazoncognito.com/oauth2/token',
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        data: expect.stringContaining('code=SECRET-code'),
        timeoutMs: expect.any(Number),
      },
    ]);
    expect(harness.sessionFetch).toHaveBeenCalledOnce();
    expect(harness.preferences.value).toBeNull();
    expect(snapshot(harness.coordinator.state)).not.toMatch(/SECRET|token|verifier|nonce|code/u);
  });

  it('ignores a duplicate callback after authentication', async () => {
    const harness = makeHarness();
    await harness.persist(activeTransaction);
    harness.prepareSuccessfulExchange(activeTransaction);
    await harness.coordinator.initialize();

    await harness.coordinator.completeCallback(callback(activeTransaction));
    await harness.coordinator.completeCallback(callback(activeTransaction));

    expect(harness.tokenTransport.requests).toHaveLength(1);
    expect(harness.coordinator.state.phase).toBe('authenticated');
  });

  it('preserves a terminal provider error when the callback is delivered twice', async () => {
    const cleanup = deferred<void>();
    const harness = makeHarness();
    await harness.persist(activeTransaction);
    await harness.coordinator.initialize();
    harness.preferences.calls.length = 0;
    harness.preferences.removeGate = cleanup.promise;
    const providerError = `${MOBILE_OAUTH_CALLBACK_URI}?error=server_error&state=${activeTransaction.state}`;

    const completing = harness.coordinator.completeCallback(providerError);
    await vi.waitFor(() => expect(harness.preferences.calls).toContain('preferences:remove'));

    expect(harness.coordinator.state).toMatchObject({
      phase: 'error',
      errorCode: 'provider_error',
    });

    cleanup.resolve();
    await completing;
    await harness.coordinator.completeCallback(providerError);

    expect(harness.browser.closeCalls).toBe(1);
    expect(harness.tokenTransport.requests).toHaveLength(0);
    expect(harness.coordinator.state).toMatchObject({
      phase: 'error',
      errorCode: 'provider_error',
    });
  });

  it('ignores a late callback after cancellation even when transaction removal fails', async () => {
    const harness = makeHarness();
    await harness.coordinator.initialize();
    await harness.coordinator.startSignIn();
    const transaction = harness.preferences.transaction();
    harness.prepareSuccessfulExchange(transaction);
    harness.preferences.removeFailure = new Error('SECRET-preferences-remove');

    harness.browser.finish();
    await harness.flush();
    expect(harness.coordinator.state).toMatchObject({
      phase: 'error',
      errorCode: 'cancelled',
    });

    await harness.coordinator.completeCallback(callback(transaction));

    expect(harness.tokenTransport.requests).toHaveLength(0);
    expect(harness.coordinator.state).toMatchObject({
      phase: 'error',
      errorCode: 'cancelled',
    });
  });

  it('marks a cleanup-failed exchange terminal before a duplicate callback', async () => {
    const harness = makeHarness();
    await harness.persist(activeTransaction);
    harness.prepareSuccessfulExchange(activeTransaction);
    await harness.coordinator.initialize();
    harness.preferences.removeFailure = new Error('SECRET-preferences-remove');

    await harness.coordinator.completeCallback(callback(activeTransaction));

    expect(harness.tokenTransport.requests).toHaveLength(1);
    expect(harness.coordinator.state).toMatchObject({
      phase: 'error',
      errorCode: 'code_exchange_failed',
    });

    await harness.coordinator.completeCallback(callback(activeTransaction));

    expect(harness.tokenTransport.requests).toHaveLength(1);
    expect(harness.sessionFetch).not.toHaveBeenCalled();
    expect(harness.coordinator.state).toMatchObject({
      phase: 'error',
      errorCode: 'code_exchange_failed',
    });
  });

  it('ignores a duplicate callback while retaining a retryable verified token bundle', async () => {
    const harness = makeHarness();
    await harness.persist(activeTransaction);
    harness.prepareSuccessfulExchange(activeTransaction);
    harness.sessionFetch.mockResolvedValueOnce(response(500, { error: 'temporary' }));
    await harness.coordinator.initialize();

    await harness.coordinator.completeCallback(callback(activeTransaction));
    await harness.coordinator.completeCallback(callback(activeTransaction));

    expect(harness.tokenTransport.requests).toHaveLength(1);
    expect(harness.coordinator.state).toMatchObject({
      phase: 'error',
      errorCode: 'session_verification_failed',
    });

    harness.sessionFetch.mockResolvedValueOnce(
      response(200, {
        authenticated: true,
        user: { userId: 'retry-user', email: null },
      }),
    );
    await harness.coordinator.retrySessionVerification();

    expect(harness.tokenTransport.requests).toHaveLength(1);
    expect(harness.coordinator.state.phase).toBe('authenticated');
  });
});

describe('session verification', () => {
  async function exchangedHarness(apiUrl = config.apiUrl) {
    const harness = makeHarness({ authConfig: { ...config, apiUrl } });
    await harness.persist(activeTransaction);
    harness.prepareSuccessfulExchange(activeTransaction);
    await harness.coordinator.initialize();
    return harness;
  }

  it.each([
    ['https://vela.example/api/', 'https://vela.example/api/auth/session'],
    ['https://vela.example/api', 'https://vela.example/api/auth/session'],
  ])('joins the session URL from %s', async (apiUrl, expected) => {
    const harness = await exchangedHarness(apiUrl);

    await harness.coordinator.completeCallback(callback(activeTransaction));

    expect(harness.sessionFetch).toHaveBeenCalledWith(expected, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: expect.stringMatching(/^Bearer /u),
      },
      signal: expect.any(AbortSignal),
    });
    const authorization = (
      harness.sessionFetch.mock.calls[0]![1]?.headers as Record<string, string>
    ).Authorization;
    expect(authorization).toBe(`Bearer ${idToken(activeTransaction)}`);
  });

  it.each([401, 403])('clears the token bundle after API status %i', async (status) => {
    const harness = await exchangedHarness();
    harness.sessionFetch.mockResolvedValueOnce(response(status, { authenticated: false }));

    await harness.coordinator.completeCallback(callback(activeTransaction));
    harness.sessionFetch.mockResolvedValueOnce(
      response(200, {
        authenticated: true,
        user: { userId: 'user-123', email: null },
      }),
    );
    await harness.coordinator.retrySessionVerification();

    expect(harness.coordinator.state).toMatchObject({
      phase: 'error',
      errorCode: 'session_unauthorized',
    });
    expect(harness.sessionFetch).toHaveBeenCalledOnce();
  });

  it.each([
    ['server response', response(500, { error: 'SECRET-server' }), null],
    ['fetch rejection', null, new Error('SECRET-network')],
    ['parse failure', response(200, null, new Error('SECRET-json')), null],
    ['invalid response', response(200, { authenticated: true, user: { email: null } }), null],
  ] as const)(
    'retains the token bundle and retries only session proof after %s',
    async (_name, firstResponse, fetchFailure) => {
      const harness = await exchangedHarness();
      if (fetchFailure) {
        harness.sessionFetch.mockRejectedValueOnce(fetchFailure);
      } else {
        harness.sessionFetch.mockResolvedValueOnce(firstResponse!);
      }

      await harness.coordinator.completeCallback(callback(activeTransaction));

      expect(harness.coordinator.state).toMatchObject({
        phase: 'error',
        errorCode: 'session_verification_failed',
      });
      harness.sessionFetch.mockResolvedValueOnce(
        response(200, {
          authenticated: true,
          user: { userId: 'retry-user', email: null },
        }),
      );
      await harness.coordinator.retrySessionVerification();

      expect(harness.tokenTransport.requests).toHaveLength(1);
      expect(harness.sessionFetch).toHaveBeenCalledTimes(2);
      expect(harness.coordinator.state).toEqual({
        phase: 'authenticated',
        errorCode: null,
        user: { userId: 'retry-user', email: null },
      });
    },
  );

  it('requires the authenticated user response shape', async () => {
    const harness = await exchangedHarness();
    harness.sessionFetch.mockResolvedValueOnce(
      response(200, {
        authenticated: false,
        user: { userId: 'untrusted-user', email: 'person@example.com' },
      }),
    );

    await harness.coordinator.completeCallback(callback(activeTransaction));

    expect(harness.coordinator.state).toMatchObject({
      phase: 'error',
      errorCode: 'session_verification_failed',
      user: null,
    });
  });

  it('routes a hung session-verification fetch to session_verification_failed via the abort signal', async () => {
    const harness = await exchangedHarness();
    vi.useFakeTimers();
    try {
      harness.sessionFetch.mockImplementationOnce(
        (_url, init) =>
          new Promise<void>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new Error('aborted'));
            });
          }),
      );

      const completing = harness.coordinator.completeCallback(callback(activeTransaction));
      await vi.advanceTimersByTimeAsync(MOBILE_AUTH_NETWORK_TIMEOUT_MS);
      await completing;

      expect(harness.coordinator.state).toMatchObject({
        phase: 'error',
        errorCode: 'session_verification_failed',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts a hung response body and routes to session_verification_failed', async () => {
    const harness = await exchangedHarness();
    vi.useFakeTimers();
    try {
      // fetch() resolves as soon as headers arrive, but the body never
      // arrives. The timeout must stay active through response.json() so
      // the coordinator is not pinned in verifyingSession indefinitely.
      harness.sessionFetch.mockImplementationOnce((_url, init) =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => {
                reject(new Error('aborted'));
              });
            }),
        } as unknown as Response),
      );

      const completing = harness.coordinator.completeCallback(callback(activeTransaction));
      await vi.advanceTimersByTimeAsync(MOBILE_AUTH_NETWORK_TIMEOUT_MS);
      await completing;

      expect(harness.coordinator.state).toMatchObject({
        phase: 'error',
        errorCode: 'session_verification_failed',
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('serialization, disposal, and secret handling', () => {
  it('serializes duplicate callback completion so code exchange happens once', async () => {
    const tokenResponse = deferred<{ status: number; data: unknown }>();
    const harness = makeHarness();
    await harness.persist(activeTransaction);
    harness.tokenTransport.gate = tokenResponse.promise;
    await harness.coordinator.initialize();

    const first = harness.coordinator.completeCallback(callback(activeTransaction));
    const second = harness.coordinator.completeCallback(callback(activeTransaction));
    await vi.waitFor(() => expect(harness.tokenTransport.requests).toHaveLength(1));

    expect(harness.tokenTransport.requests).toHaveLength(1);
    tokenResponse.resolve({
      status: 200,
      data: {
        access_token: 'SECRET-access-token',
        id_token: idToken(activeTransaction),
        expires_in: 3_600,
      },
    });
    await Promise.all([first, second]);

    expect(harness.tokenTransport.requests).toHaveLength(1);
    expect(harness.coordinator.state.phase).toBe('authenticated');
  });

  it('dispose removes listeners and memory state without erasing a crash-survival transaction', async () => {
    const harness = makeHarness();
    await harness.persist(activeTransaction);
    await harness.coordinator.initialize();

    await harness.coordinator.dispose();

    expect(harness.app.removeCalls).toBe(1);
    expect(harness.browser.removeCalls).toBe(1);
    expect(harness.preferences.value).not.toBeNull();
    expect(harness.coordinator.state).toEqual({
      phase: 'signedOut',
      errorCode: null,
      user: null,
    });
  });

  it('attempts both listener removals and remains idempotent when teardown rejects', async () => {
    const harness = makeHarness();
    await harness.coordinator.initialize();
    harness.app.failRemove = true;
    harness.browser.failRemove = true;

    await harness.coordinator.dispose();
    await harness.coordinator.dispose();

    expect(harness.app.removeCalls).toBe(1);
    expect(harness.browser.removeCalls).toBe(1);
    expect(harness.coordinator.state.phase).toBe('signedOut');
  });

  it('never logs or exposes callback, verifier, token, claim, or thrown-error sentinels', async () => {
    const spies = (['debug', 'info', 'log', 'warn', 'error'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const harness = makeHarness({ isDevelopment: true });
    await harness.persist(activeTransaction);
    harness.tokenTransport.failure = new Error('SECRET-thrown-request-object');
    await harness.coordinator.initialize();

    await harness.coordinator.completeCallback(
      `${MOBILE_OAUTH_CALLBACK_URI}?code=SECRET-code&state=${activeTransaction.state}`,
    );

    const output = spies.flatMap((spy) => spy.mock.calls.flat()).join(' ');
    expect(output).not.toMatch(
      /SECRET-code|SECRET-verifier|SECRET-state|SECRET-nonce|SECRET-access|SECRET-refresh|SECRET-thrown/u,
    );
    expect(snapshot(harness.coordinator.state)).not.toMatch(/SECRET/u);
    for (const spy of spies) {
      spy.mockRestore();
    }
  });
});

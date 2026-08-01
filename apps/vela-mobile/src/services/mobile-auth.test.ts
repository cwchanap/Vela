import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watch } from 'vue';
import {
  MOBILE_OAUTH_CALLBACK_URI,
  MOBILE_OAUTH_TRANSACTION_KEY,
  MOBILE_OAUTH_TRANSACTION_TTL_MS,
  assertMobileAuthState,
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
import {
  createMobileInstallationKey,
  type MobileInstallationStore,
} from '../auth/mobile-installation-store';
import { MobileSessionStoreError, type MobileSessionStore } from '../auth/mobile-session-store';
import { createMobileAuthCoordinator, MOBILE_AUTH_NETWORK_TIMEOUT_MS } from './mobile-auth';
import {
  captureConsoleCalls as createConsoleCapture,
  createSecretLeakAssertions,
  searchable,
} from '../test/secret-leak-helpers';

const NOW = 1_000_000;

const config: MobileOAuthConfig = {
  apiUrl: 'https://vela.example/api/',
  userPoolId: 'us-east-1_example',
  mobileClientId: 'mobile-client-id',
  oauthDomain: 'vela.auth.us-east-1.amazoncognito.com',
  region: 'us-east-1',
  callbackUri: MOBILE_OAUTH_CALLBACK_URI,
};

const { expectNoSecretLeak } = createSecretLeakAssertions({
  installationKey: createMobileInstallationKey(config),
});

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

function idToken(
  transaction: OAuthTransaction,
  overrides: Record<string, unknown> = {},
  signature = 'unsigned',
): string {
  const claims = {
    token_use: 'id',
    aud: config.mobileClientId,
    iss: `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`,
    sub: 'user-123',
    nonce: transaction.nonce,
    exp: 2_000,
    ...overrides,
  };
  return `${base64UrlJson({ alg: 'none' })}.${base64UrlJson(claims)}.${signature}`;
}

function refreshedIdToken(overrides: Record<string, unknown> = {}, signature = 'unsigned'): string {
  return `${base64UrlJson({ alg: 'none' })}.${base64UrlJson({
    token_use: 'id',
    aud: config.mobileClientId,
    iss: `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`,
    sub: 'user-123',
    exp: 2_000,
    ...overrides,
  })}.${signature}`;
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
  readonly setCalls: unknown[][] = [];
  getGate: Promise<void> | undefined;
  setGate: Promise<void> | undefined;
  removeGate: Promise<void> | undefined;
  getFailure: unknown;
  setFailure: unknown;
  removeFailure: unknown;

  constructor(private readonly order?: string[]) {}

  async get({ key }: { key: string }): Promise<{ value: string | null }> {
    expect(key).toBe(MOBILE_OAUTH_TRANSACTION_KEY);
    this.calls.push('preferences:get');
    this.order?.push('preferences:get');
    await this.getGate;
    if (this.getFailure) {
      throw this.getFailure;
    }
    return { value: this.value };
  }

  async set({ key, value }: { key: string; value: string }): Promise<void> {
    expect(key).toBe(MOBILE_OAUTH_TRANSACTION_KEY);
    this.setCalls.push([{ key, value }]);
    this.calls.push('preferences:set:start');
    this.order?.push('preferences:set:start');
    if (this.setFailure) {
      throw this.setFailure;
    }
    this.value = value;
    await this.setGate;
    this.calls.push('preferences:set:complete');
    this.order?.push('preferences:set:complete');
  }

  async remove({ key }: { key: string }): Promise<void> {
    expect(key).toBe(MOBILE_OAUTH_TRANSACTION_KEY);
    this.calls.push('preferences:remove');
    this.order?.push('preferences:remove');
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

class FakeSessionStore implements MobileSessionStore {
  refreshToken: string | null = null;
  readonly saveAttempts: string[] = [];
  clearCalls = 0;
  loadGate: Promise<void> | undefined;
  saveGate: Promise<void> | undefined;
  clearGate: Promise<void> | undefined;
  loadFailure: unknown;
  saveFailure: unknown;
  clearFailure: unknown;

  constructor(private readonly order: string[]) {}

  async loadRefreshToken(): Promise<string | null> {
    this.order.push('session:load');
    await this.loadGate;
    if (this.loadFailure) throw this.loadFailure;
    return this.refreshToken;
  }

  async saveRefreshToken(refreshToken: string): Promise<void> {
    this.order.push(`session:save:${refreshToken}`);
    this.saveAttempts.push(refreshToken);
    await this.saveGate;
    if (this.saveFailure) throw this.saveFailure;
    this.refreshToken = refreshToken;
  }

  async clearRefreshToken(): Promise<void> {
    this.order.push('session:clear');
    this.clearCalls += 1;
    await this.clearGate;
    if (this.clearFailure) throw this.clearFailure;
    this.refreshToken = null;
  }
}

class FakeInstallationStore implements MobileInstallationStore {
  marked = true;
  readFailure: unknown;
  markFailure: unknown;
  readGate: Promise<void> | undefined;
  markGate: Promise<void> | undefined;
  readCalls = 0;
  markCalls = 0;

  constructor(private readonly order: string[]) {}

  async isCurrentInstallationMarked(): Promise<boolean> {
    this.order.push('installation:isMarked');
    this.readCalls += 1;
    await this.readGate;
    if (this.readFailure) throw this.readFailure;
    return this.marked;
  }

  async markCurrentInstallation(): Promise<void> {
    this.order.push('installation:mark');
    this.markCalls += 1;
    await this.markGate;
    if (this.markFailure) throw this.markFailure;
    this.marked = true;
  }
}

class FakeApp implements MobileAppAdapter {
  readonly order: string[];
  launchUrl: { url: string } | undefined;
  urlListener: ((event: { url: string }) => void) | undefined;
  stateListener: ((event: { isActive: boolean }) => void) | undefined;
  addGate: Promise<void> | undefined;
  failAdd = false;
  failLaunch = false;
  removeCalls = 0;
  failRemove = false;

  constructor(order: string[]) {
    this.order = order;
  }

  async addListener(
    eventName: 'appUrlOpen' | 'appStateChange',
    listener: ((event: { url: string }) => void) | ((event: { isActive: boolean }) => void),
  ): Promise<{ remove(): Promise<void> }> {
    this.order.push(`app:add:${eventName}`);
    await this.addGate;
    if (this.failAdd) {
      throw new Error('SECRET-app-plugin-failure');
    }
    if (eventName === 'appUrlOpen') {
      this.urlListener = listener as (event: { url: string }) => void;
    } else {
      this.stateListener = listener as (event: { isActive: boolean }) => void;
    }
    return {
      remove: async () => {
        this.removeCalls += 1;
        if (this.failRemove) {
          throw new Error('SECRET-app-remove-failure');
        }
        if (eventName === 'appUrlOpen') {
          this.urlListener = undefined;
        } else {
          this.stateListener = undefined;
        }
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
    this.urlListener?.({ url });
  }

  emitState(isActive: boolean): void {
    this.stateListener?.({ isActive });
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
  closeGate: Promise<void> | undefined;
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
    await this.closeGate;
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
  readonly queuedFailures: unknown[] = [];
  result: { status: number; data: unknown } = { status: 500, data: {} };
  failure: unknown;
  gate: Promise<{ status: number; data: unknown }> | undefined;

  constructor(private readonly order: string[]) {}

  async request(options: MobileTokenRequest): Promise<{ status: number; data: unknown }> {
    this.requests.push(options);
    this.order.push(
      options.data.includes('grant_type=refresh_token')
        ? 'token:refresh'
        : 'token:authorizationCode',
    );
    if (this.queuedFailures.length > 0) {
      throw this.queuedFailures.shift();
    }
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
  sessionStore?: FakeSessionStore;
  installationStore?: FakeInstallationStore;
  isNativeIos?: boolean;
  crypto?: Crypto | undefined;
  isSecureContext?: boolean;
  authConfig?: MobileOAuthConfig;
  isDevelopment?: boolean;
  now?: () => number;
};

function makeHarness(options: HarnessOptions = {}) {
  const order: string[] = [];
  const app = options.app ?? new FakeApp(order);
  const browser = options.browser ?? new FakeBrowser(order);
  const preferences = options.preferences ?? new FakePreferences(order);
  const tokenTransport = options.tokenTransport ?? new FakeTokenTransport(order);
  const sessionStore = options.sessionStore ?? new FakeSessionStore(order);
  const installationStore = options.installationStore ?? new FakeInstallationStore(order);
  const sessionFetch = vi.fn(
    async (
      _input: Parameters<typeof fetch>[0],
      _init?: Parameters<typeof fetch>[1],
    ): Promise<Response> => {
      order.push('fetch:/auth/session');
      return response(200, {
        authenticated: true,
        user: { userId: 'user-123', email: 'person@example.com' },
      });
    },
  );
  const transactionStore = createOAuthTransactionStore(preferences, () => NOW);
  const crypto = Object.hasOwn(options, 'crypto') ? options.crypto : deterministicCrypto();
  const coordinator = createMobileAuthCoordinator({
    app,
    browser,
    transactionStore,
    tokenTransport,
    sessionStore,
    installationStore,
    isNativeIos: options.isNativeIos ?? true,
    crypto,
    isSecureContext: options.isSecureContext ?? true,
    fetch: sessionFetch as unknown as typeof fetch,
    now: options.now ?? (() => NOW),
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
    sessionStore,
    installationStore,
    sessionFetch,
    tokenTransport,
    persist,
    prepareSuccessfulExchange,
    flush,
  };
}

function expectOrderedCalls(order: string[], sequence: string[]): void {
  let previousIndex = -1;
  for (const item of sequence) {
    const index = order.indexOf(item, previousIndex + 1);
    expect(index, `${item} must follow ${order[previousIndex] ?? 'the start'}`).toBeGreaterThan(
      previousIndex,
    );
    previousIndex = index;
  }
}

function prepareSuccessfulRefresh(
  harness: ReturnType<typeof makeHarness>,
  options: {
    subject?: string;
    rotatedRefreshToken?: string;
    expiresInSeconds?: number;
    claimExpirySeconds?: number;
  } = {},
): void {
  harness.tokenTransport.result = {
    status: 200,
    data: {
      access_token: 'SECRET-refreshed-access-token',
      id_token: refreshedIdToken({
        sub: options.subject ?? 'user-123',
        ...(options.claimExpirySeconds === undefined ? {} : { exp: options.claimExpirySeconds }),
      }),
      expires_in: options.expiresInSeconds ?? 3_600,
      ...(options.rotatedRefreshToken ? { refresh_token: options.rotatedRefreshToken } : {}),
    },
  };
}

async function authenticateWithExpiry(
  harness: ReturnType<typeof makeHarness>,
  expiresAt: number,
  clockNow = Date.now(),
): Promise<void> {
  const expiresInSeconds = (expiresAt - clockNow) / 1_000;
  if (!Number.isInteger(expiresInSeconds) || expiresInSeconds <= 0) {
    throw new Error('Test expiry must be a positive whole number of seconds');
  }

  await harness.persist(activeTransaction);
  harness.tokenTransport.result = {
    status: 200,
    data: {
      access_token: 'SECRET-access-token',
      id_token: idToken(activeTransaction, {
        exp: Math.ceil((expiresAt + 3_600_000) / 1_000),
      }),
      refresh_token: 'SECRET-refresh-token',
      expires_in: expiresInSeconds,
    },
  };
  await harness.coordinator.initialize();
  await harness.coordinator.completeCallback(callback(activeTransaction));
}

async function authenticate(harness: ReturnType<typeof makeHarness>): Promise<void> {
  await harness.persist(activeTransaction);
  harness.prepareSuccessfulExchange(activeTransaction);
  await harness.coordinator.initialize();
  await harness.coordinator.completeCallback(callback(activeTransaction));
}

async function arrangeBlockingRetry(
  retryAction: 'restore' | 'refresh' | 'persist' | 'verify',
): Promise<ReturnType<typeof makeHarness>> {
  if (retryAction === 'restore') {
    const harness = makeHarness();
    harness.sessionStore.refreshToken = 'SECRET-durable-token';
    harness.tokenTransport.result = { status: 503, data: {} };
    await harness.coordinator.initialize();
    return harness;
  }

  if (retryAction === 'refresh') {
    let currentNow = NOW;
    const harness = makeHarness({ now: () => currentNow });
    await authenticate(harness);
    harness.tokenTransport.failure = new Error('SECRET-refresh-network');
    currentNow += 3_541_000;
    harness.app.emitState(true);
    await harness.flush();
    return harness;
  }

  const harness = makeHarness();
  harness.sessionStore.refreshToken = 'SECRET-durable-token';
  prepareSuccessfulRefresh(harness, {
    ...(retryAction === 'persist' ? { rotatedRefreshToken: 'SECRET-rotated-refresh-token' } : {}),
  });
  if (retryAction === 'persist') {
    harness.sessionStore.saveFailure = new Error('SECRET-persist');
  } else {
    harness.sessionFetch.mockResolvedValueOnce(response(503, { error: 'temporary' }));
  }
  await harness.coordinator.initialize();
  return harness;
}

function refreshRequests(harness: ReturnType<typeof makeHarness>): MobileTokenRequest[] {
  return harness.tokenTransport.requests.filter((request) =>
    request.data.includes('grant_type=refresh_token'),
  );
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

const securityTransaction: OAuthTransaction = {
  state: 'SECRET-authorization-url',
  codeVerifier: 'SECRET-code-verifier',
  nonce: 'SECRET-nonce',
  createdAt: NOW - 1,
};

function captureConsoleCalls(): {
  calls: () => unknown[][];
} {
  return createConsoleCapture();
}

function prepareSentinelExchange(harness: ReturnType<typeof makeHarness>): void {
  harness.tokenTransport.result = {
    status: 200,
    data: {
      access_token: 'SECRET-access-token',
      id_token: idToken(securityTransaction, { email: 'SECRET-claim-email' }, 'SECRET-id-token'),
      refresh_token: 'SECRET-refresh-token',
      expires_in: 3_600,
    },
  };
}

function prepareSentinelRefresh(
  harness: ReturnType<typeof makeHarness>,
  options: { rotated?: boolean; expiresInSeconds?: number } = {},
): void {
  harness.tokenTransport.result = {
    status: 200,
    data: {
      access_token: 'SECRET-access-token',
      id_token: refreshedIdToken({ email: 'SECRET-claim-email', exp: 10_000 }, 'SECRET-id-token'),
      expires_in: options.expiresInSeconds ?? 3_600,
      ...(options.rotated ? { refresh_token: 'SECRET-rotated-refresh-token' } : {}),
    },
  };
}

function expectHarnessHasNoSecretLeak(
  harness: ReturnType<typeof makeHarness>,
  consoleCalls: unknown[][],
): void {
  expectNoSecretLeak({
    consoleCalls,
    preferenceCalls: harness.preferences.setCalls,
    renderedText: '',
  });
}

describe('mobile auth initialization', () => {
  it('rejects invalid published state tuples with a stable internal error', () => {
    expect(() =>
      assertMobileAuthState(
        {
          phase: 'signedOut',
          operation: 'idle',
          sessionUsable: true,
          errorCode: null,
          retryAction: null,
          notice: null,
          user: null,
        },
        {
          activeBundle: null,
          now: NOW,
        },
      ),
    ).toThrow('invalid_mobile_auth_state');
  });

  it.each([
    {
      label: 'restore failure outside initialization',
      value: {
        phase: 'error',
        operation: 'idle',
        sessionUsable: false,
        errorCode: 'session_restore_failed',
        retryAction: 'restore',
        notice: null,
        user: null,
      } satisfies MobileAuthState,
    },
    {
      label: 'refresh failure during cold initialization',
      value: {
        phase: 'initializing',
        operation: 'idle',
        sessionUsable: false,
        errorCode: 'session_refresh_failed',
        retryAction: 'refresh',
        notice: null,
        user: null,
      } satisfies MobileAuthState,
    },
    {
      label: 'sign-out work that already claims signed-out phase',
      value: {
        phase: 'signedOut',
        operation: 'signingOut',
        sessionUsable: false,
        errorCode: null,
        retryAction: null,
        notice: null,
        user: null,
      } satisfies MobileAuthState,
    },
    {
      label: 'authenticated sign-out work without its originating user',
      value: {
        phase: 'authenticated',
        operation: 'signingOut',
        sessionUsable: false,
        errorCode: null,
        retryAction: null,
        notice: null,
        user: null,
      } satisfies MobileAuthState,
    },
    {
      label: 'initialization cleanup carrying an authenticated user',
      value: {
        phase: 'initializing',
        operation: 'cleaningUp',
        sessionUsable: false,
        errorCode: null,
        retryAction: null,
        notice: null,
        user: { userId: 'user-1', email: null },
      } satisfies MobileAuthState,
    },
    {
      label: 'authenticated cleanup without its originating user',
      value: {
        phase: 'authenticated',
        operation: 'cleaningUp',
        sessionUsable: false,
        errorCode: null,
        retryAction: null,
        notice: null,
        user: null,
      } satisfies MobileAuthState,
    },
  ])('rejects $label', ({ value }) => {
    expect(() =>
      assertMobileAuthState(value, {
        activeBundle: null,
        now: NOW,
      }),
    ).toThrow('invalid_mobile_auth_state');
  });

  const retryFailureState = (
    phase: MobileAuthState['phase'],
    errorCode: NonNullable<MobileAuthState['errorCode']>,
    retryAction: NonNullable<MobileAuthState['retryAction']>,
    user: MobileAuthState['user'] = null,
  ): MobileAuthState => ({
    phase,
    operation: 'idle',
    sessionUsable: false,
    errorCode,
    retryAction,
    notice: null,
    user,
  });

  it.each([
    {
      label: 'initializing restore failure',
      value: retryFailureState('initializing', 'session_restore_failed', 'restore'),
    },
    {
      label: 'initializing persistence failure',
      value: retryFailureState('initializing', 'session_persistence_failed', 'persist'),
    },
    {
      label: 'initializing verification failure',
      value: retryFailureState('initializing', 'session_verification_failed', 'verify'),
    },
    {
      label: 'authenticated refresh failure',
      value: retryFailureState('authenticated', 'session_refresh_failed', 'refresh', {
        userId: 'user-1',
        email: null,
      }),
    },
    {
      label: 'refresh failure without an active session',
      value: retryFailureState('error', 'session_refresh_failed', 'refresh'),
    },
  ])('accepts $label', ({ value }) => {
    expect(() =>
      assertMobileAuthState(value, {
        activeBundle: null,
        now: NOW,
      }),
    ).not.toThrow();
  });

  it('publishes the complete authenticated tuple after verification', async () => {
    const harness = makeHarness();
    await harness.persist(activeTransaction);
    harness.prepareSuccessfulExchange(activeTransaction);
    harness.sessionFetch.mockResolvedValueOnce(
      response(200, {
        authenticated: true,
        user: { userId: 'user-123', email: null },
      }),
    );
    await harness.coordinator.initialize();

    await harness.coordinator.completeCallback(callback(activeTransaction));

    expect(harness.coordinator.state).toEqual({
      phase: 'authenticated',
      operation: 'idle',
      sessionUsable: true,
      errorCode: null,
      retryAction: null,
      notice: null,
      user: { userId: 'user-123', email: null },
    });
  });

  it('registers both listeners before reading the cold-launch URL', async () => {
    const harness = makeHarness();

    await harness.coordinator.initialize();

    expect(harness.order).toEqual([
      'app:add:appUrlOpen',
      'app:add:appStateChange',
      'browser:add:browserFinished',
      'installation:isMarked',
      'session:load',
      'app:getLaunchUrl',
      'preferences:get',
    ]);
    expect(harness.coordinator.state).toEqual({
      phase: 'signedOut',
      operation: 'idle',
      sessionUsable: false,
      errorCode: null,
      retryAction: null,
      notice: null,
      user: null,
    });
  });

  it('stops before native stores and listeners on an unsupported runtime', async () => {
    const harness = makeHarness({ isNativeIos: false });

    await harness.coordinator.initialize();
    await harness.coordinator.startSignIn();

    expect(harness.order).toEqual([]);
    expect(harness.preferences.calls).toEqual([]);
    expect(harness.sessionStore.clearCalls).toBe(0);
    expect(harness.installationStore.readCalls).toBe(0);
    expect(harness.browser.openCalls).toEqual([]);
    expect(harness.coordinator.state).toMatchObject({
      phase: 'error',
      operation: 'idle',
      sessionUsable: false,
      errorCode: 'unsupported_platform',
      retryAction: null,
      notice: null,
      user: null,
    });
  });

  it('clears retained Keychain state before writing a missing install marker', async () => {
    const harness = makeHarness();
    harness.installationStore.marked = false;
    harness.sessionStore.refreshToken = 'SECRET-reinstall-residue';

    await harness.coordinator.initialize();

    expectOrderedCalls(harness.order, [
      'installation:isMarked',
      'session:clear',
      'installation:mark',
      'app:getLaunchUrl',
    ]);
    expect(harness.installationStore.marked).toBe(true);
    expect(harness.tokenTransport.requests).toHaveLength(0);
    expect(harness.sessionStore.refreshToken).toBeNull();
    expect(harness.order).not.toContain('session:load');
  });

  it('does not let a slow Keychain load delay first-install reset', async () => {
    const harness = makeHarness();
    const loadGate = deferred<void>();
    harness.installationStore.marked = false;
    harness.sessionStore.refreshToken = 'SECRET-reinstall-residue';
    harness.sessionStore.loadGate = loadGate.promise;

    const initialization = harness.coordinator.initialize();
    try {
      await vi.waitFor(() => expect(harness.installationStore.markCalls).toBe(1), {
        timeout: 100,
      });
      expect(harness.order).not.toContain('session:load');
      await initialization;
    } finally {
      loadGate.resolve();
      await initialization;
    }
  });

  it('fails closed when first-install cleanup cannot complete', async () => {
    const harness = makeHarness();
    harness.installationStore.marked = false;
    harness.sessionStore.clearFailure = new Error('SECRET-keychain');

    await harness.coordinator.initialize();

    expect(harness.coordinator.state).toMatchObject({
      phase: 'signedOut',
      operation: 'idle',
      sessionUsable: false,
      errorCode: 'session_cleanup_failed',
      retryAction: 'cleanup',
      notice: 'cleanup_incomplete',
      user: null,
    });
    expect(harness.order).not.toContain('app:getLaunchUrl');
    expect(harness.order).not.toContain('session:load');
    expect(harness.preferences.calls).toEqual([]);
    expect(harness.installationStore.markCalls).toBe(0);
  });

  it('fails closed when the installation marker cannot be read', async () => {
    const harness = makeHarness();
    harness.installationStore.readFailure = new Error('SECRET-marker-read');

    await harness.coordinator.initialize();

    expect(harness.coordinator.state).toMatchObject({
      phase: 'signedOut',
      errorCode: 'session_cleanup_failed',
      retryAction: 'cleanup',
      notice: 'cleanup_incomplete',
    });
    expect(harness.sessionStore.clearCalls).toBe(0);
    expect(harness.order).not.toContain('session:load');
    expect(harness.order).not.toContain('app:getLaunchUrl');
    expect(harness.preferences.calls).toEqual([]);
  });

  it('fails closed when a cleared installation cannot be marked', async () => {
    const harness = makeHarness();
    harness.installationStore.marked = false;
    harness.installationStore.markFailure = new Error('SECRET-marker-write');

    await harness.coordinator.initialize();

    expectOrderedCalls(harness.order, [
      'installation:isMarked',
      'session:clear',
      'installation:mark',
    ]);
    expect(harness.sessionStore.clearCalls).toBe(1);
    expect(harness.installationStore.marked).toBe(false);
    expect(harness.order).not.toContain('session:load');
    expect(harness.order).not.toContain('app:getLaunchUrl');
    expect(harness.coordinator.state).toMatchObject({
      phase: 'signedOut',
      errorCode: 'session_cleanup_failed',
      retryAction: 'cleanup',
      notice: 'cleanup_incomplete',
    });
  });

  it('repeats clear-before-mark after a crash-safe installation reset failure', async () => {
    const first = makeHarness();
    first.installationStore.marked = false;
    first.installationStore.markFailure = new Error('SECRET-first-mark');
    await first.coordinator.initialize();

    first.installationStore.markFailure = undefined;
    const relaunched = makeHarness({
      sessionStore: first.sessionStore,
      installationStore: first.installationStore,
    });
    await relaunched.coordinator.initialize();

    expect(first.sessionStore.clearCalls).toBe(2);
    expect(first.installationStore.markCalls).toBe(2);
    expect(first.installationStore.marked).toBe(true);
    expect(relaunched.coordinator.state.phase).toBe('signedOut');
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
      operation: 'idle',
      sessionUsable: true,
      errorCode: null,
      retryAction: null,
      notice: null,
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
      'app:add:appStateChange',
      'browser:add:browserFinished',
      'installation:isMarked',
      'session:load',
      'app:getLaunchUrl',
      'preferences:get',
    ]);
  });
});

describe('durable session restoration and cold-launch precedence', () => {
  it('lets a matching callback win without starting a parallel restore', async () => {
    const harness = makeHarness();
    await harness.persist(activeTransaction);
    harness.app.launchUrl = { url: callback(activeTransaction) };
    harness.sessionStore.refreshToken = 'SECRET-durable-token';
    harness.prepareSuccessfulExchange(activeTransaction);

    await harness.coordinator.initialize();

    expect(harness.tokenTransport.requests).toHaveLength(1);
    expect(harness.tokenTransport.requests[0]?.data).toContain('grant_type=authorization_code');
    expect(harness.tokenTransport.requests[0]?.data).not.toContain('grant_type=refresh_token');
  });

  it('lets a durable token outrank a residual transaction', async () => {
    const harness = makeHarness();
    await harness.persist(activeTransaction);
    harness.sessionStore.refreshToken = 'SECRET-durable-token';
    prepareSuccessfulRefresh(harness);

    await harness.coordinator.initialize();

    expect(harness.preferences.value).toBeNull();
    expect(harness.tokenTransport.requests[0]?.data).toContain('grant_type=refresh_token');
    expect(harness.coordinator.state.phase).toBe('authenticated');
  });

  it('restores a durable token when cold-launch URL discovery fails', async () => {
    const harness = makeHarness();
    harness.app.failLaunch = true;
    harness.sessionStore.refreshToken = 'SECRET-durable-token';
    prepareSuccessfulRefresh(harness);

    await harness.coordinator.initialize();

    expect(harness.tokenTransport.requests).toHaveLength(1);
    expect(harness.tokenTransport.requests[0]?.data).toContain('grant_type=refresh_token');
    expect(harness.coordinator.state).toMatchObject({
      phase: 'authenticated',
      operation: 'idle',
      sessionUsable: true,
      errorCode: null,
    });
  });

  it('restores and verifies before publishing a usable session', async () => {
    const harness = makeHarness();
    harness.sessionStore.refreshToken = 'SECRET-durable-token';
    prepareSuccessfulRefresh(harness);
    const stop = watch(
      () => [harness.coordinator.state.phase, harness.coordinator.state.sessionUsable] as const,
      ([phase, sessionUsable]) => {
        if (phase === 'authenticated' && sessionUsable) {
          harness.order.push('state:authenticated');
        }
      },
      { flush: 'sync' },
    );

    try {
      await harness.coordinator.initialize();
    } finally {
      stop();
    }

    expectOrderedCalls(harness.order, [
      'session:load',
      'token:refresh',
      'fetch:/auth/session',
      'state:authenticated',
    ]);
    expect(harness.coordinator.state.sessionUsable).toBe(true);
  });

  it('enters ordinary signed out when neither durable token nor transaction exists', async () => {
    const harness = makeHarness();

    await harness.coordinator.initialize();

    expect(harness.order).toContain('session:load');
    expect(harness.coordinator.state).toMatchObject({
      phase: 'signedOut',
      sessionUsable: false,
      errorCode: null,
      retryAction: null,
      notice: null,
    });
  });

  it('retains active transaction recovery when no durable token exists', async () => {
    const harness = makeHarness();
    await harness.persist(activeTransaction);

    await harness.coordinator.initialize();

    expect(harness.coordinator.state).toMatchObject({
      phase: 'error',
      errorCode: 'interrupted',
    });
    expect(harness.tokenTransport.requests).toHaveLength(0);
  });

  it('restores a durable token when transaction discovery rejects', async () => {
    const harness = makeHarness();
    harness.preferences.getFailure = new Error('SECRET-transaction-read');
    harness.sessionStore.refreshToken = 'SECRET-durable-token';
    prepareSuccessfulRefresh(harness);

    await harness.coordinator.initialize();

    expect(harness.tokenTransport.requests[0]?.data).toContain('grant_type=refresh_token');
    expect(harness.coordinator.state.phase).toBe('authenticated');
  });

  it('keeps a Keychain operational failure retryable despite a residual transaction', async () => {
    const harness = makeHarness();
    await harness.persist(activeTransaction);
    harness.sessionStore.loadFailure = new MobileSessionStoreError('unavailable');

    await harness.coordinator.initialize();

    expect(harness.installationStore.readCalls).toBe(1);
    expect(harness.preferences.calls).toContain('preferences:get');
    expect(harness.coordinator.state).toMatchObject({
      phase: 'initializing',
      errorCode: 'session_restore_failed',
      retryAction: 'restore',
    });
  });

  it('persists a rotated refresh token before API verification and promotion', async () => {
    const harness = makeHarness();
    harness.sessionStore.refreshToken = 'SECRET-old-refresh-token';
    prepareSuccessfulRefresh(harness, {
      rotatedRefreshToken: 'SECRET-rotated-refresh-token',
    });

    await harness.coordinator.initialize();

    expectOrderedCalls(harness.order, [
      'token:refresh',
      'session:save:SECRET-rotated-refresh-token',
      'fetch:/auth/session',
    ]);
    expect(harness.sessionStore.refreshToken).toBe('SECRET-rotated-refresh-token');
    expect(harness.coordinator.state.phase).toBe('authenticated');
  });

  it('retains the previous durable refresh token when rotation is omitted', async () => {
    const harness = makeHarness();
    harness.sessionStore.refreshToken = 'SECRET-existing-refresh-token';
    prepareSuccessfulRefresh(harness);

    await harness.coordinator.initialize();

    expect(harness.sessionStore.saveAttempts).toEqual([]);
    expect(harness.sessionStore.refreshToken).toBe('SECRET-existing-refresh-token');
    expect(harness.coordinator.state.phase).toBe('authenticated');
  });

  it('clears a refreshed subject that disagrees with the verified API user', async () => {
    const harness = makeHarness();
    harness.sessionStore.refreshToken = 'SECRET-durable-token';
    prepareSuccessfulRefresh(harness, { subject: 'different-user' });

    await harness.coordinator.initialize();

    expect(harness.sessionStore.clearCalls).toBe(1);
    expect(harness.coordinator.state).toMatchObject({
      phase: 'signedOut',
      sessionUsable: false,
      errorCode: null,
      retryAction: null,
      notice: 'session_unusable',
    });
  });
});

describe('restore terminal and retryable classification', () => {
  function makeRestoreHarness() {
    const harness = makeHarness();
    harness.sessionStore.refreshToken = 'SECRET-durable-token';
    return harness;
  }

  it('clears terminal refresh failures only for confirmed invalid_grant', async () => {
    const harness = makeRestoreHarness();
    harness.tokenTransport.result = { status: 400, data: { error: 'invalid_grant' } };

    await harness.coordinator.initialize();

    expect(harness.sessionStore.clearCalls).toBe(1);
    expect(harness.coordinator.state.notice).toBe('session_unusable');
  });

  it.each([
    ['invalid_client', 400, { error: 'invalid_client' }],
    ['invalid_request', 400, { error: 'invalid_request' }],
    ['unauthorized_client', 400, { error: 'unauthorized_client' }],
    ['unsupported_grant_type', 400, { error: 'unsupported_grant_type' }],
    ['unknown OAuth error', 400, { error: 'SECRET-provider' }],
    ['gateway 401', 401, { error: 'unauthorized' }],
    ['WAF 403', 403, { error: 'forbidden' }],
  ] as const)(
    'preserves the durable token for non-invalid_grant %s',
    async (_label, status, data) => {
      const harness = makeRestoreHarness();
      harness.tokenTransport.result = { status, data };

      await harness.coordinator.initialize();

      expect(harness.sessionStore.clearCalls).toBe(0);
      expect(harness.sessionStore.refreshToken).toBe('SECRET-durable-token');
      expect(harness.coordinator.state).toMatchObject({
        errorCode: 'session_restore_failed',
        retryAction: 'restore',
      });
    },
  );

  it('keeps terminal restore cleanup in initializing until deletion resolves', async () => {
    const harness = makeRestoreHarness();
    const clearGate = deferred<void>();
    harness.tokenTransport.result = { status: 400, data: { error: 'invalid_grant' } };
    harness.sessionStore.clearGate = clearGate.promise;

    const initialization = harness.coordinator.initialize();
    try {
      await vi.waitFor(() => expect(harness.sessionStore.clearCalls).toBe(1));
      expect(harness.coordinator.state).toMatchObject({
        phase: 'initializing',
        operation: 'cleaningUp',
        sessionUsable: false,
      });
    } finally {
      clearGate.resolve();
      await initialization;
    }
  });

  it.each([429, 500, 503])(
    'preserves the durable token for retryable status %s',
    async (status) => {
      const harness = makeRestoreHarness();
      harness.tokenTransport.result = { status, data: {} };

      await harness.coordinator.initialize();

      expect(harness.sessionStore.clearCalls).toBe(0);
      expect(harness.sessionStore.refreshToken).toBe('SECRET-durable-token');
      expect(harness.coordinator.state).toMatchObject({
        errorCode: 'session_restore_failed',
        retryAction: 'restore',
      });
    },
  );

  it('preserves the durable token after a refresh network rejection', async () => {
    const harness = makeRestoreHarness();
    harness.tokenTransport.failure = new Error('SECRET-refresh-network');

    await harness.coordinator.initialize();

    expect(harness.sessionStore.clearCalls).toBe(0);
    expect(harness.coordinator.state).toMatchObject({
      errorCode: 'session_restore_failed',
      retryAction: 'restore',
    });
  });

  it('preserves the durable token after a malformed successful refresh response', async () => {
    const harness = makeRestoreHarness();
    harness.tokenTransport.result = {
      status: 200,
      data: {
        access_token: 'SECRET-access-token',
        expires_in: 3_600,
      },
    };

    await harness.coordinator.initialize();

    expect(harness.sessionStore.clearCalls).toBe(0);
    expect(harness.sessionStore.refreshToken).toBe('SECRET-durable-token');
    expect(harness.coordinator.state).toMatchObject({
      phase: 'initializing',
      operation: 'idle',
      sessionUsable: false,
      errorCode: 'session_restore_failed',
      retryAction: 'restore',
      notice: null,
    });
  });

  it('clears a refresh response whose ID-token claims are invalid', async () => {
    const harness = makeRestoreHarness();
    prepareSuccessfulRefresh(harness, { subject: '' });

    await harness.coordinator.initialize();

    expect(harness.sessionStore.clearCalls).toBe(1);
    expect(harness.coordinator.state.notice).toBe('session_unusable');
  });

  it('clears a corrupt local token before showing the terminal notice', async () => {
    const harness = makeHarness();
    harness.sessionStore.loadFailure = new MobileSessionStoreError('corrupt');

    await harness.coordinator.initialize();

    expect(harness.sessionStore.clearCalls).toBe(1);
    expect(harness.coordinator.state).toMatchObject({
      phase: 'signedOut',
      sessionUsable: false,
      errorCode: null,
      retryAction: null,
      notice: 'session_unusable',
    });
  });

  it('fails closed when corrupt local token deletion is unavailable', async () => {
    const harness = makeHarness();
    harness.sessionStore.loadFailure = new MobileSessionStoreError('corrupt');
    harness.sessionStore.clearFailure = new Error('SECRET-corrupt-delete');

    await harness.coordinator.initialize();

    expect(harness.coordinator.state).toMatchObject({
      phase: 'signedOut',
      errorCode: 'session_cleanup_failed',
      retryAction: 'cleanup',
      notice: 'cleanup_incomplete',
    });
  });

  it.each([401, 403])(
    'clears the durable token after restored API verification status %s',
    async (status) => {
      const harness = makeRestoreHarness();
      prepareSuccessfulRefresh(harness);
      harness.sessionFetch.mockResolvedValueOnce(response(status, { authenticated: false }));

      await harness.coordinator.initialize();

      expect(harness.sessionStore.clearCalls).toBe(1);
      expect(harness.coordinator.state.notice).toBe('session_unusable');
    },
  );

  it.each([429, 500, 503])(
    'retains the verified candidate for API retry after status %s',
    async (status) => {
      const harness = makeRestoreHarness();
      prepareSuccessfulRefresh(harness);
      harness.sessionFetch.mockResolvedValueOnce(response(status, { error: 'temporary' }));

      await harness.coordinator.initialize();

      expect(harness.sessionStore.clearCalls).toBe(0);
      expect(harness.coordinator.state).toMatchObject({
        errorCode: 'session_verification_failed',
        retryAction: 'verify',
      });
    },
  );

  it('retains the verified candidate after an API network rejection', async () => {
    const harness = makeRestoreHarness();
    prepareSuccessfulRefresh(harness);
    harness.sessionFetch.mockRejectedValueOnce(new Error('SECRET-api-network'));

    await harness.coordinator.initialize();

    expect(harness.sessionStore.clearCalls).toBe(0);
    expect(harness.coordinator.state).toMatchObject({
      errorCode: 'session_verification_failed',
      retryAction: 'verify',
    });
  });
});

describe('generalized retry dispatch', () => {
  it('retries restore from the refresh grant', async () => {
    const harness = makeHarness();
    harness.sessionStore.refreshToken = 'SECRET-durable-token';
    harness.tokenTransport.result = { status: 503, data: {} };
    await harness.coordinator.initialize();
    prepareSuccessfulRefresh(harness);

    await harness.coordinator.retryCurrentOperation();

    expect(harness.tokenTransport.requests).toHaveLength(2);
    expect(harness.tokenTransport.requests[1]?.data).toContain('grant_type=refresh_token');
    expect(harness.coordinator.state.phase).toBe('authenticated');
  });

  it('retries active-session refresh through the candidate pipeline', async () => {
    const harness = await arrangeBlockingRetry('refresh');
    harness.tokenTransport.failure = undefined;
    prepareSuccessfulRefresh(harness, {
      rotatedRefreshToken: 'SECRET-refreshed-again-token',
      claimExpirySeconds: 10_000,
    });

    await harness.coordinator.retryCurrentOperation();

    const refreshes = refreshRequests(harness);
    expect(refreshes).toHaveLength(2);
    expect(refreshes[1]?.data).toContain('grant_type=refresh_token');
    expect(harness.sessionStore.refreshToken).toBe('SECRET-refreshed-again-token');
    expect(harness.coordinator.state.phase).toBe('authenticated');
  });

  it('retries persistence without repeating refresh or API verification', async () => {
    const harness = makeHarness();
    harness.sessionStore.refreshToken = 'SECRET-old-token';
    prepareSuccessfulRefresh(harness, { rotatedRefreshToken: 'SECRET-rotated-token' });
    harness.sessionStore.saveFailure = new Error('SECRET-save');
    await harness.coordinator.initialize();

    expect(harness.coordinator.state.retryAction).toBe('persist');
    harness.sessionStore.saveFailure = undefined;
    await harness.coordinator.retryCurrentOperation();

    expect(harness.tokenTransport.requests).toHaveLength(1);
    expect(harness.sessionFetch).toHaveBeenCalledOnce();
    expect(harness.sessionStore.saveAttempts).toEqual([
      'SECRET-rotated-token',
      'SECRET-rotated-token',
    ]);
  });

  it('retries API verification without repeating refresh or Keychain persistence', async () => {
    const harness = makeHarness();
    harness.sessionStore.refreshToken = 'SECRET-durable-token';
    prepareSuccessfulRefresh(harness);
    harness.sessionFetch.mockResolvedValueOnce(response(500, { error: 'temporary' }));
    await harness.coordinator.initialize();
    harness.sessionFetch.mockResolvedValueOnce(
      response(200, {
        authenticated: true,
        user: { userId: 'user-123', email: null },
      }),
    );

    await harness.coordinator.retryCurrentOperation();

    expect(harness.tokenTransport.requests).toHaveLength(1);
    expect(harness.sessionStore.saveAttempts).toEqual([]);
    expect(harness.sessionFetch).toHaveBeenCalledTimes(2);
    expect(harness.coordinator.state.phase).toBe('authenticated');
  });

  it('retries terminal cleanup without repeating token or API requests', async () => {
    const harness = makeHarness();
    harness.sessionStore.refreshToken = 'SECRET-durable-token';
    harness.tokenTransport.result = { status: 400, data: { error: 'invalid_grant' } };
    harness.sessionStore.clearFailure = new Error('SECRET-clear');
    await harness.coordinator.initialize();

    expect(harness.coordinator.state.retryAction).toBe('cleanup');
    harness.sessionStore.clearFailure = undefined;
    await harness.coordinator.retryCurrentOperation();

    expect(harness.tokenTransport.requests).toHaveLength(1);
    expect(harness.sessionFetch).not.toHaveBeenCalled();
    expect(harness.sessionStore.clearCalls).toBe(2);
    expect(harness.coordinator.state.notice).toBe('session_unusable');
  });

  it('retries installation cleanup by clearing before marking and resuming initialization', async () => {
    const harness = makeHarness();
    harness.installationStore.marked = false;
    harness.sessionStore.clearFailure = new Error('SECRET-clear');
    await harness.coordinator.initialize();

    harness.sessionStore.clearFailure = undefined;
    await harness.coordinator.retryCurrentOperation();

    expectOrderedCalls(harness.order, ['session:clear', 'session:clear', 'installation:mark']);
    expect(harness.tokenTransport.requests).toHaveLength(0);
    expect(harness.sessionFetch).not.toHaveBeenCalled();
    expect(harness.coordinator.state.phase).toBe('signedOut');
  });

  it('retains signedOut while installation cleanup retry is unresolved', async () => {
    const harness = makeHarness();
    const markGate = deferred<void>();
    harness.installationStore.marked = false;
    harness.sessionStore.clearFailure = new Error('SECRET-clear');
    await harness.coordinator.initialize();

    harness.sessionStore.clearFailure = undefined;
    harness.installationStore.markGate = markGate.promise;
    const retry = harness.coordinator.retryCurrentOperation();
    try {
      await vi.waitFor(() => expect(harness.installationStore.markCalls).toBe(1));
      expect(harness.coordinator.state).toMatchObject({
        phase: 'signedOut',
        operation: 'cleaningUp',
        sessionUsable: false,
      });
    } finally {
      markGate.resolve();
      await retry;
    }
  });
});

describe('local sign-out and cleanup retry', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('hides content before asynchronous durable cleanup and preserves cleanup ordering', async () => {
    const harness = makeHarness();
    await authenticate(harness);
    await harness.persist(activeTransaction);
    const clearGate = deferred<void>();
    harness.sessionStore.clearGate = clearGate.promise;

    const result = harness.coordinator.signOut();

    expect(harness.coordinator.state).toMatchObject({
      phase: 'authenticated',
      operation: 'signingOut',
      sessionUsable: false,
      user: { userId: 'user-123', email: 'person@example.com' },
    });
    await vi.waitFor(() => expect(harness.sessionStore.clearCalls).toBe(1));
    expect(harness.preferences.value).not.toBeNull();
    expect(harness.preferences.calls.at(-1)).not.toBe('preferences:remove');

    clearGate.resolve();
    await result;

    expectOrderedCalls(harness.order, ['session:clear', 'preferences:remove']);
    expect(harness.coordinator.state).toEqual({
      phase: 'signedOut',
      operation: 'idle',
      sessionUsable: false,
      errorCode: null,
      retryAction: null,
      notice: null,
      user: null,
    });
  });

  it.each(['restore', 'refresh', 'persist', 'verify'] as const)(
    'allows start-over cleanup from blocking %s recovery',
    async (retryAction) => {
      const harness = await arrangeBlockingRetry(retryAction);
      expect(harness.coordinator.state.retryAction).toBe(retryAction);
      await harness.persist(activeTransaction);

      await harness.coordinator.signOut();

      expect(harness.sessionStore.clearCalls).toBe(1);
      expect(harness.preferences.value).toBeNull();
      expect(harness.coordinator.state).toEqual({
        phase: 'signedOut',
        operation: 'idle',
        sessionUsable: false,
        errorCode: null,
        retryAction: null,
        notice: null,
        user: null,
      });
    },
  );

  it('retains initializing while start-over cleanup is unresolved', async () => {
    const harness = await arrangeBlockingRetry('restore');
    const clearGate = deferred<void>();
    harness.sessionStore.clearGate = clearGate.promise;

    const signOut = harness.coordinator.signOut();
    try {
      await vi.waitFor(() => expect(harness.sessionStore.clearCalls).toBe(1));
      expect(harness.coordinator.state).toMatchObject({
        phase: 'initializing',
        operation: 'signingOut',
        sessionUsable: false,
        user: null,
      });
    } finally {
      clearGate.resolve();
      await signOut;
    }
  });

  it('clears PKCE state when Keychain cleanup fails without claiming sign-out success', async () => {
    const harness = makeHarness();
    await authenticate(harness);
    await harness.persist(activeTransaction);
    harness.sessionStore.clearFailure = new Error('SECRET-delete-failure');

    await harness.coordinator.signOut();

    expect(harness.coordinator.state).toEqual({
      phase: 'signedOut',
      operation: 'idle',
      sessionUsable: false,
      errorCode: 'session_cleanup_failed',
      retryAction: 'cleanup',
      notice: 'cleanup_incomplete',
      user: null,
    });
    expect(harness.preferences.value).toBeNull();
    expect(harness.preferences.calls).toContain('preferences:remove');
    expect(snapshot(harness.coordinator.state)).not.toContain('SECRET');
  });

  it('reports incomplete transaction cleanup after deleting the Keychain token', async () => {
    const harness = makeHarness();
    await authenticate(harness);
    await harness.persist(activeTransaction);
    harness.preferences.removeFailure = new Error('SECRET-transaction-delete');

    await harness.coordinator.signOut();

    expect(harness.sessionStore.refreshToken).toBeNull();
    expect(harness.preferences.value).not.toBeNull();
    expect(harness.coordinator.state).toMatchObject({
      phase: 'signedOut',
      sessionUsable: false,
      errorCode: 'session_cleanup_failed',
      retryAction: 'cleanup',
      notice: 'cleanup_incomplete',
    });
    expect(snapshot(harness.coordinator.state)).not.toContain('SECRET');
  });

  it('retries sign-out cleanup to ordinary signed out', async () => {
    const harness = makeHarness();
    await authenticate(harness);
    await harness.persist(activeTransaction);
    harness.sessionStore.clearFailure = new Error('SECRET-delete-failure');
    await harness.coordinator.signOut();

    harness.sessionStore.clearFailure = undefined;
    await harness.coordinator.retryCurrentOperation();

    expect(harness.sessionStore.clearCalls).toBe(2);
    expect(harness.preferences.value).toBeNull();
    expect(harness.coordinator.state).toEqual({
      phase: 'signedOut',
      operation: 'idle',
      sessionUsable: false,
      errorCode: null,
      retryAction: null,
      notice: null,
      user: null,
    });
  });

  it('keeps failed sign-out cleanup retryable until all cleanup succeeds', async () => {
    const harness = makeHarness();
    await authenticate(harness);
    harness.sessionStore.clearFailure = new Error('SECRET-delete-failure');
    await harness.coordinator.signOut();

    await harness.coordinator.retryCurrentOperation();

    expect(harness.sessionStore.clearCalls).toBe(2);
    expect(harness.coordinator.state).toMatchObject({
      errorCode: 'session_cleanup_failed',
      retryAction: 'cleanup',
      notice: 'cleanup_incomplete',
    });
  });

  it('coalesces duplicate sign-out calls into one cleanup flight', async () => {
    const harness = makeHarness();
    await authenticate(harness);
    const clearGate = deferred<void>();
    harness.sessionStore.clearGate = clearGate.promise;

    const first = harness.coordinator.signOut();
    const second = harness.coordinator.signOut();

    expect(second).toBe(first);
    await vi.waitFor(() => expect(harness.sessionStore.clearCalls).toBe(1));
    clearGate.resolve();
    await Promise.all([first, second]);
    expect(harness.sessionStore.clearCalls).toBe(1);
  });

  it('cancels proactive refresh and access-expiry timers', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const harness = makeHarness({ now: () => Date.now() });
    await authenticateWithExpiry(harness, NOW + 120_000);

    await harness.coordinator.signOut();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(refreshRequests(harness)).toHaveLength(0);
    expect(harness.coordinator.state).toMatchObject({
      phase: 'signedOut',
      sessionUsable: false,
      notice: null,
    });
  });

  it('cancels a queued automatic refresh retry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const harness = makeHarness({ now: () => Date.now() });
    await authenticateWithExpiry(harness, NOW + 61_000);
    harness.tokenTransport.queuedFailures.push(new Error('SECRET-refresh-network'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refreshRequests(harness)).toHaveLength(1);

    await harness.coordinator.signOut();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(refreshRequests(harness)).toHaveLength(1);
    expect(harness.coordinator.state.phase).toBe('signedOut');
  });

  it('prevents an in-flight refresh from republishing session capability', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const harness = makeHarness({ now: () => Date.now() });
    await authenticateWithExpiry(harness, NOW + 61_000);
    const heldRefresh = deferred<{ status: number; data: unknown }>();
    harness.tokenTransport.gate = heldRefresh.promise;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(harness.coordinator.state.operation).toBe('refreshing');
    const clearGate = deferred<void>();
    harness.sessionStore.clearGate = clearGate.promise;

    const signOut = harness.coordinator.signOut();
    heldRefresh.resolve({
      status: 200,
      data: {
        access_token: 'SECRET-late-access-token',
        id_token: refreshedIdToken({ exp: 10_000 }),
        expires_in: 3_600,
      },
    });
    await vi.waitFor(() => expect(harness.sessionStore.clearCalls).toBe(1));

    expect(harness.sessionFetch).toHaveBeenCalledOnce();
    expect(harness.coordinator.state).toMatchObject({
      operation: 'signingOut',
      sessionUsable: false,
    });
    clearGate.resolve();
    await signOut;
    expect(harness.coordinator.state.phase).toBe('signedOut');
  });

  it('erases a failed pending candidate before the next sign-in', async () => {
    const harness = await arrangeBlockingRetry('persist');
    expect(harness.coordinator.state.retryAction).toBe('persist');
    harness.sessionStore.saveFailure = undefined;

    await harness.coordinator.signOut();
    await harness.coordinator.startSignIn();
    const replacement = harness.preferences.transaction();
    harness.prepareSuccessfulExchange(replacement);
    await harness.coordinator.completeCallback(callback(replacement));

    expect(harness.coordinator.state).toMatchObject({
      phase: 'authenticated',
      sessionUsable: true,
      errorCode: null,
    });
  });

  it('retains the installation marker and makes no remote logout or browser request', async () => {
    const harness = makeHarness();
    await authenticate(harness);
    const tokenRequestCount = harness.tokenTransport.requests.length;
    const sessionRequestCount = harness.sessionFetch.mock.calls.length;
    const browserOpenCount = harness.browser.openCalls.length;

    await harness.coordinator.signOut();

    expect(harness.installationStore.marked).toBe(true);
    expect(harness.installationStore.markCalls).toBe(0);
    expect(harness.tokenTransport.requests).toHaveLength(tokenRequestCount);
    expect(harness.sessionFetch).toHaveBeenCalledTimes(sessionRequestCount);
    expect(harness.browser.openCalls).toHaveLength(browserOpenCount);
  });

  it('dispose waits behind sign-out but never deletes durable state itself', async () => {
    const harness = makeHarness();
    await authenticate(harness);
    const clearGate = deferred<void>();
    harness.sessionStore.clearGate = clearGate.promise;

    const signOut = harness.coordinator.signOut();
    const dispose = harness.coordinator.dispose();
    await vi.waitFor(() => expect(harness.sessionStore.clearCalls).toBe(1));
    clearGate.resolve();
    await signOut;
    await dispose;

    expect(harness.sessionStore.clearCalls).toBe(1);
    expect(harness.preferences.value).toBeNull();
  });

  it('makes every public operation a no-op after disposal', async () => {
    const harness = makeHarness();
    harness.sessionStore.refreshToken = 'SECRET-durable-token';
    await harness.coordinator.dispose();
    const before = {
      clearCalls: harness.sessionStore.clearCalls,
      tokenRequests: harness.tokenTransport.requests.length,
      browserOpens: harness.browser.openCalls.length,
      preferenceCalls: harness.preferences.calls.length,
    };

    await harness.coordinator.initialize();
    await harness.coordinator.startSignIn();
    await harness.coordinator.completeCallback(callback(activeTransaction));
    await harness.coordinator.retryCurrentOperation();
    await harness.coordinator.signOut();

    expect(harness.sessionStore.clearCalls).toBe(before.clearCalls);
    expect(harness.tokenTransport.requests).toHaveLength(before.tokenRequests);
    expect(harness.browser.openCalls).toHaveLength(before.browserOpens);
    expect(harness.preferences.calls).toHaveLength(before.preferenceCalls);
    expect(harness.sessionStore.refreshToken).toBe('SECRET-durable-token');
  });
});

describe('active-session lifecycle refresh', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('refreshes exactly 60 seconds before access expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const harness = makeHarness({ now: () => Date.now() });
    await authenticateWithExpiry(harness, NOW + 3_600_000);
    harness.tokenTransport.queuedFailures.push(new Error('SECRET-refresh-network'));

    await vi.advanceTimersByTimeAsync(3_539_999);
    expect(refreshRequests(harness)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);

    expect(refreshRequests(harness)).toHaveLength(1);
  });

  it('preserves the active durable token after a malformed successful refresh response', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const harness = makeHarness({ now: () => Date.now() });
    await authenticateWithExpiry(harness, NOW + 61_000);
    const durableRefreshToken = harness.sessionStore.refreshToken;
    harness.tokenTransport.result = {
      status: 200,
      data: {
        access_token: 'SECRET-malformed-access-token',
        expires_in: 3_600,
      },
    };

    await vi.advanceTimersByTimeAsync(1_000);

    expect(harness.sessionStore.clearCalls).toBe(0);
    expect(harness.sessionStore.refreshToken).toBe(durableRefreshToken);
    expect(harness.coordinator.state).toMatchObject({
      phase: 'authenticated',
      operation: 'idle',
      sessionUsable: true,
      errorCode: 'session_refresh_failed',
      retryAction: 'refresh',
      notice: null,
      user: { userId: 'user-123', email: 'person@example.com' },
    });
  });

  it('keeps terminal active-session cleanup authenticated until deletion resolves', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const harness = makeHarness({ now: () => Date.now() });
    await authenticateWithExpiry(harness, NOW + 61_000);
    const clearGate = deferred<void>();
    harness.tokenTransport.result = {
      status: 400,
      data: { error: 'invalid_grant' },
    };
    harness.sessionStore.clearGate = clearGate.promise;

    await vi.advanceTimersByTimeAsync(1_000);
    try {
      await vi.waitFor(() => expect(harness.sessionStore.clearCalls).toBe(1));
      expect(harness.coordinator.state).toMatchObject({
        phase: 'authenticated',
        operation: 'cleaningUp',
        sessionUsable: false,
        user: { userId: 'user-123', email: 'person@example.com' },
      });
    } finally {
      clearGate.resolve();
      await harness.flush();
    }
  });

  it('cancels the foreground timer while inactive and rechecks on resume', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const harness = makeHarness({ now: () => Date.now() });
    await authenticateWithExpiry(harness, NOW + 120_000);

    harness.app.emitState(false);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(refreshRequests(harness)).toHaveLength(0);
    harness.app.emitState(true);
    await harness.flush();
    expect(refreshRequests(harness)).toHaveLength(1);
  });

  it('reschedules from the absolute expiry when the app becomes active', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const harness = makeHarness({ now: () => Date.now() });
    await authenticateWithExpiry(harness, NOW + 180_000);
    harness.app.emitState(false);
    await vi.advanceTimersByTimeAsync(30_000);

    harness.app.emitState(true);
    await vi.advanceTimersByTimeAsync(89_999);
    expect(refreshRequests(harness)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);

    expect(refreshRequests(harness)).toHaveLength(1);
  });

  it('refreshes immediately on resume inside the lead window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const harness = makeHarness({ now: () => Date.now() });
    await authenticateWithExpiry(harness, NOW + 120_000);
    harness.app.emitState(false);
    await vi.advanceTimersByTimeAsync(70_000);
    harness.tokenTransport.queuedFailures.push(new Error('SECRET-refresh-network'));

    harness.app.emitState(true);
    await harness.flush();

    expect(refreshRequests(harness)).toHaveLength(1);
  });

  it('coalesces resume, automatic timer, and manual retry into one grant', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const harness = makeHarness({ now: () => Date.now() });
    await authenticateWithExpiry(harness, NOW + 120_000);
    harness.tokenTransport.queuedFailures.push(new Error('SECRET-refresh-network'));
    await vi.advanceTimersByTimeAsync(60_000);

    const heldRefresh = deferred<{ status: number; data: unknown }>();
    harness.tokenTransport.gate = heldRefresh.promise;
    const manualRetry = harness.coordinator.retryCurrentOperation();
    await Promise.resolve();
    await Promise.resolve();
    harness.app.emitState(true);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(refreshRequests(harness)).toHaveLength(2);
    heldRefresh.resolve({
      status: 200,
      data: {
        access_token: 'SECRET-refreshed-access-token',
        id_token: refreshedIdToken({ exp: 10_000 }),
        expires_in: 3_600,
      },
    });
    await manualRetry;
  });

  it('rechecks app activity at the serialized refresh queue head', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const harness = makeHarness({ now: () => Date.now() });
    await authenticateWithExpiry(harness, NOW + 61_000);
    prepareSuccessfulRefresh(harness, { claimExpirySeconds: 10_000 });
    harness.sessionFetch.mockResolvedValueOnce(response(500, { error: 'temporary' }));
    await vi.advanceTimersByTimeAsync(1_000);

    const heldVerification = deferred<Response>();
    harness.sessionFetch.mockImplementationOnce(async () => heldVerification.promise);
    const manualRetry = harness.coordinator.retryCurrentOperation();
    await Promise.resolve();
    await Promise.resolve();
    harness.app.emitState(true);
    harness.app.emitState(false);
    heldVerification.resolve(response(500, { error: 'temporary' }));
    await manualRetry;
    await harness.flush();

    expect(refreshRequests(harness)).toHaveLength(1);
  });

  it('retries one soft failure after five seconds with enough lifetime', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const harness = makeHarness({ now: () => Date.now() });
    await authenticateWithExpiry(harness, NOW + 61_000);
    harness.tokenTransport.queuedFailures.push(
      new Error('SECRET-refresh-network-1'),
      new Error('SECRET-refresh-network-2'),
    );

    await vi.advanceTimersByTimeAsync(1_000);
    expect(harness.coordinator.state.sessionUsable).toBe(true);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(refreshRequests(harness)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refreshRequests(harness)).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(refreshRequests(harness)).toHaveLength(2);
  });

  it('does not retry automatically at the exact 20-second lifetime budget', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const harness = makeHarness({ now: () => Date.now() });
    await authenticateWithExpiry(harness, NOW + 20_000);
    harness.tokenTransport.queuedFailures.push(new Error('SECRET-refresh-network'));

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(refreshRequests(harness)).toHaveLength(1);
  });

  it('cancels a pending automatic retry when the user retries manually', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const harness = makeHarness({ now: () => Date.now() });
    await authenticateWithExpiry(harness, NOW + 61_000);
    harness.tokenTransport.queuedFailures.push(new Error('SECRET-refresh-network'));
    await vi.advanceTimersByTimeAsync(1_000);
    prepareSuccessfulRefresh(harness, { claimExpirySeconds: 10_000 });

    await harness.coordinator.retryCurrentOperation();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(refreshRequests(harness)).toHaveLength(2);
  });

  it('closes the gate at exact old-token expiry after a soft failure', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const harness = makeHarness({ now: () => Date.now() });
    await authenticateWithExpiry(harness, NOW + 61_000);
    harness.tokenTransport.queuedFailures.push(
      new Error('SECRET-refresh-network-1'),
      new Error('SECRET-refresh-network-2'),
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(5_000);

    await vi.advanceTimersByTimeAsync(54_999);
    expect(harness.coordinator.state.sessionUsable).toBe(true);
    await vi.advanceTimersByTimeAsync(1);

    expect(harness.coordinator.state).toMatchObject({
      phase: 'authenticated',
      operation: 'idle',
      sessionUsable: false,
      errorCode: 'session_refresh_failed',
      retryAction: 'refresh',
      user: { userId: 'user-123', email: 'person@example.com' },
    });
  });

  it('closes capability at exact expiry while the refresh grant is still pending', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const harness = makeHarness({ now: () => Date.now() });
    await authenticateWithExpiry(harness, NOW + 61_000);
    const heldRefresh = deferred<{ status: number; data: unknown }>();
    harness.tokenTransport.gate = heldRefresh.promise;

    await vi.advanceTimersByTimeAsync(1_000);
    expect(harness.coordinator.state).toMatchObject({
      operation: 'refreshing',
      sessionUsable: true,
    });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(harness.coordinator.state.sessionUsable).toBe(true);
    await vi.advanceTimersByTimeAsync(1);

    expect(harness.coordinator.state).toMatchObject({
      phase: 'authenticated',
      operation: 'refreshing',
      sessionUsable: false,
      user: { userId: 'user-123', email: 'person@example.com' },
    });
    heldRefresh.reject(new Error('SECRET-late-refresh-failure'));
    await harness.flush();
    expect(harness.coordinator.state).toMatchObject({
      operation: 'idle',
      sessionUsable: false,
      errorCode: 'session_refresh_failed',
      retryAction: 'refresh',
    });
  });

  it('closes capability at exact expiry while rotated-token persistence is pending', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const harness = makeHarness({ now: () => Date.now() });
    await authenticateWithExpiry(harness, NOW + 61_000);
    prepareSuccessfulRefresh(harness, {
      rotatedRefreshToken: 'SECRET-rotated-refresh-token',
      claimExpirySeconds: 10_000,
    });
    const heldPersistence = deferred<void>();
    harness.sessionStore.saveGate = heldPersistence.promise;

    await vi.advanceTimersByTimeAsync(1_000);
    expect(harness.coordinator.state).toMatchObject({
      operation: 'persisting',
      sessionUsable: true,
    });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(harness.coordinator.state).toMatchObject({
      phase: 'authenticated',
      operation: 'persisting',
      sessionUsable: false,
    });
    heldPersistence.resolve();
    await harness.flush();
    expect(harness.coordinator.state).toMatchObject({
      phase: 'authenticated',
      operation: 'idle',
      sessionUsable: true,
    });
  });

  it('closes capability at exact expiry while candidate verification is pending', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const harness = makeHarness({ now: () => Date.now() });
    await authenticateWithExpiry(harness, NOW + 61_000);
    prepareSuccessfulRefresh(harness, { claimExpirySeconds: 10_000 });
    const heldVerification = deferred<Response>();
    harness.sessionFetch.mockImplementationOnce(async () => heldVerification.promise);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(harness.coordinator.state).toMatchObject({
      operation: 'verifying',
      sessionUsable: true,
    });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(harness.coordinator.state).toMatchObject({
      phase: 'authenticated',
      operation: 'verifying',
      sessionUsable: false,
    });
    heldVerification.resolve(
      response(200, {
        authenticated: true,
        user: { userId: 'user-123', email: 'person@example.com' },
      }),
    );
    await harness.flush();
    expect(harness.coordinator.state).toMatchObject({
      phase: 'authenticated',
      operation: 'idle',
      sessionUsable: true,
    });
  });

  it('retries rotated-candidate persistence without issuing another grant', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const harness = makeHarness({ now: () => Date.now() });
    await authenticateWithExpiry(harness, NOW + 120_000);
    prepareSuccessfulRefresh(harness, {
      rotatedRefreshToken: 'SECRET-rotated-refresh-token',
      claimExpirySeconds: 10_000,
    });
    harness.sessionStore.saveFailure = new Error('SECRET-save');

    await vi.advanceTimersByTimeAsync(60_000);
    expect(harness.coordinator.state).toMatchObject({
      phase: 'authenticated',
      sessionUsable: true,
      errorCode: 'session_persistence_failed',
      retryAction: 'persist',
    });
    harness.sessionStore.saveFailure = undefined;
    await vi.advanceTimersByTimeAsync(5_000);

    expect(refreshRequests(harness)).toHaveLength(1);
    expect(harness.sessionStore.saveAttempts).toEqual([
      'SECRET-refresh-token',
      'SECRET-rotated-refresh-token',
      'SECRET-rotated-refresh-token',
    ]);
    expect(harness.sessionFetch).toHaveBeenCalledTimes(2);
    expect(harness.coordinator.state.sessionUsable).toBe(true);
  });

  it('retries candidate verification without issuing another grant', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const harness = makeHarness({ now: () => Date.now() });
    await authenticateWithExpiry(harness, NOW + 120_000);
    prepareSuccessfulRefresh(harness, { claimExpirySeconds: 10_000 });
    harness.sessionFetch.mockResolvedValueOnce(response(500, { error: 'temporary' }));

    await vi.advanceTimersByTimeAsync(60_000);
    expect(harness.coordinator.state).toMatchObject({
      phase: 'authenticated',
      sessionUsable: true,
      errorCode: 'session_verification_failed',
      retryAction: 'verify',
    });
    await vi.advanceTimersByTimeAsync(5_000);

    expect(refreshRequests(harness)).toHaveLength(1);
    expect(harness.sessionStore.saveAttempts).toEqual(['SECRET-refresh-token']);
    expect(harness.sessionFetch).toHaveBeenCalledTimes(3);
    expect(harness.coordinator.state.sessionUsable).toBe(true);
  });

  it('retains an expired candidate for manual verification retry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const harness = makeHarness({ now: () => Date.now() });
    await authenticateWithExpiry(harness, NOW + 61_000);
    prepareSuccessfulRefresh(harness, { claimExpirySeconds: 10_000 });
    harness.sessionFetch
      .mockResolvedValueOnce(response(500, { error: 'temporary' }))
      .mockResolvedValueOnce(response(500, { error: 'temporary' }));
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(5_000);

    await vi.advanceTimersByTimeAsync(55_000);
    expect(harness.coordinator.state).toMatchObject({
      phase: 'authenticated',
      sessionUsable: false,
      errorCode: 'session_verification_failed',
      retryAction: 'verify',
    });
    await harness.coordinator.retryCurrentOperation();

    expect(refreshRequests(harness)).toHaveLength(1);
    expect(harness.sessionFetch).toHaveBeenCalledTimes(4);
    expect(harness.coordinator.state.sessionUsable).toBe(true);
  });

  it('refreshes instead of verifying an expired retained candidate', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const harness = makeHarness({ now: () => Date.now() });
    await authenticateWithExpiry(harness, NOW + 120_000);
    // Short-lived candidate so it expires before the manual retry.
    prepareSuccessfulRefresh(harness, { expiresInSeconds: 10 });
    harness.sessionFetch
      .mockResolvedValueOnce(response(500, { error: 'temporary' }))
      .mockResolvedValueOnce(response(500, { error: 'temporary' }));

    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(5_000);
    // Candidate expired at NOW + 70_000; advance past it.
    await vi.advanceTimersByTimeAsync(6_000);

    expect(harness.coordinator.state).toMatchObject({
      phase: 'authenticated',
      errorCode: 'session_verification_failed',
      retryAction: 'verify',
    });
    expect(harness.sessionStore.clearCalls).toBe(0);

    // The retry must obtain a fresh candidate via the refresh grant, not
    // send the expired ID token to /auth/session (which would 401 and
    // trigger terminal cleanup of the still-valid durable token).
    prepareSuccessfulRefresh(harness);
    await harness.coordinator.retryCurrentOperation();

    expect(refreshRequests(harness)).toHaveLength(2);
    expect(harness.sessionStore.clearCalls).toBe(0);
    expect(harness.sessionStore.refreshToken).toBe('SECRET-refresh-token');
    expect(harness.coordinator.state.sessionUsable).toBe(true);
  });

  it('reissues an expired rotated refresh candidate with the durable R2, not active R1', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const harness = makeHarness({ now: () => Date.now() });
    await authenticateWithExpiry(harness, NOW + 120_000);
    // First refresh returns a rotated R2 with a short-lived candidate so it
    // expires before the manual retry. R2 is persisted before verification,
    // while active still holds R1.
    prepareSuccessfulRefresh(harness, {
      rotatedRefreshToken: 'SECRET-rotated-refresh-token',
      expiresInSeconds: 10,
    });
    harness.sessionFetch
      .mockResolvedValueOnce(response(500, { error: 'temporary' }))
      .mockResolvedValueOnce(response(500, { error: 'temporary' }));

    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(5_000);
    // Candidate expired at NOW + 70_000; advance past it.
    await vi.advanceTimersByTimeAsync(6_000);

    expect(harness.coordinator.state).toMatchObject({
      phase: 'authenticated',
      errorCode: 'session_verification_failed',
      retryAction: 'verify',
    });
    expect(harness.sessionStore.clearCalls).toBe(0);
    expect(harness.sessionStore.saveAttempts).toContain('SECRET-rotated-refresh-token');

    // The retry must reissue the grant with the candidate's durable R2, not
    // active.bundle.refreshToken (R1). Sending R1 would, once its rotation
    // grace ends, elicit invalid_grant and terminally delete the valid R2.
    prepareSuccessfulRefresh(harness, {
      rotatedRefreshToken: 'SECRET-rotated-refresh-token',
    });
    await harness.coordinator.retryCurrentOperation();

    const grants = refreshRequests(harness);
    expect(grants).toHaveLength(2);
    expect(grants[1]?.data).toContain('refresh_token=SECRET-rotated-refresh-token');
    expect(grants[1]?.data).not.toContain('refresh_token=SECRET-refresh-token');
    expect(harness.sessionStore.clearCalls).toBe(0);
    expect(harness.coordinator.state.sessionUsable).toBe(true);
  });

  it('reissues when the candidate expires during the /auth/session round-trip', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const harness = makeHarness({ now: () => Date.now() });
    await authenticateWithExpiry(harness, NOW + 120_000);
    // Candidate ID token expires at NOW + 62_000: valid when verification
    // starts at NOW + 60_000 but expired by the time the response arrives.
    prepareSuccessfulRefresh(harness, { expiresInSeconds: 2 });
    const heldVerification = deferred<Response>();
    harness.sessionFetch.mockImplementationOnce(async () => heldVerification.promise);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(harness.coordinator.state).toMatchObject({
      operation: 'verifying',
      sessionUsable: true,
    });

    // Advance past the candidate expiry while the response is still pending.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(harness.coordinator.state.operation).toBe('verifying');

    // Prepare the reissue grant, then release the held response. Without the
    // pre-promotion recheck, enterAuthenticated() would trip the live-bundle
    // invariant (applyState → assertMobileAuthState) after active had been
    // replaced with the expired bundle and pendingCandidate cleared, leaving
    // the coordinator stuck in 'verifying' with no recovery timer.
    prepareSuccessfulRefresh(harness);
    heldVerification.resolve(
      response(200, {
        authenticated: true,
        user: { userId: 'user-123', email: 'person@example.com' },
      }),
    );
    await harness.flush();

    expect(refreshRequests(harness)).toHaveLength(2);
    expect(harness.coordinator.state).toMatchObject({
      phase: 'authenticated',
      operation: 'idle',
      sessionUsable: true,
    });
    expect(harness.sessionStore.clearCalls).toBe(0);
  });

  it('reissues instead of terminal-cleaning when /auth/session 401s an in-flight-expired candidate', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const harness = makeHarness({ now: () => Date.now() });
    await authenticateWithExpiry(harness, NOW + 120_000);
    // Candidate ID token expires at NOW + 62_000: valid when verification
    // starts at NOW + 60_000 but expired by the time the response arrives.
    prepareSuccessfulRefresh(harness, { expiresInSeconds: 2 });
    const heldVerification = deferred<Response>();
    harness.sessionFetch.mockImplementationOnce(async () => heldVerification.promise);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(harness.coordinator.state).toMatchObject({
      operation: 'verifying',
      sessionUsable: true,
    });

    // Advance past the candidate expiry while the response is still pending.
    await vi.advanceTimersByTimeAsync(3_000);
    expect(harness.coordinator.state.operation).toBe('verifying');

    // The API returns 401 for an expired ID token. Without the post-response
    // expiry recheck, the coordinator would treat this as a terminal
    // credential failure and delete the still-valid durable refresh token.
    prepareSuccessfulRefresh(harness);
    heldVerification.resolve(response(401, { error: 'Unauthorized: Invalid or expired token' }));
    await harness.flush();

    expect(refreshRequests(harness)).toHaveLength(2);
    expect(harness.coordinator.state).toMatchObject({
      phase: 'authenticated',
      operation: 'idle',
      sessionUsable: true,
    });
    expect(harness.sessionStore.clearCalls).toBe(0);
  });

  it('retries a transiently-failed R2 reissue with R2, not the stale active R1', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const harness = makeHarness({ now: () => Date.now() });
    await authenticateWithExpiry(harness, NOW + 120_000);
    // First refresh returns a rotated R2 with a short-lived candidate so it
    // expires before the manual retry. R2 is persisted before verification,
    // while active still holds R1.
    prepareSuccessfulRefresh(harness, {
      rotatedRefreshToken: 'SECRET-rotated-refresh-token',
      expiresInSeconds: 10,
    });
    harness.sessionFetch
      .mockResolvedValueOnce(response(500, { error: 'temporary' }))
      .mockResolvedValueOnce(response(500, { error: 'temporary' }));

    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(5_000);
    // Candidate expired at NOW + 70_000; advance past it.
    await vi.advanceTimersByTimeAsync(6_000);

    expect(harness.coordinator.state).toMatchObject({
      phase: 'authenticated',
      errorCode: 'session_verification_failed',
      retryAction: 'verify',
    });
    expect(harness.sessionStore.clearCalls).toBe(0);
    expect(harness.sessionStore.saveAttempts).toContain('SECRET-rotated-refresh-token');

    // The reissue sends R2 but fails transiently (503 is retryable, not
    // invalid_grant). Without retaining R2 in active.bundle.refreshToken,
    // the next retry would fall back to active R1 and, once R1's rotation
    // grace ends, elicit invalid_grant and terminally delete the valid R2.
    harness.tokenTransport.result = { status: 503, data: {} };
    await harness.coordinator.retryCurrentOperation();

    expect(harness.coordinator.state).toMatchObject({
      phase: 'authenticated',
      errorCode: 'session_refresh_failed',
      retryAction: 'refresh',
    });
    expect(harness.sessionStore.clearCalls).toBe(0);
    // The reissue attempt sent R2.
    const grantsAfterReissue = refreshRequests(harness);
    expect(grantsAfterReissue).toHaveLength(2);
    expect(grantsAfterReissue[1]?.data).toContain('refresh_token=SECRET-rotated-refresh-token');

    // The next manual retry must still send R2, not R1.
    prepareSuccessfulRefresh(harness, { rotatedRefreshToken: 'SECRET-rotated-refresh-token' });
    await harness.coordinator.retryCurrentOperation();

    const grants = refreshRequests(harness);
    expect(grants).toHaveLength(3);
    expect(grants[2]?.data).toContain('refresh_token=SECRET-rotated-refresh-token');
    expect(grants[2]?.data).not.toContain('refresh_token=SECRET-refresh-token');
    expect(harness.sessionStore.clearCalls).toBe(0);
    expect(harness.coordinator.state.sessionUsable).toBe(true);
  });

  it('replaces both old deadlines after successful promotion', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const harness = makeHarness({ now: () => Date.now() });
    await authenticateWithExpiry(harness, NOW + 120_000);
    prepareSuccessfulRefresh(harness, { claimExpirySeconds: 10_000 });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(refreshRequests(harness)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(harness.coordinator.state.sessionUsable).toBe(true);
    await vi.advanceTimersByTimeAsync(3_479_999);
    expect(refreshRequests(harness)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(refreshRequests(harness)).toHaveLength(2);
  });

  it('uses only the injected clock for lifecycle delay decisions', async () => {
    const injectedNow = 2_000_000_000_000;
    const harness = makeHarness({ now: () => injectedNow });

    await authenticateWithExpiry(harness, injectedNow + 60_000, injectedNow);
    prepareSuccessfulRefresh(harness, {
      claimExpirySeconds: Math.ceil((injectedNow + 7_200_000) / 1_000),
    });
    await vi.waitFor(() => expect(refreshRequests(harness)).toHaveLength(1));
    await harness.coordinator.dispose();
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
    ['invalid JSON', { status: 200, data: '{not-json' }, null, 'token_validation_failed'],
    [
      'invalid shape',
      { status: 200, data: { id_token: 'SECRET-id' } },
      null,
      'token_validation_failed',
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
        refresh_token: 'SECRET-refresh-token',
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

  it('maps a successful callback response without a refresh token to token validation failure', async () => {
    const harness = makeHarness();
    await harness.coordinator.initialize();
    await harness.coordinator.startSignIn();
    const transaction = harness.preferences.transaction();
    harness.tokenTransport.result = {
      status: 200,
      data: {
        access_token: 'access',
        id_token: idToken(transaction),
        expires_in: 3_600,
      },
    };

    harness.app.emit(callback(transaction));
    await harness.flush();
    expect(harness.coordinator.state.errorCode).toBe('token_validation_failed');
  });

  it('maps a whitespace-only callback refresh token to token validation failure', async () => {
    const harness = makeHarness();
    await harness.coordinator.initialize();
    await harness.coordinator.startSignIn();
    const transaction = harness.preferences.transaction();
    harness.tokenTransport.result = {
      status: 200,
      data: {
        access_token: 'access',
        id_token: idToken(transaction),
        refresh_token: ' \t\n',
        expires_in: 3_600,
      },
    };

    harness.app.emit(callback(transaction));
    await harness.flush();
    expect(harness.coordinator.state.errorCode).toBe('token_validation_failed');
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

  it('persists the callback refresh token before transaction cleanup, API verification, and authenticated publication', async () => {
    const harness = makeHarness();
    await harness.persist(activeTransaction);
    harness.prepareSuccessfulExchange(activeTransaction);
    await harness.coordinator.initialize();
    harness.order.length = 0;
    harness.preferences.calls.length = 0;
    const stop = watch(
      () => [harness.coordinator.state.phase, harness.coordinator.state.sessionUsable] as const,
      ([phase, sessionUsable]) => {
        if (phase === 'authenticated' && sessionUsable) {
          harness.order.push('state:authenticated');
        }
      },
      { flush: 'sync' },
    );

    try {
      await harness.coordinator.completeCallback(callback(activeTransaction));
    } finally {
      stop();
    }

    expectOrderedCalls(harness.order, [
      'session:save:SECRET-refresh-token',
      'preferences:remove',
      'fetch:/auth/session',
      'state:authenticated',
    ]);
  });

  it('does not clear the transaction or verify while callback persistence is pending', async () => {
    const persistence = deferred<void>();
    const harness = makeHarness();
    await harness.persist(activeTransaction);
    harness.prepareSuccessfulExchange(activeTransaction);
    harness.sessionStore.saveGate = persistence.promise;
    await harness.coordinator.initialize();
    harness.preferences.calls.length = 0;

    const completing = harness.coordinator.completeCallback(callback(activeTransaction));
    await vi.waitFor(() =>
      expect(harness.sessionStore.saveAttempts).toEqual(['SECRET-refresh-token']),
    );

    expect(harness.preferences.value).not.toBeNull();
    expect(harness.preferences.calls).not.toContain('preferences:remove');
    expect(harness.sessionFetch).not.toHaveBeenCalled();
    expect(harness.coordinator.state).toMatchObject({
      operation: 'persisting',
      sessionUsable: false,
    });

    persistence.resolve();
    await completing;
    expect(harness.coordinator.state.phase).toBe('authenticated');
  });

  it('retains the callback candidate and transaction after persistence failure', async () => {
    const harness = makeHarness();
    await harness.persist(activeTransaction);
    harness.prepareSuccessfulExchange(activeTransaction);
    harness.sessionStore.saveFailure = new Error('SECRET-keychain-save');
    await harness.coordinator.initialize();

    await harness.coordinator.completeCallback(callback(activeTransaction));

    expect(harness.preferences.value).not.toBeNull();
    expect(harness.sessionFetch).not.toHaveBeenCalled();
    expect(harness.coordinator.state).toEqual({
      phase: 'error',
      operation: 'idle',
      sessionUsable: false,
      errorCode: 'session_persistence_failed',
      retryAction: 'persist',
      notice: null,
      user: null,
    });

    const preferencesBeforeRejectedStart = [...harness.preferences.calls];
    await harness.coordinator.startSignIn();
    expect(harness.preferences.calls).toEqual(preferencesBeforeRejectedStart);
    expect(harness.browser.openCalls).toEqual([]);

    harness.sessionStore.saveFailure = undefined;
    await harness.coordinator.retryCurrentOperation();

    expect(harness.sessionStore.saveAttempts).toEqual([
      'SECRET-refresh-token',
      'SECRET-refresh-token',
    ]);
    expect(harness.tokenTransport.requests).toHaveLength(1);
    expect(harness.preferences.value).toBeNull();
    expect(harness.coordinator.state.phase).toBe('authenticated');
  });

  it('proceeds to session verification when successful exchange cleanup fails', async () => {
    const harness = makeHarness();
    await harness.persist(activeTransaction);
    harness.prepareSuccessfulExchange(activeTransaction);
    await harness.coordinator.initialize();
    harness.preferences.removeFailure = new Error('SECRET-preferences-remove');

    await harness.coordinator.completeCallback(callback(activeTransaction));

    expect(harness.sessionFetch).toHaveBeenCalledOnce();
    expect(harness.coordinator.state).toMatchObject({
      phase: 'authenticated',
      errorCode: null,
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

  it('ignores a duplicate callback after a cleanup-failed exchange succeeds', async () => {
    const harness = makeHarness();
    await harness.persist(activeTransaction);
    harness.prepareSuccessfulExchange(activeTransaction);
    await harness.coordinator.initialize();
    harness.preferences.removeFailure = new Error('SECRET-preferences-remove');

    await harness.coordinator.completeCallback(callback(activeTransaction));

    expect(harness.tokenTransport.requests).toHaveLength(1);
    expect(harness.coordinator.state).toMatchObject({
      phase: 'authenticated',
      errorCode: null,
    });

    await harness.coordinator.completeCallback(callback(activeTransaction));

    expect(harness.tokenTransport.requests).toHaveLength(1);
    expect(harness.sessionFetch).toHaveBeenCalledOnce();
    expect(harness.coordinator.state).toMatchObject({
      phase: 'authenticated',
      errorCode: null,
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
        user: { userId: 'user-123', email: null },
      }),
    );
    await harness.coordinator.retryCurrentOperation();

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

  it.each([401, 403])(
    'clears the durable callback credential before publishing session_unusable after API status %i',
    async (status) => {
      const harness = await exchangedHarness();
      harness.sessionFetch.mockResolvedValueOnce(response(status, { authenticated: false }));

      await harness.coordinator.completeCallback(callback(activeTransaction));

      expect(harness.sessionStore.clearCalls).toBe(1);
      expect(harness.sessionStore.refreshToken).toBeNull();
      expect(harness.coordinator.state).toEqual({
        phase: 'signedOut',
        operation: 'idle',
        sessionUsable: false,
        errorCode: null,
        retryAction: null,
        notice: 'session_unusable',
        user: null,
      });
      expect(harness.sessionFetch).toHaveBeenCalledOnce();
    },
  );

  it('fails closed when an API-rejected callback credential cannot be deleted', async () => {
    const harness = await exchangedHarness();
    harness.sessionFetch.mockResolvedValueOnce(response(401, { authenticated: false }));
    harness.sessionStore.clearFailure = new Error('SECRET-keychain-delete');

    await harness.coordinator.completeCallback(callback(activeTransaction));

    expect(harness.coordinator.state).toEqual({
      phase: 'signedOut',
      operation: 'idle',
      sessionUsable: false,
      errorCode: 'session_cleanup_failed',
      retryAction: 'cleanup',
      notice: 'cleanup_incomplete',
      user: null,
    });
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
          user: { userId: 'user-123', email: null },
        }),
      );
      await harness.coordinator.retryCurrentOperation();

      expect(harness.tokenTransport.requests).toHaveLength(1);
      expect(harness.sessionFetch).toHaveBeenCalledTimes(2);
      expect(harness.coordinator.state).toEqual({
        phase: 'authenticated',
        operation: 'idle',
        sessionUsable: true,
        errorCode: null,
        retryAction: null,
        notice: null,
        user: { userId: 'user-123', email: null },
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
          new Promise<Response>((_resolve, reject) => {
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

describe('authenticated feature transport', () => {
  it.each([0, -1, 1.5, Number.NaN, 50_001])(
    'rejects invalid transport timeout %s',
    async (transportTimeoutMs) => {
      const harness = makeHarness();
      await authenticate(harness);
      const before = harness.sessionFetch.mock.calls.length;

      await expect(
        harness.coordinator.requestAuthenticatedApi({
          path: 'tts/generate',
          transportTimeoutMs,
        }),
      ).rejects.toMatchObject({ code: 'invalid_request_timeout' });

      expect(harness.sessionFetch).toHaveBeenCalledTimes(before);
    },
  );

  it('rejects path escapes before network activity', async () => {
    const harness = makeHarness();
    await authenticate(harness);
    const before = harness.sessionFetch.mock.calls.length;

    for (const path of [
      'https://evil.example/steal',
      '//evil.example/steal',
      '/api/srs/stats',
      '../secret',
      '%2e%2e/secret',
      '%2e%2e%2fsecret',
      'srs%2f..%2fsecret',
      String.raw`..\secret`,
      'srs/stats#fragment',
    ]) {
      await expect(harness.coordinator.requestAuthenticatedApi({ path })).rejects.toMatchObject({
        code: 'invalid_request_path',
      });
    }

    expect(harness.sessionFetch).toHaveBeenCalledTimes(before);
  });

  it.each(['Authorization', 'authorization', 'AUTHORIZATION', 'AuThOrIzAtIoN'])(
    'rejects caller-owned %s',
    async (header) => {
      const harness = makeHarness();
      await authenticate(harness);

      await expect(
        harness.coordinator.requestAuthenticatedApi({
          path: 'srs/stats',
          init: { headers: { [header]: 'Bearer attacker' } },
        }),
      ).rejects.toMatchObject({ code: 'invalid_request_headers' });
    },
  );

  it.each([
    ['name', { 'Invalid Header Name': 'value' }],
    ['value', { 'X-Feature': 'value\nInjected: secret' }],
  ])('normalizes an invalid header %s before network activity', async (_kind, headers) => {
    const harness = makeHarness();
    await authenticate(harness);
    const before = harness.sessionFetch.mock.calls.length;

    await expect(
      harness.coordinator.requestAuthenticatedApi({
        path: 'srs/stats',
        init: { headers },
      }),
    ).rejects.toMatchObject({ code: 'invalid_request_headers' });

    expect(harness.sessionFetch).toHaveBeenCalledTimes(before);
  });

  it.each(['https://vela.example/api', 'https://vela.example/api///'])(
    'normalizes %s before resolving a feature path',
    async (apiUrl) => {
      const harness = makeHarness({ authConfig: { ...config, apiUrl } });
      await authenticate(harness);
      harness.sessionFetch.mockClear();
      harness.sessionFetch.mockResolvedValueOnce(response(200, {}));

      await harness.coordinator.requestAuthenticatedApi({ path: 'srs/stats' });

      expect(String(harness.sessionFetch.mock.calls[0]?.[0])).toBe(
        'https://vela.example/api/srs/stats',
      );
    },
  );

  it('rejects a resolved path outside the API prefix', async () => {
    const harness = makeHarness();
    await authenticate(harness);
    const before = harness.sessionFetch.mock.calls.length;

    await expect(
      harness.coordinator.requestAuthenticatedApi({ path: '../api-evil/secret' }),
    ).rejects.toMatchObject({ code: 'invalid_request_path' });

    expect(harness.sessionFetch).toHaveBeenCalledTimes(before);
  });

  it('owns exactly one current Authorization header', async () => {
    const harness = makeHarness();
    await authenticate(harness);
    harness.sessionFetch.mockClear();
    harness.sessionFetch.mockResolvedValueOnce(response(200, {}));

    await harness.coordinator.requestAuthenticatedApi({
      path: 'srs/stats',
      init: { headers: { 'X-Feature': 'due-reviews' } },
    });

    expect(harness.sessionFetch).toHaveBeenCalledOnce();
    const headers = new Headers(harness.sessionFetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Authorization')).toBe(`Bearer ${idToken(activeTransaction)}`);
    expect(headers.get('X-Feature')).toBe('due-reviews');
  });

  it('preserves a caller abort as AbortError', async () => {
    const harness = makeHarness();
    await authenticate(harness);
    const caller = new AbortController();
    harness.sessionFetch.mockImplementationOnce(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('transport aborted')));
        }),
    );

    const request = harness.coordinator.requestAuthenticatedApi({
      path: 'srs/stats',
      init: { signal: caller.signal },
    });
    caller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('propagates a caller abort to the response body after headers arrive', async () => {
    const harness = makeHarness();
    await authenticate(harness);
    const caller = new AbortController();
    // fetch() resolves as soon as headers arrive, but response.json() is
    // consumed by the API client only after the coordinator returns. The
    // caller abort bridge must stay active through body consumption so a
    // stalled body can be cancelled by the caller's deadline.
    harness.sessionFetch.mockImplementationOnce((_url, init) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          }),
      } as unknown as Response),
    );

    const request = harness.coordinator.requestAuthenticatedApi({
      path: 'srs/stats',
      init: { signal: caller.signal },
    });

    // The coordinator has returned the Response; headers arrived but the
    // body has not been consumed yet. Start consuming the body (which
    // registers an abort listener on the fetch signal), then abort the
    // caller signal. The bridge must still propagate the abort to the
    // fetch signal that governs response.json().
    const body = await request;
    const jsonPromise = body.json();
    caller.abort();

    await expect(jsonPromise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('preserves the original caller abort when its init signal is replaced in flight', async () => {
    const harness = makeHarness();
    await authenticate(harness);
    const original = new AbortController();
    const replacement = new AbortController();
    const init = { signal: original.signal };
    harness.sessionFetch.mockImplementationOnce(
      (_url, fetchInit) =>
        new Promise<Response>((_resolve, reject) => {
          fetchInit?.signal?.addEventListener('abort', () => reject(new Error('original aborted')));
        }),
    );

    const request = harness.coordinator.requestAuthenticatedApi({ path: 'srs/stats', init });
    init.signal = replacement.signal;
    original.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('aborts an omitted feature transport timeout after 15 seconds', async () => {
    const harness = makeHarness();
    await authenticate(harness);
    vi.useFakeTimers();
    try {
      let featureSignal: AbortSignal | undefined;
      harness.sessionFetch.mockImplementationOnce(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            featureSignal = init?.signal ?? undefined;
            init?.signal?.addEventListener('abort', () => reject(new Error('timeout')));
          }),
      );

      const request = harness.coordinator.requestAuthenticatedApi({ path: 'srs/stats' });
      const expected = expect(request).rejects.toMatchObject({ code: 'request_timeout' });
      await vi.advanceTimersByTimeAsync(MOBILE_AUTH_NETWORK_TIMEOUT_MS - 1);
      expect(featureSignal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      await expected;
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a 45-second feature transport timeout active beyond 15 seconds', async () => {
    const harness = makeHarness();
    await authenticate(harness);
    vi.useFakeTimers();
    try {
      let featureSignal: AbortSignal | undefined;
      harness.sessionFetch.mockImplementationOnce(
        (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            featureSignal = init?.signal ?? undefined;
            init?.signal?.addEventListener('abort', () => reject(new Error('timeout')));
          }),
      );

      const request = harness.coordinator.requestAuthenticatedApi({
        path: 'tts/generate',
        transportTimeoutMs: 45_000,
      });
      const expected = expect(request).rejects.toMatchObject({ code: 'request_timeout' });
      await vi.advanceTimersByTimeAsync(15_000);
      expect(featureSignal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(30_000);

      await expected;
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a timeout classified as request_timeout when the caller replaces its signal', async () => {
    const harness = makeHarness();
    await authenticate(harness);
    const original = new AbortController();
    const replacement = new AbortController();
    replacement.abort();
    const init = { signal: original.signal };
    vi.useFakeTimers();
    try {
      harness.sessionFetch.mockImplementationOnce(
        (_url, fetchInit) =>
          new Promise<Response>((_resolve, reject) => {
            fetchInit?.signal?.addEventListener('abort', () => reject(new Error('timeout')));
          }),
      );

      const request = harness.coordinator.requestAuthenticatedApi({ path: 'srs/stats', init });
      const expected = expect(request).rejects.toMatchObject({ code: 'request_timeout' });
      init.signal = replacement.signal;
      await vi.advanceTimersByTimeAsync(MOBILE_AUTH_NETWORK_TIMEOUT_MS);

      await expected;
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects feature transport once disposal has been requested', async () => {
    const harness = makeHarness();
    await authenticate(harness);
    const disposing = harness.coordinator.dispose();

    await expect(
      harness.coordinator.requestAuthenticatedApi({ path: 'srs/stats' }),
    ).rejects.toMatchObject({
      code: 'session_unavailable',
    });
    await disposing;
    expect(harness.sessionFetch).toHaveBeenCalledOnce();
  });

  it('propagates raw fetch rejection without mutating auth state', async () => {
    const harness = makeHarness();
    await authenticate(harness);
    const before = { ...harness.coordinator.state };
    const failure = new Error('feature transport failed');
    harness.sessionFetch.mockRejectedValueOnce(failure);

    await expect(harness.coordinator.requestAuthenticatedApi({ path: 'srs/stats' })).rejects.toBe(
      failure,
    );

    expect(harness.coordinator.state).toEqual(before);
  });

  it.each([200, 500])('returns a non-401 response after refresh promotion (%i)', async (status) => {
    let currentNow = Date.now();
    const harness = makeHarness({ now: () => currentNow });
    await authenticateWithExpiry(harness, currentNow + 30_000, currentNow);
    harness.tokenTransport.result = {
      status: 200,
      data: {
        access_token: 'SECRET-refreshed-access-token',
        id_token: refreshedIdToken({ exp: Math.ceil((currentNow + 3_600_000) / 1_000) }),
        expires_in: 3_600,
      },
    };
    harness.sessionFetch.mockClear();
    const featureResponse = deferred<Response>();
    harness.sessionFetch.mockImplementation(async (target) => {
      if (String(target).endsWith('/srs/stats')) return featureResponse.promise;
      return response(200, {
        authenticated: true,
        user: { userId: 'user-123', email: null },
      });
    });

    const request = harness.coordinator.requestAuthenticatedApi({ path: 'srs/stats' });
    await vi.waitFor(() => expect(harness.sessionFetch).toHaveBeenCalledOnce());
    harness.app.emitState(true);
    await vi.waitFor(() => expect(refreshRequests(harness)).toHaveLength(1));
    await harness.flush();
    featureResponse.resolve(response(status, {}));

    await expect(request).resolves.toMatchObject({ status });
  });

  it('retries concurrent 401s once after one expired-token refresh promotion', async () => {
    let currentNow = NOW;
    const harness = makeHarness({ now: () => currentNow });
    await authenticateWithExpiry(harness, currentNow + 1_000, currentNow);
    prepareSuccessfulRefresh(harness, {
      claimExpirySeconds: Math.ceil((currentNow + 3_600_000) / 1_000),
    });
    const initialResponses = [deferred<Response>(), deferred<Response>()];
    let featureCalls = 0;
    harness.sessionFetch.mockImplementation(async (target) => {
      if (String(target).endsWith('/srs/stats')) {
        const responseForCall = initialResponses[featureCalls++];
        return responseForCall?.promise ?? response(200, {});
      }
      return response(200, {
        authenticated: true,
        user: { userId: 'user-123', email: 'person@example.com' },
      });
    });

    const first = harness.coordinator.requestAuthenticatedApi({ path: 'srs/stats' });
    const second = harness.coordinator.requestAuthenticatedApi({ path: 'srs/stats' });
    await vi.waitFor(() => expect(featureCalls).toBe(2));
    currentNow += 2_000;
    initialResponses[0]?.resolve(response(401, {}));
    initialResponses[1]?.resolve(response(401, {}));

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ status: 200 }),
      expect.objectContaining({ status: 200 }),
    ]);
    expect(refreshRequests(harness)).toHaveLength(1);
    expect(featureCalls).toBe(4);
  });

  it('replays a JSON POST once with the identical body after refresh', async () => {
    let currentNow = NOW;
    const harness = makeHarness({ now: () => currentNow });
    await authenticateWithExpiry(harness, currentNow + 1_000, currentNow);
    prepareSuccessfulRefresh(harness, {
      claimExpirySeconds: Math.ceil((currentNow + 3_600_000) / 1_000),
    });
    harness.sessionFetch.mockClear();
    const initialResponse = deferred<Response>();
    let featureCalls = 0;
    harness.sessionFetch.mockImplementation(async (target) => {
      if (String(target).endsWith('/tts/generate')) {
        featureCalls += 1;
        return featureCalls === 1 ? initialResponse.promise : response(200, { cached: true });
      }
      return response(200, {
        authenticated: true,
        user: { userId: 'user-123', email: 'person@example.com' },
      });
    });
    const body = JSON.stringify({ vocabularyId: '水:ミズ', text: '水' });

    const request = harness.coordinator.requestAuthenticatedApi({
      path: 'tts/generate',
      transportTimeoutMs: 45_000,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      },
    });
    await vi.waitFor(() => expect(featureCalls).toBe(1));
    currentNow += 2_000;
    initialResponse.resolve(response(401, {}));

    await expect(request).resolves.toMatchObject({ status: 200 });
    const attempts = harness.sessionFetch.mock.calls.filter(([url]) =>
      String(url).includes('tts/generate'),
    );
    expect(attempts).toHaveLength(2);
    expect(attempts[0]?.[1]?.body).toBe(body);
    expect(attempts[1]?.[1]?.body).toBe(body);
    expect(new Headers(attempts[0]?.[1]?.headers).get('Content-Type')).toBe('application/json');
    expect(new Headers(attempts[1]?.[1]?.headers).get('Content-Type')).toBe('application/json');
    expect(attempts[1]?.[1]?.method).toBe('POST');
  });

  it('queues one terminal cleanup for concurrent still-valid-token 401s', async () => {
    const harness = makeHarness();
    await authenticate(harness);
    harness.sessionFetch.mockImplementation(async (target) =>
      String(target).endsWith('/srs/stats')
        ? response(401, {})
        : response(200, {
            authenticated: true,
            user: { userId: 'user-123', email: 'person@example.com' },
          }),
    );

    await expect(
      Promise.all([
        harness.coordinator.requestAuthenticatedApi({ path: 'srs/stats' }),
        harness.coordinator.requestAuthenticatedApi({ path: 'srs/stats' }),
      ]),
    ).resolves.toEqual([
      expect.objectContaining({ status: 401 }),
      expect.objectContaining({ status: 401 }),
    ]);
    expect(harness.sessionStore.clearCalls).toBe(1);
    expect(refreshRequests(harness)).toHaveLength(0);
  });

  it('reports retryable recovery when an expired-token 401 cannot refresh while inactive', async () => {
    let currentNow = NOW;
    const harness = makeHarness({ now: () => currentNow });
    await authenticateWithExpiry(harness, currentNow + 120_000, currentNow);
    harness.sessionFetch.mockClear();
    const featureResponse = deferred<Response>();
    harness.sessionFetch.mockImplementation(async (target) =>
      String(target).endsWith('/srs/stats')
        ? featureResponse.promise
        : response(200, {
            authenticated: true,
            user: { userId: 'user-123', email: 'person@example.com' },
          }),
    );

    const request = harness.coordinator.requestAuthenticatedApi({ path: 'srs/stats' });
    await vi.waitFor(() => expect(harness.sessionFetch).toHaveBeenCalledOnce());
    harness.app.emitState(false);
    currentNow += 121_000;
    featureResponse.resolve(response(401, {}));

    await expect(request).rejects.toMatchObject({ code: 'session_recovery_pending' });
    expect(refreshRequests(harness)).toHaveLength(0);
    expect(harness.sessionStore.clearCalls).toBe(0);
  });

  it('treats invalid-grant cleanup owned by expired-token recovery as terminal', async () => {
    let currentNow = NOW;
    const harness = makeHarness({ now: () => currentNow });
    await authenticateWithExpiry(harness, currentNow + 120_000, currentNow);
    harness.sessionFetch.mockClear();
    harness.tokenTransport.result = { status: 400, data: { error: 'invalid_grant' } };
    const featureResponse = deferred<Response>();
    harness.sessionFetch.mockImplementation(async (target) =>
      String(target).endsWith('/srs/stats')
        ? featureResponse.promise
        : response(200, {
            authenticated: true,
            user: { userId: 'user-123', email: 'person@example.com' },
          }),
    );

    const request = harness.coordinator.requestAuthenticatedApi({ path: 'srs/stats' });
    await vi.waitFor(() => expect(harness.sessionFetch).toHaveBeenCalledOnce());
    currentNow += 121_000;
    featureResponse.resolve(response(401, {}));

    await expect(request).resolves.toMatchObject({ status: 401 });
    expect(refreshRequests(harness)).toHaveLength(1);
    expect(harness.sessionStore.clearCalls).toBe(1);
  });

  it('joins an already-running proactive refresh after an expired-token 401', async () => {
    let currentNow = NOW;
    const harness = makeHarness({ now: () => currentNow });
    await authenticateWithExpiry(harness, currentNow + 120_000, currentNow);
    harness.sessionFetch.mockClear();
    prepareSuccessfulRefresh(harness, {
      claimExpirySeconds: Math.ceil((currentNow + 3_600_000) / 1_000),
    });
    const refreshGate = deferred<{ status: number; data: unknown }>();
    harness.tokenTransport.gate = refreshGate.promise;
    const featureResponse = deferred<Response>();
    let featureCalls = 0;
    harness.sessionFetch.mockImplementation(async (target) => {
      if (String(target).endsWith('/srs/stats')) {
        featureCalls += 1;
        return featureCalls === 1 ? featureResponse.promise : response(200, {});
      }
      return response(200, {
        authenticated: true,
        user: { userId: 'user-123', email: 'person@example.com' },
      });
    });

    const request = harness.coordinator.requestAuthenticatedApi({ path: 'srs/stats' });
    await vi.waitFor(() => expect(featureCalls).toBe(1));
    currentNow += 61_000;
    harness.app.emitState(true);
    await vi.waitFor(() => expect(refreshRequests(harness)).toHaveLength(1));
    currentNow += 60_000;
    featureResponse.resolve(response(401, {}));
    refreshGate.resolve(harness.tokenTransport.result);

    await expect(request).resolves.toMatchObject({ status: 200 });
    expect(refreshRequests(harness)).toHaveLength(1);
  });

  it('joins an already-running proactive refresh after a still-valid-token 401', async () => {
    let currentNow = NOW;
    const harness = makeHarness({ now: () => currentNow });
    await authenticateWithExpiry(harness, currentNow + 120_000, currentNow);
    harness.sessionFetch.mockClear();
    prepareSuccessfulRefresh(harness, {
      claimExpirySeconds: Math.ceil((currentNow + 3_600_000) / 1_000),
    });
    const refreshGate = deferred<{ status: number; data: unknown }>();
    harness.tokenTransport.gate = refreshGate.promise;
    const featureResponse = deferred<Response>();
    let featureCalls = 0;
    harness.sessionFetch.mockImplementation(async (target) => {
      if (String(target).endsWith('/srs/stats')) {
        featureCalls += 1;
        return featureCalls === 1 ? featureResponse.promise : response(200, {});
      }
      return response(200, {
        authenticated: true,
        user: { userId: 'user-123', email: 'person@example.com' },
      });
    });

    const request = harness.coordinator.requestAuthenticatedApi({ path: 'srs/stats' });
    await vi.waitFor(() => expect(featureCalls).toBe(1));
    // Advance into the proactive-refresh lead window but NOT past expiry —
    // the captured token is still technically valid when the 401 arrives.
    currentNow += 61_000;
    harness.app.emitState(true);
    await vi.waitFor(() => expect(refreshRequests(harness)).toHaveLength(1));
    featureResponse.resolve(response(401, {}));
    refreshGate.resolve(harness.tokenTransport.result);

    // The in-flight refresh is joined (not treated as terminal). A successful
    // promotion retries the feature request with the new bundle instead of
    // reporting session_changed.
    await expect(request).resolves.toMatchObject({ status: 200 });
    expect(refreshRequests(harness)).toHaveLength(1);
    expect(harness.sessionStore.clearCalls).toBe(0);
  });

  it('reports retryable failure when a still-valid-token 401 joins a transiently failing refresh', async () => {
    let currentNow = NOW;
    const harness = makeHarness({ now: () => currentNow });
    await authenticateWithExpiry(harness, currentNow + 120_000, currentNow);
    harness.sessionFetch.mockClear();
    // 503 is a transient (non-invalid_grant) refresh failure: the session
    // stays authenticated with retryAction 'refresh' — the durable
    // credential must not be deleted.
    harness.tokenTransport.result = { status: 503, data: {} };
    const refreshGate = deferred<{ status: number; data: unknown }>();
    harness.tokenTransport.gate = refreshGate.promise;
    const featureResponse = deferred<Response>();
    harness.sessionFetch.mockImplementation(async (target) =>
      String(target).endsWith('/srs/stats')
        ? featureResponse.promise
        : response(200, {
            authenticated: true,
            user: { userId: 'user-123', email: 'person@example.com' },
          }),
    );

    const request = harness.coordinator.requestAuthenticatedApi({ path: 'srs/stats' });
    await vi.waitFor(() => expect(harness.sessionFetch).toHaveBeenCalledOnce());
    currentNow += 61_000;
    harness.app.emitState(true);
    await vi.waitFor(() => expect(refreshRequests(harness)).toHaveLength(1));
    featureResponse.resolve(response(401, {}));
    refreshGate.resolve(harness.tokenTransport.result);

    // The in-flight refresh is joined. Its transient failure classifies as
    // retryable_recovery — the durable credential is preserved for retry.
    await expect(request).rejects.toMatchObject({ code: 'session_recovery_pending' });
    expect(harness.sessionStore.clearCalls).toBe(0);
  });

  it('returns session_changed when sign-out supersedes a waiting expired-token recovery', async () => {
    let currentNow = NOW;
    const harness = makeHarness({ now: () => currentNow });
    await authenticateWithExpiry(harness, currentNow + 120_000, currentNow);
    harness.sessionFetch.mockClear();
    const refreshGate = deferred<{ status: number; data: unknown }>();
    harness.tokenTransport.gate = refreshGate.promise;
    const featureResponse = deferred<Response>();
    harness.sessionFetch.mockImplementation(async (target) =>
      String(target).endsWith('/srs/stats')
        ? featureResponse.promise
        : response(200, {
            authenticated: true,
            user: { userId: 'user-123', email: 'person@example.com' },
          }),
    );

    const request = harness.coordinator.requestAuthenticatedApi({ path: 'srs/stats' });
    await vi.waitFor(() => expect(harness.sessionFetch).toHaveBeenCalledOnce());
    currentNow += 121_000;
    featureResponse.resolve(response(401, {}));
    await vi.waitFor(() => expect(refreshRequests(harness)).toHaveLength(1));
    const signingOut = harness.coordinator.signOut();
    refreshGate.resolve(harness.tokenTransport.result);

    await expect(request).rejects.toMatchObject({ code: 'session_changed' });
    await signingOut;
  });

  it('reports retryable recovery when a pending candidate makes queueRefresh a no-op', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    try {
      const harness = makeHarness({ now: () => Date.now() });
      await authenticateWithExpiry(harness, NOW + 120_000);
      harness.sessionFetch.mockClear();
      prepareSuccessfulRefresh(harness, {
        claimExpirySeconds: 10_000,
        rotatedRefreshToken: 'SECRET-pending-refresh-token',
      });
      harness.sessionStore.saveFailure = new Error('pending candidate');
      const featureResponse = deferred<Response>();
      harness.sessionFetch.mockImplementation(async (target) =>
        String(target).endsWith('/srs/stats')
          ? featureResponse.promise
          : response(200, {
              authenticated: true,
              user: { userId: 'user-123', email: 'person@example.com' },
            }),
      );

      const request = harness.coordinator.requestAuthenticatedApi({ path: 'srs/stats' });
      await vi.waitFor(() => expect(harness.sessionFetch).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(60_000);
      expect(harness.coordinator.state.retryAction).toBe('persist');
      await vi.advanceTimersByTimeAsync(60_000);
      featureResponse.resolve(response(401, {}));

      await expect(request).rejects.toMatchObject({ code: 'session_recovery_pending' });
      expect(refreshRequests(harness)).toHaveLength(1);
      expect(harness.sessionStore.clearCalls).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries after verified same-user generation promotion', async () => {
    let currentNow = NOW;
    const harness = makeHarness({ now: () => currentNow });
    await authenticateWithExpiry(harness, currentNow + 120_000, currentNow);
    harness.sessionFetch.mockClear();
    prepareSuccessfulRefresh(harness, {
      claimExpirySeconds: Math.ceil((currentNow + 3_600_000) / 1_000),
    });
    const featureResponse = deferred<Response>();
    let featureCalls = 0;
    harness.sessionFetch.mockImplementation(async (target) => {
      if (String(target).endsWith('/srs/stats')) {
        featureCalls += 1;
        return featureCalls === 1 ? featureResponse.promise : response(200, {});
      }
      return response(200, {
        authenticated: true,
        user: { userId: 'user-123', email: 'person@example.com' },
      });
    });

    const request = harness.coordinator.requestAuthenticatedApi({ path: 'srs/stats' });
    await vi.waitFor(() => expect(featureCalls).toBe(1));
    currentNow += 121_000;
    featureResponse.resolve(response(401, {}));

    await expect(request).resolves.toMatchObject({ status: 200 });
    expect(refreshRequests(harness)).toHaveLength(1);
    expect(featureCalls).toBe(2);
  });

  it('returns session_changed when identity replacement supersedes waiting recovery', async () => {
    // Direct active-identity mutation is not a coordinator operation. The
    // supported replacement boundary is local sign-out followed by a fresh,
    // distinct-user OAuth session.
    let currentNow = NOW;
    let replacementActive = false;
    const harness = makeHarness({ now: () => currentNow });
    await authenticateWithExpiry(harness, currentNow + 120_000, currentNow);
    harness.sessionFetch.mockClear();
    const refreshGate = deferred<{ status: number; data: unknown }>();
    harness.tokenTransport.gate = refreshGate.promise;
    const featureResponse = deferred<Response>();
    harness.sessionFetch.mockImplementation(async (target) =>
      String(target).endsWith('/srs/stats')
        ? featureResponse.promise
        : response(200, {
            authenticated: true,
            user: {
              userId: replacementActive ? 'user-456' : 'user-123',
              email: 'person@example.com',
            },
          }),
    );

    const request = harness.coordinator.requestAuthenticatedApi({ path: 'srs/stats' });
    const expected = expect(request).rejects.toMatchObject({ code: 'session_changed' });
    await vi.waitFor(() => expect(harness.sessionFetch).toHaveBeenCalledOnce());
    currentNow += 121_000;
    featureResponse.resolve(response(401, {}));
    await vi.waitFor(() => expect(refreshRequests(harness)).toHaveLength(1));
    const signingOut = harness.coordinator.signOut();
    refreshGate.resolve(harness.tokenTransport.result);
    await signingOut;
    // The harness transaction store uses NOW as its persistence clock; reset
    // the injected coordinator clock before beginning the replacement flow.
    currentNow = NOW;
    harness.tokenTransport.gate = undefined;
    await harness.coordinator.startSignIn();
    const replacement = harness.preferences.transaction();
    replacementActive = true;
    harness.tokenTransport.result = {
      status: 200,
      data: {
        access_token: 'SECRET-replacement-access-token',
        id_token: idToken(replacement, { sub: 'user-456' }),
        refresh_token: 'SECRET-replacement-refresh-token',
        expires_in: 3_600,
      },
    };
    await harness.persist(replacement);
    await harness.coordinator.completeCallback(callback(replacement));

    await expected;
    expect(harness.coordinator.state).toMatchObject({
      phase: 'authenticated',
      user: { userId: 'user-456', email: 'person@example.com' },
    });
  });

  it('does not wait behind the feature request that initiated recovery', async () => {
    let currentNow = NOW;
    const harness = makeHarness({ now: () => currentNow });
    await authenticateWithExpiry(harness, currentNow + 120_000, currentNow);
    harness.sessionFetch.mockClear();
    prepareSuccessfulRefresh(harness, {
      claimExpirySeconds: Math.ceil((currentNow + 3_600_000) / 1_000),
    });
    const featureResponse = deferred<Response>();
    let featureCalls = 0;
    harness.sessionFetch.mockImplementation(async (target) => {
      if (String(target).endsWith('/srs/stats')) {
        featureCalls += 1;
        return featureCalls === 1 ? featureResponse.promise : response(200, {});
      }
      return response(200, {
        authenticated: true,
        user: { userId: 'user-123', email: 'person@example.com' },
      });
    });

    const request = harness.coordinator.requestAuthenticatedApi({ path: 'srs/stats' });
    await vi.waitFor(() => expect(featureCalls).toBe(1));
    currentNow += 121_000;
    featureResponse.resolve(response(401, {}));
    await vi.waitFor(() => expect(refreshRequests(harness)).toHaveLength(1));

    await expect(request).resolves.toMatchObject({ status: 200 });
    expect(featureCalls).toBe(2);
  });

  it('detaches an aborted caller while its peer completes the shared recovery', async () => {
    let currentNow = NOW;
    const harness = makeHarness({ now: () => currentNow });
    await authenticateWithExpiry(harness, currentNow + 1_000, currentNow);
    prepareSuccessfulRefresh(harness, {
      claimExpirySeconds: Math.ceil((currentNow + 3_600_000) / 1_000),
    });
    const refreshGate = deferred<{ status: number; data: unknown }>();
    harness.tokenTransport.gate = refreshGate.promise;
    const firstFeatureResponse = deferred<Response>();
    const secondFeatureResponse = deferred<Response>();
    let featureCalls = 0;
    harness.sessionFetch.mockImplementation(async (target) => {
      if (String(target).endsWith('/srs/stats')) {
        const responseForCall = [firstFeatureResponse, secondFeatureResponse][featureCalls++];
        return responseForCall?.promise ?? response(200, {});
      }
      return response(200, {
        authenticated: true,
        user: { userId: 'user-123', email: 'person@example.com' },
      });
    });
    const caller = new AbortController();
    const first = harness.coordinator.requestAuthenticatedApi({
      path: 'srs/stats',
      init: { signal: caller.signal },
    });
    const second = harness.coordinator.requestAuthenticatedApi({ path: 'srs/stats' });
    await vi.waitFor(() => expect(featureCalls).toBe(2));
    currentNow += 2_000;
    firstFeatureResponse.resolve(response(401, {}));
    secondFeatureResponse.resolve(response(401, {}));
    await vi.waitFor(() => expect(refreshRequests(harness)).toHaveLength(1));

    caller.abort();
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    refreshGate.resolve(harness.tokenTransport.result);
    await expect(second).resolves.toMatchObject({ status: 200 });
    expect(refreshRequests(harness)).toHaveLength(1);
  });

  it('performs terminal cleanup for a retry 401 without issuing another refresh', async () => {
    let currentNow = NOW;
    const harness = makeHarness({ now: () => currentNow });
    await authenticateWithExpiry(harness, currentNow + 1_000, currentNow);
    prepareSuccessfulRefresh(harness, {
      claimExpirySeconds: Math.ceil((currentNow + 3_600_000) / 1_000),
    });
    const initialResponse = deferred<Response>();
    const retryResponse = deferred<Response>();
    let featureCalls = 0;
    harness.sessionFetch.mockImplementation(async (target) => {
      if (String(target).endsWith('/srs/stats')) {
        featureCalls += 1;
        return featureCalls === 1 ? initialResponse.promise : retryResponse.promise;
      }
      return response(200, {
        authenticated: true,
        user: { userId: 'user-123', email: 'person@example.com' },
      });
    });

    const request = harness.coordinator.requestAuthenticatedApi({ path: 'srs/stats' });
    await vi.waitFor(() => expect(featureCalls).toBe(1));
    currentNow += 2_000;
    initialResponse.resolve(response(401, {}));
    await vi.waitFor(() => expect(featureCalls).toBe(2));
    currentNow += 3_601_000;
    retryResponse.resolve(response(401, {}));

    await expect(request).resolves.toMatchObject({ status: 401 });
    expect(refreshRequests(harness)).toHaveLength(1);
    expect(harness.sessionStore.clearCalls).toBe(1);
  });

  it('rejects a stale-generation 401 without cleanup', async () => {
    const harness = makeHarness();
    await authenticate(harness);
    harness.sessionFetch.mockClear();
    const featureResponse = deferred<Response>();
    harness.sessionFetch.mockImplementationOnce(async () => featureResponse.promise);

    const request = harness.coordinator.requestAuthenticatedApi({ path: 'srs/stats' });
    await vi.waitFor(() => expect(harness.sessionFetch).toHaveBeenCalledOnce());
    await harness.coordinator.signOut();
    featureResponse.resolve(response(401, {}));

    await expect(request).rejects.toMatchObject({ code: 'session_changed' });
    expect(harness.sessionStore.clearCalls).toBe(1);
  });

  it('does not let a pending feature fetch block sign-out or disposal', async () => {
    const harness = makeHarness();
    await authenticate(harness);
    const featureResponse = deferred<Response>();
    harness.sessionFetch.mockImplementationOnce(async () => featureResponse.promise);

    const request = harness.coordinator.requestAuthenticatedApi({ path: 'srs/stats' });
    await vi.waitFor(() => expect(harness.sessionFetch).toHaveBeenCalledTimes(2));
    await expect(harness.coordinator.retryCurrentOperation()).resolves.toBeUndefined();
    await expect(harness.coordinator.signOut()).resolves.toBeUndefined();
    await expect(harness.coordinator.dispose()).resolves.toBeUndefined();
    featureResponse.resolve(response(200, {}));
    await expect(request).resolves.toMatchObject({ status: 200 });
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
        refresh_token: 'SECRET-refresh-token',
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

    expect(harness.app.removeCalls).toBe(2);
    expect(harness.browser.removeCalls).toBe(1);
    expect(harness.preferences.value).not.toBeNull();
    expect(harness.coordinator.state).toEqual({
      phase: 'signedOut',
      operation: 'idle',
      sessionUsable: false,
      errorCode: null,
      retryAction: null,
      notice: null,
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

    expect(harness.app.removeCalls).toBe(2);
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

  it('never logs or exposes installation or Keychain failure sentinels', async () => {
    const spies = (['debug', 'info', 'log', 'warn', 'error'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const cleanupHarness = makeHarness();
    cleanupHarness.installationStore.marked = false;
    cleanupHarness.sessionStore.clearFailure = new Error('SECRET-cleanup-object');
    const persistenceHarness = makeHarness();
    await persistenceHarness.persist(activeTransaction);
    persistenceHarness.prepareSuccessfulExchange(activeTransaction);
    persistenceHarness.sessionStore.saveFailure = new Error('SECRET-persistence-object');

    await cleanupHarness.coordinator.initialize();
    await persistenceHarness.coordinator.initialize();
    await persistenceHarness.coordinator.completeCallback(callback(activeTransaction));

    const output = spies.flatMap((spy) => spy.mock.calls.flat()).join(' ');
    expect(output).not.toMatch(/SECRET-cleanup|SECRET-persistence/u);
    expect(snapshot(cleanupHarness.coordinator.state)).not.toMatch(/SECRET/u);
    expect(snapshot(persistenceHarness.coordinator.state)).not.toMatch(/SECRET/u);
    for (const spy of spies) {
      spy.mockRestore();
    }
  });
});

describe('cross-boundary secret leakage regressions', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('rejects a Preferences write with callback, claim, and raw transport fields outside the transaction schema', () => {
    const transactionWithRogueFields = JSON.stringify({
      ...securityTransaction,
      callbackCode: 'SECRET-callback-code',
      decodedClaimEmail: 'SECRET-claim-email',
      rawRequest: 'SECRET-raw-request',
      rawResponse: 'SECRET-raw-response',
    });

    expect(() =>
      expectNoSecretLeak({
        consoleCalls: [],
        preferenceCalls: [
          [
            {
              key: MOBILE_OAUTH_TRANSACTION_KEY,
              value: transactionWithRogueFields,
            },
          ],
        ],
        renderedText: '',
      }),
    ).toThrow();
  });

  it('rejects unenumerated native removal failures from captured logs and errors', () => {
    expect(() =>
      expectNoSecretLeak({
        consoleCalls: [
          [new Error('SECRET-app-remove-failure')],
          [{ cause: 'SECRET-browser-remove-failure' }],
        ],
        preferenceCalls: [],
        renderedText: '',
      }),
    ).toThrow();
  });

  it('rejects raw transport values from browser storage', () => {
    window.localStorage.setItem('rogue-request', 'SECRET-raw-request');
    window.sessionStorage.setItem('rogue-response', 'SECRET-raw-response');

    expect(() =>
      expectNoSecretLeak({
        consoleCalls: [],
        preferenceCalls: [],
        renderedText: '',
      }),
    ).toThrow();
  });

  it('rejects feature authorization and rejected-path sentinels from every presentation surface', () => {
    expect(() =>
      expectNoSecretLeak({
        consoleCalls: [],
        preferenceCalls: [],
        errorMessages: ['Bearer SECRET-caller-authorization'],
        jsonSnapshots: [JSON.stringify({ path: 'https://evil.example/SECRET-rejected-path' })],
        renderedText: '',
      }),
    ).toThrow();
  });

  it('allows only the exact token-free transaction and installation-marker Preferences schemas', () => {
    expect(() =>
      expectNoSecretLeak({
        consoleCalls: [],
        preferenceCalls: [
          [
            {
              key: MOBILE_OAUTH_TRANSACTION_KEY,
              value: JSON.stringify(securityTransaction),
            },
          ],
          [
            {
              key: createMobileInstallationKey(config),
              value: '1',
            },
          ],
        ],
        renderedText: '',
      }),
    ).not.toThrow();
  });

  it('keeps callback-success credentials, claims, URL, code, verifier, and nonce out of logs and non-secure storage', async () => {
    const consoleCapture = captureConsoleCalls();
    const harness = makeHarness({ isDevelopment: true });
    await harness.persist(securityTransaction);
    prepareSentinelExchange(harness);
    harness.sessionFetch.mockResolvedValueOnce(
      response(200, {
        authenticated: true,
        user: { userId: 'user-123', email: 'SECRET-claim-email' },
      }),
    );
    await harness.coordinator.initialize();

    await harness.coordinator.completeCallback(
      callback(securityTransaction, 'SECRET-callback-code'),
    );

    expect(harness.coordinator.state).toMatchObject({
      phase: 'authenticated',
      sessionUsable: true,
    });
    expectHarnessHasNoSecretLeak(harness, consoleCapture.calls());
  });

  it('sanitizes callback failures containing request, response, token, and native exception sentinels', async () => {
    const consoleCapture = captureConsoleCalls();
    const harness = makeHarness({ isDevelopment: true });
    await harness.persist(securityTransaction);
    harness.tokenTransport.failure = Object.assign(
      new Error(
        [
          'SECRET-callback-code',
          'SECRET-code-verifier',
          'SECRET-nonce',
          'SECRET-access-token',
          'SECRET-id-token',
          'SECRET-refresh-token',
          'SECRET-authorization-url',
          'SECRET-claim-email',
        ].join(' '),
      ),
      { rawResponse: 'SECRET-rotated-refresh-token' },
    );
    await harness.coordinator.initialize();

    await harness.coordinator.completeCallback(
      callback(securityTransaction, 'SECRET-callback-code'),
    );

    expect(harness.coordinator.state).toMatchObject({
      phase: 'error',
      errorCode: 'code_exchange_failed',
    });
    expectHarnessHasNoSecretLeak(harness, consoleCapture.calls());
  });

  it('keeps cold-restore credentials and decoded claims out of logs and non-secure storage', async () => {
    const consoleCapture = captureConsoleCalls();
    const harness = makeHarness({ isDevelopment: true });
    harness.sessionStore.refreshToken = 'SECRET-refresh-token';
    prepareSentinelRefresh(harness);
    harness.sessionFetch.mockResolvedValueOnce(
      response(200, {
        authenticated: true,
        user: { userId: 'user-123', email: 'SECRET-claim-email' },
      }),
    );

    await harness.coordinator.initialize();

    expect(harness.coordinator.state).toMatchObject({
      phase: 'authenticated',
      sessionUsable: true,
    });
    expectHarnessHasNoSecretLeak(harness, consoleCapture.calls());
  });

  it('keeps soft-refresh credentials and decoded claims out of logs and non-secure storage', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const consoleCapture = captureConsoleCalls();
    const harness = makeHarness({ isDevelopment: true, now: () => Date.now() });
    await harness.persist(securityTransaction);
    harness.tokenTransport.result = {
      status: 200,
      data: {
        access_token: 'SECRET-access-token',
        id_token: idToken(
          securityTransaction,
          { email: 'SECRET-claim-email', exp: 10_000 },
          'SECRET-id-token',
        ),
        refresh_token: 'SECRET-refresh-token',
        expires_in: 61,
      },
    };
    await harness.coordinator.initialize();
    await harness.coordinator.completeCallback(
      callback(securityTransaction, 'SECRET-callback-code'),
    );
    prepareSentinelRefresh(harness);
    harness.sessionFetch.mockResolvedValueOnce(
      response(200, {
        authenticated: true,
        user: { userId: 'user-123', email: 'SECRET-claim-email' },
      }),
    );

    await vi.advanceTimersByTimeAsync(1_000);

    expect(refreshRequests(harness)).toHaveLength(1);
    expect(harness.coordinator.state.sessionUsable).toBe(true);
    expectHarnessHasNoSecretLeak(harness, consoleCapture.calls());
  });

  it('sanitizes a rotated-token save failure without writing the candidate to Preferences or browser storage', async () => {
    const consoleCapture = captureConsoleCalls();
    const harness = makeHarness({ isDevelopment: true });
    harness.sessionStore.refreshToken = 'SECRET-refresh-token';
    prepareSentinelRefresh(harness, { rotated: true });
    harness.sessionStore.saveFailure = Object.assign(
      new Error('SECRET-rotated-refresh-token SECRET-id-token SECRET-claim-email'),
      { request: 'SECRET-access-token', response: 'SECRET-refresh-token' },
    );

    await harness.coordinator.initialize();

    expect(harness.coordinator.state).toMatchObject({
      errorCode: 'session_persistence_failed',
      retryAction: 'persist',
      sessionUsable: false,
    });
    expectHarnessHasNoSecretLeak(harness, consoleCapture.calls());
  });

  it('sanitizes an API rejection and clears its durable callback credential', async () => {
    const consoleCapture = captureConsoleCalls();
    const harness = makeHarness({ isDevelopment: true });
    await harness.persist(securityTransaction);
    prepareSentinelExchange(harness);
    harness.sessionFetch.mockResolvedValueOnce(
      response(401, {
        request: 'SECRET-access-token',
        idToken: 'SECRET-id-token',
        refreshToken: 'SECRET-refresh-token',
        rotatedRefreshToken: 'SECRET-rotated-refresh-token',
        email: 'SECRET-claim-email',
      }),
    );
    await harness.coordinator.initialize();

    await harness.coordinator.completeCallback(
      callback(securityTransaction, 'SECRET-callback-code'),
    );

    expect(harness.sessionStore.refreshToken).toBeNull();
    expect(harness.coordinator.state).toMatchObject({
      phase: 'signedOut',
      sessionUsable: false,
      notice: 'session_unusable',
    });
    expectHarnessHasNoSecretLeak(harness, consoleCapture.calls());
  });

  it('keeps start-over cleanup from exposing retained credentials or a raw state tuple', async () => {
    const consoleCapture = captureConsoleCalls();
    const harness = makeHarness({ isDevelopment: true });
    harness.sessionStore.refreshToken = 'SECRET-refresh-token';
    harness.tokenTransport.failure = Object.assign(
      new Error('SECRET-access-token SECRET-id-token SECRET-refresh-token'),
      {
        authorizationUrl: 'SECRET-authorization-url',
        code: 'SECRET-callback-code',
        verifier: 'SECRET-code-verifier',
        nonce: 'SECRET-nonce',
        email: 'SECRET-claim-email',
      },
    );
    await harness.persist(securityTransaction);
    await harness.coordinator.initialize();
    expect(harness.coordinator.state.retryAction).toBe('restore');

    await harness.coordinator.signOut();

    expect(harness.coordinator.state).toMatchObject({
      phase: 'signedOut',
      sessionUsable: false,
      errorCode: null,
      retryAction: null,
      notice: null,
    });
    expectHarnessHasNoSecretLeak(harness, consoleCapture.calls());
  });

  it('sanitizes cleanup failure while preserving the exact incomplete-cleanup gate state', async () => {
    const consoleCapture = captureConsoleCalls();
    const harness = makeHarness({ isDevelopment: true });
    await harness.persist(securityTransaction);
    prepareSentinelExchange(harness);
    await harness.coordinator.initialize();
    await harness.coordinator.completeCallback(
      callback(securityTransaction, 'SECRET-callback-code'),
    );
    await harness.persist(securityTransaction);
    harness.sessionStore.clearFailure = Object.assign(
      new Error('SECRET-refresh-token SECRET-rotated-refresh-token'),
      {
        accessToken: 'SECRET-access-token',
        idToken: 'SECRET-id-token',
        authorizationUrl: 'SECRET-authorization-url',
        code: 'SECRET-callback-code',
        verifier: 'SECRET-code-verifier',
        nonce: 'SECRET-nonce',
        email: 'SECRET-claim-email',
      },
    );

    await harness.coordinator.signOut();

    expect(harness.coordinator.state).toEqual({
      phase: 'signedOut',
      operation: 'idle',
      sessionUsable: false,
      errorCode: 'session_cleanup_failed',
      retryAction: 'cleanup',
      notice: 'cleanup_incomplete',
      user: null,
    });
    expectHarnessHasNoSecretLeak(harness, consoleCapture.calls());
  });

  it('sanitizes disposal failures without deleting or exposing durable state', async () => {
    const consoleCapture = captureConsoleCalls();
    const harness = makeHarness({ isDevelopment: true });
    await harness.persist(securityTransaction);
    prepareSentinelExchange(harness);
    await harness.coordinator.initialize();
    await harness.coordinator.completeCallback(
      callback(securityTransaction, 'SECRET-callback-code'),
    );
    await harness.persist(securityTransaction);
    harness.app.failRemove = true;
    harness.browser.failRemove = true;

    await harness.coordinator.dispose();

    expect(harness.sessionStore.refreshToken).toBe('SECRET-refresh-token');
    expect(harness.preferences.value).not.toBeNull();
    expect(harness.coordinator.state).toEqual({
      phase: 'signedOut',
      operation: 'idle',
      sessionUsable: false,
      errorCode: null,
      retryAction: null,
      notice: null,
      user: null,
    });
    const disposalOutput = searchable(consoleCapture.calls());
    expect(disposalOutput).not.toContain('SECRET-app-remove-failure');
    expect(disposalOutput).not.toContain('SECRET-browser-remove-failure');
    expect(disposalOutput).not.toContain('SECRET-');
    expectHarnessHasNoSecretLeak(harness, consoleCapture.calls());
  });
});

describe('simulated process lifecycle persistence', () => {
  it('restores after process relaunch but clears on a new installation marker', async () => {
    const firstRelaunch = makeHarness();
    firstRelaunch.sessionStore.refreshToken = 'refresh-token';
    firstRelaunch.installationStore.marked = true;
    prepareSuccessfulRefresh(firstRelaunch, { subject: 'user-123' });

    await firstRelaunch.coordinator.initialize();

    expect(firstRelaunch.coordinator.state.sessionUsable).toBe(true);

    const reinstalled = makeHarness({
      sessionStore: firstRelaunch.sessionStore,
      installationStore: new FakeInstallationStore([]),
    });
    reinstalled.installationStore.marked = false;

    await reinstalled.coordinator.initialize();

    expect(firstRelaunch.sessionStore.clearCalls).toBe(1);
    expect(reinstalled.coordinator.state.phase).toBe('signedOut');
    expect(reinstalled.coordinator.state.sessionUsable).toBe(false);
  });

  it('keeps successful local sign-out durable across relaunch', async () => {
    const first = makeHarness();
    first.sessionStore.refreshToken = 'refresh-token';
    prepareSuccessfulRefresh(first);
    await first.coordinator.initialize();

    await first.coordinator.signOut();

    const relaunched = makeHarness({
      sessionStore: first.sessionStore,
      installationStore: first.installationStore,
    });
    await relaunched.coordinator.initialize();

    expect(relaunched.coordinator.state.phase).toBe('signedOut');
    expect(relaunched.tokenTransport.requests).toHaveLength(0);
  });

  it('restores after relaunch when secure sign-out cleanup was incomplete', async () => {
    const first = makeHarness();
    first.sessionStore.refreshToken = 'refresh-token';
    prepareSuccessfulRefresh(first);
    await first.coordinator.initialize();
    first.sessionStore.clearFailure = new Error('SECRET-delete-failure');

    await first.coordinator.signOut();

    expect(first.coordinator.state.notice).toBe('cleanup_incomplete');

    first.sessionStore.clearFailure = undefined;
    const relaunched = makeHarness({
      sessionStore: first.sessionStore,
      installationStore: first.installationStore,
    });
    prepareSuccessfulRefresh(relaunched);

    await relaunched.coordinator.initialize();

    expect(relaunched.coordinator.state.sessionUsable).toBe(true);
  });
});

describe('disposal race boundaries', () => {
  it('stops initialization before storage when disposal begins during listener attachment', async () => {
    const listener = deferred<void>();
    const harness = makeHarness();
    harness.app.addGate = listener.promise;

    const initializing = harness.coordinator.initialize();
    await vi.waitFor(() => expect(harness.order).toContain('app:add:appUrlOpen'));
    const disposing = harness.coordinator.dispose();
    listener.resolve();
    await Promise.all([initializing, disposing]);

    expect(harness.installationStore.readCalls).toBe(0);
    expect(harness.sessionStore.clearCalls).toBe(0);
    expect(harness.app.removeCalls).toBe(2);
    expect(harness.browser.removeCalls).toBe(1);
    expect(harness.coordinator.state.phase).toBe('signedOut');
  });

  it('stops initialization before cold-launch handling when disposal begins during marker read', async () => {
    const markerRead = deferred<void>();
    const harness = makeHarness();
    harness.installationStore.readGate = markerRead.promise;

    const initializing = harness.coordinator.initialize();
    await vi.waitFor(() => expect(harness.installationStore.readCalls).toBe(1));
    const disposing = harness.coordinator.dispose();
    markerRead.resolve();
    await Promise.all([initializing, disposing]);

    expect(harness.order).not.toContain('app:getLaunchUrl');
    expect(harness.tokenTransport.requests).toHaveLength(0);
    expect(harness.coordinator.state.phase).toBe('signedOut');
  });

  it('does not mark an installation when disposal begins during first-install Keychain cleanup', async () => {
    const keychainClear = deferred<void>();
    const harness = makeHarness();
    harness.installationStore.marked = false;
    harness.sessionStore.clearGate = keychainClear.promise;

    const initializing = harness.coordinator.initialize();
    await vi.waitFor(() => expect(harness.sessionStore.clearCalls).toBe(1));
    const disposing = harness.coordinator.dispose();
    keychainClear.resolve();
    await Promise.all([initializing, disposing]);

    expect(harness.installationStore.markCalls).toBe(0);
    expect(harness.order).not.toContain('app:getLaunchUrl');
    expect(harness.coordinator.state.phase).toBe('signedOut');
  });

  it('stops cold initialization when disposal begins during transaction discovery', async () => {
    const transactionRead = deferred<void>();
    const harness = makeHarness();
    harness.preferences.getGate = transactionRead.promise;

    const initializing = harness.coordinator.initialize();
    await vi.waitFor(() => expect(harness.preferences.calls).toContain('preferences:get'));
    const disposing = harness.coordinator.dispose();
    transactionRead.resolve();
    await Promise.all([initializing, disposing]);

    expect(harness.tokenTransport.requests).toHaveLength(0);
    expect(harness.coordinator.state.phase).toBe('signedOut');
  });

  it('does not exchange a callback when disposal begins while its browser is closing', async () => {
    const browserClose = deferred<void>();
    const harness = makeHarness();
    await harness.persist(activeTransaction);
    await harness.coordinator.initialize();
    harness.browser.closeGate = browserClose.promise;

    const completing = harness.coordinator.completeCallback(callback(activeTransaction));
    await vi.waitFor(() => expect(harness.browser.closeCalls).toBe(1));
    const disposing = harness.coordinator.dispose();
    browserClose.resolve();
    await Promise.all([completing, disposing]);

    expect(harness.tokenTransport.requests).toHaveLength(0);
    expect(harness.preferences.value).not.toBeNull();
    expect(harness.coordinator.state.phase).toBe('signedOut');
  });

  it('does not accept a callback response when disposal begins during token exchange', async () => {
    const tokenResponse = deferred<{ status: number; data: unknown }>();
    const harness = makeHarness();
    await harness.persist(activeTransaction);
    await harness.coordinator.initialize();
    harness.tokenTransport.gate = tokenResponse.promise;

    const completing = harness.coordinator.completeCallback(callback(activeTransaction));
    await vi.waitFor(() => expect(harness.tokenTransport.requests).toHaveLength(1));
    const disposing = harness.coordinator.dispose();
    tokenResponse.resolve({
      status: 200,
      data: {
        access_token: 'SECRET-access-token',
        id_token: idToken(activeTransaction),
        refresh_token: 'SECRET-refresh-token',
        expires_in: 3_600,
      },
    });
    await Promise.all([completing, disposing]);

    expect(harness.sessionStore.saveAttempts).toEqual([]);
    expect(harness.preferences.value).not.toBeNull();
    expect(harness.coordinator.state.phase).toBe('signedOut');
  });

  it('does not promote a callback candidate when disposal begins during durable persistence', async () => {
    const persistence = deferred<void>();
    const harness = makeHarness();
    await harness.persist(activeTransaction);
    harness.prepareSuccessfulExchange(activeTransaction);
    harness.sessionStore.saveGate = persistence.promise;
    await harness.coordinator.initialize();

    const completing = harness.coordinator.completeCallback(callback(activeTransaction));
    await vi.waitFor(() =>
      expect(harness.sessionStore.saveAttempts).toEqual(['SECRET-refresh-token']),
    );
    const disposing = harness.coordinator.dispose();
    persistence.resolve();
    await Promise.all([completing, disposing]);

    expect(harness.sessionFetch).not.toHaveBeenCalled();
    expect(harness.sessionStore.refreshToken).toBe('SECRET-refresh-token');
    expect(harness.coordinator.state.phase).toBe('signedOut');
  });

  it('does not promote a callback candidate when disposal begins during API fetch', async () => {
    const sessionResponse = deferred<Response>();
    const harness = makeHarness();
    await harness.persist(activeTransaction);
    harness.prepareSuccessfulExchange(activeTransaction);
    harness.sessionFetch.mockImplementationOnce(async () => sessionResponse.promise);
    await harness.coordinator.initialize();

    const completing = harness.coordinator.completeCallback(callback(activeTransaction));
    await vi.waitFor(() => expect(harness.sessionFetch).toHaveBeenCalledOnce());
    const disposing = harness.coordinator.dispose();
    sessionResponse.resolve(
      response(200, {
        authenticated: true,
        user: { userId: 'user-123', email: 'SECRET-claim-email' },
      }),
    );
    await Promise.all([completing, disposing]);

    expect(harness.sessionStore.refreshToken).toBe('SECRET-refresh-token');
    expect(harness.coordinator.state.phase).toBe('signedOut');
    expect(harness.coordinator.state.sessionUsable).toBe(false);
  });

  it('does not promote a callback candidate when disposal begins during API body parsing', async () => {
    const sessionBody = deferred<unknown>();
    const json = vi.fn(async () => sessionBody.promise);
    const harness = makeHarness();
    await harness.persist(activeTransaction);
    harness.prepareSuccessfulExchange(activeTransaction);
    harness.sessionFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json,
    } as unknown as Response);
    await harness.coordinator.initialize();

    const completing = harness.coordinator.completeCallback(callback(activeTransaction));
    await vi.waitFor(() => expect(json).toHaveBeenCalledOnce());
    const disposing = harness.coordinator.dispose();
    sessionBody.resolve({
      authenticated: true,
      user: { userId: 'user-123', email: 'SECRET-claim-email' },
    });
    await Promise.all([completing, disposing]);

    expect(harness.coordinator.state.phase).toBe('signedOut');
    expect(harness.coordinator.state.sessionUsable).toBe(false);
  });

  it('keeps the transaction durable when disposal begins during browser launch', async () => {
    const browserOpen = deferred<void>();
    const harness = makeHarness();
    harness.browser.openGate = browserOpen.promise;
    await harness.coordinator.initialize();

    const starting = harness.coordinator.startSignIn();
    await vi.waitFor(() => expect(harness.browser.openCalls).toHaveLength(1));
    const disposing = harness.coordinator.dispose();
    browserOpen.resolve();
    await Promise.all([starting, disposing]);

    expect(harness.preferences.value).not.toBeNull();
    expect(harness.coordinator.state.phase).toBe('signedOut');
  });

  it('does not launch the browser when disposal begins during transaction persistence', async () => {
    const transactionWrite = deferred<void>();
    const harness = makeHarness();
    harness.preferences.setGate = transactionWrite.promise;
    await harness.coordinator.initialize();

    const starting = harness.coordinator.startSignIn();
    await vi.waitFor(() => expect(harness.preferences.calls).toContain('preferences:set:start'));
    const disposing = harness.coordinator.dispose();
    transactionWrite.resolve();
    await Promise.all([starting, disposing]);

    expect(harness.preferences.value).not.toBeNull();
    expect(harness.browser.openCalls).toHaveLength(0);
    expect(harness.coordinator.state.phase).toBe('signedOut');
  });
});

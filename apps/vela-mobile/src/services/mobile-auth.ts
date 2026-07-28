import { reactive, readonly, type InjectionKey } from 'vue';
import {
  MOBILE_OAUTH_CALLBACK_URI,
  type MobileAppAdapter,
  type MobileAuthCoordinator,
  type MobileAuthErrorCode,
  type MobileAuthState,
  type MobileBrowserAdapter,
  type MobileOAuthConfig,
  type MobileTokenTransportAdapter,
  type OAuthTokenBundle,
} from '../auth/mobile-auth-contract';
import {
  buildAuthorizationUrl,
  buildTokenRequest,
  createOAuthTransaction,
  createPkceChallenge,
  hasOAuthCryptoCapabilities,
  parseOAuthCallback,
  parseTokenResponse,
  validateIdTokenClaims,
} from '../auth/mobile-oauth';
import type { OAuthTransactionStore } from '../auth/oauth-transaction-store';

type ListenerHandle = {
  remove(): Promise<void>;
};

export type MobileAuthCoordinatorDependencies = {
  app: MobileAppAdapter;
  browser: MobileBrowserAdapter;
  transactionStore: OAuthTransactionStore;
  tokenTransport: MobileTokenTransportAdapter;
  crypto: Crypto | undefined;
  isSecureContext: boolean;
  fetch: typeof fetch;
  now: () => number;
  config: MobileOAuthConfig;
  isDevelopment?: boolean;
};

export const MOBILE_AUTH_KEY: InjectionKey<MobileAuthCoordinator> = Symbol('mobile-auth');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasValidConfig(config: MobileOAuthConfig): boolean {
  if (
    !config.apiUrl ||
    !config.userPoolId ||
    !config.mobileClientId ||
    !config.oauthDomain ||
    !config.region ||
    config.callbackUri !== MOBILE_OAUTH_CALLBACK_URI
  ) {
    return false;
  }

  try {
    const apiUrl = new URL(config.apiUrl);
    const oauthUrl = new URL(`https://${config.oauthDomain}`);
    return (
      (apiUrl.protocol === 'http:' || apiUrl.protocol === 'https:') &&
      apiUrl.hostname.length > 0 &&
      oauthUrl.hostname.toLowerCase() === config.oauthDomain.toLowerCase() &&
      oauthUrl.username === '' &&
      oauthUrl.password === '' &&
      oauthUrl.port === '' &&
      oauthUrl.pathname === '/' &&
      oauthUrl.search === '' &&
      oauthUrl.hash === '' &&
      config.userPoolId.startsWith(`${config.region}_`) &&
      !/\s/u.test(config.mobileClientId) &&
      !/\s/u.test(config.region)
    );
  } catch {
    return false;
  }
}

function parseTransportData(data: unknown): unknown {
  if (typeof data !== 'string') {
    return data;
  }
  return JSON.parse(data);
}

function parseSessionUser(value: unknown): { userId: string; email: string | null } | null {
  if (!isRecord(value) || value.authenticated !== true || !isRecord(value.user)) {
    return null;
  }

  const { userId, email } = value.user;
  if (
    typeof userId !== 'string' ||
    userId.length === 0 ||
    (typeof email !== 'string' && email !== null)
  ) {
    return null;
  }

  return { userId, email };
}

function sessionUrl(apiUrl: string): string {
  return `${apiUrl.replace(/\/+$/u, '')}/auth/session`;
}

export function createMobileAuthCoordinator(
  dependencies: MobileAuthCoordinatorDependencies,
): MobileAuthCoordinator {
  const state = reactive<MobileAuthState>({
    phase: 'initializing',
    errorCode: null,
    user: null,
  });
  const publicState = readonly(state) as Readonly<MobileAuthState>;

  let operationTail = Promise.resolve();
  let appUrlHandle: ListenerHandle | undefined;
  let browserFinishedHandle: ListenerHandle | undefined;
  let tokenBundle: OAuthTokenBundle | undefined;
  let initialized = false;
  let disposed = false;

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = operationTail.then(operation, operation);
    operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function setPhase(phase: MobileAuthState['phase']): void {
    state.phase = phase;
    state.errorCode = null;
    if (phase !== 'authenticated') {
      state.user = null;
    }
  }

  function setError(errorCode: MobileAuthErrorCode): void {
    state.phase = 'error';
    state.errorCode = errorCode;
    state.user = null;
  }

  function setAuthenticated(user: { userId: string; email: string | null }): void {
    state.phase = 'authenticated';
    state.errorCode = null;
    state.user = user;
  }

  async function removeListener(handle: ListenerHandle | undefined): Promise<void> {
    try {
      await handle?.remove();
    } catch {
      // Listener teardown is best effort and must never expose plugin errors.
    }
  }

  async function clearTransaction(): Promise<void> {
    try {
      await dependencies.transactionStore.clear();
    } catch {
      // The public error remains stable even when native cleanup is unavailable.
    }
  }

  async function failCallback(errorCode: MobileAuthErrorCode): Promise<void> {
    tokenBundle = undefined;
    await clearTransaction();
    setError(errorCode);
  }

  async function closeBrowser(): Promise<void> {
    try {
      await dependencies.browser.close();
    } catch {
      // A callback is authoritative even if SFSafariViewController cannot close.
    }
  }

  async function verifySessionUnlocked(): Promise<void> {
    const bundle = tokenBundle;
    if (!bundle || disposed) {
      return;
    }

    setPhase('verifyingSession');

    let response: Response;
    try {
      response = await dependencies.fetch(sessionUrl(dependencies.config.apiUrl), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${bundle.idToken}`,
        },
      });
    } catch {
      setError('session_verification_failed');
      return;
    }

    if (response.status === 401 || response.status === 403) {
      tokenBundle = undefined;
      setError('session_unauthorized');
      return;
    }

    if (!response.ok) {
      setError('session_verification_failed');
      return;
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      setError('session_verification_failed');
      return;
    }

    const user = parseSessionUser(data);
    if (!user) {
      setError('session_verification_failed');
      return;
    }

    setAuthenticated(user);
  }

  async function completeCallbackUnlocked(rawUrl: string): Promise<void> {
    if (disposed || state.phase === 'authenticated' || tokenBundle) {
      return;
    }

    const parsed = parseOAuthCallback(rawUrl);
    if (parsed.kind === 'unrelated') {
      return;
    }

    setPhase('exchangingCode');
    await closeBrowser();

    if (parsed.kind === 'malformed') {
      await failCallback('malformed_callback');
      return;
    }

    let loaded: Awaited<ReturnType<OAuthTransactionStore['load']>>;
    try {
      loaded = await dependencies.transactionStore.load();
    } catch {
      await failCallback('interrupted');
      return;
    }

    if (loaded.kind === 'missing' || loaded.kind === 'corrupt') {
      await failCallback('interrupted');
      return;
    }
    if (loaded.kind === 'expired') {
      await failCallback('transaction_expired');
      return;
    }

    const { transaction } = loaded;
    if (parsed.state !== transaction.state) {
      await failCallback('state_mismatch');
      return;
    }

    if (parsed.kind === 'providerError') {
      await failCallback(parsed.error === 'access_denied' ? 'cancelled' : 'provider_error');
      return;
    }

    let bundle: OAuthTokenBundle;
    try {
      const response = await dependencies.tokenTransport.request(
        buildTokenRequest(dependencies.config, transaction, parsed.code),
      );
      if (response.status < 200 || response.status >= 300) {
        throw new Error('token_endpoint_rejected');
      }
      bundle = parseTokenResponse(parseTransportData(response.data), dependencies.now());
    } catch {
      await failCallback('code_exchange_failed');
      return;
    }

    try {
      validateIdTokenClaims(bundle.idToken, {
        config: dependencies.config,
        transaction,
        now: dependencies.now(),
      });
    } catch {
      await failCallback('token_validation_failed');
      return;
    }

    tokenBundle = bundle;
    try {
      await dependencies.transactionStore.clear();
    } catch {
      tokenBundle = undefined;
      setError('code_exchange_failed');
      return;
    }

    await verifySessionUnlocked();
  }

  async function resumeStoredTransactionUnlocked(): Promise<void> {
    let loaded: Awaited<ReturnType<OAuthTransactionStore['load']>>;
    try {
      loaded = await dependencies.transactionStore.load();
    } catch {
      setError('configuration_error');
      return;
    }

    if (loaded.kind === 'missing') {
      setPhase('signedOut');
      return;
    }
    if (loaded.kind === 'expired') {
      setError('transaction_expired');
      return;
    }
    if (loaded.kind === 'corrupt') {
      setError('interrupted');
      return;
    }
    setError('interrupted');
  }

  async function initializeUnlocked(): Promise<void> {
    if (disposed || initialized) {
      return;
    }
    initialized = true;
    setPhase('initializing');

    if (!hasValidConfig(dependencies.config)) {
      setError('configuration_error');
      return;
    }

    try {
      appUrlHandle = await dependencies.app.addListener('appUrlOpen', (event) => {
        void coordinator.completeCallback(event.url);
      });
      browserFinishedHandle = await dependencies.browser.addListener('browserFinished', () => {
        void serialize(handleBrowserFinishedUnlocked);
      });
      const launchUrl = await dependencies.app.getLaunchUrl();
      if (launchUrl && parseOAuthCallback(launchUrl.url).kind !== 'unrelated') {
        await completeCallbackUnlocked(launchUrl.url);
        return;
      }
    } catch {
      await removeListener(appUrlHandle);
      await removeListener(browserFinishedHandle);
      appUrlHandle = undefined;
      browserFinishedHandle = undefined;
      setError('configuration_error');
      return;
    }

    await resumeStoredTransactionUnlocked();
  }

  async function startSignInUnlocked(): Promise<void> {
    if (
      disposed ||
      state.phase === 'initializing' ||
      state.phase === 'openingBrowser' ||
      state.phase === 'awaitingCallback' ||
      state.phase === 'exchangingCode' ||
      state.phase === 'verifyingSession' ||
      state.phase === 'authenticated' ||
      (state.phase === 'error' &&
        (state.errorCode === 'configuration_error' ||
          state.errorCode === 'session_verification_failed'))
    ) {
      return;
    }

    if (
      !hasValidConfig(dependencies.config) ||
      !hasOAuthCryptoCapabilities(dependencies.crypto, dependencies.isSecureContext)
    ) {
      setError('configuration_error');
      return;
    }

    setPhase('openingBrowser');

    let authorizationUrl: string;
    try {
      const transaction = createOAuthTransaction(dependencies.crypto, dependencies.now());
      const challenge = await createPkceChallenge(transaction.codeVerifier, dependencies.crypto);
      authorizationUrl = buildAuthorizationUrl(dependencies.config, transaction, challenge);
      await dependencies.transactionStore.replace(transaction);
    } catch {
      setError('configuration_error');
      return;
    }

    try {
      await dependencies.browser.open({ url: authorizationUrl });
    } catch {
      await clearTransaction();
      setError('browser_launch_failed');
      return;
    }

    setPhase('awaitingCallback');
  }

  async function handleBrowserFinishedUnlocked(): Promise<void> {
    if (disposed || state.phase !== 'awaitingCallback') {
      return;
    }

    await clearTransaction();
    setError('cancelled');
    if (dependencies.isDevelopment ?? import.meta.env.DEV) {
      console.info('browser_closed_before_callback');
    }
  }

  async function retrySessionVerificationUnlocked(): Promise<void> {
    if (
      disposed ||
      state.phase !== 'error' ||
      state.errorCode !== 'session_verification_failed' ||
      !tokenBundle
    ) {
      return;
    }
    await verifySessionUnlocked();
  }

  async function disposeUnlocked(): Promise<void> {
    if (disposed) {
      return;
    }
    disposed = true;
    await removeListener(appUrlHandle);
    await removeListener(browserFinishedHandle);
    appUrlHandle = undefined;
    browserFinishedHandle = undefined;
    tokenBundle = undefined;
    state.phase = 'signedOut';
    state.errorCode = null;
    state.user = null;
  }

  const coordinator: MobileAuthCoordinator = {
    state: publicState,
    initialize: () => serialize(initializeUnlocked),
    startSignIn: () => serialize(startSignInUnlocked),
    completeCallback: (url) => serialize(() => completeCallbackUnlocked(url)),
    retrySessionVerification: () => serialize(retrySessionVerificationUnlocked),
    dispose: () => serialize(disposeUnlocked),
  };

  return coordinator;
}

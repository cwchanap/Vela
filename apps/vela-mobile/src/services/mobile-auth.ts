import { reactive, readonly, type InjectionKey } from 'vue';
import {
  MOBILE_OAUTH_CALLBACK_URI,
  assertMobileAuthState,
  type AuthorizationCodeTokenBundle,
  type MobileAppAdapter,
  type MobileAuthCoordinator,
  type MobileAuthErrorCode,
  type MobileAuthNotice,
  type MobileAuthOperation,
  type MobileAuthPhase,
  type MobileAuthRetryAction,
  type MobileAuthState,
  type MobileAuthUser,
  type MobileBrowserAdapter,
  type MobileOAuthConfig,
  type MobileTokenTransportAdapter,
} from '../auth/mobile-auth-contract';
import {
  containsWhitespace,
  hasMatchingUserPoolRegion,
  isValidHostOnlyDomain,
} from '../auth/config-validators';
import {
  buildAuthorizationUrl,
  buildAuthorizationCodeTokenRequest,
  createOAuthTransaction,
  createPkceChallenge,
  hasOAuthCryptoCapabilities,
  parseOAuthCallback,
  parseAuthorizationCodeTokenResponse,
  validateAuthorizationCodeIdTokenClaims,
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

/**
 * Upper bound for the token-exchange and session-verification network calls.
 * A hung request would otherwise leave the coordinator pinned in
 * `exchangingCode` or `verifyingSession`; the timeout routes both operations
 * back through their existing failure paths so the user can retry.
 */
export const MOBILE_AUTH_NETWORK_TIMEOUT_MS = 15_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Hostnames that are safe to contact over plain `http:` from the coordinator.
 * The coordinator sends a bearer id-token to the API; allowing non-loopback
 * HTTP would leak that token on the wire. Loopback is the only HTTP surface
 * permitted, and only in development builds.
 */
function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (normalized === 'localhost' || normalized === '::1') {
    return true;
  }
  const parts = normalized.split('.');
  return parts.length === 4 && parts[0] === '127' && parts.every((part) => /^\d{1,3}$/u.test(part));
}

function hasValidConfig(config: MobileOAuthConfig, isDevelopment: boolean): boolean {
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
    if (apiUrl.hostname.length === 0) {
      return false;
    }
    // HTTPS is always permitted under the hostname rules below. Plain HTTP is
    // rejected by default because the coordinator bearer token would travel in
    // cleartext; only dev builds targeting a loopback address may use it.
    if (apiUrl.protocol === 'http:') {
      if (!isDevelopment || !isLoopbackHostname(apiUrl.hostname)) {
        return false;
      }
    } else if (apiUrl.protocol !== 'https:') {
      return false;
    }

    return (
      isValidHostOnlyDomain(config.oauthDomain) &&
      hasMatchingUserPoolRegion(config.userPoolId, config.region) &&
      !containsWhitespace(config.userPoolId) &&
      !containsWhitespace(config.mobileClientId) &&
      !containsWhitespace(config.region)
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
    operation: 'idle',
    sessionUsable: false,
    errorCode: null,
    retryAction: null,
    notice: null,
    user: null,
  });
  const publicState = readonly(state) as Readonly<MobileAuthState>;

  let operationTail = Promise.resolve();
  let appUrlHandle: ListenerHandle | undefined;
  let browserFinishedHandle: ListenerHandle | undefined;
  let tokenBundle: AuthorizationCodeTokenBundle | undefined;
  let initialized = false;
  let disposed = false;
  const isDevelopment = dependencies.isDevelopment ?? import.meta.env.DEV;

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = operationTail.then(operation, operation);
    operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function applyState(next: MobileAuthState): void {
    assertMobileAuthState(next, {
      activeBundle: tokenBundle ?? null,
      now: dependencies.now(),
    });
    Object.assign(state, next);
  }

  const transitions = {
    enterOAuthProgress(phase: MobileAuthPhase): void {
      applyState({
        phase,
        operation: 'idle',
        sessionUsable: false,
        errorCode: null,
        retryAction: null,
        notice: null,
        user: null,
      });
    },

    enterOAuthError(errorCode: MobileAuthErrorCode): void {
      applyState({
        phase: 'error',
        operation: 'idle',
        sessionUsable: false,
        errorCode,
        retryAction: null,
        notice: null,
        user: null,
      });
    },

    enterAuthenticated(user: MobileAuthUser): void {
      applyState({
        phase: 'authenticated',
        operation: 'idle',
        sessionUsable: true,
        errorCode: null,
        retryAction: null,
        notice: null,
        user,
      });
    },

    enterSignedOut(notice: Extract<MobileAuthNotice, 'session_unusable' | null> = null): void {
      applyState({
        phase: 'signedOut',
        operation: 'idle',
        sessionUsable: false,
        errorCode: null,
        retryAction: null,
        notice,
        user: null,
      });
    },

    enterSessionFailure(options: {
      phase: MobileAuthPhase;
      sessionUsable: boolean;
      errorCode: MobileAuthErrorCode;
      retryAction: MobileAuthRetryAction | null;
      user: MobileAuthUser | null;
    }): void {
      applyState({
        phase: options.phase,
        operation: 'idle',
        sessionUsable: options.sessionUsable,
        errorCode: options.errorCode,
        retryAction: options.retryAction,
        notice: null,
        user: options.user,
      });
    },

    enterOperation(options: {
      phase: MobileAuthPhase;
      operation: Exclude<MobileAuthOperation, 'idle'>;
      sessionUsable: boolean;
      notice: MobileAuthNotice;
      user: MobileAuthUser | null;
    }): void {
      applyState({
        phase: options.phase,
        operation: options.operation,
        sessionUsable: options.sessionUsable,
        errorCode: null,
        retryAction: null,
        notice: options.notice,
        user: options.user,
      });
    },

    enterTerminalNotice(): void {
      applyState({
        phase: 'signedOut',
        operation: 'idle',
        sessionUsable: false,
        errorCode: null,
        retryAction: null,
        notice: 'session_unusable',
        user: null,
      });
    },

    enterCleanupFailure(): void {
      applyState({
        phase: 'signedOut',
        operation: 'idle',
        sessionUsable: false,
        errorCode: 'session_cleanup_failed',
        retryAction: 'cleanup',
        notice: 'cleanup_incomplete',
        user: null,
      });
    },
  };

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
    transitions.enterOAuthError(errorCode);
    await clearTransaction();
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

    transitions.enterOAuthProgress('verifyingSession');

    // The timeout and AbortController must remain active until the response
    // body has been fully consumed. fetch() resolves as soon as the response
    // headers arrive; a server that sends headers but stalls or truncates the
    // body would otherwise leave response.json() hanging indefinitely, pinned
    // in `verifyingSession` and blocking both retry and a new sign-in.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MOBILE_AUTH_NETWORK_TIMEOUT_MS);
    try {
      let response: Response;
      try {
        response = await dependencies.fetch(sessionUrl(dependencies.config.apiUrl), {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${bundle.idToken}`,
          },
          signal: controller.signal,
        });
      } catch {
        transitions.enterSessionFailure({
          phase: 'error',
          sessionUsable: false,
          errorCode: 'session_verification_failed',
          retryAction: null,
          user: null,
        });
        return;
      }

      if (response.status === 401 || response.status === 403) {
        tokenBundle = undefined;
        transitions.enterOAuthError('session_unauthorized');
        return;
      }

      if (!response.ok) {
        transitions.enterSessionFailure({
          phase: 'error',
          sessionUsable: false,
          errorCode: 'session_verification_failed',
          retryAction: null,
          user: null,
        });
        return;
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        transitions.enterSessionFailure({
          phase: 'error',
          sessionUsable: false,
          errorCode: 'session_verification_failed',
          retryAction: null,
          user: null,
        });
        return;
      }

      const user = parseSessionUser(data);
      if (!user) {
        transitions.enterSessionFailure({
          phase: 'error',
          sessionUsable: false,
          errorCode: 'session_verification_failed',
          retryAction: null,
          user: null,
        });
        return;
      }

      transitions.enterAuthenticated(user);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function completeCallbackUnlocked(rawUrl: string): Promise<boolean> {
    const isActiveCallbackPhase =
      state.phase === 'initializing' ||
      state.phase === 'openingBrowser' ||
      state.phase === 'awaitingCallback' ||
      (state.phase === 'error' && state.errorCode === 'interrupted');

    if (disposed || !initialized || tokenBundle || !isActiveCallbackPhase) {
      return false;
    }

    const parsed = parseOAuthCallback(rawUrl);
    if (parsed.kind === 'unrelated') {
      return false;
    }

    // Load the transaction and validate the callback state before closing the
    // browser or changing the phase. A stale callback (from an interrupted
    // transaction that was replaced) or an unsolicited callback (any external
    // caller capable of opening the custom URL scheme) would otherwise cancel
    // a valid in-progress sign-in: the old state mismatches the new
    // transaction, failCallback clears it, and the replacement flow is dead.
    // By validating first we preserve the current transaction, phase, and
    // browser session for the legitimate callback.
    let loaded: Awaited<ReturnType<OAuthTransactionStore['load']>>;
    try {
      loaded = await dependencies.transactionStore.load();
    } catch {
      transitions.enterOAuthProgress('exchangingCode');
      await closeBrowser();
      await failCallback('interrupted');
      return true;
    }

    if (loaded.kind === 'missing' || loaded.kind === 'corrupt') {
      transitions.enterOAuthProgress('exchangingCode');
      await closeBrowser();
      await failCallback(parsed.kind === 'malformed' ? 'malformed_callback' : 'interrupted');
      return true;
    }
    if (loaded.kind === 'expired') {
      transitions.enterOAuthProgress('exchangingCode');
      await closeBrowser();
      await failCallback('transaction_expired');
      return true;
    }

    const { transaction } = loaded;

    // The callback belongs to an older or unsolicited flow — ignore it
    // without touching the phase, browser, or stored transaction so the
    // current sign-in remains viable for the legitimate callback. Report
    // that the URL was not consumed so the cold-launch path can fall
    // through to resumeStoredTransactionUnlocked rather than stranding
    // the coordinator in `initializing`.
    if (parsed.kind === 'malformed' || parsed.state !== transaction.state) {
      return false;
    }

    transitions.enterOAuthProgress('exchangingCode');
    await closeBrowser();

    if (parsed.kind === 'providerError') {
      await failCallback(parsed.error === 'access_denied' ? 'cancelled' : 'provider_error');
      return true;
    }

    let response: { status: number; data: unknown };
    try {
      response = await dependencies.tokenTransport.request(
        buildAuthorizationCodeTokenRequest(dependencies.config, transaction, parsed.code, {
          timeoutMs: MOBILE_AUTH_NETWORK_TIMEOUT_MS,
        }),
      );
    } catch {
      await failCallback('code_exchange_failed');
      return true;
    }

    if (response.status < 200 || response.status >= 300) {
      await failCallback('code_exchange_failed');
      return true;
    }

    let bundle: AuthorizationCodeTokenBundle;
    try {
      bundle = parseAuthorizationCodeTokenResponse(
        parseTransportData(response.data),
        dependencies.now(),
      );
      validateAuthorizationCodeIdTokenClaims(bundle.idToken, {
        config: dependencies.config,
        transaction,
        now: dependencies.now(),
      });
    } catch {
      await failCallback('token_validation_failed');
      return true;
    }

    tokenBundle = bundle;
    // Best-effort cleanup: a clear failure does not invalidate the exchanged
    // tokens. The transaction is single-use (Cognito rejects a replayed
    // verifier), so a stale entry only affects the next launch's resume path.
    await clearTransaction();

    await verifySessionUnlocked();
    return true;
  }

  async function resumeStoredTransactionUnlocked(): Promise<void> {
    let loaded: Awaited<ReturnType<OAuthTransactionStore['load']>>;
    try {
      loaded = await dependencies.transactionStore.load();
    } catch {
      transitions.enterOAuthError('configuration_error');
      return;
    }

    if (loaded.kind === 'missing') {
      transitions.enterSignedOut();
      return;
    }
    if (loaded.kind === 'expired') {
      transitions.enterOAuthError('transaction_expired');
      return;
    }
    if (loaded.kind === 'corrupt') {
      transitions.enterOAuthError('interrupted');
      return;
    }
    transitions.enterOAuthError('interrupted');
  }

  async function initializeUnlocked(): Promise<void> {
    if (disposed || initialized) {
      return;
    }
    initialized = true;
    transitions.enterOAuthProgress('initializing');

    if (!hasValidConfig(dependencies.config, isDevelopment)) {
      transitions.enterOAuthError('configuration_error');
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
        const consumed = await completeCallbackUnlocked(launchUrl.url);
        if (consumed) {
          return;
        }
        // The callback was ignored (malformed or state mismatch) to
        // preserve an in-flight transaction. Fall through to
        // resumeStoredTransactionUnlocked so the coordinator leaves the
        // `initializing` phase instead of stranding the user with no
        // retry action.
      }
    } catch {
      await removeListener(appUrlHandle);
      await removeListener(browserFinishedHandle);
      appUrlHandle = undefined;
      browserFinishedHandle = undefined;
      transitions.enterOAuthError('configuration_error');
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
      !hasValidConfig(dependencies.config, isDevelopment) ||
      !hasOAuthCryptoCapabilities(dependencies.crypto, dependencies.isSecureContext)
    ) {
      transitions.enterOAuthError('configuration_error');
      return;
    }

    transitions.enterOAuthProgress('openingBrowser');

    let authorizationUrl: string;
    try {
      const transaction = createOAuthTransaction(dependencies.crypto, dependencies.now());
      const challenge = await createPkceChallenge(transaction.codeVerifier, dependencies.crypto);
      authorizationUrl = buildAuthorizationUrl(dependencies.config, transaction, challenge);
      await dependencies.transactionStore.replace(transaction);
    } catch {
      transitions.enterOAuthError('configuration_error');
      return;
    }

    try {
      await dependencies.browser.open({ url: authorizationUrl });
    } catch {
      await clearTransaction();
      transitions.enterOAuthError('browser_launch_failed');
      return;
    }

    transitions.enterOAuthProgress('awaitingCallback');
  }

  async function handleBrowserFinishedUnlocked(): Promise<void> {
    if (disposed || state.phase !== 'awaitingCallback') {
      return;
    }

    transitions.enterOAuthError('cancelled');
    await clearTransaction();
    if (isDevelopment) {
      console.info(
        'browser_closed_before_callback — verify the deployed Cognito client ID and redirect URI configuration.',
      );
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
    transitions.enterSignedOut();
  }

  const coordinator: MobileAuthCoordinator = {
    state: publicState,
    initialize: () => serialize(initializeUnlocked),
    startSignIn: () => serialize(startSignInUnlocked),
    completeCallback: (url) => serialize(() => completeCallbackUnlocked(url).then(() => undefined)),
    retrySessionVerification: () => serialize(retrySessionVerificationUnlocked),
    dispose: () => serialize(disposeUnlocked),
  };

  return coordinator;
}

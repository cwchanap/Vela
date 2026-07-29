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
  type OAuthTokenBundleBase,
} from '../auth/mobile-auth-contract';
import type { MobileInstallationStore } from '../auth/mobile-installation-store';
import { MobileSessionStoreError, type MobileSessionStore } from '../auth/mobile-session-store';
import {
  containsWhitespace,
  hasMatchingUserPoolRegion,
  isValidHostOnlyDomain,
} from '../auth/config-validators';
import {
  buildAuthorizationUrl,
  buildAuthorizationCodeTokenRequest,
  buildRefreshTokenRequest,
  createOAuthTransaction,
  createPkceChallenge,
  hasOAuthCryptoCapabilities,
  parseOAuthCallback,
  parseAuthorizationCodeTokenResponse,
  parseRefreshTokenResponse,
  validateAuthorizationCodeIdTokenClaims,
  validateRefreshedIdTokenClaims,
} from '../auth/mobile-oauth';
import type {
  LoadedOAuthTransaction,
  OAuthTransactionStore,
} from '../auth/oauth-transaction-store';

type ListenerHandle = {
  remove(): Promise<void>;
};

type PendingCandidate = {
  bundle: OAuthTokenBundleBase;
  durableRefreshToken: string;
  returnedRefreshToken?: string;
  context: 'authorizationCode' | 'restore' | 'refresh';
};

type ActiveSession = {
  bundle: OAuthTokenBundleBase & { refreshToken: string };
  user: MobileAuthUser;
};

type CleanupContext = { kind: 'terminalSession' } | { kind: 'installationReset' };

type SettledRefreshToken =
  | { kind: 'loaded'; refreshToken: string | null }
  | { kind: 'corrupt' }
  | { kind: 'unavailable' };

type SettledTransaction =
  | { kind: 'loaded'; transaction: LoadedOAuthTransaction }
  | { kind: 'unavailable' };

export type MobileAuthCoordinatorDependencies = {
  app: MobileAppAdapter;
  browser: MobileBrowserAdapter;
  transactionStore: OAuthTransactionStore;
  tokenTransport: MobileTokenTransportAdapter;
  sessionStore: MobileSessionStore;
  installationStore: MobileInstallationStore;
  isNativeIos: boolean;
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

const RESTARTABLE_OAUTH_ERRORS = new Set<MobileAuthErrorCode>([
  'browser_launch_failed',
  'cancelled',
  'interrupted',
  'transaction_expired',
  'malformed_callback',
  'provider_error',
  'code_exchange_failed',
  'token_validation_failed',
  'session_unauthorized',
]);

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
  let active: ActiveSession | undefined;
  let pendingCandidate: PendingCandidate | undefined;
  let pendingSubject: string | undefined;
  let restoreRefreshToken: string | undefined;
  let cleanupContext: CleanupContext | undefined;
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
      activeBundle: active?.bundle ?? null,
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

    enterRetryOperation(retryAction: MobileAuthRetryAction): void {
      const operationByAction: Record<
        MobileAuthRetryAction,
        Exclude<MobileAuthOperation, 'idle'>
      > = {
        restore: 'restoring',
        refresh: 'refreshing',
        persist: 'persisting',
        verify: 'verifying',
        cleanup: 'cleaningUp',
      };
      const phaseByAction: Record<MobileAuthRetryAction, MobileAuthPhase> = {
        restore: 'initializing',
        refresh: 'authenticated',
        persist: 'exchangingCode',
        verify: 'verifyingSession',
        cleanup: 'signedOut',
      };
      applyState({
        phase: phaseByAction[retryAction],
        operation: operationByAction[retryAction],
        sessionUsable: false,
        errorCode: null,
        retryAction: null,
        notice: null,
        user: retryAction === 'refresh' ? (active?.user ?? null) : null,
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
    active = undefined;
    pendingCandidate = undefined;
    pendingSubject = undefined;
    restoreRefreshToken = undefined;
    cleanupContext = undefined;
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

  async function terminalSessionCleanupUnlocked(): Promise<void> {
    active = undefined;
    pendingCandidate = undefined;
    pendingSubject = undefined;
    restoreRefreshToken = undefined;
    cleanupContext = { kind: 'terminalSession' };
    try {
      await dependencies.sessionStore.clearRefreshToken();
    } catch {
      transitions.enterCleanupFailure();
      return;
    }
    cleanupContext = undefined;
    transitions.enterTerminalNotice();
  }

  async function verifyCandidateSessionUnlocked(): Promise<void> {
    const candidate = pendingCandidate;
    if (!candidate || disposed) {
      return;
    }

    transitions.enterOperation({
      phase: 'verifyingSession',
      operation: 'verifying',
      sessionUsable: false,
      notice: null,
      user: null,
    });

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
            Authorization: `Bearer ${candidate.bundle.idToken}`,
          },
          signal: controller.signal,
        });
      } catch {
        transitions.enterSessionFailure({
          phase: 'error',
          sessionUsable: false,
          errorCode: 'session_verification_failed',
          retryAction: 'verify',
          user: null,
        });
        return;
      }

      if (response.status === 401 || response.status === 403) {
        await terminalSessionCleanupUnlocked();
        return;
      }

      if (!response.ok) {
        transitions.enterSessionFailure({
          phase: 'error',
          sessionUsable: false,
          errorCode: 'session_verification_failed',
          retryAction: 'verify',
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
          retryAction: 'verify',
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
          retryAction: 'verify',
          user: null,
        });
        return;
      }

      if (pendingSubject !== undefined && user.userId !== pendingSubject) {
        await terminalSessionCleanupUnlocked();
        return;
      }

      active = {
        bundle: {
          ...candidate.bundle,
          refreshToken: candidate.durableRefreshToken,
        },
        user,
      };
      pendingCandidate = undefined;
      pendingSubject = undefined;
      restoreRefreshToken = undefined;
      cleanupContext = undefined;
      transitions.enterAuthenticated(user);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function persistPendingCandidateUnlocked(): Promise<void> {
    const candidate = pendingCandidate;
    if (!candidate || disposed) {
      return;
    }

    const needsPersistence =
      candidate.context === 'authorizationCode' || candidate.returnedRefreshToken !== undefined;
    if (needsPersistence) {
      transitions.enterOperation({
        phase: 'exchangingCode',
        operation: 'persisting',
        sessionUsable: false,
        notice: null,
        user: null,
      });
      try {
        await dependencies.sessionStore.saveRefreshToken(candidate.durableRefreshToken);
      } catch {
        transitions.enterSessionFailure({
          phase: 'error',
          sessionUsable: false,
          errorCode: 'session_persistence_failed',
          retryAction: 'persist',
          user: null,
        });
        return;
      }

      if (candidate.context === 'authorizationCode') {
        // Only a durable refresh credential permits transaction removal. A
        // failed Preferences cleanup remains best effort because the exchanged
        // authorization code is single-use.
        await clearTransaction();
      }
    }

    await verifyCandidateSessionUnlocked();
  }

  async function completeCallbackUnlocked(
    rawUrl: string,
    loadedTransaction?: LoadedOAuthTransaction,
  ): Promise<boolean> {
    const isActiveCallbackPhase =
      state.phase === 'initializing' ||
      state.phase === 'openingBrowser' ||
      state.phase === 'awaitingCallback' ||
      (state.phase === 'error' && state.errorCode === 'interrupted');

    if (disposed || !initialized || active || pendingCandidate || !isActiveCallbackPhase) {
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
    let loaded = loadedTransaction;
    if (!loaded) {
      try {
        loaded = await dependencies.transactionStore.load();
      } catch {
        transitions.enterOAuthProgress('exchangingCode');
        await closeBrowser();
        await failCallback('interrupted');
        return true;
      }
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

    const { refreshToken, ...candidateBundle } = bundle;
    pendingCandidate = {
      bundle: candidateBundle,
      durableRefreshToken: refreshToken,
      context: 'authorizationCode',
    };
    pendingSubject = undefined;
    await persistPendingCandidateUnlocked();
    return true;
  }

  function classifyRefreshTokenLoad(
    result: PromiseSettledResult<string | null>,
  ): SettledRefreshToken {
    if (result.status === 'fulfilled') {
      return { kind: 'loaded', refreshToken: result.value };
    }
    if (result.reason instanceof MobileSessionStoreError && result.reason.code === 'corrupt') {
      return { kind: 'corrupt' };
    }
    return { kind: 'unavailable' };
  }

  async function loadRefreshTokenSettled(): Promise<SettledRefreshToken> {
    const [result] = await Promise.allSettled([dependencies.sessionStore.loadRefreshToken()]);
    return classifyRefreshTokenLoad(result!);
  }

  async function loadTransactionSettled(): Promise<SettledTransaction> {
    try {
      return { kind: 'loaded', transaction: await dependencies.transactionStore.load() };
    } catch {
      return { kind: 'unavailable' };
    }
  }

  function enterRefreshFailure(context: 'restore' | 'refresh'): void {
    transitions.enterSessionFailure({
      phase: 'error',
      sessionUsable: false,
      errorCode: context === 'restore' ? 'session_restore_failed' : 'session_refresh_failed',
      retryAction: context,
      user: null,
    });
  }

  function isTerminalRefreshStatus(status: number): boolean {
    return status === 400 || status === 401 || status === 403;
  }

  async function refreshCandidateUnlocked(
    refreshToken: string,
    context: 'restore' | 'refresh',
    expectedSubject?: string,
  ): Promise<void> {
    if (disposed) {
      return;
    }

    transitions.enterOperation({
      phase: context === 'restore' ? 'initializing' : 'authenticated',
      operation: context === 'restore' ? 'restoring' : 'refreshing',
      sessionUsable: false,
      notice: null,
      user: context === 'refresh' ? (active?.user ?? null) : null,
    });

    let response: { status: number; data: unknown };
    try {
      response = await dependencies.tokenTransport.request(
        buildRefreshTokenRequest(dependencies.config, refreshToken, {
          timeoutMs: MOBILE_AUTH_NETWORK_TIMEOUT_MS,
        }),
      );
    } catch {
      enterRefreshFailure(context);
      return;
    }

    if (response.status < 200 || response.status >= 300) {
      if (isTerminalRefreshStatus(response.status)) {
        await terminalSessionCleanupUnlocked();
      } else {
        enterRefreshFailure(context);
      }
      return;
    }

    try {
      const refreshed = parseRefreshTokenResponse(
        parseTransportData(response.data),
        dependencies.now(),
      );
      const subject = validateRefreshedIdTokenClaims(refreshed.idToken, {
        config: dependencies.config,
        now: dependencies.now(),
        ...(expectedSubject === undefined ? {} : { expectedSubject }),
      });
      const { refreshToken: returnedRefreshToken, ...bundle } = refreshed;
      pendingCandidate = {
        bundle,
        durableRefreshToken: returnedRefreshToken ?? refreshToken,
        ...(returnedRefreshToken === undefined ? {} : { returnedRefreshToken }),
        context,
      };
      pendingSubject = subject;
    } catch {
      await terminalSessionCleanupUnlocked();
      return;
    }

    await persistPendingCandidateUnlocked();
  }

  async function restoreSessionUnlocked(refreshToken?: string): Promise<void> {
    let durableRefreshToken = refreshToken ?? restoreRefreshToken;
    if (!durableRefreshToken) {
      const loaded = await loadRefreshTokenSettled();
      if (loaded.kind === 'corrupt') {
        await terminalSessionCleanupUnlocked();
        return;
      }
      if (loaded.kind === 'unavailable') {
        enterRefreshFailure('restore');
        return;
      }
      if (loaded.refreshToken === null) {
        restoreRefreshToken = undefined;
        transitions.enterSignedOut();
        return;
      }
      durableRefreshToken = loaded.refreshToken;
    }

    restoreRefreshToken = durableRefreshToken;
    await refreshCandidateUnlocked(durableRefreshToken, 'restore');
  }

  async function refreshActiveSessionUnlocked(): Promise<void> {
    const current = active;
    if (!current || disposed) {
      return;
    }
    await refreshCandidateUnlocked(current.bundle.refreshToken, 'refresh', current.user.userId);
  }

  function resumeStoredTransactionUnlocked(loaded: SettledTransaction): void {
    if (loaded.kind === 'unavailable') {
      transitions.enterOAuthError('configuration_error');
      return;
    }
    if (loaded.transaction.kind === 'missing') {
      transitions.enterSignedOut();
      return;
    }
    if (loaded.transaction.kind === 'expired') {
      transitions.enterOAuthError('transaction_expired');
      return;
    }
    if (loaded.transaction.kind === 'corrupt') {
      transitions.enterOAuthError('interrupted');
      return;
    }
    transitions.enterOAuthError('interrupted');
  }

  function isMatchingLaunchCallback(
    rawUrl: string,
    loaded: SettledTransaction,
  ): loaded is {
    kind: 'loaded';
    transaction: Extract<LoadedOAuthTransaction, { kind: 'active' }>;
  } {
    if (loaded.kind !== 'loaded' || loaded.transaction.kind !== 'active') {
      return false;
    }
    const parsed = parseOAuthCallback(rawUrl);
    return (
      (parsed.kind === 'success' || parsed.kind === 'providerError') &&
      parsed.state === loaded.transaction.transaction.state
    );
  }

  async function continueColdInitializationUnlocked(
    refreshTokenResultPromise: Promise<SettledRefreshToken>,
  ): Promise<void> {
    let launchUrl: { url: string } | undefined;
    try {
      launchUrl = await dependencies.app.getLaunchUrl();
    } catch {
      await removeListener(appUrlHandle);
      await removeListener(browserFinishedHandle);
      appUrlHandle = undefined;
      browserFinishedHandle = undefined;
      transitions.enterOAuthError('configuration_error');
      return;
    }

    const transaction = await loadTransactionSettled();
    if (launchUrl && isMatchingLaunchCallback(launchUrl.url, transaction)) {
      await completeCallbackUnlocked(launchUrl.url, transaction.transaction);
      await refreshTokenResultPromise;
      return;
    }

    const refreshTokenResult = await refreshTokenResultPromise;
    if (refreshTokenResult.kind === 'corrupt') {
      await terminalSessionCleanupUnlocked();
      return;
    }
    if (refreshTokenResult.kind === 'unavailable') {
      enterRefreshFailure('restore');
      return;
    }
    if (refreshTokenResult.refreshToken !== null) {
      restoreRefreshToken = refreshTokenResult.refreshToken;
      if (transaction.kind === 'unavailable' || transaction.transaction.kind !== 'missing') {
        await clearTransaction();
      }
      await restoreSessionUnlocked(refreshTokenResult.refreshToken);
      return;
    }

    resumeStoredTransactionUnlocked(transaction);
  }

  async function performInstallationResetUnlocked(): Promise<void> {
    cleanupContext = { kind: 'installationReset' };
    transitions.enterOperation({
      phase: 'initializing',
      operation: 'cleaningUp',
      sessionUsable: false,
      notice: null,
      user: null,
    });
    try {
      await dependencies.sessionStore.clearRefreshToken();
      await dependencies.installationStore.markCurrentInstallation();
    } catch {
      transitions.enterCleanupFailure();
      return;
    }
    cleanupContext = undefined;
    restoreRefreshToken = undefined;
    transitions.enterOAuthProgress('initializing');
    await continueColdInitializationUnlocked(
      Promise.resolve({ kind: 'loaded', refreshToken: null }),
    );
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

    if (!dependencies.isNativeIos) {
      transitions.enterOAuthError('unsupported_platform');
      return;
    }

    try {
      appUrlHandle = await dependencies.app.addListener('appUrlOpen', (event) => {
        void coordinator.completeCallback(event.url);
      });
      browserFinishedHandle = await dependencies.browser.addListener('browserFinished', () => {
        void serialize(handleBrowserFinishedUnlocked);
      });
    } catch {
      await removeListener(appUrlHandle);
      await removeListener(browserFinishedHandle);
      appUrlHandle = undefined;
      browserFinishedHandle = undefined;
      transitions.enterOAuthError('configuration_error');
      return;
    }

    const installationMarkerPromise = dependencies.installationStore.isCurrentInstallationMarked();
    const refreshTokenResultPromise = loadRefreshTokenSettled();
    const [installationMarkerResult] = await Promise.allSettled([installationMarkerPromise]);

    if (installationMarkerResult.status === 'rejected') {
      await refreshTokenResultPromise;
      cleanupContext = { kind: 'installationReset' };
      transitions.enterCleanupFailure();
      return;
    }
    if (!installationMarkerResult.value) {
      await refreshTokenResultPromise;
      await performInstallationResetUnlocked();
      return;
    }

    cleanupContext = undefined;
    await continueColdInitializationUnlocked(refreshTokenResultPromise);
  }

  async function startSignInUnlocked(): Promise<void> {
    const canStartSignIn =
      dependencies.isNativeIos &&
      state.operation === 'idle' &&
      ((state.phase === 'signedOut' &&
        state.retryAction === null &&
        (state.notice === null || state.notice === 'session_unusable')) ||
        (state.phase === 'error' &&
          state.errorCode !== null &&
          RESTARTABLE_OAUTH_ERRORS.has(state.errorCode)));

    if (disposed || !canStartSignIn) {
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

  async function retryCleanupUnlocked(): Promise<void> {
    if (cleanupContext?.kind === 'installationReset') {
      await performInstallationResetUnlocked();
      return;
    }
    if (cleanupContext?.kind === 'terminalSession') {
      await terminalSessionCleanupUnlocked();
    }
  }

  async function retryCurrentOperationUnlocked(): Promise<void> {
    const retryAction = state.retryAction;
    if (disposed || retryAction === null || state.operation !== 'idle') {
      return;
    }

    transitions.enterRetryOperation(retryAction);
    switch (retryAction) {
      case 'restore':
        await restoreSessionUnlocked();
        return;
      case 'refresh':
        await refreshActiveSessionUnlocked();
        return;
      case 'persist':
        await persistPendingCandidateUnlocked();
        return;
      case 'verify':
        await verifyCandidateSessionUnlocked();
        return;
      case 'cleanup':
        await retryCleanupUnlocked();
        return;
    }
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
    active = undefined;
    pendingCandidate = undefined;
    pendingSubject = undefined;
    restoreRefreshToken = undefined;
    cleanupContext = undefined;
    transitions.enterSignedOut();
  }

  const coordinator: MobileAuthCoordinator = {
    state: publicState,
    initialize: () => serialize(initializeUnlocked),
    startSignIn: () => serialize(startSignInUnlocked),
    completeCallback: (url) => serialize(() => completeCallbackUnlocked(url).then(() => undefined)),
    retryCurrentOperation: () => serialize(retryCurrentOperationUnlocked),
    dispose: () => serialize(disposeUnlocked),
  };

  return coordinator;
}

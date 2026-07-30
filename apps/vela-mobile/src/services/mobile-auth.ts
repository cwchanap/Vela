import { reactive, readonly, type InjectionKey } from 'vue';
import {
  MOBILE_OAUTH_CALLBACK_URI,
  MobileAuthenticatedApiRequestError,
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
  type MobileAuthenticatedApiRequest,
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

type PendingCandidateBase = {
  bundle: OAuthTokenBundleBase;
  durableRefreshToken: string;
  // Captured at candidate creation so candidateIsCurrent can reject any
  // candidate (not just refresh) whose owning generation was invalidated by
  // sign-out, disposal, or an intervening session reset.
  generation: number;
  returnedRefreshToken?: string;
};

type PendingCandidate =
  | (PendingCandidateBase & { context: 'authorizationCode' })
  | (PendingCandidateBase & { context: 'restore' })
  | (PendingCandidateBase & {
      context: 'refresh';
      refreshOwner: ActiveSession;
    });

type ActiveSession = {
  bundle: OAuthTokenBundleBase & { refreshToken: string };
  user: MobileAuthUser;
};

type AuthenticatedFeatureSnapshot = {
  owner: ActiveSession;
  generation: number;
  idToken: string;
  expiresAt: number;
  userId: string;
};

type FeatureRefreshObservation =
  | { kind: 'promoted'; owner: ActiveSession; generation: number }
  | { kind: 'terminal' }
  | { kind: 'superseded' }
  | { kind: 'retryable_failure' };

type FeatureUnauthorizedRecoveryResult =
  | { kind: 'refreshed' }
  | { kind: 'terminal' }
  | { kind: 'superseded' }
  | { kind: 'retryable_failure' };

type FeatureUnauthorizedRecovery = {
  owner: ActiveSession;
  generation: number;
  terminalCleanupStarted: boolean;
  promise: Promise<FeatureUnauthorizedRecoveryResult>;
};

type CleanupContext =
  | { kind: 'signOut' }
  | { kind: 'terminalSession' }
  | { kind: 'installationReset' };

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
export const MOBILE_AUTH_REFRESH_LEAD_MS = 60_000;
export const MOBILE_AUTH_SOFT_RETRY_DELAY_MS = 5_000;

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

function normalizeMobileApiBaseUrl(apiUrl: string): URL {
  const base = new URL(apiUrl);
  base.search = '';
  base.hash = '';
  base.pathname = `${base.pathname.replace(/\/+$/u, '')}/`;
  return base;
}

function resolveMobileApiUrl(base: URL, relativePath: string): URL {
  if (
    relativePath.length === 0 ||
    relativePath.startsWith('/') ||
    relativePath.startsWith('\\') ||
    relativePath.includes('\\') ||
    relativePath.includes('#') ||
    /^[a-z][a-z\d+.-]*:/iu.test(relativePath) ||
    relativePath.startsWith('//')
  ) {
    throw new MobileAuthenticatedApiRequestError('invalid_request_path');
  }

  for (const segment of relativePath.split('/')) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new MobileAuthenticatedApiRequestError('invalid_request_path');
    }
    if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\')) {
      throw new MobileAuthenticatedApiRequestError('invalid_request_path');
    }
  }

  const resolved = new URL(relativePath, base);
  if (resolved.origin !== base.origin || !resolved.pathname.startsWith(base.pathname)) {
    throw new MobileAuthenticatedApiRequestError('invalid_request_path');
  }
  return resolved;
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
  let appStateHandle: ListenerHandle | undefined;
  let browserFinishedHandle: ListenerHandle | undefined;
  let proactiveRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  let accessExpiryTimer: ReturnType<typeof setTimeout> | undefined;
  let automaticRetryTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshPromise: Promise<void> | undefined;
  let active: ActiveSession | undefined;
  let activeBundleGeneration = 0;
  let appIsActive = true;
  let automaticRetryUsed = false;
  let pendingCandidate: PendingCandidate | undefined;
  let pendingSubject: string | undefined;
  let restoreRefreshToken: string | undefined;
  let cleanupContext: CleanupContext | undefined;
  let signOutPromise: Promise<void> | undefined;
  let featureUnauthorizedRecovery: FeatureUnauthorizedRecovery | undefined;
  let initialized = false;
  let disposed = false;
  let disposalRequested = false;
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

  function activeSessionIsUsable(): boolean {
    return active !== undefined && active.bundle.expiresAt > dependencies.now();
  }

  function unavailable(): boolean {
    return disposed || disposalRequested;
  }

  async function dispatchAuthenticatedFeatureAttempt(
    request: MobileAuthenticatedApiRequest,
    snapshot: AuthenticatedFeatureSnapshot,
  ): Promise<Response> {
    const target = resolveMobileApiUrl(
      normalizeMobileApiBaseUrl(dependencies.config.apiUrl),
      request.path,
    );
    const headers = new Headers(request.init?.headers);
    if (headers.has('authorization')) {
      throw new MobileAuthenticatedApiRequestError('invalid_request_headers');
    }
    headers.set('Accept', headers.get('Accept') ?? 'application/json');
    headers.set('Authorization', `Bearer ${snapshot.idToken}`);

    const controller = new AbortController();
    let timeoutExpired = false;
    const callerSignal = request.init?.signal;
    const onCallerAbort = () => controller.abort();
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
    if (callerSignal?.aborted) {
      controller.abort();
    }
    const timeout = setTimeout(() => {
      timeoutExpired = true;
      controller.abort();
    }, MOBILE_AUTH_NETWORK_TIMEOUT_MS);

    try {
      return await dependencies.fetch(target, {
        ...request.init,
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      if (callerSignal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
      if (timeoutExpired) {
        throw new MobileAuthenticatedApiRequestError('request_timeout', { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
  }

  async function observeFeatureRefresh(
    owner: ActiveSession,
    generation: number,
    recovery: FeatureUnauthorizedRecovery,
  ): Promise<FeatureRefreshObservation> {
    await queueRefresh({ requireDue: false, owner, generation });

    if (
      active !== undefined &&
      active.user.userId === owner.user.userId &&
      activeBundleGeneration > generation &&
      activeSessionIsUsable()
    ) {
      return { kind: 'promoted', owner: active, generation: activeBundleGeneration };
    }

    if (recovery.terminalCleanupStarted) {
      return { kind: 'terminal' };
    }

    if (unavailable() || active !== owner || activeBundleGeneration !== generation) {
      return { kind: 'superseded' };
    }

    return { kind: 'retryable_failure' };
  }

  function getOrCreateFeatureUnauthorizedRecovery(
    snapshot: AuthenticatedFeatureSnapshot,
    forceTerminalCleanup = false,
  ): Promise<FeatureUnauthorizedRecoveryResult> {
    const existing = featureUnauthorizedRecovery;
    if (existing?.owner === snapshot.owner && existing.generation === snapshot.generation) {
      return existing.promise;
    }

    let resolve!: (result: FeatureUnauthorizedRecoveryResult) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<FeatureUnauthorizedRecoveryResult>(
      (resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
      },
    );
    const record: FeatureUnauthorizedRecovery = {
      owner: snapshot.owner,
      generation: snapshot.generation,
      terminalCleanupStarted: false,
      promise,
    };
    featureUnauthorizedRecovery = record;
    void (async () => {
      try {
        let observation: FeatureRefreshObservation;
        if (!forceTerminalCleanup && snapshot.expiresAt <= dependencies.now()) {
          observation = await observeFeatureRefresh(snapshot.owner, snapshot.generation, record);
        } else {
          let cleanupStarted = false;
          await serialize(async () => {
            if (
              unavailable() ||
              active !== snapshot.owner ||
              activeBundleGeneration !== snapshot.generation
            ) {
              return;
            }
            cleanupStarted = true;
            await terminalSessionCleanupUnlocked();
          });
          observation = cleanupStarted ? { kind: 'terminal' } : { kind: 'superseded' };
        }

        switch (observation.kind) {
          case 'promoted':
            resolve({ kind: 'refreshed' });
            return;
          case 'terminal':
          case 'superseded':
          case 'retryable_failure':
            resolve(observation);
            return;
        }
      } catch (error) {
        reject(error);
      } finally {
        if (featureUnauthorizedRecovery === record) {
          featureUnauthorizedRecovery = undefined;
        }
      }
    })();
    return promise;
  }

  async function waitForFeatureRecoveryOrCallerAbort(
    snapshot: AuthenticatedFeatureSnapshot,
    signal: AbortSignal | undefined,
    forceTerminalCleanup = false,
  ): Promise<FeatureUnauthorizedRecoveryResult> {
    const recovery = getOrCreateFeatureUnauthorizedRecovery(snapshot, forceTerminalCleanup);
    if (!signal) {
      return recovery;
    }

    return new Promise<FeatureUnauthorizedRecoveryResult>((resolve, reject) => {
      const abort = () => {
        signal.removeEventListener('abort', abort);
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      void recovery.then(
        (result) => {
          signal.removeEventListener('abort', abort);
          resolve(result);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', abort);
          reject(error);
        },
      );
    });
  }

  async function requestAuthenticatedApiInternal(
    request: MobileAuthenticatedApiRequest,
    allowRefreshRetry: boolean,
  ): Promise<Response> {
    // Resolve caller-controlled URL and headers before consulting any session
    // material, so malformed requests can never trigger a bearer fetch.
    resolveMobileApiUrl(normalizeMobileApiBaseUrl(dependencies.config.apiUrl), request.path);
    const callerHeaders = new Headers(request.init?.headers);
    if (callerHeaders.has('authorization')) {
      throw new MobileAuthenticatedApiRequestError('invalid_request_headers');
    }

    const owner = active;
    if (unavailable() || !owner || !activeSessionIsUsable() || !state.sessionUsable) {
      throw new MobileAuthenticatedApiRequestError('session_unavailable');
    }
    const snapshot: AuthenticatedFeatureSnapshot = {
      owner,
      generation: activeBundleGeneration,
      idToken: owner.bundle.idToken,
      expiresAt: owner.bundle.expiresAt,
      userId: owner.user.userId,
    };

    // The physical fetch stays outside serialize(), so it cannot hold up
    // sign-out, retries, or disposal while it is pending.
    const response = await dispatchAuthenticatedFeatureAttempt(request, snapshot);
    if (response.status !== 401) {
      return response;
    }
    if (active !== snapshot.owner || activeBundleGeneration !== snapshot.generation) {
      throw new MobileAuthenticatedApiRequestError('session_changed');
    }
    const recovery = await waitForFeatureRecoveryOrCallerAbort(
      snapshot,
      request.init?.signal,
      !allowRefreshRetry,
    );
    switch (recovery.kind) {
      case 'refreshed':
        if (!allowRefreshRetry) {
          return response;
        }
        return requestAuthenticatedApiInternal(request, false);
      case 'terminal':
        return response;
      case 'superseded':
        throw new MobileAuthenticatedApiRequestError('session_changed');
      case 'retryable_failure':
        throw new MobileAuthenticatedApiRequestError('session_recovery_pending');
    }
  }

  function requestAuthenticatedApi(request: MobileAuthenticatedApiRequest): Promise<Response> {
    return requestAuthenticatedApiInternal(request, true);
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
      const isInSessionRetry =
        active !== undefined &&
        (retryAction === 'refresh' ||
          ((retryAction === 'persist' || retryAction === 'verify') &&
            pendingCandidate?.context === 'refresh'));
      const isRestoreCandidateRetry =
        (retryAction === 'persist' || retryAction === 'verify') &&
        pendingCandidate?.context === 'restore';
      const phaseByAction: Record<MobileAuthRetryAction, MobileAuthPhase> = {
        restore: 'initializing',
        refresh: 'authenticated',
        persist: isInSessionRetry
          ? 'authenticated'
          : isRestoreCandidateRetry
            ? 'initializing'
            : 'exchangingCode',
        verify: isInSessionRetry
          ? 'authenticated'
          : isRestoreCandidateRetry
            ? 'initializing'
            : 'verifyingSession',
        cleanup: 'signedOut',
      };
      applyState({
        phase: phaseByAction[retryAction],
        operation: operationByAction[retryAction],
        sessionUsable: isInSessionRetry && activeSessionIsUsable(),
        errorCode: null,
        retryAction: null,
        notice: null,
        user: isInSessionRetry ? (active?.user ?? null) : null,
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

  function cancelProactiveRefreshTimer(): void {
    if (proactiveRefreshTimer !== undefined) {
      clearTimeout(proactiveRefreshTimer);
      proactiveRefreshTimer = undefined;
    }
  }

  function cancelAccessExpiryTimer(): void {
    if (accessExpiryTimer !== undefined) {
      clearTimeout(accessExpiryTimer);
      accessExpiryTimer = undefined;
    }
  }

  function cancelAutomaticRetryTimer(): void {
    if (automaticRetryTimer !== undefined) {
      clearTimeout(automaticRetryTimer);
      automaticRetryTimer = undefined;
    }
  }

  function cancelActiveSessionTimers(): void {
    cancelProactiveRefreshTimer();
    cancelAccessExpiryTimer();
    cancelAutomaticRetryTimer();
  }

  function clearActiveSession(): void {
    cancelActiveSessionTimers();
    active = undefined;
    activeBundleGeneration += 1;
    automaticRetryUsed = false;
  }

  function closeExpiredActiveSession(owner: ActiveSession, generation: number): void {
    if (unavailable() || active !== owner || activeBundleGeneration !== generation) {
      return;
    }
    if (owner.bundle.expiresAt > dependencies.now()) {
      scheduleAccessExpiryTimer(owner, generation);
      return;
    }

    cancelProactiveRefreshTimer();
    cancelAutomaticRetryTimer();
    if (state.operation !== 'idle') {
      applyState({
        phase: state.phase,
        operation: state.operation,
        sessionUsable: false,
        errorCode: state.errorCode,
        retryAction: state.retryAction,
        notice: state.notice,
        user: state.user,
      });
      return;
    }

    const retainedRetry =
      state.errorCode !== null &&
      (state.retryAction === 'refresh' ||
        state.retryAction === 'persist' ||
        state.retryAction === 'verify')
        ? {
            errorCode: state.errorCode,
            retryAction: state.retryAction,
          }
        : {
            errorCode: 'session_refresh_failed' as const,
            retryAction: 'refresh' as const,
          };
    transitions.enterSessionFailure({
      phase: 'authenticated',
      sessionUsable: false,
      errorCode: retainedRetry.errorCode,
      retryAction: retainedRetry.retryAction,
      user: owner.user,
    });
  }

  function scheduleAccessExpiryTimer(owner: ActiveSession, generation: number): void {
    cancelAccessExpiryTimer();
    const delay = Math.max(0, owner.bundle.expiresAt - dependencies.now());
    accessExpiryTimer = setTimeout(() => {
      accessExpiryTimer = undefined;
      closeExpiredActiveSession(owner, generation);
    }, delay);
  }

  function scheduleProactiveRefreshTimer(owner: ActiveSession, generation: number): void {
    cancelProactiveRefreshTimer();
    if (
      !appIsActive ||
      unavailable() ||
      active !== owner ||
      activeBundleGeneration !== generation
    ) {
      return;
    }
    const delay = Math.max(
      0,
      owner.bundle.expiresAt - dependencies.now() - MOBILE_AUTH_REFRESH_LEAD_MS,
    );
    proactiveRefreshTimer = setTimeout(() => {
      proactiveRefreshTimer = undefined;
      void queueRefresh({ requireDue: true, owner, generation });
    }, delay);
  }

  function scheduleActiveSessionTimers(): void {
    const owner = active;
    if (!owner || unavailable()) {
      return;
    }
    const generation = activeBundleGeneration;
    scheduleAccessExpiryTimer(owner, generation);
    scheduleProactiveRefreshTimer(owner, generation);
  }

  function queueRefresh(options: {
    requireDue: boolean;
    owner?: ActiveSession;
    generation?: number;
  }): Promise<void> {
    if (unavailable()) {
      return Promise.resolve();
    }
    if (refreshPromise !== undefined) {
      return refreshPromise;
    }

    const owner = options.owner ?? active;
    const generation = options.generation ?? activeBundleGeneration;
    if (!owner) {
      return Promise.resolve();
    }

    cancelProactiveRefreshTimer();
    const operation = serialize(async () => {
      if (
        unavailable() ||
        !appIsActive ||
        active !== owner ||
        activeBundleGeneration !== generation ||
        pendingCandidate !== undefined
      ) {
        return;
      }
      if (
        options.requireDue &&
        owner.bundle.expiresAt - dependencies.now() > MOBILE_AUTH_REFRESH_LEAD_MS
      ) {
        scheduleProactiveRefreshTimer(owner, generation);
        return;
      }
      await refreshActiveSessionUnlocked(owner, generation);
    });
    let tracked!: Promise<void>;
    tracked = operation.finally(() => {
      if (refreshPromise === tracked) {
        refreshPromise = undefined;
      }
    });
    refreshPromise = tracked;
    return tracked;
  }

  function queueRecordedRetry(): void {
    if (state.retryAction === null || state.operation !== 'idle' || unavailable() || !appIsActive) {
      return;
    }
    if (state.retryAction === 'refresh') {
      void queueRefresh({ requireDue: false });
      return;
    }
    if (state.retryAction === 'persist' || state.retryAction === 'verify') {
      void serialize(retryCurrentOperationUnlocked);
    }
  }

  function scheduleAutomaticRetry(): void {
    const owner = active;
    const retryAction = state.retryAction;
    if (
      !owner ||
      unavailable() ||
      !appIsActive ||
      automaticRetryUsed ||
      automaticRetryTimer !== undefined ||
      (retryAction !== 'refresh' && retryAction !== 'persist' && retryAction !== 'verify')
    ) {
      return;
    }
    const enoughLifetime =
      owner.bundle.expiresAt - dependencies.now() >
      MOBILE_AUTH_SOFT_RETRY_DELAY_MS + MOBILE_AUTH_NETWORK_TIMEOUT_MS;
    if (!enoughLifetime) {
      return;
    }

    automaticRetryUsed = true;
    automaticRetryTimer = setTimeout(() => {
      automaticRetryTimer = undefined;
      if (
        unavailable() ||
        !appIsActive ||
        active !== owner ||
        owner.bundle.expiresAt <= dependencies.now() ||
        state.retryAction !== retryAction
      ) {
        return;
      }
      queueRecordedRetry();
    }, MOBILE_AUTH_SOFT_RETRY_DELAY_MS);
  }

  function handleAppStateChange(isActive: boolean): void {
    appIsActive = isActive;
    if (!isActive) {
      cancelProactiveRefreshTimer();
      cancelAutomaticRetryTimer();
      return;
    }

    const owner = active;
    if (!owner || unavailable()) {
      return;
    }
    if (state.retryAction === 'persist' || state.retryAction === 'verify') {
      queueRecordedRetry();
      return;
    }

    const generation = activeBundleGeneration;
    if (owner.bundle.expiresAt <= dependencies.now()) {
      closeExpiredActiveSession(owner, generation);
      void queueRefresh({ requireDue: false, owner, generation });
      return;
    }
    if (
      state.retryAction === 'refresh' ||
      owner.bundle.expiresAt - dependencies.now() <= MOBILE_AUTH_REFRESH_LEAD_MS
    ) {
      void queueRefresh({ requireDue: state.retryAction !== 'refresh', owner, generation });
      return;
    }
    scheduleProactiveRefreshTimer(owner, generation);
  }

  async function removeListener(handle: ListenerHandle | undefined): Promise<void> {
    try {
      await handle?.remove();
    } catch {
      // Listener teardown is best effort and must never expose plugin errors.
    }
  }

  async function removeListenerHandles(): Promise<void> {
    await removeListener(appUrlHandle);
    await removeListener(appStateHandle);
    await removeListener(browserFinishedHandle);
    appUrlHandle = undefined;
    appStateHandle = undefined;
    browserFinishedHandle = undefined;
  }

  async function clearTransaction(): Promise<void> {
    try {
      await dependencies.transactionStore.clear();
    } catch {
      // The public error remains stable even when native cleanup is unavailable.
    }
  }

  function candidateIsCurrent(candidate: PendingCandidate): boolean {
    if (unavailable() || candidate.generation !== activeBundleGeneration) {
      return false;
    }
    if (candidate.context === 'refresh') {
      return candidate.refreshOwner === active;
    }
    return true;
  }

  async function failCallback(errorCode: MobileAuthErrorCode): Promise<void> {
    clearActiveSession();
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
    const cleanupPhase: MobileAuthPhase =
      state.phase === 'signedOut'
        ? 'signedOut'
        : active !== undefined || state.phase === 'authenticated'
          ? 'authenticated'
          : 'initializing';
    const cleanupUser =
      cleanupPhase === 'authenticated' ? (state.user ?? active?.user ?? null) : null;
    const activeRecovery = featureUnauthorizedRecovery;
    if (
      activeRecovery !== undefined &&
      activeRecovery.owner === active &&
      activeRecovery.generation === activeBundleGeneration
    ) {
      activeRecovery.terminalCleanupStarted = true;
    }
    clearActiveSession();
    const cleanupGeneration = activeBundleGeneration;
    pendingCandidate = undefined;
    pendingSubject = undefined;
    restoreRefreshToken = undefined;
    cleanupContext = { kind: 'terminalSession' };
    transitions.enterOperation({
      phase: cleanupPhase,
      operation: 'cleaningUp',
      sessionUsable: false,
      notice: null,
      user: cleanupUser,
    });
    try {
      await dependencies.sessionStore.clearRefreshToken();
    } catch {
      if (unavailable() || activeBundleGeneration !== cleanupGeneration) {
        return;
      }
      transitions.enterCleanupFailure();
      return;
    }
    if (unavailable() || activeBundleGeneration !== cleanupGeneration) {
      return;
    }
    cleanupContext = undefined;
    transitions.enterTerminalNotice();
  }

  function enterCandidateFailure(
    candidate: PendingCandidate,
    errorCode: Extract<
      MobileAuthErrorCode,
      'session_persistence_failed' | 'session_verification_failed'
    >,
    retryAction: Extract<MobileAuthRetryAction, 'persist' | 'verify'>,
  ): void {
    const isInSession = candidate.context === 'refresh' && active !== undefined;
    transitions.enterSessionFailure({
      phase: isInSession
        ? 'authenticated'
        : candidate.context === 'restore'
          ? 'initializing'
          : 'error',
      sessionUsable: isInSession && activeSessionIsUsable(),
      errorCode,
      retryAction,
      user: isInSession ? (active?.user ?? null) : null,
    });
    if (isInSession) {
      scheduleAutomaticRetry();
    }
  }

  // An expired candidate must not be verified or promoted directly. The
  // expired ID token would either elicit a 401 from /auth/session (which
  // terminal cleanup treats as proof the durable refresh token is unusable,
  // destroying a still-valid credential) or trip the live-bundle invariant
  // in enterAuthenticated() (via applyState → assertMobileAuthState) after
  // active and recovery state have been mutated. Discard the expired
  // candidate and reissue the grant through its durable refresh token.
  //
  // For a refresh candidate the durable token may be a rotated R2 that was
  // already persisted while active still holds R1. refreshActiveSessionUnlocked()
  // would send active.bundle.refreshToken (R1); once R1's rotation grace
  // ends Cognito returns invalid_grant and terminal cleanup deletes the
  // valid persisted R2. Rebuild the grant here with the candidate's durable
  // token while retaining the active owner, generation, and expected-subject
  // guards (refreshCandidateUnlocked's refreshIsCurrent enforces them).
  async function reissueExpiredCandidateUnlocked(candidate: PendingCandidate): Promise<void> {
    const durableRefreshToken = candidate.durableRefreshToken;
    // For a refresh candidate, active still holds the pre-rotation R1 while
    // R2 is already persisted in the keychain. If this reissue fails
    // transiently (network error or retryable server response),
    // enterRefreshFailure('refresh') records retryAction: 'refresh' and the
    // next retry dispatches to refreshActiveSessionUnlocked(), which reads
    // active.bundle.refreshToken. Without promoting R2 into active here,
    // that retry would send the stale R1 — which after its rotation grace
    // ends returns invalid_grant and triggers terminal cleanup that deletes
    // the valid persisted R2. Mutate active.bundle.refreshToken in place
    // (rather than reassigning active) so refreshCandidateUnlocked's
    // refreshIsCurrent guard (refreshOwner === active) still holds. The
    // refresh grant's invalid_grant path still terminally cleans up if R2
    // itself is genuinely unusable; a successful reissue overwrites active
    // entirely on promotion.
    if (candidate.context === 'refresh' && active !== undefined) {
      active.bundle.refreshToken = durableRefreshToken;
    }
    pendingCandidate = undefined;
    pendingSubject = undefined;
    if (candidate.context === 'refresh') {
      await refreshCandidateUnlocked(
        durableRefreshToken,
        'refresh',
        candidate.refreshOwner.user.userId,
        candidate.refreshOwner,
        candidate.generation,
      );
    } else {
      await restoreSessionUnlocked(durableRefreshToken);
    }
  }

  async function verifyCandidateSessionUnlocked(): Promise<void> {
    const candidate = pendingCandidate;
    if (!candidate || !candidateIsCurrent(candidate)) {
      return;
    }

    if (candidate.bundle.expiresAt <= dependencies.now()) {
      await reissueExpiredCandidateUnlocked(candidate);
      return;
    }

    transitions.enterOperation({
      phase:
        candidate.context === 'refresh'
          ? 'authenticated'
          : candidate.context === 'restore'
            ? 'initializing'
            : 'verifyingSession',
      operation: 'verifying',
      sessionUsable: candidate.context === 'refresh' && activeSessionIsUsable(),
      notice: null,
      user: candidate.context === 'refresh' ? (active?.user ?? null) : null,
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
        response = await dependencies.fetch(
          resolveMobileApiUrl(
            normalizeMobileApiBaseUrl(dependencies.config.apiUrl),
            'auth/session',
          ).toString(),
          {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${candidate.bundle.idToken}`,
            },
            signal: controller.signal,
          },
        );
      } catch {
        if (!candidateIsCurrent(candidate)) {
          return;
        }
        enterCandidateFailure(candidate, 'session_verification_failed', 'verify');
        return;
      }

      if (!candidateIsCurrent(candidate)) {
        return;
      }
      if (response.status === 401 || response.status === 403) {
        // The API returns 401 for an expired ID token (auth middleware:
        // "Invalid or expired token"). A candidate that was valid when the
        // request started can expire during the network round trip and
        // arrive as 401, even though its durable refresh token is still
        // usable. Recheck expiry before treating 401/403 as terminal; an
        // expired candidate must be reissued so the refresh grant determines
        // whether the durable credential is actually unusable, rather than
        // deleting it on the ID token's expiry alone.
        if (candidate.bundle.expiresAt <= dependencies.now()) {
          await reissueExpiredCandidateUnlocked(candidate);
          return;
        }
        await terminalSessionCleanupUnlocked();
        return;
      }

      if (!response.ok) {
        enterCandidateFailure(candidate, 'session_verification_failed', 'verify');
        return;
      }

      let data: unknown;
      try {
        data = await response.json();
      } catch {
        if (!candidateIsCurrent(candidate)) {
          return;
        }
        enterCandidateFailure(candidate, 'session_verification_failed', 'verify');
        return;
      }

      if (!candidateIsCurrent(candidate)) {
        return;
      }
      const user = parseSessionUser(data);
      if (!user) {
        enterCandidateFailure(candidate, 'session_verification_failed', 'verify');
        return;
      }

      if (pendingSubject !== undefined && user.userId !== pendingSubject) {
        await terminalSessionCleanupUnlocked();
        return;
      }

      // Recheck expiry immediately before promotion, before mutating active
      // or clearing the pending recovery data. The candidate may have
      // expired during the /auth/session request or response-body read;
      // enterAuthenticated() indirectly invokes the live-bundle invariant
      // (applyState → assertMobileAuthState with now()), so a candidate that
      // expires mid-flight can throw after active has been replaced and
      // pendingCandidate cleared. scheduleActiveSessionTimers() runs only
      // after that call and therefore cannot provide zero-delay recovery.
      if (candidate.bundle.expiresAt <= dependencies.now()) {
        await reissueExpiredCandidateUnlocked(candidate);
        return;
      }

      cancelActiveSessionTimers();
      active = {
        bundle: {
          ...candidate.bundle,
          refreshToken: candidate.durableRefreshToken,
        },
        user,
      };
      activeBundleGeneration += 1;
      automaticRetryUsed = false;
      pendingCandidate = undefined;
      pendingSubject = undefined;
      restoreRefreshToken = undefined;
      cleanupContext = undefined;
      transitions.enterAuthenticated(user);
      scheduleActiveSessionTimers();
    } finally {
      clearTimeout(timeout);
    }
  }

  async function persistPendingCandidateUnlocked(): Promise<void> {
    const candidate = pendingCandidate;
    if (!candidate || !candidateIsCurrent(candidate)) {
      return;
    }

    const needsPersistence =
      candidate.context === 'authorizationCode' || candidate.returnedRefreshToken !== undefined;
    if (needsPersistence) {
      transitions.enterOperation({
        phase:
          candidate.context === 'refresh'
            ? 'authenticated'
            : candidate.context === 'restore'
              ? 'initializing'
              : 'exchangingCode',
        operation: 'persisting',
        sessionUsable: candidate.context === 'refresh' && activeSessionIsUsable(),
        notice: null,
        user: candidate.context === 'refresh' ? (active?.user ?? null) : null,
      });
      try {
        await dependencies.sessionStore.saveRefreshToken(candidate.durableRefreshToken);
      } catch {
        if (!candidateIsCurrent(candidate)) {
          return;
        }
        enterCandidateFailure(candidate, 'session_persistence_failed', 'persist');
        return;
      }

      if (!candidateIsCurrent(candidate)) {
        return;
      }
      if (candidate.context === 'authorizationCode') {
        // Only a durable refresh credential permits transaction removal. A
        // failed Preferences cleanup remains best effort because the exchanged
        // authorization code is single-use.
        await clearTransaction();
        if (!candidateIsCurrent(candidate)) {
          return;
        }
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

    if (unavailable() || !initialized || active || pendingCandidate || !isActiveCallbackPhase) {
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
        if (unavailable()) {
          return false;
        }
        transitions.enterOAuthProgress('exchangingCode');
        await closeBrowser();
        if (unavailable()) {
          return false;
        }
        await failCallback('interrupted');
        return true;
      }
    }

    if (unavailable()) {
      return false;
    }
    if (loaded.kind === 'missing' || loaded.kind === 'corrupt') {
      transitions.enterOAuthProgress('exchangingCode');
      await closeBrowser();
      if (unavailable()) {
        return true;
      }
      await failCallback(parsed.kind === 'malformed' ? 'malformed_callback' : 'interrupted');
      return true;
    }
    if (loaded.kind === 'expired') {
      transitions.enterOAuthProgress('exchangingCode');
      await closeBrowser();
      if (unavailable()) {
        return true;
      }
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
    if (unavailable()) {
      return true;
    }

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
      if (unavailable()) {
        return true;
      }
      await failCallback('code_exchange_failed');
      return true;
    }

    if (unavailable()) {
      return true;
    }
    if (response.status < 200 || response.status >= 300) {
      await failCallback('code_exchange_failed');
      return true;
    }

    let bundle: AuthorizationCodeTokenBundle;
    let authorizationCodeSubject: string;
    try {
      bundle = parseAuthorizationCodeTokenResponse(
        parseTransportData(response.data),
        dependencies.now(),
      );
      authorizationCodeSubject = validateAuthorizationCodeIdTokenClaims(bundle.idToken, {
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
      generation: activeBundleGeneration,
    };
    pendingSubject = authorizationCodeSubject;
    await persistPendingCandidateUnlocked();
    return true;
  }

  async function loadRefreshTokenSettled(): Promise<SettledRefreshToken> {
    try {
      return {
        kind: 'loaded',
        refreshToken: await dependencies.sessionStore.loadRefreshToken(),
      };
    } catch (reason) {
      if (reason instanceof MobileSessionStoreError && reason.code === 'corrupt') {
        return { kind: 'corrupt' };
      }
      return { kind: 'unavailable' };
    }
  }

  async function loadTransactionSettled(): Promise<SettledTransaction> {
    try {
      return { kind: 'loaded', transaction: await dependencies.transactionStore.load() };
    } catch {
      return { kind: 'unavailable' };
    }
  }

  function enterRefreshFailure(context: 'restore' | 'refresh'): void {
    if (context === 'refresh' && active !== undefined) {
      transitions.enterSessionFailure({
        phase: 'authenticated',
        sessionUsable: activeSessionIsUsable(),
        errorCode: 'session_refresh_failed',
        retryAction: 'refresh',
        user: active.user,
      });
      scheduleAutomaticRetry();
      return;
    }
    transitions.enterSessionFailure({
      phase: context === 'restore' ? 'initializing' : 'error',
      sessionUsable: false,
      errorCode: context === 'restore' ? 'session_restore_failed' : 'session_refresh_failed',
      retryAction: context,
      user: null,
    });
  }

  // RFC 6749 §5.2 requires token-endpoint errors to use HTTP 400 with an
  // `error` parameter. Only `invalid_grant` establishes that the refresh
  // token itself is unusable for this grant — Cognito returns it for a
  // revoked token but also for some app-client attribute-permission
  // failures, so it does not uniquely prove revocation; it does prove the
  // credential cannot be redeemed and must be discarded. Other 400 errors
  // (`invalid_client`, `invalid_request`, `unauthorized_client`,
  // `unsupported_grant_type`) indicate client/config faults that don't
  // invalidate the credential. A 401/403 from a gateway or WAF in front of
  // Cognito is not an OAuth error at all. Treating any of those as terminal
  // would destroy a still-valid durable refresh token and force an
  // unnecessary interactive sign-in.
  function isInvalidGrantRefreshFailure(response: { status: number; data: unknown }): boolean {
    if (response.status !== 400) {
      return false;
    }
    let parsed: unknown;
    try {
      parsed = parseTransportData(response.data);
    } catch {
      return false;
    }
    return isRecord(parsed) && parsed.error === 'invalid_grant';
  }

  async function refreshCandidateUnlocked(
    refreshToken: string,
    context: 'restore' | 'refresh',
    expectedSubject?: string,
    refreshOwner?: ActiveSession,
    refreshGeneration?: number,
  ): Promise<void> {
    const refreshIsCurrent = () =>
      !unavailable() &&
      (context !== 'refresh' ||
        (refreshOwner === active && refreshGeneration === activeBundleGeneration));
    if (!refreshIsCurrent()) {
      return;
    }

    transitions.enterOperation({
      phase: context === 'restore' ? 'initializing' : 'authenticated',
      operation: context === 'restore' ? 'restoring' : 'refreshing',
      sessionUsable: context === 'refresh' && activeSessionIsUsable(),
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
      if (!refreshIsCurrent()) {
        return;
      }
      enterRefreshFailure(context);
      return;
    }

    if (!refreshIsCurrent()) {
      return;
    }
    if (response.status < 200 || response.status >= 300) {
      if (isInvalidGrantRefreshFailure(response)) {
        await terminalSessionCleanupUnlocked();
      } else {
        enterRefreshFailure(context);
      }
      return;
    }

    let refreshed: ReturnType<typeof parseRefreshTokenResponse>;
    try {
      refreshed = parseRefreshTokenResponse(parseTransportData(response.data), dependencies.now());
    } catch {
      enterRefreshFailure(context);
      return;
    }

    let subject: string;
    try {
      subject = validateRefreshedIdTokenClaims(refreshed.idToken, {
        config: dependencies.config,
        now: dependencies.now(),
        ...(expectedSubject === undefined ? {} : { expectedSubject }),
      });
    } catch {
      await terminalSessionCleanupUnlocked();
      return;
    }

    const { refreshToken: returnedRefreshToken, ...bundle } = refreshed;
    const durableRefreshToken = returnedRefreshToken ?? refreshToken;
    const generation = activeBundleGeneration;
    if (context === 'refresh') {
      pendingCandidate = {
        bundle,
        durableRefreshToken,
        generation,
        context,
        refreshOwner: refreshOwner!,
        ...(returnedRefreshToken === undefined ? {} : { returnedRefreshToken }),
      };
    } else {
      pendingCandidate = {
        bundle,
        durableRefreshToken,
        generation,
        context,
        ...(returnedRefreshToken === undefined ? {} : { returnedRefreshToken }),
      };
    }
    pendingSubject = subject;

    await persistPendingCandidateUnlocked();
  }

  async function restoreSessionUnlocked(refreshToken?: string): Promise<void> {
    let durableRefreshToken = refreshToken ?? restoreRefreshToken;
    if (!durableRefreshToken) {
      const loaded = await loadRefreshTokenSettled();
      if (unavailable()) {
        return;
      }
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

  async function refreshActiveSessionUnlocked(
    current = active,
    generation = activeBundleGeneration,
  ): Promise<void> {
    if (!current || unavailable() || active !== current || activeBundleGeneration !== generation) {
      return;
    }
    await refreshCandidateUnlocked(
      current.bundle.refreshToken,
      'refresh',
      current.user.userId,
      current,
      generation,
    );
  }

  function resumeStoredTransactionUnlocked(loaded: SettledTransaction): void {
    if (unavailable()) {
      return;
    }
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
    const [launchUrlResult] = await Promise.allSettled([dependencies.app.getLaunchUrl()]);

    if (unavailable()) {
      return;
    }

    let transaction: SettledTransaction | undefined;
    if (launchUrlResult.status === 'fulfilled') {
      transaction = await loadTransactionSettled();
      if (unavailable()) {
        return;
      }
      if (
        launchUrlResult.value &&
        isMatchingLaunchCallback(launchUrlResult.value.url, transaction)
      ) {
        await completeCallbackUnlocked(launchUrlResult.value.url, transaction.transaction);
        await refreshTokenResultPromise;
        return;
      }
    }

    const refreshTokenResult = await refreshTokenResultPromise;
    if (unavailable()) {
      return;
    }
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
      if (
        transaction === undefined ||
        transaction.kind === 'unavailable' ||
        transaction.transaction.kind !== 'missing'
      ) {
        await clearTransaction();
        if (unavailable()) {
          return;
        }
      }
      await restoreSessionUnlocked(refreshTokenResult.refreshToken);
      return;
    }

    if (launchUrlResult.status === 'rejected') {
      await removeListenerHandles();
      if (unavailable()) {
        return;
      }
      transitions.enterOAuthError('configuration_error');
      return;
    }

    if (!transaction) {
      transitions.enterOAuthError('configuration_error');
      return;
    }
    resumeStoredTransactionUnlocked(transaction);
  }

  async function performInstallationResetUnlocked(): Promise<void> {
    if (unavailable()) {
      return;
    }
    const resetPhase: MobileAuthPhase =
      state.phase === 'signedOut' && state.operation === 'cleaningUp'
        ? 'signedOut'
        : 'initializing';
    cleanupContext = { kind: 'installationReset' };
    transitions.enterOperation({
      phase: resetPhase,
      operation: 'cleaningUp',
      sessionUsable: false,
      notice: null,
      user: null,
    });
    try {
      await dependencies.sessionStore.clearRefreshToken();
      if (unavailable()) {
        return;
      }
      await dependencies.installationStore.markCurrentInstallation();
    } catch {
      if (unavailable()) {
        return;
      }
      transitions.enterCleanupFailure();
      return;
    }
    if (unavailable()) {
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
    if (unavailable() || initialized) {
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
      appStateHandle = await dependencies.app.addListener('appStateChange', (event) => {
        handleAppStateChange(event.isActive);
      });
      browserFinishedHandle = await dependencies.browser.addListener('browserFinished', () => {
        void serialize(handleBrowserFinishedUnlocked);
      });
    } catch {
      await removeListenerHandles();
      if (unavailable()) {
        return;
      }
      transitions.enterOAuthError('configuration_error');
      return;
    }

    if (unavailable()) {
      await removeListenerHandles();
      return;
    }
    let installationMarked: boolean;
    try {
      installationMarked = await dependencies.installationStore.isCurrentInstallationMarked();
    } catch {
      if (unavailable()) {
        return;
      }
      cleanupContext = { kind: 'installationReset' };
      transitions.enterCleanupFailure();
      return;
    }

    if (unavailable()) {
      return;
    }
    if (!installationMarked) {
      await performInstallationResetUnlocked();
      return;
    }

    cleanupContext = undefined;
    await continueColdInitializationUnlocked(loadRefreshTokenSettled());
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

    if (unavailable() || !canStartSignIn) {
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
      if (unavailable()) {
        return;
      }
      authorizationUrl = buildAuthorizationUrl(dependencies.config, transaction, challenge);
      await dependencies.transactionStore.replace(transaction);
    } catch {
      if (unavailable()) {
        return;
      }
      transitions.enterOAuthError('configuration_error');
      return;
    }

    if (unavailable()) {
      return;
    }
    try {
      await dependencies.browser.open({ url: authorizationUrl });
    } catch {
      if (unavailable()) {
        return;
      }
      await clearTransaction();
      transitions.enterOAuthError('browser_launch_failed');
      return;
    }

    if (unavailable()) {
      return;
    }
    transitions.enterOAuthProgress('awaitingCallback');
  }

  async function handleBrowserFinishedUnlocked(): Promise<void> {
    if (unavailable() || state.phase !== 'awaitingCallback') {
      return;
    }

    transitions.enterOAuthError('cancelled');
    await clearTransaction();
    if (!unavailable() && isDevelopment) {
      console.info(
        'browser_closed_before_callback — verify the deployed Cognito client ID and redirect URI configuration.',
      );
    }
  }

  function eraseSessionMaterial(): void {
    active = undefined;
    pendingCandidate = undefined;
    pendingSubject = undefined;
    restoreRefreshToken = undefined;
    automaticRetryUsed = false;
  }

  async function finishSignOutCleanupUnlocked(): Promise<void> {
    cleanupContext = { kind: 'signOut' };
    cancelActiveSessionTimers();
    activeBundleGeneration += 1;

    let durableCleanupSucceeded = false;
    let transactionCleanupSucceeded = false;
    try {
      await dependencies.sessionStore.clearRefreshToken();
      durableCleanupSucceeded = true;
    } catch {
      // Durable and transaction cleanup are independent requirements.
    }
    try {
      await dependencies.transactionStore.clear();
      transactionCleanupSucceeded = true;
    } catch {
      // Cleanup failures publish only the stable retry context below.
    }

    eraseSessionMaterial();
    if (!durableCleanupSucceeded || !transactionCleanupSucceeded) {
      transitions.enterCleanupFailure();
      return;
    }

    cleanupContext = undefined;
    transitions.enterSignedOut();
  }

  function canSignOutOrStartOver(): boolean {
    if (unavailable()) {
      return false;
    }
    return (
      state.phase === 'authenticated' ||
      (state.operation === 'idle' &&
        state.sessionUsable === false &&
        state.retryAction !== null &&
        ['restore', 'refresh', 'persist', 'verify'].includes(state.retryAction))
    );
  }

  function signOut(): Promise<void> {
    if (signOutPromise !== undefined) {
      return signOutPromise;
    }
    if (!canSignOutOrStartOver()) {
      return Promise.resolve();
    }

    cancelActiveSessionTimers();
    activeBundleGeneration += 1;
    automaticRetryUsed = false;
    const signOutPhase: MobileAuthPhase =
      active !== undefined || state.phase === 'authenticated' ? 'authenticated' : 'initializing';
    transitions.enterOperation({
      phase: signOutPhase,
      operation: 'signingOut',
      sessionUsable: false,
      notice: null,
      user: signOutPhase === 'authenticated' ? (state.user ?? active?.user ?? null) : null,
    });

    const cleanup = serialize(finishSignOutCleanupUnlocked);
    let tracked!: Promise<void>;
    tracked = cleanup.finally(() => {
      if (signOutPromise === tracked) {
        signOutPromise = undefined;
      }
    });
    signOutPromise = tracked;
    return tracked;
  }

  async function retryCleanupUnlocked(): Promise<void> {
    if (cleanupContext?.kind === 'signOut') {
      await finishSignOutCleanupUnlocked();
      return;
    }
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
    if (unavailable() || retryAction === null || state.operation !== 'idle') {
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

  function retryCurrentOperation(): Promise<void> {
    if (unavailable()) {
      return Promise.resolve();
    }
    if (refreshPromise !== undefined) {
      cancelAutomaticRetryTimer();
      return refreshPromise;
    }

    const retryAction = state.retryAction;
    if (
      active !== undefined &&
      (retryAction === 'refresh' || retryAction === 'persist' || retryAction === 'verify')
    ) {
      cancelAutomaticRetryTimer();
      automaticRetryUsed = true;
    }
    if (retryAction === 'refresh') {
      return queueRefresh({ requireDue: false });
    }
    return serialize(retryCurrentOperationUnlocked);
  }

  async function disposeUnlocked(): Promise<void> {
    if (disposed) {
      return;
    }
    disposed = true;
    cancelActiveSessionTimers();
    await removeListenerHandles();
    clearActiveSession();
    pendingCandidate = undefined;
    pendingSubject = undefined;
    restoreRefreshToken = undefined;
    cleanupContext = undefined;
    transitions.enterSignedOut();
  }

  function dispose(): Promise<void> {
    if (disposed) {
      return Promise.resolve();
    }
    if (disposalRequested) {
      return operationTail;
    }
    disposalRequested = true;
    cancelActiveSessionTimers();
    activeBundleGeneration += 1;
    return serialize(disposeUnlocked);
  }

  const coordinator: MobileAuthCoordinator = {
    state: publicState,
    initialize: () => (unavailable() ? Promise.resolve() : serialize(initializeUnlocked)),
    startSignIn: () => (unavailable() ? Promise.resolve() : serialize(startSignInUnlocked)),
    completeCallback: (url) =>
      unavailable()
        ? Promise.resolve()
        : serialize(() => completeCallbackUnlocked(url).then(() => undefined)),
    requestAuthenticatedApi,
    retryCurrentOperation,
    signOut,
    dispose,
  };

  return coordinator;
}

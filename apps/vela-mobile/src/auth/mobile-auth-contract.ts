export const MOBILE_OAUTH_CALLBACK_URI = 'dev.cwchanap.vela.oauth:/oauth/callback';
export const MOBILE_OAUTH_SCHEME = 'dev.cwchanap.vela.oauth:';
export const MOBILE_OAUTH_TRANSACTION_KEY = 'vela:mobile:oauth-transaction';
export const MOBILE_OAUTH_TRANSACTION_TTL_MS = 10 * 60 * 1000;

export type MobileOAuthConfig = {
  apiUrl: string;
  userPoolId: string;
  mobileClientId: string;
  oauthDomain: string;
  region: string;
  callbackUri: typeof MOBILE_OAUTH_CALLBACK_URI;
};

export type OAuthTransaction = {
  state: string;
  codeVerifier: string;
  nonce: string;
  createdAt: number;
};

export type OAuthTokenBundleBase = {
  accessToken: string;
  idToken: string;
  expiresAt: number;
};

export type AuthorizationCodeTokenBundle = OAuthTokenBundleBase & {
  refreshToken: string;
};

export type RefreshedTokenBundle = OAuthTokenBundleBase & {
  refreshToken?: string;
};

export type ParsedOAuthCallback =
  | { kind: 'unrelated' }
  | { kind: 'success'; code: string; state: string }
  | { kind: 'providerError'; error: 'access_denied' | 'other'; state: string }
  | { kind: 'malformed' };

export type MobileTokenRequest = {
  url: string;
  method: 'POST';
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' };
  data: string;
  /**
   * Optional total timeout in milliseconds. The token-request adapter is
   * expected to terminate the underlying native request when this elapses so
   * the coordinator cannot remain stuck in `exchangingCode`. The Capacitor
   * boot adapter maps this to `connectTimeout`/`readTimeout`.
   */
  timeoutMs?: number;
};

export type MobileAuthPhase =
  | 'initializing'
  | 'signedOut'
  | 'openingBrowser'
  | 'awaitingCallback'
  | 'exchangingCode'
  | 'verifyingSession'
  | 'authenticated'
  | 'error';

export type MobileAuthErrorCode =
  | 'configuration_error'
  | 'browser_launch_failed'
  | 'cancelled'
  | 'interrupted'
  | 'transaction_expired'
  | 'malformed_callback'
  | 'provider_error'
  | 'code_exchange_failed'
  | 'token_validation_failed'
  | 'session_unauthorized'
  | 'session_verification_failed'
  | 'session_restore_failed'
  | 'session_refresh_failed'
  | 'session_persistence_failed'
  | 'session_cleanup_failed'
  | 'unsupported_platform';

export type MobileAuthRetryAction = 'restore' | 'refresh' | 'persist' | 'verify' | 'cleanup';

export type MobileAuthOperation =
  | 'idle'
  | 'restoring'
  | 'refreshing'
  | 'persisting'
  | 'verifying'
  | 'signingOut'
  | 'cleaningUp';

export type MobileAuthNotice = 'session_unusable' | 'cleanup_incomplete' | null;

export type MobileAuthUser = {
  userId: string;
  email: string | null;
};

export type MobileAuthState = {
  phase: MobileAuthPhase;
  operation: MobileAuthOperation;
  sessionUsable: boolean;
  errorCode: MobileAuthErrorCode | null;
  retryAction: MobileAuthRetryAction | null;
  notice: MobileAuthNotice;
  user: MobileAuthUser | null;
};

export type MobileAuthStateAssertionContext = {
  activeBundle: OAuthTokenBundleBase | null;
  now: number;
};

export function assertMobileAuthState(
  state: MobileAuthState,
  context: MobileAuthStateAssertionContext,
): void {
  const usableSessionIsInvalid =
    state.sessionUsable &&
    (state.phase !== 'authenticated' ||
      state.user === null ||
      state.notice !== null ||
      context.activeBundle === null ||
      context.activeBundle.expiresAt <= context.now);
  const errorPhaseIsInvalid = state.phase === 'error' && state.errorCode === null;
  const retryIsInvalid =
    state.retryAction !== null && (state.operation !== 'idle' || state.errorCode === null);
  const terminalNoticeIsInvalid =
    state.notice === 'session_unusable' &&
    (state.phase !== 'signedOut' ||
      state.operation !== 'idle' ||
      state.sessionUsable ||
      state.errorCode !== null ||
      state.retryAction !== null ||
      state.user !== null);
  const cleanupNoticeIsInvalid =
    state.notice === 'cleanup_incomplete' &&
    (state.phase !== 'signedOut' ||
      state.operation !== 'idle' ||
      state.sessionUsable ||
      state.errorCode !== 'session_cleanup_failed' ||
      state.retryAction !== 'cleanup' ||
      state.user !== null);

  if (
    usableSessionIsInvalid ||
    errorPhaseIsInvalid ||
    retryIsInvalid ||
    terminalNoticeIsInvalid ||
    cleanupNoticeIsInvalid
  ) {
    throw new Error('invalid_mobile_auth_state');
  }
}

export type MobileAppAdapter = {
  addListener(
    eventName: 'appUrlOpen',
    listener: (event: { url: string }) => void,
  ): Promise<{ remove(): Promise<void> }>;
  addListener(
    eventName: 'appStateChange',
    listener: (event: { isActive: boolean }) => void,
  ): Promise<{ remove(): Promise<void> }>;
  getLaunchUrl(): Promise<{ url: string } | undefined>;
};

export type MobileBrowserAdapter = {
  addListener(
    eventName: 'browserFinished',
    listener: () => void,
  ): Promise<{ remove(): Promise<void> }>;
  open(options: { url: string }): Promise<void>;
  close(): Promise<void>;
};

export type MobileTokenTransportAdapter = {
  request(options: MobileTokenRequest): Promise<{ status: number; data: unknown }>;
};

export type MobileAuthCoordinator = {
  state: Readonly<MobileAuthState>;
  initialize(): Promise<void>;
  startSignIn(): Promise<void>;
  completeCallback(url: string): Promise<void>;
  retryCurrentOperation(): Promise<void>;
  dispose(): Promise<void>;
};

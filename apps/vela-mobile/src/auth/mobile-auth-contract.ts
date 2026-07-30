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
  const invariants: { name: string; violated: boolean }[] = [
    {
      name: 'usable_session_requires_authenticated_phase_user_no_notice_live_bundle',
      violated:
        state.sessionUsable &&
        (state.phase !== 'authenticated' ||
          state.user === null ||
          state.notice !== null ||
          context.activeBundle === null ||
          context.activeBundle.expiresAt <= context.now),
    },
    {
      name: 'error_phase_requires_error_code',
      violated: state.phase === 'error' && state.errorCode === null,
    },
    {
      name: 'retry_action_requires_idle_operation_and_error_code',
      violated:
        state.retryAction !== null && (state.operation !== 'idle' || state.errorCode === null),
    },
    {
      name: 'session_unusable_notice_confined_to_signed_out_idle_clean_state',
      violated:
        state.notice === 'session_unusable' &&
        (state.phase !== 'signedOut' ||
          state.operation !== 'idle' ||
          state.sessionUsable ||
          state.errorCode !== null ||
          state.retryAction !== null ||
          state.user !== null),
    },
    {
      name: 'cleanup_incomplete_notice_confined_to_signed_out_cleanup_failure_state',
      violated:
        state.notice === 'cleanup_incomplete' &&
        (state.phase !== 'signedOut' ||
          state.operation !== 'idle' ||
          state.sessionUsable ||
          state.errorCode !== 'session_cleanup_failed' ||
          state.retryAction !== 'cleanup' ||
          state.user !== null),
    },
    {
      name: 'session_restore_failed_confined_to_initializing_phase',
      violated: state.errorCode === 'session_restore_failed' && state.phase !== 'initializing',
    },
    {
      name: 'session_refresh_failed_confined_to_authenticated_or_error_phase',
      violated:
        state.errorCode === 'session_refresh_failed' &&
        state.phase !== 'authenticated' &&
        state.phase !== 'error',
    },
    {
      name: 'signing_out_operation_shape',
      violated:
        state.operation === 'signingOut' &&
        ((state.phase !== 'initializing' && state.phase !== 'authenticated') ||
          (state.phase === 'initializing' && state.user !== null) ||
          (state.phase === 'authenticated' && state.user === null) ||
          state.sessionUsable ||
          state.errorCode !== null ||
          state.retryAction !== null ||
          state.notice !== null),
    },
    {
      name: 'cleaning_up_operation_shape',
      violated:
        state.operation === 'cleaningUp' &&
        ((state.phase !== 'initializing' &&
          state.phase !== 'authenticated' &&
          state.phase !== 'signedOut') ||
          (state.phase === 'authenticated' && state.user === null) ||
          (state.phase !== 'authenticated' && state.user !== null) ||
          state.sessionUsable ||
          state.errorCode !== null ||
          state.retryAction !== null ||
          state.notice !== null),
    },
  ];

  const failed = invariants.find((invariant) => invariant.violated);
  if (failed) {
    throw new Error(`invalid_mobile_auth_state:${failed.name}`);
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
  signOut(): Promise<void>;
  dispose(): Promise<void>;
};

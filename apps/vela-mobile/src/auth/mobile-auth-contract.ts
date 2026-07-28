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

export type OAuthTokenBundle = {
  accessToken: string;
  idToken: string;
  refreshToken?: string;
  expiresAt: number;
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
  | 'state_mismatch'
  | 'provider_error'
  | 'code_exchange_failed'
  | 'token_validation_failed'
  | 'session_unauthorized'
  | 'session_verification_failed';

export type MobileAuthUser = {
  userId: string;
  email: string | null;
};

export type MobileAuthState = {
  phase: MobileAuthPhase;
  errorCode: MobileAuthErrorCode | null;
  user: MobileAuthUser | null;
};

export type MobileAppAdapter = {
  addListener(
    eventName: 'appUrlOpen',
    listener: (event: { url: string }) => void,
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
  retrySessionVerification(): Promise<void>;
  dispose(): Promise<void>;
};

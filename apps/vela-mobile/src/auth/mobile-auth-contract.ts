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

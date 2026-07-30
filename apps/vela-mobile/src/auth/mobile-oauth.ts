import {
  MOBILE_OAUTH_CALLBACK_URI,
  MOBILE_OAUTH_SCHEME,
  type AuthorizationCodeTokenBundle,
  type MobileOAuthConfig,
  type MobileTokenRequest,
  type OAuthTransaction,
  type ParsedOAuthCallback,
  type RefreshedTokenBundle,
} from './mobile-auth-contract';

const OAUTH_RANDOM_BYTE_LENGTH = 32;
const ID_TOKEN_EXPIRY_SKEW_MS = 60_000;

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

function createRandomBase64UrlValue(crypto: Crypto): string {
  const bytes = new Uint8Array(OAUTH_RANDOM_BYTE_LENGTH);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function invalidTokenResponse(): never {
  throw new Error('Invalid token response');
}

function invalidIdToken(): never {
  throw new Error('Invalid ID token');
}

function decodeJwtPayload(idToken: string): Record<string, unknown> {
  const parts = idToken.split('.');
  if (parts.length !== 3 || !parts[1]) {
    return invalidIdToken();
  }

  try {
    const payload = parts[1].replace(/-/gu, '+').replace(/_/gu, '/');
    if (payload.length % 4 === 1) {
      return invalidIdToken();
    }

    const paddedPayload = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=');
    const decodedBytes = Uint8Array.from(atob(paddedPayload), (character) =>
      character.charCodeAt(0),
    );
    const claims = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decodedBytes));

    if (!isRecord(claims)) {
      return invalidIdToken();
    }

    return claims;
  } catch {
    return invalidIdToken();
  }
}

export function hasOAuthCryptoCapabilities(
  crypto: Crypto | undefined,
  isSecureContext: boolean,
): crypto is Crypto {
  return (
    isSecureContext &&
    crypto !== undefined &&
    typeof crypto.getRandomValues === 'function' &&
    typeof crypto.subtle?.digest === 'function'
  );
}

export function createOAuthTransaction(crypto: Crypto, now: number): OAuthTransaction {
  return {
    state: createRandomBase64UrlValue(crypto),
    codeVerifier: createRandomBase64UrlValue(crypto),
    nonce: createRandomBase64UrlValue(crypto),
    createdAt: now,
  };
}

export async function createPkceChallenge(verifier: string, crypto: Crypto): Promise<string> {
  const verifierBytes = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', verifierBytes);
  return encodeBase64Url(new Uint8Array(digest));
}

export function buildAuthorizationUrl(
  config: MobileOAuthConfig,
  transaction: OAuthTransaction,
  challenge: string,
): string {
  const url = new URL(`https://${config.oauthDomain}/oauth2/authorize`);
  url.search = new URLSearchParams({
    client_id: config.mobileClientId,
    response_type: 'code',
    redirect_uri: MOBILE_OAUTH_CALLBACK_URI,
    scope: 'openid email profile',
    identity_provider: 'Google',
    state: transaction.state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    nonce: transaction.nonce,
  }).toString();
  return url.toString();
}

export function parseOAuthCallback(rawUrl: string): ParsedOAuthCallback {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { kind: 'unrelated' };
  }

  if (url.protocol !== MOBILE_OAUTH_SCHEME) {
    return { kind: 'unrelated' };
  }

  const queryIndex = rawUrl.indexOf('?');
  const fragmentIndex = rawUrl.indexOf('#');
  const pathEnd =
    queryIndex === -1
      ? fragmentIndex === -1
        ? rawUrl.length
        : fragmentIndex
      : fragmentIndex === -1
        ? queryIndex
        : Math.min(queryIndex, fragmentIndex);

  if (
    rawUrl.slice(0, pathEnd) !== MOBILE_OAUTH_CALLBACK_URI ||
    fragmentIndex !== -1 ||
    url.host !== '' ||
    url.hostname !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    url.pathname !== '/oauth/callback' ||
    url.hash !== ''
  ) {
    return { kind: 'malformed' };
  }

  const codes = url.searchParams.getAll('code');
  const states = url.searchParams.getAll('state');
  const errors = url.searchParams.getAll('error');
  const state = states[0];

  if (
    codes.length > 1 ||
    states.length !== 1 ||
    errors.length > 1 ||
    !state ||
    (codes.length === 1 && errors.length === 1)
  ) {
    return { kind: 'malformed' };
  }

  if (errors.length === 1) {
    const providerError = errors[0];
    if (!providerError || codes.length !== 0) {
      return { kind: 'malformed' };
    }

    return {
      kind: 'providerError',
      error: providerError === 'access_denied' ? 'access_denied' : 'other',
      state,
    };
  }

  const code = codes[0];
  if (codes.length !== 1 || !code) {
    return { kind: 'malformed' };
  }

  return { kind: 'success', code, state };
}

function buildTokenRequest(
  config: MobileOAuthConfig,
  formParameters: Record<string, string>,
  options: { timeoutMs?: number } = {},
): MobileTokenRequest {
  const request: MobileTokenRequest = {
    url: `https://${config.oauthDomain}/oauth2/token`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    data: new URLSearchParams(formParameters).toString(),
  };
  if (options.timeoutMs !== undefined) {
    request.timeoutMs = options.timeoutMs;
  }
  return request;
}

export function buildAuthorizationCodeTokenRequest(
  config: MobileOAuthConfig,
  transaction: OAuthTransaction,
  code: string,
  options: { timeoutMs?: number } = {},
): MobileTokenRequest {
  return buildTokenRequest(
    config,
    {
      grant_type: 'authorization_code',
      client_id: config.mobileClientId,
      code,
      redirect_uri: MOBILE_OAUTH_CALLBACK_URI,
      code_verifier: transaction.codeVerifier,
    },
    options,
  );
}

export function buildRefreshTokenRequest(
  config: MobileOAuthConfig,
  refreshToken: string,
  options: { timeoutMs?: number } = {},
): MobileTokenRequest {
  return buildTokenRequest(
    config,
    {
      grant_type: 'refresh_token',
      client_id: config.mobileClientId,
      refresh_token: refreshToken,
    },
    options,
  );
}

function parseTokenResponseBase(
  value: unknown,
  now: number,
  requireRefreshToken: boolean,
): RefreshedTokenBundle {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.access_token) ||
    !isNonEmptyString(value.id_token) ||
    typeof value.expires_in !== 'number' ||
    !Number.isFinite(value.expires_in) ||
    value.expires_in <= 0 ||
    (requireRefreshToken && !isNonEmptyString(value.refresh_token))
  ) {
    return invalidTokenResponse();
  }

  const expiresAt = now + value.expires_in * 1_000;
  if (!Number.isFinite(expiresAt)) {
    return invalidTokenResponse();
  }

  const tokenBundle: RefreshedTokenBundle = {
    accessToken: value.access_token,
    idToken: value.id_token,
    expiresAt,
  };

  if (value.refresh_token !== undefined) {
    if (!isNonEmptyString(value.refresh_token)) {
      return invalidTokenResponse();
    }
    tokenBundle.refreshToken = value.refresh_token;
  }

  return tokenBundle;
}

export function parseAuthorizationCodeTokenResponse(
  value: unknown,
  now: number,
): AuthorizationCodeTokenBundle {
  const parsed = parseTokenResponseBase(value, now, true);
  if (!parsed.refreshToken) return invalidTokenResponse();
  return { ...parsed, refreshToken: parsed.refreshToken };
}

export function parseRefreshTokenResponse(value: unknown, now: number): RefreshedTokenBundle {
  return parseTokenResponseBase(value, now, false);
}

type AuthorizationCodeClaimExpectation = {
  config: MobileOAuthConfig;
  transaction: OAuthTransaction;
  now: number;
};

type RefreshedClaimExpectation = {
  config: MobileOAuthConfig;
  now: number;
  expectedSubject?: string;
};

function validateIdTokenClaimsBase(
  idToken: string,
  expected: {
    config: MobileOAuthConfig;
    now: number;
    expectedNonce?: string;
    expectedSubject?: string;
  },
): string {
  const claims = decodeJwtPayload(idToken);
  const expectedIssuer = `https://cognito-idp.${expected.config.region}.amazonaws.com/${expected.config.userPoolId}`;
  const expiryWithSkew =
    typeof claims.exp === 'number' ? claims.exp * 1_000 + ID_TOKEN_EXPIRY_SKEW_MS : Number.NaN;

  if (
    claims.token_use !== 'id' ||
    typeof claims.aud !== 'string' ||
    claims.aud !== expected.config.mobileClientId ||
    claims.iss !== expectedIssuer ||
    !isNonEmptyString(claims.sub) ||
    (expected.expectedNonce !== undefined && claims.nonce !== expected.expectedNonce) ||
    (expected.expectedSubject !== undefined && claims.sub !== expected.expectedSubject) ||
    typeof claims.exp !== 'number' ||
    !Number.isFinite(claims.exp) ||
    !Number.isFinite(expiryWithSkew) ||
    expiryWithSkew <= expected.now
  ) {
    return invalidIdToken();
  }

  return claims.sub;
}

export function validateAuthorizationCodeIdTokenClaims(
  idToken: string,
  expected: AuthorizationCodeClaimExpectation,
): string {
  return validateIdTokenClaimsBase(idToken, {
    config: expected.config,
    now: expected.now,
    expectedNonce: expected.transaction.nonce,
  });
}

export function validateRefreshedIdTokenClaims(
  idToken: string,
  expected: RefreshedClaimExpectation,
): string {
  return validateIdTokenClaimsBase(idToken, expected);
}

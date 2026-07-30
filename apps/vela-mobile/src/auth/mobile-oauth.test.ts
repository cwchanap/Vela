import { describe, expect, it } from 'vitest';
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
} from './mobile-oauth';
import {
  MOBILE_OAUTH_CALLBACK_URI,
  type MobileOAuthConfig,
  type OAuthTransaction,
} from './mobile-auth-contract';

const config: MobileOAuthConfig = {
  apiUrl: 'https://vela.example/api/',
  userPoolId: 'us-east-1_example',
  mobileClientId: 'mobile-client-id',
  oauthDomain: 'vela.auth.us-east-1.amazoncognito.com',
  region: 'us-east-1',
  callbackUri: MOBILE_OAUTH_CALLBACK_URI,
};

const transaction: OAuthTransaction = {
  state: 'expected-state',
  codeVerifier: 'expected-verifier',
  nonce: 'expected-nonce',
  createdAt: 1_000,
};

function deterministicCrypto(seed: number): Crypto {
  let call = seed;

  return {
    getRandomValues<T extends ArrayBufferView | null>(array: T): T {
      if (!array || !(array instanceof Uint8Array)) {
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
  return base64UrlText(JSON.stringify(value));
}

function base64UrlText(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/u, '');
}

function makeIdToken(payload: unknown): string {
  return `${base64UrlJson({ alg: 'none', typ: 'JWT' })}.${base64UrlJson(payload)}.unsigned`;
}

const validClaims = {
  token_use: 'id',
  aud: config.mobileClientId,
  iss: `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`,
  sub: 'user-123',
  nonce: transaction.nonce,
  exp: 2_000,
};

describe('OAuth crypto primitives', () => {
  it('requires a secure context with random values and SHA-256 digest support', () => {
    const capableCrypto = deterministicCrypto(0);

    expect(hasOAuthCryptoCapabilities(capableCrypto, true)).toBe(true);
    expect(hasOAuthCryptoCapabilities(capableCrypto, false)).toBe(false);
    expect(hasOAuthCryptoCapabilities(undefined, true)).toBe(false);
    expect(hasOAuthCryptoCapabilities({ subtle: capableCrypto.subtle } as Crypto, true)).toBe(
      false,
    );
    expect(
      hasOAuthCryptoCapabilities(
        { getRandomValues: capableCrypto.getRandomValues } as Crypto,
        true,
      ),
    ).toBe(false);
  });

  it('creates independent 32-byte URL-safe transaction values', () => {
    const crypto = deterministicCrypto(0);
    const first = createOAuthTransaction(crypto, 123_456);
    const second = createOAuthTransaction(crypto, 123_457);

    for (const value of [first.codeVerifier, first.state, first.nonce]) {
      expect(value).toHaveLength(43);
      expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(value).not.toContain('=');
    }
    expect(first.createdAt).toBe(123_456);
    expect(second.createdAt).toBe(123_457);
    expect(second.codeVerifier).not.toBe(first.codeVerifier);
    expect(second.state).not.toBe(first.state);
    expect(second.nonce).not.toBe(first.nonce);
  });

  it('produces the RFC 7636 S256 challenge for a known verifier', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

    await expect(createPkceChallenge(verifier, globalThis.crypto)).resolves.toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});

describe('OAuth request builders', () => {
  it('builds the exact direct-to-Google Cognito authorization request', () => {
    const url = new URL(buildAuthorizationUrl(config, transaction, 'pkce-challenge'));

    expect(url.origin).toBe('https://vela.auth.us-east-1.amazoncognito.com');
    expect(url.pathname).toBe('/oauth2/authorize');
    expect([...url.searchParams.keys()].sort()).toEqual(
      [
        'client_id',
        'response_type',
        'redirect_uri',
        'scope',
        'identity_provider',
        'state',
        'code_challenge',
        'code_challenge_method',
        'nonce',
      ].sort(),
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: config.mobileClientId,
      response_type: 'code',
      redirect_uri: MOBILE_OAUTH_CALLBACK_URI,
      scope: 'openid email profile',
      identity_provider: 'Google',
      state: transaction.state,
      code_challenge: 'pkce-challenge',
      code_challenge_method: 'S256',
      nonce: transaction.nonce,
    });
  });

  it('builds the exact public-client native token request without a client secret', () => {
    const request = buildAuthorizationCodeTokenRequest(config, transaction, 'authorization-code');
    const body = new URLSearchParams(request.data);

    expect(request.url).toBe('https://vela.auth.us-east-1.amazoncognito.com/oauth2/token');
    expect(request.method).toBe('POST');
    expect(request.headers).toEqual({
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    expect([...body.keys()].sort()).toEqual(
      ['grant_type', 'client_id', 'code', 'redirect_uri', 'code_verifier'].sort(),
    );
    expect(Object.fromEntries(body)).toEqual({
      grant_type: 'authorization_code',
      client_id: config.mobileClientId,
      code: 'authorization-code',
      redirect_uri: MOBILE_OAUTH_CALLBACK_URI,
      code_verifier: transaction.codeVerifier,
    });
    expect(body.has('client_secret')).toBe(false);
  });

  it('builds the exact refresh-token public-client request', () => {
    const request = buildRefreshTokenRequest(config, 'refresh-token', {
      timeoutMs: 15_000,
    });
    expect(request).toEqual({
      url: `https://${config.oauthDomain}/oauth2/token`,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: config.mobileClientId,
        refresh_token: 'refresh-token',
      }).toString(),
      timeoutMs: 15_000,
    });
    expect(request.data).not.toContain('client_secret');
  });
});

describe('OAuth callback parser', () => {
  it('accepts the exact single-slash callback independent of query order', () => {
    expect(
      parseOAuthCallback(
        `${MOBILE_OAUTH_CALLBACK_URI}?code=authorization-code&state=expected-state`,
      ),
    ).toEqual({
      kind: 'success',
      code: 'authorization-code',
      state: 'expected-state',
    });
    expect(
      parseOAuthCallback(
        `${MOBILE_OAUTH_CALLBACK_URI}?state=expected-state&code=authorization-code`,
      ),
    ).toEqual({
      kind: 'success',
      code: 'authorization-code',
      state: 'expected-state',
    });
  });

  it('decodes both plus and percent-encoded spaces through WHATWG URL semantics', () => {
    expect(
      parseOAuthCallback(`${MOBILE_OAUTH_CALLBACK_URI}?code=code+value&state=state%20value`),
    ).toEqual({
      kind: 'success',
      code: 'code value',
      state: 'state value',
    });
  });

  it.each([
    `${MOBILE_OAUTH_CALLBACK_URI}`,
    `${MOBILE_OAUTH_CALLBACK_URI}?state=expected-state`,
    `${MOBILE_OAUTH_CALLBACK_URI}?code=authorization-code`,
    `${MOBILE_OAUTH_CALLBACK_URI}?code=&state=expected-state`,
    `${MOBILE_OAUTH_CALLBACK_URI}?code=authorization-code&state=`,
    `${MOBILE_OAUTH_CALLBACK_URI}?error=&state=expected-state`,
    `${MOBILE_OAUTH_CALLBACK_URI}?error=access_denied`,
    `${MOBILE_OAUTH_CALLBACK_URI}?code=one&code=two&state=expected-state`,
    `${MOBILE_OAUTH_CALLBACK_URI}?code=authorization-code&state=one&state=two`,
    `${MOBILE_OAUTH_CALLBACK_URI}?error=one&error=two&state=expected-state`,
    `${MOBILE_OAUTH_CALLBACK_URI}?code=authorization-code&error=access_denied&state=expected-state`,
    'dev.cwchanap.vela.oauth://authority/oauth/callback?code=authorization-code&state=expected-state',
    'dev.cwchanap.vela.oauth:///oauth/callback?code=authorization-code&state=expected-state',
    'dev.cwchanap.vela.oauth:/oauth/callback/trailing?code=authorization-code&state=expected-state',
    'dev.cwchanap.vela.oauth://authority:123/oauth/callback?code=authorization-code&state=expected-state',
    'dev.cwchanap.vela.oauth://user:password@authority/oauth/callback?code=authorization-code&state=expected-state',
    `${MOBILE_OAUTH_CALLBACK_URI}?code=authorization-code&state=expected-state#fragment`,
    `${MOBILE_OAUTH_CALLBACK_URI}?code=authorization-code&state=expected-state#`,
  ])('rejects malformed same-scheme callback %s', (rawUrl) => {
    expect(parseOAuthCallback(rawUrl)).toEqual({ kind: 'malformed' });
  });

  it('maps provider cancellation and other provider errors without exposing details', () => {
    expect(
      parseOAuthCallback(`${MOBILE_OAUTH_CALLBACK_URI}?error=access_denied&state=expected-state`),
    ).toEqual({
      kind: 'providerError',
      error: 'access_denied',
      state: 'expected-state',
    });
    expect(
      parseOAuthCallback(
        `${MOBILE_OAUTH_CALLBACK_URI}?state=expected-state&error=server_error&error_description=secret`,
      ),
    ).toEqual({
      kind: 'providerError',
      error: 'other',
      state: 'expected-state',
    });
  });

  it.each([
    'https://vela.example/oauth/callback?code=authorization-code&state=expected-state',
    'other.scheme:/oauth/callback?code=authorization-code&state=expected-state',
    'not a URL',
  ])('ignores unrelated URL %s', (rawUrl) => {
    expect(parseOAuthCallback(rawUrl)).toEqual({ kind: 'unrelated' });
  });
});

describe('OAuth token parsing and ID-token claim validation', () => {
  it('parses required authorization-code token fields and derives the expiry timestamp', () => {
    expect(
      parseAuthorizationCodeTokenResponse(
        {
          access_token: 'access-token',
          id_token: 'id-token',
          refresh_token: 'refresh-token',
          token_type: 'Bearer',
          expires_in: 3_600,
        },
        1_000,
      ),
    ).toEqual({
      accessToken: 'access-token',
      idToken: 'id-token',
      refreshToken: 'refresh-token',
      expiresAt: 3_601_000,
    });
  });

  it('retains a rotated refresh token from refresh success', () => {
    expect(
      parseRefreshTokenResponse(
        {
          access_token: 'access-token',
          id_token: 'id-token',
          refresh_token: 'refresh-token',
          expires_in: 3_600,
        },
        1_000,
      ),
    ).toEqual({
      accessToken: 'access-token',
      idToken: 'id-token',
      refreshToken: 'refresh-token',
      expiresAt: 3_601_000,
    });
  });

  it('requires a refresh token from authorization-code success', () => {
    expect(() =>
      parseAuthorizationCodeTokenResponse(
        { access_token: 'access', id_token: 'id', expires_in: 3600 },
        1_000,
      ),
    ).toThrow('Invalid token response');
  });

  it('permits refresh-token omission from refresh success', () => {
    expect(
      parseRefreshTokenResponse(
        { access_token: 'access', id_token: 'id', expires_in: 3600 },
        1_000,
      ),
    ).toEqual({
      accessToken: 'access',
      idToken: 'id',
      expiresAt: 3_601_000,
    });
  });

  it.each([
    null,
    [],
    {},
    { access_token: '', id_token: 'id-token', expires_in: 3_600 },
    { access_token: 'access-token', id_token: '', expires_in: 3_600 },
    { access_token: 'access-token', id_token: 'id-token' },
    { access_token: 'access-token', id_token: 'id-token', expires_in: 0 },
    { access_token: 'access-token', id_token: 'id-token', expires_in: Number.NaN },
    {
      access_token: 'access-token',
      id_token: 'id-token',
      expires_in: 3_600,
      refresh_token: '',
    },
    {
      access_token: 'access-token',
      id_token: 'id-token',
      expires_in: 3_600,
      refresh_token: ' \t\n',
    },
  ])('rejects malformed token response %#', (value) => {
    expect(() => parseAuthorizationCodeTokenResponse(value, 1_000)).toThrow(
      'Invalid token response',
    );
  });

  it('accepts exact valid mobile ID-token claims without local signature verification', () => {
    expect(
      validateAuthorizationCodeIdTokenClaims(makeIdToken(validClaims), {
        config,
        transaction,
        now: 2_000_000 - 59_999,
      }),
    ).toBe('user-123');
  });

  it('validates a refreshed ID token without nonce and returns its subject', () => {
    const idToken = makeIdToken({
      token_use: 'id',
      aud: config.mobileClientId,
      iss: `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`,
      sub: 'user-1',
      exp: 3_600,
    });
    expect(
      validateRefreshedIdTokenClaims(idToken, {
        config,
        now: 1_000,
        expectedSubject: 'user-1',
      }),
    ).toBe('user-1');
  });

  it.each([
    ['missing subject', undefined, undefined],
    ['empty subject', '', undefined],
    ['subject mismatch', 'user-2', 'user-1'],
  ] as const)('rejects %s', (_label, subject, expectedSubject) => {
    const idToken = makeIdToken({
      token_use: 'id',
      aud: config.mobileClientId,
      iss: `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`,
      sub: subject,
      exp: 3_600,
    });
    expect(() =>
      validateRefreshedIdTokenClaims(idToken, {
        config,
        now: 1_000,
        ...(expectedSubject ? { expectedSubject } : {}),
      }),
    ).toThrow('Invalid ID token');
  });

  it.each([
    ['wrong token use', { ...validClaims, token_use: 'access' }],
    ['missing subject', { ...validClaims, sub: undefined }],
    ['empty subject', { ...validClaims, sub: '' }],
    ['missing audience', { ...validClaims, aud: undefined }],
    ['non-string audience', { ...validClaims, aud: 123 }],
    ['array audience', { ...validClaims, aud: [config.mobileClientId] }],
    ['wrong audience', { ...validClaims, aud: 'web-client-id' }],
    ['wrong issuer', { ...validClaims, iss: 'https://issuer.example' }],
    ['wrong nonce', { ...validClaims, nonce: 'wrong-nonce' }],
    ['missing expiry', { ...validClaims, exp: undefined }],
    ['non-numeric expiry', { ...validClaims, exp: '2000' }],
  ])('rejects %s', (_name, claims) => {
    expect(() =>
      validateAuthorizationCodeIdTokenClaims(makeIdToken(claims), {
        config,
        transaction,
        now: 1_000,
      }),
    ).toThrow('Invalid ID token');
  });

  it('rejects a non-finite expiry decoded from a JSON numeric overflow', () => {
    const serialized = JSON.stringify(validClaims);
    const rawClaims = serialized.replace('"exp":2000', '"exp":1e400');
    expect(rawClaims).not.toEqual(serialized);
    expect(rawClaims).toContain('1e400');
    const idToken = `${base64UrlJson({ alg: 'none' })}.${base64UrlText(rawClaims)}.unsigned`;

    expect(() =>
      validateAuthorizationCodeIdTokenClaims(idToken, {
        config,
        transaction,
        now: 1_000,
      }),
    ).toThrow('Invalid ID token');
  });

  it('rejects expiry at the exact 60-second skew boundary', () => {
    const idToken = makeIdToken({ ...validClaims, exp: 2_000 });

    expect(() =>
      validateAuthorizationCodeIdTokenClaims(idToken, {
        config,
        transaction,
        now: 2_060_000,
      }),
    ).toThrow('Invalid ID token');
    expect(() =>
      validateAuthorizationCodeIdTokenClaims(idToken, {
        config,
        transaction,
        now: 2_059_999,
      }),
    ).not.toThrow();
  });

  it.each([
    '',
    'not-a-jwt',
    'one.two',
    'one.two.three.four',
    'header.%%%.signature',
    `header.${base64UrlJson('not an object')}.signature`,
    `header.${btoa('{not-json')}.signature`,
  ])('rejects malformed JWT %s without echoing it', (idToken) => {
    let thrown: unknown;

    try {
      validateAuthorizationCodeIdTokenClaims(idToken, { config, transaction, now: 1_000 });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('Invalid ID token');
    if (idToken !== '') {
      expect((thrown as Error).message).not.toContain(idToken);
    }
  });
});

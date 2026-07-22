import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AuthStack } from '../lib/auth-stack';

describe('AuthStack', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.ALLOW_LOCAL_OAUTH_PLACEHOLDERS = 'true';
    process.env.COGNITO_DOMAIN_PREFIX = 'vela-test-auth';
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET_NAME = 'vela/test-google-oauth-client-secret';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function synthesizeStack() {
    const app = new App();
    const stack = new AuthStack(app, 'TestAuthStack', {
      env: {
        account: '123456789012',
        region: 'us-east-1',
      },
    });
    return { stack, template: Template.fromStack(stack) };
  }

  function synthesizeTemplate(): Template {
    return synthesizeStack().template;
  }

  test('configures Google as the hosted UI identity provider', () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties('AWS::Cognito::UserPoolIdentityProvider', {
      ProviderName: 'Google',
      ProviderType: 'Google',
      AttributeMapping: {
        email: 'email',
        email_verified: 'email_verified',
        name: 'name',
        picture: 'picture',
      },
      ProviderDetails: {
        client_id: 'test-google-client-id.apps.googleusercontent.com',
        client_secret: {
          Ref: 'GoogleOAuthClientSecret',
        },
        authorize_scopes: 'profile email openid',
      },
    });
  });

  test('creates a managed Secrets Manager secret from a no-echo deploy parameter', () => {
    const template = synthesizeTemplate();

    template.hasParameter('GoogleOAuthClientSecret', {
      Type: 'String',
      NoEcho: true,
      Default: 'local-synth-only',
    });

    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: 'vela/test-google-oauth-client-secret',
      SecretString: {
        Ref: 'GoogleOAuthClientSecret',
      },
    });
  });

  test('configures the user pool app client for Google-only OAuth code flow', () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'vela-web-client',
      SupportedIdentityProviders: ['Google'],
      AllowedOAuthFlows: ['code'],
      AllowedOAuthFlowsUserPoolClient: true,
      AllowedOAuthScopes: Match.arrayWith(['openid', 'email', 'profile']),
      ExplicitAuthFlows: ['ALLOW_REFRESH_TOKEN_AUTH'],
      CallbackURLs: Match.arrayWith([
        'https://vela.cwchanap.dev/auth/callback',
        'http://localhost:9000/auth/callback',
        'http://127.0.0.1:9000/auth/callback',
      ]),
      LogoutURLs: Match.arrayWith([
        'https://vela.cwchanap.dev/auth/login',
        'http://localhost:9000/auth/login',
        'http://127.0.0.1:9000/auth/login',
      ]),
    });
  });

  test('creates the configured Cognito hosted UI domain', () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties('AWS::Cognito::UserPoolDomain', {
      Domain: 'vela-test-auth',
    });
  });

  test('defaults the Cognito hosted UI domain prefix from CDK', () => {
    delete process.env.COGNITO_DOMAIN_PREFIX;

    const template = synthesizeTemplate();

    template.hasResourceProperties('AWS::Cognito::UserPoolDomain', {
      Domain: 'vela-cwchanap-auth',
    });
  });

  test('uses only the expected OAuth scopes', () => {
    const template = synthesizeTemplate();
    const clients = template.findResources('AWS::Cognito::UserPoolClient');
    const client = Object.values(clients).find(
      (c) => c.Properties.ClientName === 'vela-web-client',
    );

    expect(client).toBeDefined();
    expect(client!.Properties.AllowedOAuthScopes.toSorted()).toEqual([
      'email',
      'openid',
      'profile',
    ]);
  });

  test('creates a separate test client with admin auth flow enabled', () => {
    const template = synthesizeTemplate();
    const clients = template.findResources('AWS::Cognito::UserPoolClient');

    const allClients = Object.values(clients);
    expect(allClients.length).toBe(3);

    const testClient = allClients.find((c) => c.Properties.ClientName === 'vela-test-client');
    expect(testClient).toBeDefined();
    expect(testClient!.Properties.ExplicitAuthFlows).toContain('ALLOW_ADMIN_USER_PASSWORD_AUTH');
    expect(testClient!.Properties.ExplicitAuthFlows).toContain('ALLOW_REFRESH_TOKEN_AUTH');
    expect(testClient!.Properties.SupportedIdentityProviders).toEqual(['COGNITO']);
    // OAuth is disabled — this client should never be used with Hosted UI flows
    expect(testClient!.Properties.AllowedOAuthFlowsUserPoolClient).toBe(false);
  });

  test('test client is distinct from the production web client', () => {
    const template = synthesizeTemplate();
    const clients = template.findResources('AWS::Cognito::UserPoolClient');

    const allClients = Object.values(clients);
    expect(allClients.length).toBe(3);

    const webClient = allClients.find((c) => c.Properties.ClientName === 'vela-web-client');
    const testClient = allClients.find((c) => c.Properties.ClientName === 'vela-test-client');

    // Web client has Google identity provider and code flow; test client does not
    expect(webClient!.Properties.SupportedIdentityProviders).toEqual(['Google']);
    expect(webClient!.Properties.AllowedOAuthFlows).toEqual(['code']);
    expect(testClient!.Properties.SupportedIdentityProviders).not.toContain('Google');
    expect(testClient!.Properties.ExplicitAuthFlows).toContain('ALLOW_ADMIN_USER_PASSWORD_AUTH');
  });

  test('does not synthesize the GitHub Actions secret value into the template', () => {
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'plaintext-secret-from-github-actions';

    const template = synthesizeTemplate();

    expect(JSON.stringify(template.toJSON())).not.toContain('plaintext-secret-from-github-actions');
  });

  test('requires a Google OAuth client id outside local placeholder mode', () => {
    delete process.env.NODE_ENV;
    delete process.env.ALLOW_LOCAL_OAUTH_PLACEHOLDERS;
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;

    expect(() => synthesizeTemplate()).toThrow(
      'Missing GOOGLE_OAUTH_CLIENT_ID. Set it to your Google OAuth web client id, or set ALLOW_LOCAL_OAUTH_PLACEHOLDERS=true for local-only synth.',
    );
  });

  test('defaults the managed Google OAuth client secret name outside local placeholder mode', () => {
    delete process.env.NODE_ENV;
    delete process.env.ALLOW_LOCAL_OAUTH_PLACEHOLDERS;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET_NAME;

    const template = synthesizeTemplate();

    template.hasParameter('GoogleOAuthClientSecret', {
      Type: 'String',
      NoEcho: true,
    });
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: 'vela/google-oauth-client-secret',
    });
  });

  test('uses custom callback and logout URLs from env vars', () => {
    process.env.COGNITO_CALLBACK_URLS =
      'https://staging.example.com/auth/callback,http://localhost:9000/auth/callback';
    process.env.COGNITO_LOGOUT_URLS =
      'https://staging.example.com/auth/login,http://localhost:9000/auth/login';

    const template = synthesizeTemplate();

    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'vela-web-client',
      CallbackURLs: [
        'https://staging.example.com/auth/callback',
        'http://localhost:9000/auth/callback',
      ],
      LogoutURLs: ['https://staging.example.com/auth/login', 'http://localhost:9000/auth/login'],
    });
  });

  test('falls back to default callback and logout URLs when env vars are empty', () => {
    process.env.COGNITO_CALLBACK_URLS = '';
    process.env.COGNITO_LOGOUT_URLS = '   ';

    const template = synthesizeTemplate();

    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'vela-web-client',
      CallbackURLs: Match.arrayWith([
        'https://vela.cwchanap.dev/auth/callback',
        'http://localhost:9000/auth/callback',
        'http://127.0.0.1:9000/auth/callback',
      ]),
      LogoutURLs: Match.arrayWith([
        'https://vela.cwchanap.dev/auth/login',
        'http://localhost:9000/auth/login',
        'http://127.0.0.1:9000/auth/login',
      ]),
    });
  });

  test('includes localhost OAuth URLs in deployed (non-placeholder) mode', () => {
    delete process.env.ALLOW_LOCAL_OAUTH_PLACEHOLDERS;
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'deployed-client-id.apps.googleusercontent.com';

    const template = synthesizeTemplate();

    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'vela-web-client',
      CallbackURLs: Match.arrayWith([
        'https://vela.cwchanap.dev/auth/callback',
        'http://localhost:9000/auth/callback',
        'http://127.0.0.1:9000/auth/callback',
      ]),
      LogoutURLs: Match.arrayWith([
        'https://vela.cwchanap.dev/auth/login',
        'http://localhost:9000/auth/login',
        'http://127.0.0.1:9000/auth/login',
      ]),
    });
  });

  test('mobile client uses the iOS custom-scheme callback and logout URIs', () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'vela-mobile-client',
      CallbackURLs: ['dev.cwchanap.vela.oauth://oauth/callback'],
      LogoutURLs: ['dev.cwchanap.vela.oauth://oauth/logout'],
    });
  });

  test('creates a dedicated public mobile client with PKCE-compatible OAuth', () => {
    const template = synthesizeTemplate();
    const clients = template.findResources('AWS::Cognito::UserPoolClient');
    const mobile = Object.values(clients).find(
      (c) => c.Properties.ClientName === 'vela-mobile-client',
    );

    expect(mobile).toBeDefined();
    expect(mobile!.Properties.GenerateSecret).toBeFalsy();
    expect(mobile!.Properties.AllowedOAuthFlows).toEqual(['code']);
    expect(mobile!.Properties.AllowedOAuthFlowsUserPoolClient).toBe(true);
    expect(mobile!.Properties.SupportedIdentityProviders).toEqual(['Google']);
    expect(mobile!.Properties.AllowedOAuthScopes.toSorted()).toEqual([
      'email',
      'openid',
      'profile',
    ]);
    expect(mobile!.Properties.ExplicitAuthFlows).toEqual(['ALLOW_REFRESH_TOKEN_AUTH']);
  });

  test('mobile callback/logout URIs are overridable via env vars (same-scheme only)', () => {
    process.env.COGNITO_MOBILE_CALLBACK_URLS =
      'dev.cwchanap.vela.oauth://oauth/staging-callback,dev.cwchanap.vela.oauth://oauth/callback';
    process.env.COGNITO_MOBILE_LOGOUT_URLS = 'dev.cwchanap.vela.oauth://oauth/staging-logout';

    const template = synthesizeTemplate();
    const clients = template.findResources('AWS::Cognito::UserPoolClient');
    const byName = (name: string) =>
      Object.values(clients).find((c) => c.Properties.ClientName === name);

    const mobile = byName('vela-mobile-client');
    expect(mobile!.Properties.CallbackURLs).toEqual([
      'dev.cwchanap.vela.oauth://oauth/staging-callback',
      'dev.cwchanap.vela.oauth://oauth/callback',
    ]);
    expect(mobile!.Properties.LogoutURLs).toEqual([
      'dev.cwchanap.vela.oauth://oauth/staging-logout',
    ]);

    const web = byName('vela-web-client');
    expect(web!.Properties.CallbackURLs).toEqual(
      expect.arrayContaining([
        'https://vela.cwchanap.dev/auth/callback',
        'http://localhost:9000/auth/callback',
      ]),
    );
    expect(web!.Properties.LogoutURLs).toEqual(
      expect.arrayContaining([
        'https://vela.cwchanap.dev/auth/login',
        'http://localhost:9000/auth/login',
      ]),
    );
  });

  test('mobile callback/logout URIs fall back to defaults when env vars are empty', () => {
    process.env.COGNITO_MOBILE_CALLBACK_URLS = '';
    process.env.COGNITO_MOBILE_LOGOUT_URLS = '   ';

    const template = synthesizeTemplate();

    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      ClientName: 'vela-mobile-client',
      CallbackURLs: ['dev.cwchanap.vela.oauth://oauth/callback'],
      LogoutURLs: ['dev.cwchanap.vela.oauth://oauth/logout'],
    });
  });

  test('rejects mobile callback/logout URIs that do not use the registered scheme', () => {
    process.env.COGNITO_MOBILE_CALLBACK_URLS = 'dev.cwchanap.vela.dev://oauth/callback';

    // Wrong-scheme branch: message names the scheme, not the path.
    expect(() => synthesizeTemplate()).toThrow(
      /COGNITO_MOBILE_CALLBACK_URLS must use the dev\.cwchanap\.vela\.oauth:\/\/ scheme \(Info\.plist only registers that scheme\)\. Got: dev\.cwchanap\.vela\.dev:\/\/oauth\/callback/,
    );

    process.env.COGNITO_MOBILE_CALLBACK_URLS = '';
    process.env.COGNITO_MOBILE_LOGOUT_URLS = 'dev.cwchanap.vela.dev://oauth/logout';

    expect(() => synthesizeTemplate()).toThrow(
      /COGNITO_MOBILE_LOGOUT_URLS must use the dev\.cwchanap\.vela\.oauth:\/\/ scheme \(Info\.plist only registers that scheme\)\. Got: dev\.cwchanap\.vela\.dev:\/\/oauth\/logout/,
    );
  });

  test('rejects mobile URIs with the right scheme but an empty path', () => {
    process.env.COGNITO_MOBILE_CALLBACK_URLS = 'dev.cwchanap.vela.oauth://';

    // Right-scheme / bad-path branch: message names the path, not the scheme.
    expect(() => synthesizeTemplate()).toThrow(
      /COGNITO_MOBILE_CALLBACK_URLS must include a non-empty, non-whitespace path after dev\.cwchanap\.vela\.oauth:\/\/ \(query-only and fragment-only URIs have no path; the app's router would have no matching route\)\. Got: dev\.cwchanap\.vela\.oauth:\/\/$/,
    );

    process.env.COGNITO_MOBILE_CALLBACK_URLS = '';
    process.env.COGNITO_MOBILE_LOGOUT_URLS = 'dev.cwchanap.vela.oauth://';

    expect(() => synthesizeTemplate()).toThrow(
      /COGNITO_MOBILE_LOGOUT_URLS must include a non-empty, non-whitespace path after dev\.cwchanap\.vela\.oauth:\/\/ \(query-only and fragment-only URIs have no path; the app's router would have no matching route\)\. Got: dev\.cwchanap\.vela\.oauth:\/\/$/,
    );
  });

  test('rejects mobile URIs with a whitespace-only path', () => {
    // `parseCommaList` trims each entry before `assertMobileScheme` sees
    // it, so `dev.cwchanap.vela.oauth:// ` arrives as
    // `dev.cwchanap.vela.oauth://` — the trailing space is already gone.
    // The path-empty check then rejects it. (Internal whitespace within
    // a path is NOT trimmed by `parseCommaList` and is caught by the
    // raw-string whitespace check — see the internal-whitespace test.)
    process.env.COGNITO_MOBILE_CALLBACK_URLS = 'dev.cwchanap.vela.oauth:// ';

    expect(() => synthesizeTemplate()).toThrow(
      /COGNITO_MOBILE_CALLBACK_URLS must include a non-empty, non-whitespace path after dev\.cwchanap\.vela\.oauth:\/\/ \(query-only and fragment-only URIs have no path; the app's router would have no matching route\)\. Got: dev\.cwchanap\.vela\.oauth:\/\/$/,
    );
  });

  test('rejects mobile URIs with an authority-only path (no pathname)', () => {
    // `dev.cwchanap.vela.oauth://oauth` has `oauth` as the host and an empty
    // pathname per WHATWG URL parsing. A regex like `[^\s?#]+` would accept it
    // (treating `oauth` as the path), but the app's router would have no
    // matching route because the path that distinguishes callback vs logout
    // is missing. `new URL()` correctly assigns `oauth` to `host` and leaves
    // `pathname` empty, which the validator rejects.
    process.env.COGNITO_MOBILE_CALLBACK_URLS = 'dev.cwchanap.vela.oauth://oauth';

    expect(() => synthesizeTemplate()).toThrow(
      /COGNITO_MOBILE_CALLBACK_URLS must include a non-empty, non-whitespace path after dev\.cwchanap\.vela\.oauth:\/\/ \(query-only and fragment-only URIs have no path; the app's router would have no matching route\)\. Got: dev\.cwchanap\.vela\.oauth:\/\/oauth$/,
    );

    process.env.COGNITO_MOBILE_CALLBACK_URLS = '';
    process.env.COGNITO_MOBILE_LOGOUT_URLS = 'dev.cwchanap.vela.oauth://oauth';

    expect(() => synthesizeTemplate()).toThrow(
      /COGNITO_MOBILE_LOGOUT_URLS must include a non-empty, non-whitespace path after dev\.cwchanap\.vela\.oauth:\/\/ \(query-only and fragment-only URIs have no path; the app's router would have no matching route\)\. Got: dev\.cwchanap\.vela\.oauth:\/\/oauth$/,
    );
  });

  test('rejects mobile URIs with a root-only path (slash after authority)', () => {
    // `dev.cwchanap.vela.oauth://oauth/` has pathname `/` — the authority is
    // present but the path is just the root slash, which does not distinguish
    // callback from logout. The app's router would have no matching route.
    process.env.COGNITO_MOBILE_CALLBACK_URLS = 'dev.cwchanap.vela.oauth://oauth/';

    expect(() => synthesizeTemplate()).toThrow(
      /COGNITO_MOBILE_CALLBACK_URLS must include a non-empty, non-whitespace path after dev\.cwchanap\.vela\.oauth:\/\/.*Got: dev\.cwchanap\.vela\.oauth:\/\/oauth\/$/,
    );

    process.env.COGNITO_MOBILE_CALLBACK_URLS = '';
    process.env.COGNITO_MOBILE_LOGOUT_URLS = 'dev.cwchanap.vela.oauth://oauth/';

    expect(() => synthesizeTemplate()).toThrow(
      /COGNITO_MOBILE_LOGOUT_URLS must include a non-empty, non-whitespace path after dev\.cwchanap\.vela\.oauth:\/\/.*Got: dev\.cwchanap\.vela\.oauth:\/\/oauth\/$/,
    );
  });

  test('rejects mobile URIs with a query-only or fragment-only suffix', () => {
    // A URI like `scheme://?foo` has no path component; `\S+` alone would
    // accept it because `?` is non-whitespace. The app's router would have
    // no matching route for the empty path → callback silently dropped.
    process.env.COGNITO_MOBILE_CALLBACK_URLS = 'dev.cwchanap.vela.oauth://?code=abc';

    expect(() => synthesizeTemplate()).toThrow(
      /COGNITO_MOBILE_CALLBACK_URLS must include a non-empty, non-whitespace path after dev\.cwchanap\.vela\.oauth:\/\//,
    );

    // `scheme://#bar` is rejected by the raw-string `#` check (before
    // parsing) with a fragment-specific error — Cognito rejects any
    // redirect URI containing a fragment component, regardless of path.
    process.env.COGNITO_MOBILE_CALLBACK_URLS = '';
    process.env.COGNITO_MOBILE_LOGOUT_URLS = 'dev.cwchanap.vela.oauth://#fragment';

    expect(() => synthesizeTemplate()).toThrow(
      /COGNITO_MOBILE_LOGOUT_URLS must not contain a fragment \(Cognito rejects redirect URIs with a `#` component\)\. Got: dev\.cwchanap\.vela\.oauth:\/\/#fragment/,
    );
  });

  test('rejects mobile URIs that contain a fragment after a real path', () => {
    // Cognito rejects callback/logout URLs containing a fragment component
    // (see CreateUserPoolClient docs: "Not include a fragment component").
    // Without this guard, synth succeeds and deploy fails at the
    // AWS::Cognito::UserPoolClient resource.
    process.env.COGNITO_MOBILE_CALLBACK_URLS = 'dev.cwchanap.vela.oauth://oauth/callback#fragment';

    expect(() => synthesizeTemplate()).toThrow(
      /COGNITO_MOBILE_CALLBACK_URLS must not contain a fragment \(Cognito rejects redirect URIs with a `#` component\)\. Got: dev\.cwchanap\.vela\.oauth:\/\/oauth\/callback#fragment/,
    );

    process.env.COGNITO_MOBILE_CALLBACK_URLS = '';
    process.env.COGNITO_MOBILE_LOGOUT_URLS = 'dev.cwchanap.vela.oauth://oauth/logout#fragment';

    expect(() => synthesizeTemplate()).toThrow(
      /COGNITO_MOBILE_LOGOUT_URLS must not contain a fragment \(Cognito rejects redirect URIs with a `#` component\)\. Got: dev\.cwchanap\.vela\.oauth:\/\/oauth\/logout#fragment/,
    );
  });

  test('rejects mobile URIs with a bare trailing `#` (empty fragment)', () => {
    // Regression: `new URL('...#').hash === ''`, so the old `parsed.hash`
    // check did not reject a trailing `#`. But the raw string still
    // contains `#`, and Cognito rejects any redirect URI with a fragment
    // component — including a bare trailing `#` with empty fragment.
    // The raw-string `uri.includes('#')` check catches this before parsing.
    process.env.COGNITO_MOBILE_CALLBACK_URLS = 'dev.cwchanap.vela.oauth://oauth/callback#';

    expect(() => synthesizeTemplate()).toThrow(
      /COGNITO_MOBILE_CALLBACK_URLS must not contain a fragment \(Cognito rejects redirect URIs with a `#` component\)\. Got: dev\.cwchanap\.vela\.oauth:\/\/oauth\/callback#$/,
    );

    process.env.COGNITO_MOBILE_CALLBACK_URLS = '';
    process.env.COGNITO_MOBILE_LOGOUT_URLS = 'dev.cwchanap.vela.oauth://oauth/logout#';

    expect(() => synthesizeTemplate()).toThrow(
      /COGNITO_MOBILE_LOGOUT_URLS must not contain a fragment \(Cognito rejects redirect URIs with a `#` component\)\. Got: dev\.cwchanap\.vela\.oauth:\/\/oauth\/logout#$/,
    );
  });

  test('rejects mobile URIs with internal whitespace in an otherwise valid path', () => {
    // Regression: `new URL()` percent-encodes spaces and silently strips
    // tabs/newlines, so `parsed.pathname` looks valid while the raw string
    // passed to Cognito contains whitespace that Cognito's redirect URI
    // pattern excludes. The raw-string `/\s/u` check catches these before
    // parsing.
    const cases = [
      'dev.cwchanap.vela.oauth://oauth/callback trailing',
      'dev.cwchanap.vela.oauth://oauth/callback\tsuffix',
      'dev.cwchanap.vela.oauth://oauth/callback\nsuffix',
    ];

    for (const uri of cases) {
      process.env.COGNITO_MOBILE_CALLBACK_URLS = uri;
      expect(() => synthesizeTemplate()).toThrow(
        /COGNITO_MOBILE_CALLBACK_URLS must not contain whitespace \(Cognito rejects redirect URIs containing whitespace characters\)\. Got: dev\.cwchanap\.vela\.oauth:\/\/oauth\/callback[\s\S]*$/,
      );
      process.env.COGNITO_MOBILE_CALLBACK_URLS = '';
    }

    // Logout URLs: same bypass, same fix.
    const logoutCases = [
      'dev.cwchanap.vela.oauth://oauth/logout trailing',
      'dev.cwchanap.vela.oauth://oauth/logout\tsuffix',
      'dev.cwchanap.vela.oauth://oauth/logout\nsuffix',
    ];

    for (const uri of logoutCases) {
      process.env.COGNITO_MOBILE_LOGOUT_URLS = uri;
      expect(() => synthesizeTemplate()).toThrow(
        /COGNITO_MOBILE_LOGOUT_URLS must not contain whitespace \(Cognito rejects redirect URIs containing whitespace characters\)\. Got: dev\.cwchanap\.vela\.oauth:\/\/oauth\/logout[\s\S]*$/,
      );
      process.env.COGNITO_MOBILE_LOGOUT_URLS = '';
    }
  });

  test('mobile client is distinct from web and test clients', () => {
    const template = synthesizeTemplate();
    const clients = Object.values(template.findResources('AWS::Cognito::UserPoolClient'));

    const byName = (name: string) => clients.find((c) => c.Properties.ClientName === name);

    expect(byName('vela-web-client')).toBeDefined();
    expect(byName('vela-test-client')).toBeDefined();
    expect(byName('vela-mobile-client')).toBeDefined();

    const names = clients.map((c) => c.Properties.ClientName);
    expect(new Set(names).size).toBe(3);
  });

  test('web client OAuth flow, scopes, and redirect URIs are preserved after the mobile client addition', () => {
    const template = synthesizeTemplate();
    const clients = template.findResources('AWS::Cognito::UserPoolClient');
    const web = Object.values(clients).find((c) => c.Properties.ClientName === 'vela-web-client');

    expect(web!.Properties.SupportedIdentityProviders).toEqual(['Google']);
    expect(web!.Properties.AllowedOAuthFlows).toEqual(['code']);
    expect(web!.Properties.AllowedOAuthFlowsUserPoolClient).toBe(true);
    expect(web!.Properties.AllowedOAuthScopes.toSorted()).toEqual(['email', 'openid', 'profile']);
    expect(web!.Properties.ExplicitAuthFlows).toEqual(['ALLOW_REFRESH_TOKEN_AUTH']);
    expect(web!.Properties.GenerateSecret).toBeFalsy();
    expect(web!.Properties.CallbackURLs).toEqual(
      expect.arrayContaining([
        'https://vela.cwchanap.dev/auth/callback',
        'http://localhost:9000/auth/callback',
        'http://127.0.0.1:9000/auth/callback',
      ]),
    );
    expect(web!.Properties.LogoutURLs).toEqual(
      expect.arrayContaining([
        'https://vela.cwchanap.dev/auth/login',
        'http://localhost:9000/auth/login',
        'http://127.0.0.1:9000/auth/login',
      ]),
    );
  });

  test('exposes the mobile client as a public field on AuthStack', () => {
    const { stack } = synthesizeStack();

    expect(stack.mobileUserPoolClient).toBeDefined();
    expect(stack.mobileUserPoolClient.userPoolClientId).toBeDefined();
  });

  // Pins the intentional enableTokenRevocation: true hardening applied to
  // every client. It adds origin_jti/jti claims to access and ID tokens and
  // enables the RevokeToken endpoint; pinning the synthesized template
  // prevents a future refactor from silently dropping it. See auth-stack.ts
  // for the rationale and the security-scope caveat (revocation does not
  // immediately invalidate already-issued bearer tokens verified locally by
  // the Vela API).
  test('pins enableTokenRevocation=true on all three clients', () => {
    const template = synthesizeTemplate();
    const clients = Object.values(template.findResources('AWS::Cognito::UserPoolClient'));

    expect(clients.length).toBe(3);
    for (const client of clients) {
      expect(client.Properties.ClientName).toMatch(/^vela-(web|mobile|test)-client$/);
      expect(client.Properties.EnableTokenRevocation).toBe(true);
    }
  });

  // Cross-layer contract test: the iOS custom URL scheme registered in
  // Info.plist must match the scheme used in the CDK mobile client's
  // callback/logout URIs. The scheme is hardcoded independently in CDK
  // source (MOBILE_OAUTH_SCHEME) and in Info.plist (CFBundleURLSchemes).
  // Without this test, a change to one without the other would leave all
  // existing tests green while OAuth callbacks fail on-device: iOS would
  // not dispatch the CDK-configured callback URL to the app (or vice
  // versa, the app would register a scheme Cognito never sends).
  //
  // This test reads the Info.plist directly (cross-package file read, no
  // runtime dependency) and compares the scheme against the mobile
  // client's synthesized CallbackURLs. The mobile info-plist.test.ts
  // suite independently asserts the plist structure; this test only
  // bridges the two packages' scheme constants.
  test('CDK mobile callback scheme matches the iOS Info.plist CFBundleURLSchemes entry', () => {
    // Extract the scheme from the synthesized CDK template.
    const template = synthesizeTemplate();
    const clients = template.findResources('AWS::Cognito::UserPoolClient');
    const mobile = Object.values(clients).find(
      (c) => c.Properties.ClientName === 'vela-mobile-client',
    );
    expect(mobile).toBeDefined();
    const cdkCallbackUrl = mobile!.Properties.CallbackURLs[0] as string;
    const cdkScheme = cdkCallbackUrl.split('://')[0];

    // Extract the scheme from Info.plist. The plist is XML text; a regex
    // on the CFBundleURLSchemes array is sufficient (the mobile test suite
    // already validates the plist structure more thoroughly).
    const plistPath = resolve(
      __dirname,
      '../../../apps/vela-mobile/src-capacitor/ios/App/App/Info.plist',
    );
    const plistContent = readFileSync(plistPath, 'utf8');

    // Guard against binary plists — would produce a misleading failure.
    expect(
      !plistContent.startsWith('bplist'),
      `${plistPath} is a binary plist. Convert it: plutil -convert xml1 "${plistPath}".`,
    ).toBe(true);

    const schemesBlock = plistContent.match(
      /<key>CFBundleURLSchemes<\/key>\s*<array>([\s\S]*?)<\/array>/,
    );
    expect(schemesBlock, 'CFBundleURLSchemes entry not found in Info.plist').not.toBeNull();
    const plistSchemes: string[] = [];
    const stringRegex = /<string>([^<]+)<\/string>/g;
    let match: RegExpExecArray | null;
    while ((match = stringRegex.exec(schemesBlock![1])) !== null) {
      if (match[1] !== undefined) plistSchemes.push(match[1]);
    }
    expect(plistSchemes, 'Info.plist CFBundleURLSchemes array is empty').not.toHaveLength(0);

    // The CDK scheme must be registered in Info.plist. If this fails, either
    // update Info.plist's CFBundleURLSchemes or the CDK MOBILE_OAUTH_SCHEME
    // constant — they must stay in sync.
    expect(plistSchemes).toContain(cdkScheme);
  });
});

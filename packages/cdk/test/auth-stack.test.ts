import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
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

    expect(() => synthesizeTemplate()).toThrow(
      /COGNITO_MOBILE_CALLBACK_URLS must use the dev\.cwchanap\.vela\.oauth:\/\/ scheme/,
    );

    process.env.COGNITO_MOBILE_CALLBACK_URLS = '';
    process.env.COGNITO_MOBILE_LOGOUT_URLS = 'dev.cwchanap.vela.dev://oauth/logout';

    expect(() => synthesizeTemplate()).toThrow(
      /COGNITO_MOBILE_LOGOUT_URLS must use the dev\.cwchanap\.vela\.oauth:\/\/ scheme/,
    );
  });

  test('rejects mobile URIs with the right scheme but an empty path', () => {
    process.env.COGNITO_MOBILE_CALLBACK_URLS = 'dev.cwchanap.vela.oauth://';

    expect(() => synthesizeTemplate()).toThrow(
      /COGNITO_MOBILE_CALLBACK_URLS must use the dev\.cwchanap\.vela\.oauth:\/\/ scheme with a non-empty path/,
    );

    process.env.COGNITO_MOBILE_CALLBACK_URLS = '';
    process.env.COGNITO_MOBILE_LOGOUT_URLS = 'dev.cwchanap.vela.oauth://';

    expect(() => synthesizeTemplate()).toThrow(
      /COGNITO_MOBILE_LOGOUT_URLS must use the dev\.cwchanap\.vela\.oauth:\/\/ scheme with a non-empty path/,
    );
  });

  test('rejects mobile URIs with a whitespace-only path', () => {
    // `.+` would accept `scheme:// ` (space-only path); `\S+` rejects it.
    // Cognito would store the URI but iOS would dispatch to a no-op handler.
    process.env.COGNITO_MOBILE_CALLBACK_URLS = 'dev.cwchanap.vela.oauth:// ';

    expect(() => synthesizeTemplate()).toThrow(
      /COGNITO_MOBILE_CALLBACK_URLS must use the dev\.cwchanap\.vela\.oauth:\/\/ scheme with a non-empty path/,
    );
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
  // every client. It adds origin_jti/origin_iat claims to access tokens and
  // enables the RevokeToken endpoint; pinning the synthesized template
  // prevents a future refactor from silently dropping it. See auth-stack.ts
  // for the rationale.
  test('pins enableTokenRevocation=true on all three clients', () => {
    const template = synthesizeTemplate();
    const clients = Object.values(template.findResources('AWS::Cognito::UserPoolClient'));

    expect(clients.length).toBe(3);
    for (const client of clients) {
      expect(client.Properties.ClientName).toMatch(/^vela-(web|mobile|test)-client$/);
      expect(client.Properties.EnableTokenRevocation).toBe(true);
    }
  });
});

import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AuthStack } from '../lib/auth-stack';

describe('AuthStack', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'test';
    process.env.COGNITO_DOMAIN_PREFIX = 'vela-test-auth';
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET_NAME = 'vela/test-google-oauth-client-secret';
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function synthesizeTemplate(): Template {
    const app = new App();
    const stack = new AuthStack(app, 'TestAuthStack', {
      env: {
        account: '123456789012',
        region: 'us-east-1',
      },
    });

    return Template.fromStack(stack);
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
        authorize_scopes: 'profile email openid',
      },
    });
  });

  test('configures the user pool app client for Google-only OAuth code flow', () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      SupportedIdentityProviders: ['Google'],
      AllowedOAuthFlows: ['code'],
      AllowedOAuthFlowsUserPoolClient: true,
      AllowedOAuthScopes: Match.arrayWith(['openid', 'email', 'profile']),
      ExplicitAuthFlows: ['ALLOW_REFRESH_TOKEN_AUTH'],
      CallbackURLs: Match.arrayWith([
        'http://localhost:9000/auth/callback',
        'http://127.0.0.1:9000/auth/callback',
        'https://vela.cwchanap.dev/auth/callback',
      ]),
      LogoutURLs: Match.arrayWith([
        'http://localhost:9000/auth/login',
        'http://127.0.0.1:9000/auth/login',
        'https://vela.cwchanap.dev/auth/login',
      ]),
    });
  });

  test('creates the configured Cognito hosted UI domain', () => {
    const template = synthesizeTemplate();

    template.hasResourceProperties('AWS::Cognito::UserPoolDomain', {
      Domain: 'vela-test-auth',
    });
  });

  test('uses only the expected OAuth scopes', () => {
    const template = synthesizeTemplate();
    const clients = template.findResources('AWS::Cognito::UserPoolClient');
    const client = Object.values(clients)[0];

    expect(client.Properties.AllowedOAuthScopes.toSorted()).toEqual(['email', 'openid', 'profile']);
  });

  test('rejects plaintext Google OAuth client secrets', () => {
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'plaintext-secret';

    expect(() => synthesizeTemplate()).toThrow(
      'GOOGLE_OAUTH_CLIENT_SECRET is not supported for CDK synthesis. Store the secret in Secrets Manager and set GOOGLE_OAUTH_CLIENT_SECRET_NAME.',
    );
  });

  test('requires a Google OAuth client id outside local placeholder mode', () => {
    delete process.env.NODE_ENV;
    delete process.env.ALLOW_LOCAL_OAUTH_PLACEHOLDERS;
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;

    expect(() => synthesizeTemplate()).toThrow(
      'Missing GOOGLE_OAUTH_CLIENT_ID. Set it to your Google OAuth web client id, or set ALLOW_LOCAL_OAUTH_PLACEHOLDERS=true for local-only synth.',
    );
  });

  test('requires a Google OAuth client secret name outside local placeholder mode', () => {
    delete process.env.NODE_ENV;
    delete process.env.ALLOW_LOCAL_OAUTH_PLACEHOLDERS;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET_NAME;

    expect(() => synthesizeTemplate()).toThrow(
      'Missing GOOGLE_OAUTH_CLIENT_SECRET_NAME. Store the Google OAuth client secret in Secrets Manager and set GOOGLE_OAUTH_CLIENT_SECRET_NAME, or set ALLOW_LOCAL_OAUTH_PLACEHOLDERS=true for local-only synth.',
    );
  });
});

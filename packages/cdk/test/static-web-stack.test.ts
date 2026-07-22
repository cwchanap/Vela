import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuthStack } from '../lib/auth-stack';
import { DatabaseStack } from '../lib/database-stack';
import { StorageStack } from '../lib/storage-stack';
import { ApiStack } from '../lib/api-stack';
import { StaticWebStack } from '../lib/static-web-stack';

describe('StaticWebStack', () => {
  const originalEnv = { ...process.env };
  let spaDistDir: string | undefined;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.ALLOW_LOCAL_OAUTH_PLACEHOLDERS = 'true';
    process.env.COGNITO_DOMAIN_PREFIX = 'vela-test-auth';
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-google-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET_NAME = 'vela/test-google-oauth-client-secret';
    delete process.env.CLOUDFRONT_CERT_ARN;
    delete process.env.ACM_CERT_ARN;

    // Source.asset stats the directory at construct time. Point CDK_SPA_DIST_PATH
    // at a temp dir with a dummy index.html so tests don't require a built SPA
    // (`bun run build` in apps/vela). Without this, a fresh checkout fails
    // synth with "Cannot find asset at .../apps/vela/dist/spa".
    spaDistDir = mkdtempSync(join(tmpdir(), 'vela-cdk-spa-'));
    writeFileSync(join(spaDistDir, 'index.html'), '<!doctype html><title>test</title>');
    process.env.CDK_SPA_DIST_PATH = spaDistDir;
  });

  afterEach(() => {
    process.env = originalEnv;
    if (spaDistDir) {
      rmSync(spaDistDir, { recursive: true, force: true });
      spaDistDir = undefined;
    }
  });

  function synthesize() {
    const app = new App();
    const stackEnv = { account: '123456789012', region: 'us-east-1' };
    const auth = new AuthStack(app, 'TestStaticAuthStack', { env: stackEnv });
    const database = new DatabaseStack(app, 'TestStaticDatabaseStack', { env: stackEnv });
    const storage = new StorageStack(app, 'TestStaticStorageStack', { env: stackEnv });
    const api = new ApiStack(app, 'TestStaticApiStack', {
      env: stackEnv,
      auth,
      database,
      storage,
    });
    const staticWeb = new StaticWebStack(app, 'TestStaticWebStack', {
      env: stackEnv,
      auth,
      database,
      storage,
      api,
    });
    return {
      stack: staticWeb,
      template: Template.fromStack(staticWeb),
      authTemplate: Template.fromStack(auth),
    };
  }

  test('exposes CognitoMobileUserPoolClientId wired to the mobile client resource', () => {
    const { template, authTemplate } = synthesize();

    // The output exists.
    const outputs = (template.toJSON().Outputs ?? {}) as Record<
      string,
      { Value: unknown; Description?: string }
    >;
    expect(outputs.CognitoMobileUserPoolClientId).toBeDefined();
    // Pin the description so a future edit (e.g. dropping "public, no client
    // secret" or swapping it for the web client's description) is caught. The
    // description documents the security-relevant "public client, no secret"
    // property. PKCE is not yet implemented (M2 work); do not advertise it here.
    expect(outputs.CognitoMobileUserPoolClientId.Description).toBe(
      'Cognito User Pool Client ID for the iOS mobile app (public, no client secret)',
    );

    // The Value must reference the *mobile* client, not the web or test client.
    // AuthStack and StaticWebStack are separate stacks, so CDK renders the
    // cross-stack reference as { "Fn::ImportValue": "<stack>:ExportsOutputRef<LogicalId><hash>" }
    // (a same-stack reference would be Fn::GetAtt instead). Both forms embed
    // the source resource's logical id in the rendered value string.
    const value = outputs.CognitoMobileUserPoolClientId.Value as Record<string, unknown>;
    expect(value).toHaveProperty('Fn::ImportValue');
    const importValue = value['Fn::ImportValue'] as string;
    expect(importValue).toContain('VelaMobileUserPoolClient');
    expect(importValue).not.toContain('VelaTestUserPoolClient');
    // The web client's logical id is just 'VelaUserPoolClient' — guard against
    // a substring false-positive by checking exact-id membership via findResources.
    // The UserPoolClient resources live in AuthStack, so the lookup must go there
    // (the StaticWebStack template only contains CfnOutputs, no client resources).
    const clients = authTemplate.findResources('AWS::Cognito::UserPoolClient');
    const mobileLogicalIds = Object.keys(clients).filter(
      (id) => clients[id].Properties?.ClientName === 'vela-mobile-client',
    );
    expect(mobileLogicalIds).toHaveLength(1);
    expect(importValue).toContain(mobileLogicalIds[0]);
  });

  // Belt-and-suspenders: the pre-existing CognitoUserPoolClientId output must
  // still be wired to the *web* client after the mobile client addition. The
  // web client's resource contract (scopes, flows, redirect URIs) is pinned in
  // auth-stack.test.ts; this test pins the StaticWebStack output pass-through
  // so a future edit that accidentally swaps the output's source client is
  // caught here, not by a downstream consumer getting the wrong client ID.
  test('exposes CognitoUserPoolClientId wired to the web client resource', () => {
    const { template, authTemplate } = synthesize();

    const outputs = (template.toJSON().Outputs ?? {}) as Record<
      string,
      { Value: unknown; Description?: string }
    >;
    expect(outputs.CognitoUserPoolClientId).toBeDefined();
    expect(outputs.CognitoUserPoolClientId.Description).toBe('Cognito User Pool Client ID');

    const value = outputs.CognitoUserPoolClientId.Value as Record<string, unknown>;
    expect(value).toHaveProperty('Fn::ImportValue');
    const importValue = value['Fn::ImportValue'] as string;
    // The web client's logical id is 'VelaUserPoolClient' (no prefix). Guard
    // against a substring false-positive (e.g. 'VelaMobileUserPoolClient'
    // contains 'VelaUserPoolClient' as a substring) by looking up the actual
    // web-client logical id via findResources and asserting exact membership.
    expect(importValue).toContain('VelaUserPoolClient');
    expect(importValue).not.toContain('VelaMobileUserPoolClient');
    expect(importValue).not.toContain('VelaTestUserPoolClient');

    const clients = authTemplate.findResources('AWS::Cognito::UserPoolClient');
    const webLogicalIds = Object.keys(clients).filter(
      (id) => clients[id].Properties?.ClientName === 'vela-web-client',
    );
    expect(webLogicalIds).toHaveLength(1);
    expect(importValue).toContain(webLogicalIds[0]);
  });
});

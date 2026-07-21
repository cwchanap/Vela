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
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

describe('inject-env', () => {
  let tempRoot: string;
  let tempCdkRoot: string;
  const scriptPath = path.resolve(import.meta.dir, '../scripts/inject-env.ts');

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-cdk-inject-env-'));
    tempCdkRoot = path.join(tempRoot, 'packages', 'cdk');
    fs.mkdirSync(tempCdkRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  function writeOutputs(outputs: unknown[]): void {
    fs.writeFileSync(path.join(tempCdkRoot, 'cdk-outputs.json'), JSON.stringify(outputs), 'utf8');
  }

  function runInjectEnv(env: Record<string, string | undefined> = {}) {
    return spawnSync('bun', [scriptPath], {
      cwd: tempCdkRoot,
      env: {
        ...process.env,
        ...env,
      },
      encoding: 'utf8',
    });
  }

  // Minimal outputs that satisfy all required fields. Tests add/override as
  // needed. WebsiteOrigin + MobileApiURL are emitted by StaticWebStack after
  // the multi-env refactor; included here so the default fixture exercises the
  // output-driven path rather than the DEFAULT_WEBSITE_DOMAIN fallback.
  const BASE_OUTPUTS = [
    { OutputKey: 'CognitoUserPoolId', OutputValue: 'us-east-1_testPool' },
    { OutputKey: 'CognitoUserPoolClientId', OutputValue: 'test-client-id' },
    { OutputKey: 'CognitoMobileUserPoolClientId', OutputValue: 'test-mobile-client-id' },
    { OutputKey: 'CognitoRegion', OutputValue: 'us-east-1' },
    { OutputKey: 'WebsiteOrigin', OutputValue: 'https://vela.cwchanap.dev' },
    { OutputKey: 'MobileApiURL', OutputValue: 'https://vela.cwchanap.dev/api/' },
  ];

  test('derives the OAuth domain from domain prefix and region when the stack output is missing', () => {
    writeOutputs(BASE_OUTPUTS);

    const result = runInjectEnv({
      COGNITO_DOMAIN_PREFIX: 'vela-test-auth',
      VITE_AWS_REGION: undefined,
      AWS_REGION: undefined,
    });

    expect(result.status).toBe(0);
    const envFile = fs.readFileSync(path.join(tempRoot, 'apps', 'vela', '.env.production'), 'utf8');
    expect(envFile).toContain(
      'VITE_COGNITO_OAUTH_DOMAIN=vela-test-auth.auth.us-east-1.amazoncognito.com',
    );
  });

  test('derives the OAuth domain from default prefix when stack output and env var are both missing', () => {
    writeOutputs(BASE_OUTPUTS);

    const result = runInjectEnv({
      COGNITO_DOMAIN_PREFIX: undefined,
      VITE_AWS_REGION: undefined,
      AWS_REGION: undefined,
    });

    expect(result.status).toBe(0);
    const envFile = fs.readFileSync(path.join(tempRoot, 'apps', 'vela', '.env.production'), 'utf8');
    expect(envFile).toContain(
      'VITE_COGNITO_OAUTH_DOMAIN=vela-cwchanap-auth.auth.us-east-1.amazoncognito.com',
    );
  });

  test('prefers CognitoOAuthDomain from CloudFormation outputs over derived prefix', () => {
    writeOutputs([
      ...BASE_OUTPUTS,
      { OutputKey: 'CognitoOAuthDomain', OutputValue: 'custom.auth.us-east-1.amazoncognito.com' },
    ]);

    const result = runInjectEnv({
      COGNITO_DOMAIN_PREFIX: 'different-prefix',
      VITE_AWS_REGION: undefined,
      AWS_REGION: undefined,
    });

    expect(result.status).toBe(0);
    const envFile = fs.readFileSync(path.join(tempRoot, 'apps', 'vela', '.env.production'), 'utf8');
    expect(envFile).toContain('VITE_COGNITO_OAUTH_DOMAIN=custom.auth.us-east-1.amazoncognito.com');
    expect(envFile).not.toContain('different-prefix');
    const mobileEnv = fs.readFileSync(
      path.join(tempRoot, 'apps', 'vela-mobile', '.env.production'),
      'utf8',
    );
    expect(mobileEnv).toContain(
      'VITE_COGNITO_OAUTH_DOMAIN=custom.auth.us-east-1.amazoncognito.com',
    );
  });

  test('generates the complete mobile OAuth environment from CloudFormation outputs', () => {
    writeOutputs(BASE_OUTPUTS);

    const result = runInjectEnv();

    expect(result.status).toBe(0);
    const mobileEnvPath = path.join(tempRoot, 'apps', 'vela-mobile', '.env.production');
    expect(fs.existsSync(mobileEnvPath)).toBe(true);
    const mobileEnv = fs.readFileSync(mobileEnvPath, 'utf8');
    expect(mobileEnv).toBe(
      [
        'VITE_MOBILE_API_URL=https://vela.cwchanap.dev/api/',
        'VITE_COGNITO_USER_POOL_ID=us-east-1_testPool',
        'VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID=test-mobile-client-id',
        'VITE_COGNITO_OAUTH_DOMAIN=vela-cwchanap-auth.auth.us-east-1.amazoncognito.com',
        'VITE_AWS_REGION=us-east-1',
        '',
      ].join('\n'),
    );
  });

  test('rejects a missing mobile client output before writing either environment file', () => {
    writeOutputs(
      BASE_OUTPUTS.filter(({ OutputKey }) => OutputKey !== 'CognitoMobileUserPoolClientId'),
    );

    const result = runInjectEnv();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Missing CognitoMobileUserPoolClientId');
    expect(fs.existsSync(path.join(tempRoot, 'apps', 'vela', '.env.production'))).toBe(false);
    expect(fs.existsSync(path.join(tempRoot, 'apps', 'vela-mobile', '.env.production'))).toBe(
      false,
    );
  });

  test.each([
    ['VITE_AWS_REGION', { VITE_AWS_REGION: 'us-west-2', AWS_REGION: undefined }, 'us-west-2'],
    ['CognitoRegion', { VITE_AWS_REGION: undefined, AWS_REGION: 'us-west-2' }, 'us-east-1'],
    ['AWS_REGION', { VITE_AWS_REGION: undefined, AWS_REGION: 'us-west-2' }, 'us-west-2'],
  ])('uses %s in the existing region precedence', (_source, env, expectedRegion) => {
    const outputs =
      _source === 'CognitoRegion'
        ? BASE_OUTPUTS
        : BASE_OUTPUTS.filter(({ OutputKey }) => OutputKey !== 'CognitoRegion');
    writeOutputs(outputs);

    const result = runInjectEnv(env);

    expect(result.status).toBe(0);
    const mobileEnv = fs.readFileSync(
      path.join(tempRoot, 'apps', 'vela-mobile', '.env.production'),
      'utf8',
    );
    expect(mobileEnv).toContain(`VITE_AWS_REGION=${expectedRegion}`);
  });

  test('uses us-east-1 when no region source is configured', () => {
    writeOutputs(BASE_OUTPUTS.filter(({ OutputKey }) => OutputKey !== 'CognitoRegion'));

    const result = runInjectEnv({ VITE_AWS_REGION: undefined, AWS_REGION: undefined });

    expect(result.status).toBe(0);
    const mobileEnv = fs.readFileSync(
      path.join(tempRoot, 'apps', 'vela-mobile', '.env.production'),
      'utf8',
    );
    expect(mobileEnv).toContain('VITE_AWS_REGION=us-east-1');
  });

  test('routes mobile traffic to the deployed stack origin, not production', () => {
    // Non-production deployment: VELA_DOMAIN_NAME=staging.vela.example would
    // produce WebsiteOrigin=https://staging.vela.example and a matching
    // MobileApiURL. inject-env.ts must read those outputs, not fall back to
    // the production hostname.
    writeOutputs([
      { OutputKey: 'CognitoUserPoolId', OutputValue: 'us-east-1_testPool' },
      { OutputKey: 'CognitoUserPoolClientId', OutputValue: 'test-client-id' },
      { OutputKey: 'CognitoMobileUserPoolClientId', OutputValue: 'test-mobile-client-id' },
      { OutputKey: 'CognitoRegion', OutputValue: 'us-east-1' },
      { OutputKey: 'WebsiteOrigin', OutputValue: 'https://staging.vela.example' },
      { OutputKey: 'MobileApiURL', OutputValue: 'https://staging.vela.example/api/' },
    ]);

    const result = runInjectEnv();

    expect(result.status).toBe(0);
    const webEnv = fs.readFileSync(path.join(tempRoot, 'apps', 'vela', '.env.production'), 'utf8');
    expect(webEnv).toContain(
      'VITE_COGNITO_REDIRECT_SIGN_IN=https://staging.vela.example/auth/callback',
    );
    expect(webEnv).toContain(
      'VITE_COGNITO_REDIRECT_SIGN_OUT=https://staging.vela.example/auth/login',
    );
    const mobileEnv = fs.readFileSync(
      path.join(tempRoot, 'apps', 'vela-mobile', '.env.production'),
      'utf8',
    );
    expect(mobileEnv).toContain('VITE_MOBILE_API_URL=https://staging.vela.example/api/');
    expect(mobileEnv).not.toContain('vela.cwchanap.dev');
  });

  // Older stacks deployed before the WebsiteOrigin output existed have only
  // CloudFrontDomain. The fallback must NOT use CloudFrontDomain — AuthStack
  // registers Cognito callbacks for VELA_DOMAIN_NAME (default vela.cwchanap.dev),
  // not the CloudFront domain, so a CloudFront-derived callback URL would be
  // rejected by Cognito on the first deployment of the multi-env refactor.
  // Instead the fallback derives from VELA_DOMAIN_NAME (same env var AuthStack
  // reads) and finally DEFAULT_WEBSITE_DOMAIN, matching AuthStack's expression.
  test('falls back to DEFAULT_WEBSITE_DOMAIN (not CloudFrontDomain) when WebsiteOrigin is absent', () => {
    writeOutputs([
      { OutputKey: 'CognitoUserPoolId', OutputValue: 'us-east-1_testPool' },
      { OutputKey: 'CognitoUserPoolClientId', OutputValue: 'test-client-id' },
      { OutputKey: 'CognitoMobileUserPoolClientId', OutputValue: 'test-mobile-client-id' },
      { OutputKey: 'CognitoRegion', OutputValue: 'us-east-1' },
      { OutputKey: 'CloudFrontDomain', OutputValue: 'd1234567890abc.cloudfront.net' },
    ]);

    const result = runInjectEnv({ VELA_DOMAIN_NAME: undefined });

    expect(result.status).toBe(0);
    const webEnv = fs.readFileSync(path.join(tempRoot, 'apps', 'vela', '.env.production'), 'utf8');
    expect(webEnv).toContain(
      'VITE_COGNITO_REDIRECT_SIGN_IN=https://vela.cwchanap.dev/auth/callback',
    );
    expect(webEnv).not.toContain('cloudfront.net');
    const mobileEnv = fs.readFileSync(
      path.join(tempRoot, 'apps', 'vela-mobile', '.env.production'),
      'utf8',
    );
    expect(mobileEnv).toContain('VITE_MOBILE_API_URL=https://vela.cwchanap.dev/api/');
    expect(mobileEnv).not.toContain('cloudfront.net');
  });

  test('falls back to VELA_DOMAIN_NAME when WebsiteOrigin is absent and VELA_DOMAIN_NAME is set', () => {
    writeOutputs([
      { OutputKey: 'CognitoUserPoolId', OutputValue: 'us-east-1_testPool' },
      { OutputKey: 'CognitoUserPoolClientId', OutputValue: 'test-client-id' },
      { OutputKey: 'CognitoMobileUserPoolClientId', OutputValue: 'test-mobile-client-id' },
      { OutputKey: 'CognitoRegion', OutputValue: 'us-east-1' },
      { OutputKey: 'CloudFrontDomain', OutputValue: 'd1234567890abc.cloudfront.net' },
    ]);

    const result = runInjectEnv({ VELA_DOMAIN_NAME: 'staging.vela.example' });

    expect(result.status).toBe(0);
    const webEnv = fs.readFileSync(path.join(tempRoot, 'apps', 'vela', '.env.production'), 'utf8');
    expect(webEnv).toContain(
      'VITE_COGNITO_REDIRECT_SIGN_IN=https://staging.vela.example/auth/callback',
    );
    expect(webEnv).not.toContain('cloudfront.net');
  });

  // GitHub Actions evaluates an unset `vars.VELA_DOMAIN_NAME` to an empty
  // string, not undefined. Both inject-env.ts and the CDK stacks must treat
  // empty string as "unset" and fall through to DEFAULT_WEBSITE_DOMAIN, so
  // the production default stays consistent when the workflow-level env var
  // is left unconfigured.
  test('treats empty-string VELA_DOMAIN_NAME as unset (GitHub Actions unset-var semantics)', () => {
    writeOutputs([
      { OutputKey: 'CognitoUserPoolId', OutputValue: 'us-east-1_testPool' },
      { OutputKey: 'CognitoUserPoolClientId', OutputValue: 'test-client-id' },
      { OutputKey: 'CognitoMobileUserPoolClientId', OutputValue: 'test-mobile-client-id' },
      { OutputKey: 'CognitoRegion', OutputValue: 'us-east-1' },
      { OutputKey: 'CloudFrontDomain', OutputValue: 'd1234567890abc.cloudfront.net' },
    ]);

    const result = runInjectEnv({ VELA_DOMAIN_NAME: '' });

    expect(result.status).toBe(0);
    const webEnv = fs.readFileSync(path.join(tempRoot, 'apps', 'vela', '.env.production'), 'utf8');
    expect(webEnv).toContain(
      'VITE_COGNITO_REDIRECT_SIGN_IN=https://vela.cwchanap.dev/auth/callback',
    );
    expect(webEnv).not.toContain('cloudfront.net');
  });

  // Regression: the deploy workflow exports outputs from the *currently*
  // deployed stack, injects env, builds the SPA/mobile bundle, and only then
  // runs `cdk deploy`. When VELA_DOMAIN_NAME is changed (e.g. production →
  // staging), the stale outputs still contain the old domain. VELA_DOMAIN_NAME
  // must take precedence over those outputs so the bundle is built against the
  // domain AuthStack is about to register in Cognito — otherwise the deployed
  // SPA/mobile bundle and Cognito disagree on callback/logout URLs.
  test('VELA_DOMAIN_NAME overrides stale WebsiteOrigin/MobileApiURL outputs', () => {
    writeOutputs([
      { OutputKey: 'CognitoUserPoolId', OutputValue: 'us-east-1_testPool' },
      { OutputKey: 'CognitoUserPoolClientId', OutputValue: 'test-client-id' },
      { OutputKey: 'CognitoMobileUserPoolClientId', OutputValue: 'test-mobile-client-id' },
      { OutputKey: 'CognitoRegion', OutputValue: 'us-east-1' },
      // Stale outputs from the currently-deployed production stack.
      { OutputKey: 'WebsiteOrigin', OutputValue: 'https://vela.cwchanap.dev' },
      { OutputKey: 'MobileApiURL', OutputValue: 'https://vela.cwchanap.dev/api/' },
    ]);

    const result = runInjectEnv({ VELA_DOMAIN_NAME: 'staging.vela.example' });

    expect(result.status).toBe(0);
    const webEnv = fs.readFileSync(path.join(tempRoot, 'apps', 'vela', '.env.production'), 'utf8');
    expect(webEnv).toContain(
      'VITE_COGNITO_REDIRECT_SIGN_IN=https://staging.vela.example/auth/callback',
    );
    expect(webEnv).toContain(
      'VITE_COGNITO_REDIRECT_SIGN_OUT=https://staging.vela.example/auth/login',
    );
    expect(webEnv).not.toContain('vela.cwchanap.dev');
    const mobileEnv = fs.readFileSync(
      path.join(tempRoot, 'apps', 'vela-mobile', '.env.production'),
      'utf8',
    );
    expect(mobileEnv).toContain('VITE_MOBILE_API_URL=https://staging.vela.example/api/');
    expect(mobileEnv).not.toContain('vela.cwchanap.dev');
  });

  test('VITE_MOBILE_API_URL env var overrides the CFN output', () => {
    writeOutputs(BASE_OUTPUTS);

    const result = runInjectEnv({
      VITE_MOBILE_API_URL: 'https://override.example/api/',
    });

    expect(result.status).toBe(0);
    const mobileEnv = fs.readFileSync(
      path.join(tempRoot, 'apps', 'vela-mobile', '.env.production'),
      'utf8',
    );
    expect(mobileEnv).toContain('VITE_MOBILE_API_URL=https://override.example/api/');
  });
});

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
  // output-driven path rather than the CloudFrontDomain fallback.
  const BASE_OUTPUTS = [
    { OutputKey: 'CognitoUserPoolId', OutputValue: 'us-east-1_testPool' },
    { OutputKey: 'CognitoUserPoolClientId', OutputValue: 'test-client-id' },
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
  });

  test('generates apps/vela-mobile/.env.production with absolute VITE_MOBILE_API_URL from MobileApiURL output', () => {
    writeOutputs(BASE_OUTPUTS);

    const result = runInjectEnv();

    expect(result.status).toBe(0);
    const mobileEnvPath = path.join(tempRoot, 'apps', 'vela-mobile', '.env.production');
    expect(fs.existsSync(mobileEnvPath)).toBe(true);
    const mobileEnv = fs.readFileSync(mobileEnvPath, 'utf8');
    expect(mobileEnv).toContain('VITE_MOBILE_API_URL=https://vela.cwchanap.dev/api/');
    expect(mobileEnv).not.toContain('VITE_MOBILE_API_URL=/api/');
  });

  test('routes mobile traffic to the deployed stack origin, not production', () => {
    // Non-production deployment: VELA_DOMAIN_NAME=staging.vela.example would
    // produce WebsiteOrigin=https://staging.vela.example and a matching
    // MobileApiURL. inject-env.ts must read those outputs, not fall back to
    // the production hostname.
    writeOutputs([
      { OutputKey: 'CognitoUserPoolId', OutputValue: 'us-east-1_testPool' },
      { OutputKey: 'CognitoUserPoolClientId', OutputValue: 'test-client-id' },
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

  test('falls back to CloudFrontDomain output when WebsiteOrigin is absent (older stack)', () => {
    writeOutputs([
      { OutputKey: 'CognitoUserPoolId', OutputValue: 'us-east-1_testPool' },
      { OutputKey: 'CognitoUserPoolClientId', OutputValue: 'test-client-id' },
      { OutputKey: 'CognitoRegion', OutputValue: 'us-east-1' },
      { OutputKey: 'CloudFrontDomain', OutputValue: 'd1234567890abc.cloudfront.net' },
    ]);

    const result = runInjectEnv();

    expect(result.status).toBe(0);
    const webEnv = fs.readFileSync(path.join(tempRoot, 'apps', 'vela', '.env.production'), 'utf8');
    expect(webEnv).toContain(
      'VITE_COGNITO_REDIRECT_SIGN_IN=https://d1234567890abc.cloudfront.net/auth/callback',
    );
    const mobileEnv = fs.readFileSync(
      path.join(tempRoot, 'apps', 'vela-mobile', '.env.production'),
      'utf8',
    );
    expect(mobileEnv).toContain('VITE_MOBILE_API_URL=https://d1234567890abc.cloudfront.net/api/');
  });

  test('throws when neither WebsiteOrigin nor CloudFrontDomain is present', () => {
    writeOutputs([
      { OutputKey: 'CognitoUserPoolId', OutputValue: 'us-east-1_testPool' },
      { OutputKey: 'CognitoUserPoolClientId', OutputValue: 'test-client-id' },
      { OutputKey: 'CognitoRegion', OutputValue: 'us-east-1' },
    ]);

    const result = runInjectEnv();

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Missing WebsiteOrigin');
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

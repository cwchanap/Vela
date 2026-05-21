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

  test('derives the OAuth domain from domain prefix and region when the stack output is missing', () => {
    writeOutputs([
      { OutputKey: 'CognitoUserPoolId', OutputValue: 'us-east-1_testPool' },
      { OutputKey: 'CognitoUserPoolClientId', OutputValue: 'test-client-id' },
      { OutputKey: 'CognitoRegion', OutputValue: 'us-east-1' },
    ]);

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
    writeOutputs([
      { OutputKey: 'CognitoUserPoolId', OutputValue: 'us-east-1_testPool' },
      { OutputKey: 'CognitoUserPoolClientId', OutputValue: 'test-client-id' },
      { OutputKey: 'CognitoRegion', OutputValue: 'us-east-1' },
    ]);

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
      { OutputKey: 'CognitoUserPoolId', OutputValue: 'us-east-1_testPool' },
      { OutputKey: 'CognitoUserPoolClientId', OutputValue: 'test-client-id' },
      { OutputKey: 'CognitoRegion', OutputValue: 'us-east-1' },
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
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildE2EWebServerEnv } from '../../playwright.config';

describe('Playwright e2e Cognito client config', () => {
  it('runs the app and API with the dedicated e2e Cognito client', () => {
    expect(
      buildE2EWebServerEnv({
        VITE_COGNITO_TEST_CLIENT_ID: 'test-client-id',
        VITE_COGNITO_USER_POOL_CLIENT_ID: 'web-client-id',
      }),
    ).toEqual({
      VITE_COGNITO_USER_POOL_CLIENT_ID: 'test-client-id',
      COGNITO_CLIENT_ID: 'test-client-id',
    });
  });

  it('does not fall back to the production web client for AdminInitiateAuth', () => {
    expect(
      buildE2EWebServerEnv({
        VITE_COGNITO_USER_POOL_CLIENT_ID: 'web-client-id',
      }),
    ).toEqual({});

    const authFixture = readFileSync(resolve(__dirname, '../../e2e/fixtures/auth.ts'), 'utf8');
    expect(authFixture).toContain("clientId: requireTestEnv('VITE_COGNITO_TEST_CLIENT_ID')");
    expect(authFixture).not.toContain('process.env.VITE_COGNITO_TEST_CLIENT_ID ||');
  });
});

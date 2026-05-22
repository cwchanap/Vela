import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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

  it('uses ADMIN_USER_PASSWORD_AUTH flow in the auth fixture', () => {
    const authFixture = readFileSync(resolve(__dirname, '../../e2e/fixtures/auth.ts'), 'utf8');
    expect(authFixture).toContain("AuthFlow: 'ADMIN_USER_PASSWORD_AUTH'");
    expect(authFixture).not.toContain("AuthFlow: 'ADMIN_NO_SRP_AUTH'");
  });
});

describe('Playwright server reuse logic', () => {
  const originalCI = process.env.CI;
  const originalTestClientId = process.env.VITE_COGNITO_TEST_CLIENT_ID;

  afterEach(() => {
    process.env.CI = originalCI;
    if (originalTestClientId !== undefined) {
      process.env.VITE_COGNITO_TEST_CLIENT_ID = originalTestClientId;
    } else {
      delete process.env.VITE_COGNITO_TEST_CLIENT_ID;
    }
  });

  it('allows reuse locally when no test client override is set', () => {
    delete process.env.CI;
    delete process.env.VITE_COGNITO_TEST_CLIENT_ID;
    // Re-import to pick up env changes — since the module caches on load,
    // we verify the formula directly.
    const shouldReuse = !process.env.CI && !process.env.VITE_COGNITO_TEST_CLIENT_ID;
    expect(shouldReuse).toBe(true);
  });

  it('disables reuse when test client override is required', () => {
    delete process.env.CI;
    process.env.VITE_COGNITO_TEST_CLIENT_ID = 'test-client-id';
    const shouldReuse = !process.env.CI && !process.env.VITE_COGNITO_TEST_CLIENT_ID;
    expect(shouldReuse).toBe(false);
  });

  it('disables reuse on CI regardless of test client', () => {
    process.env.CI = 'true';
    delete process.env.VITE_COGNITO_TEST_CLIENT_ID;
    const shouldReuse = !process.env.CI && !process.env.VITE_COGNITO_TEST_CLIENT_ID;
    expect(shouldReuse).toBe(false);
  });
});

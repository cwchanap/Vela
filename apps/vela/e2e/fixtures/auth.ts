import { test as base, expect, Page } from '@playwright/test';
import {
  CognitoIdentityProviderClient,
  AdminInitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const requireTestEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name} for Playwright tests. Set it in your environment or .env file.`,
    );
  }
  return value;
};

// Env is resolved lazily inside the helpers/fixture: loading this module without
// the e2e credentials must not break test collection for unauthenticated specs.
const COGNITO_TEST_ENV_KEYS = {
  email: 'TEST_EMAIL',
  password: 'TEST_PASSWORD',
  userPoolId: 'VITE_COGNITO_USER_POOL_ID',
  // Must match the client injected into the Playwright app/API web servers.
  // The production web client intentionally does not allow ADMIN_USER_PASSWORD_AUTH.
  clientId: 'VITE_COGNITO_TEST_CLIENT_ID',
  region: 'VITE_AWS_REGION',
} as const;

export const getMissingCognitoTestEnv = (): string[] =>
  Object.values(COGNITO_TEST_ENV_KEYS).filter((name) => !process.env[name]);

export const hasCognitoTestEnv = (): boolean => getMissingCognitoTestEnv().length === 0;

export const formatMissingCognitoTestEnvMessage = (
  missing: readonly string[] = getMissingCognitoTestEnv(),
): string =>
  `Missing e2e credentials: ${missing.join(', ')}. Set them in your environment or .env file.`;

export const getCognitoTestEnv = () => ({
  email: requireTestEnv(COGNITO_TEST_ENV_KEYS.email),
  password: requireTestEnv(COGNITO_TEST_ENV_KEYS.password),
  userPoolId: requireTestEnv(COGNITO_TEST_ENV_KEYS.userPoolId),
  clientId: requireTestEnv(COGNITO_TEST_ENV_KEYS.clientId),
  region: requireTestEnv(COGNITO_TEST_ENV_KEYS.region),
});

// Amplify v6 token storage key format: CognitoIdentityServiceProvider.{clientId}.{username}.{key}
const AUTH_KEY_PREFIX = 'CognitoIdentityServiceProvider';

/**
 * Obtain valid Cognito tokens using AdminInitiateAuth with the
 * ADMIN_USER_PASSWORD_AUTH flow (enabled on the dedicated test client)
 * and seed them into the browser's localStorage so Amplify recognises the session.
 */
async function seedAuthSession(page: Page): Promise<void> {
  const config = getCognitoTestEnv();

  // 1. Get tokens via AWS SDK from the Node.js test runner context
  const cognitoClient = new CognitoIdentityProviderClient({
    region: config.region,
  });

  const response = await cognitoClient.send(
    new AdminInitiateAuthCommand({
      UserPoolId: config.userPoolId,
      ClientId: config.clientId,
      AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
      AuthParameters: {
        USERNAME: config.email,
        PASSWORD: config.password,
      },
    }),
  );

  const authResult = response.AuthenticationResult;
  if (!authResult?.AccessToken || !authResult?.IdToken) {
    throw new Error('AdminInitiateAuth did not return valid tokens');
  }

  const { AccessToken, IdToken, RefreshToken } = authResult;

  // 2. Navigate to the app so Amplify is configured and localStorage is available
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // 3. Derive the username (sub claim) from the access token JWT payload
  //    Cognito usernames for Google-OAuth users are typically UUID-based "sub" values,
  //    but AdminInitiateAuth also returns the Cognito username in the token.
  const tokenParts = AccessToken.split('.');
  const payloadB64 = tokenParts[1];
  if (!payloadB64) {
    throw new Error('Access token does not contain a valid JWT payload');
  }
  const tokenPayload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
  const username: string = tokenPayload['cognito:username'] || tokenPayload['sub'];

  // 4. Inject tokens into localStorage using Amplify v6's key format
  const clientId = config.clientId;
  const keyPrefix = `${AUTH_KEY_PREFIX}.${clientId}`;
  const userPrefix = `${keyPrefix}.${username}`;

  const entries: Array<[string, string]> = [
    [`${userPrefix}.accessToken`, AccessToken],
    [`${userPrefix}.idToken`, IdToken],
    [`${userPrefix}.clockDrift`, '0'],
  ];
  if (RefreshToken) {
    entries.push([`${userPrefix}.refreshToken`, RefreshToken]);
  }

  await page.evaluate(
    (args: { entries: Array<[string, string]>; lastAuthUserKey: string; username: string }) => {
      for (const [key, value] of args.entries) {
        localStorage.setItem(key, value);
      }
      localStorage.setItem(args.lastAuthUserKey, args.username);
    },
    { entries, lastAuthUserKey: `${keyPrefix}.LastAuthUser`, username },
  );
}

// Extend base test with authentication fixture
export const test = base.extend<{
  authenticatedPage: Page;
}>({
  authenticatedPage: async ({ page }, use) => {
    const missing = getMissingCognitoTestEnv();
    if (missing.length > 0) {
      const message = formatMissingCognitoTestEnvMessage(missing);
      if (process.env.CI) {
        throw new Error(message);
      }
      test.skip(true, message);
    }

    // Seed a valid Cognito session via AdminInitiateAuth + localStorage injection.
    // Uses ADMIN_USER_PASSWORD_AUTH which is enabled on the dedicated test client,
    // bypassing the Google-only OAuth UI while authenticating against the real user pool.
    await seedAuthSession(page);

    // Reload so Amplify picks up the seeded tokens and the app enters authenticated state
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Wait for the app to settle on an authenticated route
    await expect(page).toHaveURL(/\/(home|dashboard)?$/, { timeout: 20000 });

    await use(page);
  },
});

export { expect };

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

// Test user credentials and Cognito config: required via environment for flexibility
export const TEST_USER = {
  email: requireTestEnv('TEST_EMAIL'),
  password: requireTestEnv('TEST_PASSWORD'),
};

const COGNITO_CONFIG = {
  userPoolId: requireTestEnv('VITE_COGNITO_USER_POOL_ID'),
  // Must match the client injected into the Playwright app/API web servers.
  // The production web client intentionally does not allow ADMIN_NO_SRP_AUTH.
  clientId: requireTestEnv('VITE_COGNITO_TEST_CLIENT_ID'),
  region: requireTestEnv('VITE_AWS_REGION'),
};

// Amplify v6 token storage key format: CognitoIdentityServiceProvider.{clientId}.{username}.{key}
const AUTH_KEY_PREFIX = 'CognitoIdentityServiceProvider';

/**
 * Obtain valid Cognito tokens using AdminInitiateAuth (admin-level API
 * bypasses the app client's disabled password/SRP auth flows) and seed
 * them into the browser's localStorage so Amplify recognises the session.
 */
async function seedAuthSession(page: Page, email: string, password: string): Promise<void> {
  // 1. Get tokens via AWS SDK from the Node.js test runner context
  const cognitoClient = new CognitoIdentityProviderClient({
    region: COGNITO_CONFIG.region,
  });

  const response = await cognitoClient.send(
    new AdminInitiateAuthCommand({
      UserPoolId: COGNITO_CONFIG.userPoolId,
      ClientId: COGNITO_CONFIG.clientId,
      AuthFlow: 'ADMIN_NO_SRP_AUTH',
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
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
  const clientId = COGNITO_CONFIG.clientId;
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
    // Seed a valid Cognito session via AdminInitiateAuth + localStorage injection.
    // This bypasses the Google-only OAuth UI while still authenticating against
    // the real Cognito user pool (admin API ignores client-level auth-flow restrictions).
    await seedAuthSession(page, TEST_USER.email, TEST_USER.password);

    // Reload so Amplify picks up the seeded tokens and the app enters authenticated state
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Wait for the app to settle on an authenticated route
    await expect(page).toHaveURL(/\/(home|dashboard)?$/, { timeout: 20000 });

    await use(page);
  },
});

export { expect };

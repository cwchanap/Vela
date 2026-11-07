/**
 * Synthetic Cognito environment for the fully-mocked Playwright harness
 * (playwright.mocked.config.ts + fixtures/syntheticAuth.ts). These values
 * are deliberately non-functional: they only satisfy the app's startup env
 * validation and key the localStorage token entries. All API traffic is
 * intercepted in the browser and no Cognito/provider endpoint is ever
 * contacted — the unexpired synthetic JWTs keep Amplify on its pure
 * localStorage code path and the fixture aborts every non-loopback request.
 */
export const SYNTHETIC_COGNITO_ENV = {
  VITE_COGNITO_USER_POOL_ID: 'e2elocal_pool_0000',
  VITE_COGNITO_USER_POOL_CLIENT_ID: 'e2esyntheticclientid00',
  VITE_COGNITO_OAUTH_DOMAIN: 'e2e-synthetic.auth.invalid',
  VITE_COGNITO_REDIRECT_SIGN_IN: 'http://localhost:9000/auth/callback',
  VITE_COGNITO_REDIRECT_SIGN_OUT: 'http://localhost:9000/auth/login',
  VITE_AWS_REGION: 'e2e-local-1',
  // Relative API base keeps requests on the loopback dev-server origin where
  // the route mocks can intercept them; nothing real ever listens on :9005.
  VITE_API_URL: '/api/',
} as const;

export interface SyntheticUser {
  /** JWT `sub` — also the profile `user_id`/`id` used by the API mock. */
  userId: string;
  /** JWT `cognito:username` claim and the Amplify storage-key segment. */
  username: string;
  email: string | null;
}

export const SYNTHETIC_USER_A: SyntheticUser = {
  userId: 'e2e-synthetic-user-0001',
  username: 'e2e-synthetic-user-a',
  email: 'e2e-user-a@example.invalid',
};

export const SYNTHETIC_USER_B: SyntheticUser = {
  userId: 'e2e-synthetic-user-0002',
  username: 'e2e-synthetic-user-b',
  email: 'e2e-user-b@example.invalid',
};

import type { Env } from './types';
import { initializeAuthVerifier } from './middleware/auth';

type AuthVerifierInitializer = typeof initializeAuthVerifier;

export function initializeAuthFromEnv(
  env: Env,
  initialize: AuthVerifierInitializer = initializeAuthVerifier,
): void {
  const userPoolId = env.VITE_COGNITO_USER_POOL_ID;
  const webClientId = env.COGNITO_CLIENT_ID;

  if (userPoolId && webClientId) {
    initialize(userPoolId, webClientId, env.COGNITO_MOBILE_CLIENT_ID);
  } else {
    console.warn(
      '⚠️ Cognito configuration missing. Authentication will fail for protected routes.',
    );
  }
}

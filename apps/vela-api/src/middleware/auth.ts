import { Context, Next } from 'hono';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

// Type for authenticated context with userId
export type AuthContext = {
  Variables: {
    userId: string;
    userEmail: string | null;
  };
};

// Create verifier for Cognito ID tokens
const createVerifier = (userPoolId: string, clientId: string | string[]) => {
  return CognitoJwtVerifier.create({
    userPoolId,
    tokenUse: 'id',
    clientId,
  });
};

let verifier: ReturnType<typeof createVerifier> | null = null;

/**
 * Initialize the JWT verifier with Cognito configuration
 */
export function initializeAuthVerifier(
  userPoolId: string,
  webClientId: string,
  mobileClientId?: string,
): void {
  if (!userPoolId || !webClientId) {
    console.warn('⚠️ Cognito configuration missing. Auth middleware will reject all requests.');
    return;
  }
  if (!mobileClientId) {
    console.warn(
      'Mobile Cognito client ID missing. Mobile authenticated requests will be rejected.',
    );
  }
  verifier = createVerifier(
    userPoolId,
    mobileClientId ? [webClientId, mobileClientId] : webClientId,
  );
  console.log('✅ Auth verifier initialized');
}

function safeVerificationErrorName(error: unknown): string {
  try {
    const name =
      typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;
    return typeof name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name)
      ? name
      : 'UnknownVerificationError';
  } catch {
    return 'UnknownVerificationError';
  }
}

/**
 * Extract userId from Cognito JWT token
 */
async function getUserClaimsFromToken(
  token: string,
): Promise<{ userId: string; userEmail: string | null } | null> {
  if (!verifier) {
    console.error('Auth verifier not initialized');
    return null;
  }

  try {
    const payload = await verifier.verify(token);
    return {
      // Cognito ID token has 'sub' claim which is the canonical user ID.
      userId: payload.sub,
      userEmail: typeof payload.email === 'string' ? payload.email : null,
    };
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.error('Token verification failed', safeVerificationErrorName(error));
    } else {
      console.error('Token verification failed');
    }
    return null;
  }
}

/**
 * Authentication middleware that extracts and validates JWT token
 * Sets c.get('userId') for downstream handlers
 */
export async function requireAuth(c: Context<AuthContext>, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized: Missing or invalid Authorization header' }, 401);
  }

  const token = authHeader.substring(7); // Remove "Bearer " prefix

  const claims = await getUserClaimsFromToken(token);

  if (!claims) {
    return c.json({ error: 'Unauthorized: Invalid or expired token' }, 401);
  }

  // Store token claims in context for downstream handlers.
  c.set('userId', claims.userId);
  c.set('userEmail', claims.userEmail);

  await next();
}

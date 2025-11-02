import { Context, Next } from 'hono';
import { CognitoJwtVerifier } from 'aws-jwt-verify';

// Type for authenticated context with userId
export type AuthContext = {
  Variables: {
    userId: string;
  };
};

// Create verifier for Cognito ID tokens
const createVerifier = (userPoolId: string, clientId: string) => {
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
export function initializeAuthVerifier(userPoolId: string, clientId: string) {
  if (!userPoolId || !clientId) {
    console.warn('⚠️ Cognito configuration missing. Auth middleware will reject all requests.');
    return;
  }
  verifier = createVerifier(userPoolId, clientId);
  console.log('✅ Auth verifier initialized');
}

/**
 * Extract userId from Cognito JWT token
 */
async function getUserIdFromToken(token: string): Promise<string | null> {
  if (!verifier) {
    console.error('Auth verifier not initialized');
    return null;
  }

  try {
    const payload = await verifier.verify(token);
    // Cognito ID token has 'sub' claim which is the user ID
    return payload.sub;
  } catch (error) {
    console.error('Token verification failed:', error);
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

  const userId = await getUserIdFromToken(token);

  if (!userId) {
    return c.json({ error: 'Unauthorized: Invalid or expired token' }, 401);
  }

  // Store userId in context for downstream handlers
  c.set('userId', userId);

  await next();
}

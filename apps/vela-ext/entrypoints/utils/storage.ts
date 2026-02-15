import type { AuthTokens } from './api';
import { refreshToken as refreshTokenAPI } from './api';

const STORAGE_KEYS = {
  AUTH_TOKENS: 'vela_auth_tokens',
  USER_EMAIL: 'vela_user_email',
};

export async function saveAuthTokens(tokens: AuthTokens, email?: string): Promise<void> {
  const data: Record<string, any> = {
    [STORAGE_KEYS.AUTH_TOKENS]: tokens,
  };

  if (email) {
    data[STORAGE_KEYS.USER_EMAIL] = email;
  }

  await browser.storage.local.set(data);
}

export async function getAuthTokens(): Promise<AuthTokens | null> {
  const result = (await browser.storage.local.get(STORAGE_KEYS.AUTH_TOKENS)) as {
    [STORAGE_KEYS.AUTH_TOKENS]?: AuthTokens;
  };
  return result[STORAGE_KEYS.AUTH_TOKENS] ?? null;
}

export async function getUserEmail(): Promise<string | null> {
  const result = (await browser.storage.local.get(STORAGE_KEYS.USER_EMAIL)) as {
    [STORAGE_KEYS.USER_EMAIL]?: string;
  };
  return result[STORAGE_KEYS.USER_EMAIL] ?? null;
}

export async function clearAuthData(): Promise<void> {
  await browser.storage.local.remove([STORAGE_KEYS.AUTH_TOKENS, STORAGE_KEYS.USER_EMAIL]);
}

export async function isAuthenticated(): Promise<boolean> {
  const tokens = await getAuthTokens();
  return tokens !== null && !!tokens.accessToken;
}

/**
 * Get valid access token, automatically refreshing if expired
 */
export async function getValidAccessToken(): Promise<string> {
  const tokens = await getAuthTokens();

  if (!tokens) {
    throw new Error('Not authenticated');
  }

  // Just return the access token - the API calls will handle refresh on 401
  return tokens.accessToken;
}

/**
 * Get valid ID token for protected API routes guarded by JWT middleware
 */
export async function getValidIdToken(): Promise<string> {
  const tokens = await getAuthTokens();

  if (!tokens) {
    throw new Error('Not authenticated');
  }

  if (!tokens.idToken) {
    throw new Error('No ID token available');
  }

  return tokens.idToken;
}

/**
 * Refresh the access token using the refresh token
 */
export async function refreshAccessToken(): Promise<string> {
  const tokens = await getAuthTokens();

  if (!tokens || !tokens.refreshToken) {
    throw new Error('No refresh token available');
  }

  try {
    const newTokens = await refreshTokenAPI(tokens.refreshToken);
    await saveAuthTokens(newTokens);
    return newTokens.accessToken;
  } catch (error) {
    // Refresh failed, clear auth data
    console.error('Token refresh error:', error);
    await clearAuthData();
    throw new Error('Session expired. Please log in again.');
  }
}

/**
 * Refresh auth tokens and return a valid ID token for protected API routes
 */
export async function refreshIdToken(): Promise<string> {
  const tokens = await getAuthTokens();

  if (!tokens || !tokens.refreshToken) {
    throw new Error('No refresh token available');
  }

  let newTokens: AuthTokens;

  try {
    newTokens = await refreshTokenAPI(tokens.refreshToken);
    await saveAuthTokens(newTokens);
  } catch (error) {
    // Only clear auth data for network/API errors, not for missing ID token
    console.error('Token refresh error:', error);
    await clearAuthData();
    throw new Error('Session expired. Please log in again.');
  }

  // Check for ID token outside the try-catch to avoid clearing auth data on missing token
  if (!newTokens.idToken) {
    throw new Error('Missing ID token after refresh');
  }

  return newTokens.idToken;
}

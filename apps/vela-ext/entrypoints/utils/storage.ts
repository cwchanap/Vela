import type { AuthTokens } from './api';

const STORAGE_KEYS = {
  AUTH_TOKENS: 'vela_auth_tokens',
  USER_EMAIL: 'vela_user_email',
};

export async function saveAuthTokens(tokens: AuthTokens, email: string): Promise<void> {
  await browser.storage.local.set({
    [STORAGE_KEYS.AUTH_TOKENS]: tokens,
    [STORAGE_KEYS.USER_EMAIL]: email,
  });
}

export async function getAuthTokens(): Promise<AuthTokens | null> {
  const result = await browser.storage.local.get(STORAGE_KEYS.AUTH_TOKENS);
  return result[STORAGE_KEYS.AUTH_TOKENS] || null;
}

export async function getUserEmail(): Promise<string | null> {
  const result = await browser.storage.local.get(STORAGE_KEYS.USER_EMAIL);
  return result[STORAGE_KEYS.USER_EMAIL] || null;
}

export async function clearAuthData(): Promise<void> {
  await browser.storage.local.remove([STORAGE_KEYS.AUTH_TOKENS, STORAGE_KEYS.USER_EMAIL]);
}

export async function isAuthenticated(): Promise<boolean> {
  const tokens = await getAuthTokens();
  return tokens !== null && !!tokens.accessToken;
}

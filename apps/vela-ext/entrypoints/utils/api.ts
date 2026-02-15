// API configuration
const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://vela.cwchanap.dev/api';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
}

export interface SaveDictionaryEntryParams {
  sentence: string;
  sourceUrl?: string;
  context?: string;
}

// Authentication API
export async function signIn(email: string, password: string): Promise<AuthTokens> {
  const response = await fetch(`${API_BASE_URL}/auth/signin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Sign in failed');
  }

  const data = await response.json();
  return data.tokens;
}

export async function checkSession(idToken: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/session`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    return data.authenticated === true;
  } catch {
    return false;
  }
}

// Refresh token
export async function refreshToken(refreshToken: string): Promise<AuthTokens> {
  const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ refreshToken }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Token refresh failed');
  }

  const data = await response.json();
  return data.tokens;
}

// My Dictionaries API
export async function saveDictionaryEntry(
  idToken: string,
  params: SaveDictionaryEntryParams,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/my-dictionaries`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to save dictionary entry');
  }
}

export async function getMyDictionaries(idToken: string, limit = 50) {
  const response = await fetch(`${API_BASE_URL}/my-dictionaries?limit=${limit}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch dictionary entries');
  }

  const data = await response.json();
  return data.data;
}

// API configuration
const API_BASE_URL = import.meta.env.VITE_API_URL || 'https://vela.cwchanap.dev/api';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
}

export interface SaveSentenceParams {
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

export async function checkSession(accessToken: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/session`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
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

// Saved Sentences API
export async function saveSentence(accessToken: string, params: SaveSentenceParams): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/saved-sentences`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to save sentence');
  }
}

export async function getSavedSentences(accessToken: string, limit = 50) {
  const response = await fetch(`${API_BASE_URL}/saved-sentences?limit=${limit}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch saved sentences');
  }

  const data = await response.json();
  return data.data;
}

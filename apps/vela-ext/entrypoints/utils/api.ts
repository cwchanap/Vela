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

async function getErrorMessage(response: Response, fallback: string): Promise<string> {
  const fallbackWithStatus =
    typeof response.status === 'number' ? `${fallback} (HTTP ${response.status})` : fallback;

  try {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType && !contentType.toLowerCase().includes('application/json')) {
      return fallbackWithStatus;
    }

    const error = (await response.json()) as { error?: unknown; message?: unknown };
    if (typeof error.error === 'string' && error.error.length > 0) {
      return error.error;
    }
    if (typeof error.message === 'string' && error.message.length > 0) {
      return error.message;
    }
    return fallbackWithStatus;
  } catch {
    return fallbackWithStatus;
  }
}

async function getJsonBody<T>(response: Response, fallback: string): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(`${fallback}: invalid response from server`);
  }
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

    const data = await getJsonBody<{ authenticated?: boolean }>(response, 'Session check failed');
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
    throw new Error(await getErrorMessage(response, 'Token refresh failed'));
  }

  const data = await getJsonBody<{ tokens: AuthTokens }>(response, 'Token refresh failed');
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
    throw new Error(await getErrorMessage(response, 'Failed to save dictionary entry'));
  }
}

export async function getMyDictionaries(idToken: string, limit = 50): Promise<any[]> {
  const response = await fetch(`${API_BASE_URL}/my-dictionaries?limit=${limit}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(await getErrorMessage(response, 'Failed to fetch dictionary entries'));
  }

  const data = await getJsonBody<{ data: any[] }>(response, 'Failed to fetch dictionary entries');
  return data.data;
}

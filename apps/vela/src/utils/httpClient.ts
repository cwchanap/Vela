import { fetchAuthSession } from 'aws-amplify/auth';

/**
 * Make an unauthenticated JSON request
 */
export async function httpJson<T = unknown>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = await res.json();
      if (data?.error) msg = data.error as string;
    } catch {
      // ignore parse error
    }
    throw new Error(msg);
  }

  return res.json() as Promise<T>;
}

/**
 * Get Authorization header with JWT token from Cognito
 */
async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    const session = await fetchAuthSession();
    const idToken = session.tokens?.idToken?.toString();

    if (!idToken) {
      throw new Error('No authentication token available');
    }

    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    };
  } catch (error) {
    console.error('Failed to get auth token:', error);
    throw new Error('Authentication required. Please sign in.');
  }
}

/**
 * Make an authenticated JSON request
 */
export async function httpJsonAuth<T = unknown>(
  input: RequestInfo,
  init?: RequestInit,
): Promise<T> {
  const headers = await getAuthHeaders();

  const res = await fetch(input, {
    ...init,
    headers: {
      ...headers,
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = await res.json();
      if (data?.error) msg = data.error as string;
    } catch {
      // ignore parse error
    }
    throw new Error(msg);
  }

  return res.json() as Promise<T>;
}

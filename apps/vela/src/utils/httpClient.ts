import { fetchAuthSession } from 'aws-amplify/auth';

/**
 * Normalize headers to a plain object to handle both Headers instances and plain objects
 */
function normalizeHeaders(
  headers: Record<string, string> | Headers | [string, string][] | undefined,
): Record<string, string> {
  if (!headers) {
    return {};
  }
  // If it's already a Headers instance, convert to plain object
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  // If it's an array of key-value pairs, convert to plain object
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  // Otherwise, it's already a plain object
  return headers;
}

/**
 * Make an unauthenticated JSON request
 */
export async function httpJson<T = unknown>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const normalizedHeaders = normalizeHeaders(init?.headers);
  const res = await fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...normalizedHeaders,
    },
  });

  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = await res.json();
      if (typeof data?.error === 'string') {
        msg = data.error;
      } else if (data?.error !== undefined && data?.error !== null) {
        // Convert non-string error to readable string
        msg = JSON.stringify(data.error);
      }
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
    // Log only sanitized error info to avoid leaking sensitive session data
    const errorName = error instanceof Error ? error.name : 'Unknown error';
    console.error('Failed to get auth token:', errorName);
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
  const authHeaders = await getAuthHeaders();
  const normalizedHeaders = normalizeHeaders(init?.headers);

  const res = await fetch(input, {
    ...init,
    headers: {
      ...authHeaders,
      ...normalizedHeaders,
    },
  });

  if (!res.ok) {
    let msg = res.statusText;
    try {
      const data = await res.json();
      if (typeof data?.error === 'string') {
        msg = data.error;
      } else if (data?.error !== undefined && data?.error !== null) {
        // Convert non-string error to readable string
        msg = JSON.stringify(data.error);
      }
    } catch {
      // ignore parse error
    }
    throw new Error(msg);
  }

  return res.json() as Promise<T>;
}

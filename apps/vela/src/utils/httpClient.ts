import { fetchAuthSession } from 'aws-amplify/auth';

export const DEFAULT_HTTP_TIMEOUT_MS = 30_000;

export interface HttpError extends Error {
  status: number;
}

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

function createHttpError(message: string, status: number): HttpError {
  return Object.assign(new Error(message), { status });
}

function getResponseContentType(res: Response): string {
  return res.headers?.get('content-type')?.toLowerCase() ?? '';
}

function isJsonResponse(res: Response): boolean {
  const contentType = getResponseContentType(res);
  return !contentType || contentType.includes('application/json');
}

async function readJsonResponse<T>(res: Response): Promise<T> {
  if (!isJsonResponse(res)) {
    throw createHttpError(
      `Expected JSON response, received ${getResponseContentType(res)}`,
      res.status,
    );
  }

  try {
    return (await res.json()) as T;
  } catch {
    throw createHttpError('Invalid JSON response', res.status);
  }
}

async function getErrorMessage(res: Response): Promise<string> {
  let msg = res.statusText;
  if (!isJsonResponse(res)) {
    return msg;
  }

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

  return msg;
}

async function fetchJsonWithTimeout<T>(
  input: RequestInfo,
  init: RequestInit | undefined,
  headers: Record<string, string>,
  timeoutMs = DEFAULT_HTTP_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const callerSignal = init?.signal;
  let onCallerAbort: (() => void) | undefined;
  let onControllerAbort: (() => void) | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const abortPromise = new Promise<never>((_resolve, reject) => {
    onControllerAbort = () => {
      const reason = controller.signal.reason;
      reject(reason instanceof Error ? reason : new Error(String(reason ?? 'Request aborted')));
    };
    controller.signal.addEventListener('abort', onControllerAbort, { once: true });
  });
  // Prevent an unhandled rejection if fetch rejects first or resolves normally.
  abortPromise.catch(() => {});

  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort(callerSignal.reason);
    } else {
      onCallerAbort = () => controller.abort(callerSignal.reason);
      callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }
  }

  timeoutId = setTimeout(() => {
    controller.abort(new Error('Request timed out'));
  }, timeoutMs);

  try {
    const res = await Promise.race([
      fetch(input, {
        ...init,
        signal: controller.signal,
        headers,
      }),
      abortPromise,
    ]);

    if (!res.ok) {
      const msg = await Promise.race([getErrorMessage(res), abortPromise]);
      throw createHttpError(msg, res.status);
    }

    return await Promise.race([readJsonResponse<T>(res), abortPromise]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (callerSignal && onCallerAbort) callerSignal.removeEventListener('abort', onCallerAbort);
    if (onControllerAbort) controller.signal.removeEventListener('abort', onControllerAbort);
  }
}

/**
 * Make an unauthenticated JSON request
 */
export async function httpJson<T = unknown>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const normalizedHeaders = normalizeHeaders(init?.headers);
  return fetchJsonWithTimeout<T>(input, init, {
    'Content-Type': 'application/json',
    ...normalizedHeaders,
  });
}

async function getAuthSession(): Promise<{
  headers: Record<string, string>;
  userId: string | null;
}> {
  try {
    const session = await fetchAuthSession();
    const idToken = session.tokens?.idToken;
    const token = idToken?.toString();

    if (!token) {
      throw new Error('No authentication token available');
    }

    return {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      userId: typeof idToken?.payload?.sub === 'string' ? idToken?.payload?.sub : null,
    };
  } catch (error) {
    // Log only sanitized error info to avoid leaking sensitive session data
    const errorName = error instanceof Error ? error.name : 'Unknown error';
    console.error('Failed to get auth token:', errorName);
    throw new Error('Authentication required. Please sign in.');
  }
}

/**
 * Get Authorization header with JWT token from Cognito. Reusable by
 * non-JSON transports (e.g. the SSE dictionary stream) that cannot use
 * httpJsonAuth because they must read the response body incrementally.
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const { headers } = await getAuthSession();
  return headers;
}

const ACCOUNT_CHANGED_MESSAGE = 'Account changed during request. Please try again.';

export function isAccountChangedError(error: unknown): boolean {
  return error instanceof Error && error.message === ACCOUNT_CHANGED_MESSAGE;
}

/**
 * Make an authenticated JSON request
 */
export async function httpJsonAuth<T = unknown>(
  input: RequestInfo,
  init?: RequestInit,
  expectedUserId?: string,
): Promise<T> {
  const { headers: authHeaders, userId } = await getAuthSession();

  if (expectedUserId !== undefined && userId !== expectedUserId) {
    throw new Error(ACCOUNT_CHANGED_MESSAGE);
  }

  const normalizedHeaders = normalizeHeaders(init?.headers);

  return fetchJsonWithTimeout<T>(input, init, {
    ...authHeaders,
    ...normalizedHeaders,
  });
}

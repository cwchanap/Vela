import {
  MobileAuthenticatedApiRequestError,
  type MobileAuthCoordinator,
} from '../auth/mobile-auth-contract';
import { selectMobileFeatureSessionStatus } from '../auth/mobile-feature-session-status';

/* global RequestInit */

export type MobileApiErrorCode =
  | 'invalid_request'
  | 'session_unavailable'
  | 'session_changed'
  | 'session_recovery_pending'
  | 'unauthorized'
  | 'forbidden'
  | 'network'
  | 'server'
  | 'client'
  | 'invalid_response';

export type MobileApiErrorDetails = {
  cause?: unknown;
  serverBody?: unknown;
  status?: number;
};

export class MobileApiError extends Error {
  declare readonly details: MobileApiErrorDetails;

  constructor(
    readonly code: MobileApiErrorCode,
    details: MobileApiErrorDetails = {},
  ) {
    super(code, details.cause === undefined ? undefined : { cause: details.cause });
    Object.defineProperty(this, 'name', {
      value: 'MobileApiError',
      enumerable: false,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(this, 'details', {
      value: details,
      enumerable: false,
      configurable: false,
      writable: false,
    });
  }
}

export const MOBILE_API_DEFAULT_TIMEOUT_MS = 8_000;
export const MOBILE_API_MAX_ERROR_BODY_BYTES = 16_384;

export type MobileApiRequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type MobileApiClient = {
  getJson(path: string, options?: MobileApiRequestOptions): Promise<unknown>;
  postJson(path: string, body: unknown, options?: MobileApiRequestOptions): Promise<unknown>;
};

function mapCoordinatorError(
  error: unknown,
  context: {
    callerAborted: boolean;
    deadlineExpired: boolean;
    coordinator: MobileAuthCoordinator;
  },
): never {
  const { callerAborted, deadlineExpired, coordinator } = context;

  if (error instanceof MobileAuthenticatedApiRequestError) {
    if (
      error.code === 'invalid_request_path' ||
      error.code === 'invalid_request_headers' ||
      error.code === 'invalid_request_timeout'
    ) {
      throw new MobileApiError('invalid_request', { cause: error });
    }
    if (error.code === 'request_timeout') {
      throw new MobileApiError('network', { cause: error });
    }
    throw new MobileApiError(error.code, { cause: error });
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    if (callerAborted) throw error;
    // A deadline abort during coordinator session recovery is expected: the
    // token refresh in flight has not finished within the request budget, so
    // surface it as session-recovery-pending (the UI waits for recovery)
    // instead of a hard network failure that would prompt a pointless retry.
    if (
      deadlineExpired &&
      selectMobileFeatureSessionStatus(coordinator.state).kind === 'recovering'
    ) {
      throw new MobileApiError('session_recovery_pending', { cause: error });
    }
    throw new MobileApiError('network', { cause: error });
  }

  throw new MobileApiError('network', { cause: error });
}

function mapResponseBodyError(
  error: unknown,
  context: {
    callerAborted: boolean;
    deadlineExpired: boolean;
    coordinator: MobileAuthCoordinator;
  },
): never {
  if (error instanceof SyntaxError && !context.callerAborted && !context.deadlineExpired) {
    throw new MobileApiError('invalid_response', { cause: error });
  }

  return mapCoordinatorError(error, context);
}

async function readBoundedErrorText(response: Response): Promise<string | undefined> {
  if (!response.body) return undefined;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let retainedBytes = 0;

  try {
    while (retainedBytes < MOBILE_API_MAX_ERROR_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;

      const availableBytes = MOBILE_API_MAX_ERROR_BODY_BYTES - retainedBytes;
      const retained = value.byteLength <= availableBytes ? value : value.slice(0, availableBytes);
      chunks.push(retained);
      retainedBytes += retained.byteLength;

      if (retainedBytes === MOBILE_API_MAX_ERROR_BODY_BYTES) {
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(retainedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function errorDetails(response: Response): Promise<MobileApiErrorDetails> {
  const details: MobileApiErrorDetails = { status: response.status };
  const bodyText = await readBoundedErrorText(response);
  if (bodyText === undefined) return details;

  if (response.headers.get('Content-Type')?.toLowerCase().includes('application/json')) {
    try {
      details.serverBody = JSON.parse(bodyText);
      return details;
    } catch {
      // A truncated or malformed error body remains a bounded string; never
      // replace the HTTP failure with an invalid-response error.
    }
  }

  details.serverBody = bodyText;
  return details;
}

async function responseError(response: Response): Promise<MobileApiError> {
  const details = await errorDetails(response);
  if (response.status === 401) return new MobileApiError('unauthorized', details);
  if (response.status === 403) return new MobileApiError('forbidden', details);
  if (response.status >= 400 && response.status < 500) {
    return new MobileApiError('client', details);
  }
  return new MobileApiError('server', details);
}

export function createMobileApiClient(
  coordinator: MobileAuthCoordinator,
  timeoutMs = MOBILE_API_DEFAULT_TIMEOUT_MS,
): MobileApiClient {
  async function requestJson(
    path: string,
    init: RequestInit,
    options: MobileApiRequestOptions = {},
  ): Promise<unknown> {
    const controller = new AbortController();
    let callerAborted = false;
    let deadlineExpired = false;
    const onCallerAbort = () => {
      callerAborted = true;
      controller.abort();
    };

    options.signal?.addEventListener('abort', onCallerAbort, { once: true });
    if (options.signal?.aborted) {
      onCallerAbort();
    }

    const selectedTimeoutMs = options.timeoutMs ?? timeoutMs;
    const deadline = setTimeout(() => {
      deadlineExpired = true;
      controller.abort();
    }, selectedTimeoutMs);

    try {
      if (callerAborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }

      let response: Response;
      try {
        response = await coordinator.requestAuthenticatedApi({
          path,
          transportTimeoutMs: selectedTimeoutMs,
          init: { ...init, signal: controller.signal },
        });
      } catch (error) {
        return mapCoordinatorError(error, { callerAborted, deadlineExpired, coordinator });
      }

      if (!response.ok) {
        try {
          throw await responseError(response);
        } catch (error) {
          if (error instanceof MobileApiError) throw error;
          return mapResponseBodyError(error, { callerAborted, deadlineExpired, coordinator });
        }
      }

      try {
        return await response.json();
      } catch (error) {
        return mapResponseBodyError(error, { callerAborted, deadlineExpired, coordinator });
      }
    } finally {
      clearTimeout(deadline);
      options.signal?.removeEventListener('abort', onCallerAbort);
    }
  }

  return {
    getJson(path, options) {
      return requestJson(path, {}, options);
    },
    async postJson(path, body, options) {
      let serializedBody: string;
      try {
        const serialized = JSON.stringify(body);
        if (typeof serialized !== 'string') throw new TypeError('invalid_json_body');
        serializedBody = serialized;
      } catch (error) {
        throw new MobileApiError('invalid_request', { cause: error });
      }

      return requestJson(
        path,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: serializedBody,
        },
        options,
      );
    },
  };
}

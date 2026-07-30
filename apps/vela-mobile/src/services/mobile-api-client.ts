import {
  MobileAuthenticatedApiRequestError,
  type MobileAuthCoordinator,
} from '../auth/mobile-auth-contract';
import { selectMobileFeatureSessionStatus } from '../auth/mobile-feature-session-status';

export type MobileApiErrorCode =
  | 'invalid_request'
  | 'session_unavailable'
  | 'session_changed'
  | 'session_recovery_pending'
  | 'unauthorized'
  | 'forbidden'
  | 'network'
  | 'server'
  | 'invalid_response';

export class MobileApiError extends Error {
  constructor(
    readonly code: MobileApiErrorCode,
    options?: { cause?: unknown },
  ) {
    super(code, options);
    this.name = 'MobileApiError';
  }
}

export const MOBILE_DUE_COUNT_EXECUTION_TIMEOUT_MS = 8_000;

export type MobileApiClient = {
  getJson(path: string, options?: { signal?: AbortSignal }): Promise<unknown>;
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
    if (error.code === 'invalid_request_path' || error.code === 'invalid_request_headers') {
      throw new MobileApiError('invalid_request', { cause: error });
    }
    if (error.code === 'request_timeout') {
      throw new MobileApiError('network', { cause: error });
    }
    throw new MobileApiError(error.code, { cause: error });
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    if (callerAborted) throw error;
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

export function createMobileApiClient(
  coordinator: MobileAuthCoordinator,
  timeoutMs = MOBILE_DUE_COUNT_EXECUTION_TIMEOUT_MS,
): MobileApiClient {
  return {
    async getJson(path, options = {}) {
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

      const deadline = setTimeout(() => {
        deadlineExpired = true;
        controller.abort();
      }, timeoutMs);

      try {
        let response: Response;
        try {
          response = await coordinator.requestAuthenticatedApi({
            path,
            init: { signal: controller.signal },
          });
        } catch (error) {
          return mapCoordinatorError(error, { callerAborted, deadlineExpired, coordinator });
        }

        if (response.status === 401) throw new MobileApiError('unauthorized');
        if (response.status === 403) throw new MobileApiError('forbidden');
        if (!response.ok) throw new MobileApiError('server');

        try {
          return await response.json();
        } catch (error) {
          return mapCoordinatorError(error, { callerAborted, deadlineExpired, coordinator });
        }
      } finally {
        clearTimeout(deadline);
        options.signal?.removeEventListener('abort', onCallerAbort);
      }
    },
  };
}

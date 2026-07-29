import type {
  MobileAuthErrorCode,
  MobileAuthOperation,
  MobileAuthPhase,
  MobileAuthRetryAction,
  MobileAuthState,
} from '../../auth/mobile-auth-contract';

export type AuthenticatedLandingState = 'pending' | 'ready' | 'failed';

export type MobileAuthGateView =
  | {
      kind: 'content';
      retry: {
        errorCode: MobileAuthErrorCode;
        action: Exclude<MobileAuthRetryAction, 'cleanup'>;
      } | null;
    }
  | { kind: 'progress'; operation: MobileAuthOperation; phase: MobileAuthPhase }
  | { kind: 'landing_failure' }
  | {
      kind: 'blocking_session_failure';
      errorCode: MobileAuthErrorCode;
      retryAction: Exclude<MobileAuthRetryAction, 'cleanup'>;
      allowStartOver: true;
    }
  | { kind: 'signed_out'; notice: 'session_unusable' | null }
  | { kind: 'cleanup_failure' }
  | { kind: 'unsupported' }
  | { kind: 'oauth_error'; errorCode: MobileAuthErrorCode }
  | { kind: 'invalid_state' };

const OAUTH_PROGRESS_PHASES = new Set<MobileAuthPhase>([
  'initializing',
  'openingBrowser',
  'awaitingCallback',
  'exchangingCode',
  'verifyingSession',
]);

const OAUTH_ERROR_CODES = new Set<MobileAuthErrorCode>([
  'configuration_error',
  'browser_launch_failed',
  'cancelled',
  'interrupted',
  'transaction_expired',
  'malformed_callback',
  'provider_error',
  'code_exchange_failed',
  'token_validation_failed',
  'session_unauthorized',
  'unsupported_platform',
]);

const SESSION_RETRY_BY_ERROR: Partial<
  Record<MobileAuthErrorCode, Exclude<MobileAuthRetryAction, 'cleanup'>>
> = {
  session_restore_failed: 'restore',
  session_refresh_failed: 'refresh',
  session_persistence_failed: 'persist',
  session_verification_failed: 'verify',
};

function hasValidOperationTuple(state: Readonly<MobileAuthState>): boolean {
  if (
    state.errorCode !== null ||
    state.retryAction !== null ||
    state.notice !== null ||
    state.operation === 'idle'
  ) {
    return false;
  }

  switch (state.operation) {
    case 'restoring':
      return state.phase === 'initializing' && !state.sessionUsable && state.user === null;
    case 'refreshing':
      return state.phase === 'authenticated' && state.user !== null;
    case 'persisting':
      return (
        (state.phase === 'authenticated' && state.user !== null) ||
        (state.phase === 'initializing' && !state.sessionUsable && state.user === null) ||
        (state.phase === 'exchangingCode' && !state.sessionUsable && state.user === null)
      );
    case 'verifying':
      return (
        (state.phase === 'authenticated' && state.user !== null) ||
        (state.phase === 'initializing' && !state.sessionUsable && state.user === null) ||
        (state.phase === 'verifyingSession' && !state.sessionUsable && state.user === null)
      );
    case 'signingOut':
      return (
        !state.sessionUsable &&
        ((state.phase === 'initializing' && state.user === null) ||
          (state.phase === 'authenticated' && state.user !== null))
      );
    case 'cleaningUp':
      return (
        !state.sessionUsable &&
        ((state.phase === 'authenticated' && state.user !== null) ||
          ((state.phase === 'signedOut' || state.phase === 'initializing') && state.user === null))
      );
  }
}

function hasValidIdleTuple(state: Readonly<MobileAuthState>): boolean {
  if (state.operation !== 'idle') {
    return false;
  }

  if (state.notice === 'session_unusable') {
    return (
      state.phase === 'signedOut' &&
      !state.sessionUsable &&
      state.errorCode === null &&
      state.retryAction === null &&
      state.user === null
    );
  }

  if (state.notice === 'cleanup_incomplete') {
    return (
      state.phase === 'signedOut' &&
      !state.sessionUsable &&
      state.errorCode === 'session_cleanup_failed' &&
      state.retryAction === 'cleanup' &&
      state.user === null
    );
  }

  if (state.sessionUsable && (state.phase !== 'authenticated' || state.user === null)) {
    return false;
  }
  if (state.phase === 'authenticated' && state.user === null) {
    return false;
  }
  if (state.phase !== 'authenticated' && state.user !== null) {
    return false;
  }

  if (state.errorCode === null) {
    if (state.retryAction !== null || state.phase === 'error') {
      return false;
    }
    if (state.phase === 'authenticated') {
      return state.sessionUsable;
    }
    return !state.sessionUsable;
  }

  if (state.errorCode === 'session_cleanup_failed') {
    return false;
  }

  const sessionRetry = SESSION_RETRY_BY_ERROR[state.errorCode];
  if (sessionRetry !== undefined) {
    if (state.retryAction !== sessionRetry) {
      return false;
    }
    if (state.errorCode === 'session_restore_failed') {
      return state.phase === 'initializing' && !state.sessionUsable && state.user === null;
    }
    return (
      (state.phase === 'initializing' && !state.sessionUsable && state.user === null) ||
      (state.phase === 'error' && !state.sessionUsable && state.user === null) ||
      (state.phase === 'authenticated' && state.user !== null)
    );
  }

  return (
    OAUTH_ERROR_CODES.has(state.errorCode) &&
    state.phase === 'error' &&
    !state.sessionUsable &&
    state.retryAction === null &&
    state.user === null
  );
}

function hasValidStateTuple(state: Readonly<MobileAuthState>): boolean {
  return state.operation === 'idle' ? hasValidIdleTuple(state) : hasValidOperationTuple(state);
}

export function selectMobileAuthGateView(
  state: Readonly<MobileAuthState>,
  landingState: AuthenticatedLandingState,
): MobileAuthGateView {
  if (!hasValidStateTuple(state)) {
    return { kind: 'invalid_state' };
  }

  if (state.errorCode === 'unsupported_platform') {
    return { kind: 'unsupported' };
  }
  if (state.errorCode === 'session_cleanup_failed') {
    return { kind: 'cleanup_failure' };
  }

  if (
    !state.sessionUsable &&
    (state.operation !== 'idle' ||
      (state.errorCode === null && OAUTH_PROGRESS_PHASES.has(state.phase)))
  ) {
    return { kind: 'progress', operation: state.operation, phase: state.phase };
  }

  if (state.sessionUsable && landingState === 'ready') {
    const retryAction =
      state.retryAction === null || state.retryAction === 'cleanup' ? null : state.retryAction;
    return {
      kind: 'content',
      retry:
        state.errorCode !== null && retryAction !== null
          ? { errorCode: state.errorCode, action: retryAction }
          : null,
    };
  }

  if (state.phase === 'authenticated' && state.sessionUsable) {
    if (landingState === 'pending') {
      return { kind: 'progress', operation: state.operation, phase: state.phase };
    }
    if (landingState === 'failed') {
      return { kind: 'landing_failure' };
    }
  }

  if (
    !state.sessionUsable &&
    state.errorCode !== null &&
    state.retryAction !== null &&
    state.retryAction !== 'cleanup'
  ) {
    return {
      kind: 'blocking_session_failure',
      errorCode: state.errorCode,
      retryAction: state.retryAction,
      allowStartOver: true,
    };
  }

  if (state.phase === 'signedOut') {
    return {
      kind: 'signed_out',
      notice: state.notice === 'session_unusable' ? state.notice : null,
    };
  }

  if (state.phase === 'error' && state.errorCode !== null) {
    return { kind: 'oauth_error', errorCode: state.errorCode };
  }

  return { kind: 'invalid_state' };
}

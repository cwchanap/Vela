import { describe, expect, it } from 'vitest';
import type {
  MobileAuthErrorCode,
  MobileAuthOperation,
  MobileAuthState,
} from '../../auth/mobile-auth-contract';
import {
  selectMobileAuthGateView,
  type AuthenticatedLandingState,
  type MobileAuthGateView,
} from './mobile-auth-gate-view';

const user = { userId: 'user-1', email: 'vela@example.com' };

function state(overrides: Partial<MobileAuthState>): MobileAuthState {
  return {
    phase: 'signedOut',
    operation: 'idle',
    sessionUsable: false,
    errorCode: null,
    retryAction: null,
    notice: null,
    user: null,
    ...overrides,
  };
}

describe('selectMobileAuthGateView', () => {
  it.each<
    [
      label: string,
      state: MobileAuthState,
      landingState: AuthenticatedLandingState,
      expected: MobileAuthGateView,
    ]
  >([
    ['ordinary signed out', state({}), 'ready', { kind: 'signed_out', notice: null }],
    [
      'terminal unusable session notice',
      state({ notice: 'session_unusable' }),
      'ready',
      { kind: 'signed_out', notice: 'session_unusable' },
    ],
    [
      'cleanup failure',
      state({
        errorCode: 'session_cleanup_failed',
        retryAction: 'cleanup',
        notice: 'cleanup_incomplete',
      }),
      'ready',
      { kind: 'cleanup_failure' },
    ],
    [
      'unsupported platform',
      state({ phase: 'error', errorCode: 'unsupported_platform' }),
      'ready',
      { kind: 'unsupported' },
    ],
    [
      'authenticated landing pending',
      state({ phase: 'authenticated', sessionUsable: true, user }),
      'pending',
      { kind: 'progress', operation: 'idle', phase: 'authenticated' },
    ],
    [
      'authenticated landing failure',
      state({ phase: 'authenticated', sessionUsable: true, user }),
      'failed',
      { kind: 'landing_failure' },
    ],
    [
      'authenticated content',
      state({ phase: 'authenticated', sessionUsable: true, user }),
      'ready',
      { kind: 'content', retry: null },
    ],
    [
      'soft refresh failure banner',
      state({
        phase: 'authenticated',
        sessionUsable: true,
        errorCode: 'session_refresh_failed',
        retryAction: 'refresh',
        user,
      }),
      'ready',
      {
        kind: 'content',
        retry: { errorCode: 'session_refresh_failed', action: 'refresh' },
      },
    ],
    [
      'soft persistence failure banner',
      state({
        phase: 'authenticated',
        sessionUsable: true,
        errorCode: 'session_persistence_failed',
        retryAction: 'persist',
        user,
      }),
      'ready',
      {
        kind: 'content',
        retry: { errorCode: 'session_persistence_failed', action: 'persist' },
      },
    ],
    [
      'soft verification failure banner',
      state({
        phase: 'authenticated',
        sessionUsable: true,
        errorCode: 'session_verification_failed',
        retryAction: 'verify',
        user,
      }),
      'ready',
      {
        kind: 'content',
        retry: { errorCode: 'session_verification_failed', action: 'verify' },
      },
    ],
    [
      'blocking restore failure',
      state({
        phase: 'error',
        errorCode: 'session_restore_failed',
        retryAction: 'restore',
      }),
      'ready',
      {
        kind: 'blocking_session_failure',
        errorCode: 'session_restore_failed',
        retryAction: 'restore',
        allowStartOver: true,
      },
    ],
    [
      'blocking expired refresh failure',
      state({
        phase: 'authenticated',
        errorCode: 'session_refresh_failed',
        retryAction: 'refresh',
        user,
      }),
      'ready',
      {
        kind: 'blocking_session_failure',
        errorCode: 'session_refresh_failed',
        retryAction: 'refresh',
        allowStartOver: true,
      },
    ],
    [
      'blocking expired refresh failure before landing can complete',
      state({
        phase: 'authenticated',
        errorCode: 'session_refresh_failed',
        retryAction: 'refresh',
        user,
      }),
      'pending',
      {
        kind: 'blocking_session_failure',
        errorCode: 'session_refresh_failed',
        retryAction: 'refresh',
        allowStartOver: true,
      },
    ],
    [
      'blocking sign-in persistence failure',
      state({
        phase: 'error',
        errorCode: 'session_persistence_failed',
        retryAction: 'persist',
      }),
      'ready',
      {
        kind: 'blocking_session_failure',
        errorCode: 'session_persistence_failed',
        retryAction: 'persist',
        allowStartOver: true,
      },
    ],
    [
      'blocking sign-in verification failure',
      state({
        phase: 'error',
        errorCode: 'session_verification_failed',
        retryAction: 'verify',
      }),
      'ready',
      {
        kind: 'blocking_session_failure',
        errorCode: 'session_verification_failed',
        retryAction: 'verify',
        allowStartOver: true,
      },
    ],
  ])('maps $label to an explicit gate view', (_label, current, landingState, expected) => {
    expect(selectMobileAuthGateView(current, landingState)).toEqual(expected);
  });

  it.each<[MobileAuthOperation, MobileAuthState]>([
    ['restoring', state({ phase: 'initializing', operation: 'restoring' })],
    [
      'refreshing',
      state({ phase: 'authenticated', operation: 'refreshing', sessionUsable: false, user }),
    ],
    ['persisting', state({ phase: 'exchangingCode', operation: 'persisting' })],
    ['verifying', state({ phase: 'verifyingSession', operation: 'verifying' })],
    ['signingOut', state({ operation: 'signingOut' })],
    ['cleaningUp', state({ operation: 'cleaningUp' })],
  ])('maps blocking %s operation to progress', (operation, current) => {
    expect(selectMobileAuthGateView(current, 'ready')).toEqual({
      kind: 'progress',
      operation,
      phase: current.phase,
    });
  });

  it.each([
    'initializing',
    'openingBrowser',
    'awaitingCallback',
    'exchangingCode',
    'verifyingSession',
  ] as const)('maps error-free idle %s to OAuth progress', (phase) => {
    const current = state({ phase });
    expect(selectMobileAuthGateView(current, 'ready')).toEqual({
      kind: 'progress',
      operation: 'idle',
      phase,
    });
  });

  it.each<MobileAuthErrorCode>([
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
  ])('maps HPA-205 error %s without inventing recovery data', (errorCode) => {
    expect(selectMobileAuthGateView(state({ phase: 'error', errorCode }), 'ready')).toEqual({
      kind: 'oauth_error',
      errorCode,
    });
  });

  it.each<MobileAuthOperation>(['refreshing', 'persisting', 'verifying'])(
    'keeps usable content visible during background %s without a live retry banner',
    (operation) => {
      expect(
        selectMobileAuthGateView(
          state({
            phase: 'authenticated',
            operation,
            sessionUsable: true,
            user,
          }),
          'ready',
        ),
      ).toEqual({ kind: 'content', retry: null });
    },
  );

  it.each([
    state({ sessionUsable: true }),
    state({ phase: 'error' }),
    state({
      phase: 'error',
      errorCode: 'session_restore_failed',
      retryAction: 'refresh',
    }),
    state({
      operation: 'refreshing',
      errorCode: 'session_refresh_failed',
    }),
    state({
      phase: 'authenticated',
      sessionUsable: true,
      notice: 'session_unusable',
      user,
    }),
  ])('fails closed for an invariant-breaking tuple', (current) => {
    expect(selectMobileAuthGateView(current, 'ready')).toEqual({ kind: 'invalid_state' });
  });
});

import { describe, expect, it } from 'vitest';
import { MobileApiError } from '../../services/mobile-api-client';
import {
  GENERIC_MESSAGE,
  NETWORK_MESSAGE,
  STALE_MESSAGE,
  selectDueReviewView,
  type DueReviewViewInput,
} from './due-review-view';
import { dueReviewStats as stats } from './stats-fixture';

const input = (overrides: Partial<DueReviewViewInput> = {}): DueReviewViewInput => ({
  stats: undefined,
  error: null,
  isInitialPending: false,
  isFetching: false,
  sessionRecoveryPending: false,
  manualRetryPending: false,
  ...overrides,
});

describe('selectDueReviewView', () => {
  it.each([
    [
      'initial loading',
      input({ isInitialPending: true }),
      { kind: 'loading', recoveringSession: false },
    ],
    [
      'session recovery loading',
      input({ sessionRecoveryPending: true }),
      { kind: 'loading', recoveringSession: true },
    ],
    ['zero count', input({ stats: stats(0) }), { kind: 'zero', refreshing: false }],
    [
      'positive count',
      input({ stats: stats(3) }),
      { kind: 'positive', count: 3, refreshing: false },
    ],
    [
      'zero background refresh',
      input({ stats: stats(0), isFetching: true }),
      { kind: 'zero', refreshing: true },
    ],
    [
      'positive background refresh',
      input({ stats: stats(3), isFetching: true }),
      { kind: 'positive', count: 3, refreshing: true },
    ],
    [
      'blocking network error',
      input({ error: new MobileApiError('network') }),
      { kind: 'blocking_error', message: NETWORK_MESSAGE, retrying: false, canRetry: true },
    ],
    [
      'cached positive stale error',
      input({ stats: stats(3), error: new MobileApiError('network') }),
      { kind: 'cached_error', count: 3, message: STALE_MESSAGE, retrying: false, canRetry: true },
    ],
    [
      'cached zero stale error',
      input({ stats: stats(0), error: new MobileApiError('server') }),
      { kind: 'cached_error', count: 0, message: STALE_MESSAGE, retrying: false, canRetry: true },
    ],
    [
      'manual blocking retry',
      input({ error: new MobileApiError('network'), manualRetryPending: true }),
      { kind: 'blocking_error', message: NETWORK_MESSAGE, retrying: true, canRetry: true },
    ],
    [
      'manual cached retry',
      input({ stats: stats(3), error: new MobileApiError('server'), manualRetryPending: true }),
      { kind: 'cached_error', count: 3, message: STALE_MESSAGE, retrying: true, canRetry: true },
    ],
    [
      'invalid request cannot retry',
      input({ error: new MobileApiError('invalid_request') }),
      { kind: 'blocking_error', message: GENERIC_MESSAGE, retrying: false, canRetry: false },
    ],
    [
      'invalid response can retry',
      input({ error: new MobileApiError('invalid_response') }),
      { kind: 'blocking_error', message: GENERIC_MESSAGE, retrying: false, canRetry: true },
    ],
    [
      'repeated session control race has generic manual recovery',
      input({ error: new MobileApiError('session_changed') }),
      { kind: 'blocking_error', message: GENERIC_MESSAGE, retrying: false, canRetry: true },
    ],
    [
      'unauthorized without cache routes to session recovery loading',
      input({ error: new MobileApiError('unauthorized') }),
      { kind: 'loading', recoveringSession: true },
    ],
    [
      'unauthorized with cache keeps data during session recovery',
      input({ stats: stats(3), error: new MobileApiError('unauthorized') }),
      { kind: 'positive', count: 3, refreshing: false },
    ],
  ])('selects %s', (_name, viewInput, expected) => {
    expect(selectDueReviewView(viewInput)).toEqual(expected);
  });

  it('suppresses refreshing while a manual retry retains cached data', () => {
    expect(
      selectDueReviewView(input({ stats: stats(3), isFetching: true, manualRetryPending: true })),
    ).toEqual({ kind: 'positive', count: 3, refreshing: false });
  });

  it('keeps cached data visible during session recovery', () => {
    expect(selectDueReviewView(input({ stats: stats(3), sessionRecoveryPending: true }))).toEqual({
      kind: 'positive',
      count: 3,
      refreshing: false,
    });
  });
});

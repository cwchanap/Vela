import type { SRSStats } from '@vela/common';
import type { MobileApiError } from '../../services/mobile-api-client';

export type DueReviewView =
  | { kind: 'loading'; recoveringSession: boolean }
  | { kind: 'zero'; refreshing: boolean }
  | { kind: 'positive'; count: number; refreshing: boolean }
  | { kind: 'blocking_error'; message: string; retrying: boolean; canRetry: boolean }
  | { kind: 'cached_error'; count: number; message: string; retrying: boolean; canRetry: boolean };

export type DueReviewViewInput = {
  stats: SRSStats | undefined;
  error: MobileApiError | null;
  isInitialPending: boolean;
  isFetching: boolean;
  sessionRecoveryPending: boolean;
  manualRetryPending: boolean;
};

export const NETWORK_MESSAGE =
  'Vela couldn’t load your review count. Check your connection and try again.';
export const GENERIC_MESSAGE = 'Vela couldn’t load your review count. Please try again.';
export const STALE_MESSAGE = 'This count may be out of date.';

export function selectDueReviewView(input: DueReviewViewInput): DueReviewView {
  const refreshing = input.isFetching && input.stats !== undefined && !input.manualRetryPending;

  if (input.sessionRecoveryPending) {
    if (input.stats === undefined) return { kind: 'loading', recoveringSession: true };
    if (input.stats.due_today === 0) return { kind: 'zero', refreshing: false };
    return { kind: 'positive', count: input.stats.due_today, refreshing: false };
  }

  if (input.error && input.stats !== undefined) {
    return {
      kind: 'cached_error',
      count: input.stats.due_today,
      message: STALE_MESSAGE,
      retrying: input.manualRetryPending,
      canRetry: input.error.code !== 'invalid_request',
    };
  }

  if (input.error) {
    return {
      kind: 'blocking_error',
      message: input.error.code === 'network' ? NETWORK_MESSAGE : GENERIC_MESSAGE,
      retrying: input.manualRetryPending,
      canRetry: input.error.code !== 'invalid_request',
    };
  }

  if (input.stats?.due_today === 0) return { kind: 'zero', refreshing };
  if (input.stats && input.stats.due_today > 0) {
    return { kind: 'positive', count: input.stats.due_today, refreshing };
  }
  if (input.isInitialPending) return { kind: 'loading', recoveringSession: false };

  return { kind: 'blocking_error', message: GENERIC_MESSAGE, retrying: false, canRetry: true };
}

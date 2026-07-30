import type { MobileAuthState } from './mobile-auth-contract';

export type MobileFeatureSessionStatus =
  | { kind: 'usable'; userId: string }
  | { kind: 'recovering'; userId: string; sessionUsable: boolean }
  | { kind: 'unavailable' };

export function selectMobileFeatureSessionStatus(
  state: Readonly<MobileAuthState>,
): MobileFeatureSessionStatus {
  const userId = state.user?.userId;
  if (state.phase !== 'authenticated' || !userId) {
    return { kind: 'unavailable' };
  }

  const recovering =
    state.operation === 'refreshing' ||
    state.operation === 'persisting' ||
    state.operation === 'verifying' ||
    state.retryAction === 'refresh' ||
    state.retryAction === 'persist' ||
    state.retryAction === 'verify';

  if (recovering) {
    return { kind: 'recovering', userId, sessionUsable: state.sessionUsable };
  }

  if (
    state.operation === 'idle' &&
    state.sessionUsable &&
    state.errorCode === null &&
    state.retryAction === null &&
    state.notice === null
  ) {
    return { kind: 'usable', userId };
  }

  return { kind: 'unavailable' };
}

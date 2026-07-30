import { describe, expect, it } from 'vitest';
import type { MobileAuthState } from './mobile-auth-contract';
import { selectMobileFeatureSessionStatus } from './mobile-feature-session-status';

const authenticated: MobileAuthState = {
  phase: 'authenticated',
  operation: 'idle',
  sessionUsable: true,
  errorCode: null,
  retryAction: null,
  notice: null,
  user: { userId: 'user-1', email: null },
};

describe('selectMobileFeatureSessionStatus', () => {
  it('returns usable for a verified idle session', () => {
    expect(selectMobileFeatureSessionStatus(authenticated)).toEqual({
      kind: 'usable',
      userId: 'user-1',
    });
  });

  it.each([
    [{ ...authenticated, operation: 'refreshing' as const }, true],
    [
      {
        ...authenticated,
        sessionUsable: false,
        errorCode: 'session_refresh_failed' as const,
        retryAction: 'refresh' as const,
      },
      false,
    ],
  ])('returns recovering and preserves capability', (state, sessionUsable) => {
    expect(selectMobileFeatureSessionStatus(state)).toEqual({
      kind: 'recovering',
      userId: 'user-1',
      sessionUsable,
    });
  });

  it.each([
    { ...authenticated, phase: 'signedOut' as const, sessionUsable: false, user: null },
    { ...authenticated, operation: 'signingOut' as const, sessionUsable: false },
    { ...authenticated, operation: 'cleaningUp' as const, sessionUsable: false },
  ])('returns unavailable for blocking auth state', (state) => {
    expect(selectMobileFeatureSessionStatus(state)).toEqual({ kind: 'unavailable' });
  });
});

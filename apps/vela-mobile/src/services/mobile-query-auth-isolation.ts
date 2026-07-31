import type { QueryClient } from '@tanstack/vue-query';
import { srsKeys } from '@vela/common';
import { watch, type WatchStopHandle } from 'vue';
import type { MobileAuthState } from '../auth/mobile-auth-contract';
import {
  selectMobileFeatureSessionStatus,
  type MobileFeatureSessionStatus,
} from '../auth/mobile-feature-session-status';

type AuthQuerySnapshot = {
  phase: MobileAuthState['phase'];
  operation: MobileAuthState['operation'];
  userId: string | null;
  featureStatus: MobileFeatureSessionStatus;
};

function selectAuthQuerySnapshot(state: Readonly<MobileAuthState>): AuthQuerySnapshot {
  return {
    phase: state.phase,
    operation: state.operation,
    userId: state.user?.userId ?? null,
    featureStatus: selectMobileFeatureSessionStatus(state),
  };
}

export function installMobileQueryAuthIsolation(options: {
  state: Readonly<MobileAuthState>;
  queryClient: QueryClient;
}): WatchStopHandle {
  let cleanupTail = Promise.resolve();

  return watch(
    () => selectAuthQuerySnapshot(options.state),
    (next, previous) => {
      const previousUserId = previous.userId;
      const identityChanged = previousUserId !== next.userId;
      // A terminal sign-out wipes the whole cache (no successor user to keep).
      const signOutClear =
        next.phase === 'signedOut' ||
        next.operation === 'signingOut' ||
        next.operation === 'cleaningUp';
      const cancelOnly =
        next.featureStatus.kind === 'recovering' && !next.featureStatus.sessionUsable;

      if (!identityChanged && !signOutClear && !cancelOnly) return;

      cleanupTail = cleanupTail
        .catch(() => undefined)
        .then(async () => {
          if (signOutClear) {
            await options.queryClient.cancelQueries();
            options.queryClient.clear();
            return;
          }
          if (identityChanged && previousUserId !== null) {
            // Scope removal to the prior user's key so an in-flight or freshly
            // resolved request for the new user survives the identity handoff.
            const priorUserKey = srsKeys.stats(previousUserId);
            await options.queryClient.cancelQueries({ queryKey: priorUserKey });
            options.queryClient.removeQueries({ queryKey: priorUserKey });
            return;
          }
          await options.queryClient.cancelQueries();
        })
        .catch(() => undefined);
    },
  );
}

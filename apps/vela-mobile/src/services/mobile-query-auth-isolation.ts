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
            // When a prior user is known, scope the cancellation and
            // removal to that user's key. This avoids globally cancelling
            // a successor's in-flight queries when this stale continuation
            // resumes after sign-out has completed and a successor session
            // has started. A global cancelQueries()/clear() here would
            // abort the successor's active requests and erase their cache.
            if (previousUserId !== null) {
              const priorUserKey = srsKeys.stats(previousUserId);
              await options.queryClient.cancelQueries({ queryKey: priorUserKey });
              options.queryClient.removeQueries({ queryKey: priorUserKey });
              return;
            }
            // No prior user (e.g. cleanup on a fresh signed-out state).
            // Revalidate before globally clearing — a successor may have
            // started during the await.
            const current = selectAuthQuerySnapshot(options.state);
            const stillSignedOut =
              current.phase === 'signedOut' ||
              current.operation === 'signingOut' ||
              current.operation === 'cleaningUp';
            if (!stillSignedOut && current.userId !== null) {
              return;
            }
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
          if (cancelOnly) {
            // Unusable session recovery: cancel in-flight queries without
            // clearing the cache.
            await options.queryClient.cancelQueries();
            return;
          }
          // identityChanged && previousUserId === null: null → newUser
          // with no prior user to clean up. Nothing to do — a global
          // cancellation here would abort the new user's own requests.
        })
        .catch(() => undefined);
    },
  );
}

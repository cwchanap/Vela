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
            // No prior user (e.g. a cleanup retry on a fresh signed-out
            // state). With no prior user there is no authenticated user key
            // to remove, and every mobile query is user-scoped
            // (srsKeys.stats(userId)), so any cache present belongs to a
            // successor. A global cancelQueries()/clear() here would race a
            // successor that authenticates during the await: the revalidation
            // above ran before the await, but clear() runs after it
            // unconditionally, erasing the successor's cache and detaching
            // its observers. Do nothing — there is nothing legitimate to
            // clean up.
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
          if (cancelOnly && next.featureStatus.kind === 'recovering') {
            // Unusable session recovery: cancel the recovering user's
            // in-flight queries without clearing the cache. Scope to that
            // user's key so a stale recovery callback queued behind other
            // cleanup cannot abort a successor's requests after an identity
            // change during the await.
            const recoveringUserKey = srsKeys.stats(next.featureStatus.userId);
            await options.queryClient.cancelQueries({ queryKey: recoveringUserKey });
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

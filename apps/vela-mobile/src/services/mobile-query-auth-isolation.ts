import type { QueryClient } from '@tanstack/vue-query';
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
      const identityChanged = previous.userId !== next.userId;
      const clearRequired =
        identityChanged ||
        next.phase === 'signedOut' ||
        next.operation === 'signingOut' ||
        next.operation === 'cleaningUp';
      const cancelOnly =
        next.featureStatus.kind === 'recovering' && !next.featureStatus.sessionUsable;

      if (!clearRequired && !cancelOnly) return;

      cleanupTail = cleanupTail
        .catch(() => undefined)
        .then(async () => {
          await options.queryClient.cancelQueries();
          if (clearRequired) options.queryClient.clear();
        })
        .catch(() => undefined);
    },
  );
}

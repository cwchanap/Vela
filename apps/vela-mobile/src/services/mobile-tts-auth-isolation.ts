import { watch, type WatchStopHandle } from 'vue';
import type { MobileAuthState } from '../auth/mobile-auth-contract';
import {
  selectMobileFeatureSessionStatus,
  type MobileFeatureSessionStatus,
} from '../auth/mobile-feature-session-status';
import type { MobileTtsService } from './mobile-tts';

type AuthTtsSnapshot = {
  phase: MobileAuthState['phase'];
  operation: MobileAuthState['operation'];
  userId: string | null;
  featureStatus: MobileFeatureSessionStatus;
};

function selectAuthTtsSnapshot(state: Readonly<MobileAuthState>): AuthTtsSnapshot {
  return {
    phase: state.phase,
    operation: state.operation,
    userId: state.user?.userId ?? null,
    featureStatus: selectMobileFeatureSessionStatus(state),
  };
}

/**
 * Removes cache and pending-work indexes for the identity that just lost its
 * session. Audio ownership remains with the mounted pronunciation controller.
 */
export function installMobileTtsAuthIsolation(options: {
  state: Readonly<MobileAuthState>;
  ttsService: MobileTtsService;
}): WatchStopHandle {
  let cleanupTail = Promise.resolve();

  return watch(
    () => selectAuthTtsSnapshot(options.state),
    (next, previous) => {
      const previousUserId = previous.userId;
      const identityChanged = previousUserId !== next.userId;
      const signOutTransition =
        next.phase === 'signedOut' ||
        next.operation === 'signingOut' ||
        next.operation === 'cleaningUp';
      const unusableRecovery =
        next.featureStatus.kind === 'recovering' && !next.featureStatus.sessionUsable;

      if (!identityChanged && !signOutTransition && !unusableRecovery) return;

      cleanupTail = cleanupTail
        .catch(() => undefined)
        .then(() => {
          if (signOutTransition || identityChanged) {
            if (previousUserId !== null) options.ttsService.clearUser(previousUserId);
            return;
          }

          if (unusableRecovery && next.featureStatus.kind === 'recovering') {
            options.ttsService.clearUser(next.featureStatus.userId);
          }
        })
        .catch(() => undefined);
    },
  );
}

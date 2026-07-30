import { useQuery } from '@tanstack/vue-query';
import { srsKeys, type SRSStats } from '@vela/common';
import { computed, inject, ref, watch, type ComputedRef, type Ref } from 'vue';
import {
  selectMobileFeatureSessionStatus,
  type MobileFeatureSessionStatus,
} from '../auth/mobile-feature-session-status';
import { MOBILE_AUTH_KEY } from '../services/mobile-auth';
import { MobileApiError } from '../services/mobile-api-client';
import type { MobileSrsService } from '../services/mobile-srs';
import { MOBILE_SRS_SERVICE_KEY } from '../services/mobile-services';

export const DUE_COUNT_RETRY_LIMIT = 2;

export type UseDueReviewCountResult = {
  stats: ComputedRef<SRSStats | undefined>;
  error: ComputedRef<MobileApiError | null>;
  sessionStatus: ComputedRef<MobileFeatureSessionStatus>;
  isInitialPending: ComputedRef<boolean>;
  isFetching: ComputedRef<boolean>;
  sessionRecoveryPending: ComputedRef<boolean>;
  manualRetryPending: Readonly<Ref<boolean>>;
  retry(): Promise<void>;
};

export function retryDueCountQuery(failureCount: number, error: unknown): boolean {
  return (
    error instanceof MobileApiError &&
    (error.code === 'network' || error.code === 'server') &&
    failureCount < DUE_COUNT_RETRY_LIMIT
  );
}

function canRetryControlRace(
  status: MobileFeatureSessionStatus,
  startingUserId: string | null,
  signal: AbortSignal,
): boolean {
  return (
    !signal.aborted &&
    startingUserId !== null &&
    status.kind !== 'unavailable' &&
    status.userId === startingUserId &&
    (status.kind === 'usable' || status.sessionUsable)
  );
}

export function useDueReviewCount(): UseDueReviewCountResult {
  const coordinator = inject(MOBILE_AUTH_KEY);
  const srsService = inject(MOBILE_SRS_SERVICE_KEY);
  if (!coordinator || !srsService) {
    throw new Error('mobile_due_review_count_dependencies_unavailable');
  }
  const dueCountSrsService: MobileSrsService = srsService;

  const sessionStatus = computed(() => selectMobileFeatureSessionStatus(coordinator.state));
  const queryEnabled = computed(
    () =>
      sessionStatus.value.kind === 'usable' ||
      (sessionStatus.value.kind === 'recovering' && sessionStatus.value.sessionUsable),
  );

  async function fetchStatsWithSessionRaceRecovery(signal: AbortSignal): Promise<SRSStats> {
    const startingStatus = sessionStatus.value;
    const startingUserId = startingStatus.kind === 'unavailable' ? null : startingStatus.userId;

    try {
      return await dueCountSrsService.getStats({ signal });
    } catch (error) {
      const isControlRace =
        error instanceof MobileApiError &&
        (error.code === 'session_changed' || error.code === 'session_unavailable');
      if (!isControlRace || !canRetryControlRace(sessionStatus.value, startingUserId, signal)) {
        throw error;
      }

      // The coordinator can reject a request dispatched during the narrow
      // session handoff window. Retry exactly once for the same live user;
      // a second control failure remains visible for an explicit user retry.
      return dueCountSrsService.getStats({ signal });
    }
  }

  const query = useQuery<SRSStats, MobileApiError>({
    queryKey: computed(() =>
      srsKeys.stats(sessionStatus.value.kind === 'unavailable' ? null : sessionStatus.value.userId),
    ),
    enabled: queryEnabled,
    queryFn: ({ signal }) => fetchStatsWithSessionRaceRecovery(signal),
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    retry: retryDueCountQuery,
  });

  const sessionRecoveryPending = computed(
    () =>
      query.error.value instanceof MobileApiError &&
      query.error.value.code === 'session_recovery_pending',
  );
  const manualRetryPending = ref(false);
  const retainedManualError = ref<MobileApiError | null>(null);

  const visibleError = computed<MobileApiError | null>(() => {
    const error = retainedManualError.value ?? query.error.value;
    if (!(error instanceof MobileApiError)) return null;
    if (error.code === 'session_recovery_pending' || error.code === 'unauthorized') {
      return null;
    }
    return error;
  });

  watch(sessionStatus, (next, previous) => {
    if (
      !sessionRecoveryPending.value ||
      previous?.kind !== 'recovering' ||
      next.kind !== 'usable' ||
      previous.userId !== next.userId
    ) {
      return;
    }
    void query.refetch();
  });

  async function retry(): Promise<void> {
    if (manualRetryPending.value) return;
    retainedManualError.value =
      query.error.value instanceof MobileApiError ? query.error.value : null;
    manualRetryPending.value = true;
    try {
      await query.refetch();
    } finally {
      manualRetryPending.value = false;
      retainedManualError.value = null;
    }
  }

  return {
    stats: computed(() => query.data.value),
    error: visibleError,
    sessionStatus,
    isInitialPending: computed(() => query.isPending.value),
    isFetching: computed(() => query.isFetching.value),
    sessionRecoveryPending,
    manualRetryPending: manualRetryPending as Readonly<Ref<boolean>>,
    retry,
  };
}

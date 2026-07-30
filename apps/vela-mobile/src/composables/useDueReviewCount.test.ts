import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { srsKeys, type SRSStats } from '@vela/common';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, nextTick, reactive } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MobileAuthCoordinator, MobileAuthState } from '../auth/mobile-auth-contract';
import { MOBILE_AUTH_KEY } from '../services/mobile-auth';
import { MobileApiError } from '../services/mobile-api-client';
import type { MobileSrsService } from '../services/mobile-srs';
import { MOBILE_SRS_SERVICE_KEY } from '../services/mobile-services';
import { retryDueCountQuery, useDueReviewCount } from './useDueReviewCount';

const stats: SRSStats = {
  total_items: 8,
  due_today: 3,
  mastery_breakdown: { new: 1, learning: 2, reviewing: 3, mastered: 2 },
  average_ease_factor: 2.5,
  total_reviews: 12,
  accuracy_rate: 90,
};

function restoringState(): MobileAuthState {
  return {
    phase: 'initializing',
    operation: 'restoring',
    sessionUsable: false,
    errorCode: null,
    retryAction: null,
    notice: null,
    user: null,
  };
}

function usableState(userId = 'user-1'): MobileAuthState {
  return {
    phase: 'authenticated',
    operation: 'idle',
    sessionUsable: true,
    errorCode: null,
    retryAction: null,
    notice: null,
    user: { userId, email: null },
  };
}

function recoveringState(userId = 'user-1', sessionUsable = true): MobileAuthState {
  return {
    ...usableState(userId),
    operation: 'refreshing',
    sessionUsable,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function mountHarness(
  options: {
    initialState?: MobileAuthState;
    getStats?: MobileSrsService['getStats'];
    retry?: boolean;
  } = {},
) {
  const state = reactive(options.initialState ?? restoringState());
  const coordinator: MobileAuthCoordinator = {
    state,
    initialize: vi.fn(),
    startSignIn: vi.fn(),
    completeCallback: vi.fn(),
    requestAuthenticatedApi: vi.fn(),
    retryCurrentOperation: vi.fn(),
    signOut: vi.fn(),
    dispose: vi.fn(),
  };
  const getStats = vi.fn(options.getStats ?? (async () => stats));
  const service: MobileSrsService = { getStats };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: options.retry ?? false, gcTime: 0 } },
  });
  let result!: ReturnType<typeof useDueReviewCount>;
  const Harness = defineComponent({
    setup() {
      result = useDueReviewCount();
      return () => null;
    },
  });
  const wrapper = mount(Harness, {
    global: {
      plugins: [[VueQueryPlugin, { queryClient }]],
      provide: {
        [MOBILE_AUTH_KEY as symbol]: coordinator,
        [MOBILE_SRS_SERVICE_KEY as symbol]: service,
      },
    },
  });

  return { state, getStats, queryClient, result, wrapper };
}

async function settle(): Promise<void> {
  await nextTick();
  await flushPromises();
  await nextTick();
  await flushPromises();
}

describe('useDueReviewCount', () => {
  const cleanups: (() => void)[] = [];

  afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
  });

  function harness(options?: Parameters<typeof mountHarness>[0]) {
    const mounted = mountHarness(options);
    cleanups.push(() => {
      mounted.wrapper.unmount();
      mounted.queryClient.clear();
    });
    return mounted;
  }

  it('does not request while auth restoration is in progress', async () => {
    const { getStats, result } = harness();
    await settle();

    expect(getStats).not.toHaveBeenCalled();
    expect(result.sessionStatus.value).toEqual({ kind: 'unavailable' });
  });

  it('requests exactly once when restored auth becomes usable', async () => {
    const { state, getStats, result } = harness();

    Object.assign(state, usableState());
    await vi.waitFor(() => expect(getStats).toHaveBeenCalledOnce());

    expect(result.stats.value).toEqual(stats);
  });

  it('uses the authenticated user in its query key', async () => {
    const { queryClient, getStats } = harness({ initialState: usableState('user-7') });
    await vi.waitFor(() => expect(getStats).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(srsKeys.stats('user-7'))).toEqual(stats),
    );

    expect(queryClient.getQueryData(srsKeys.stats('user-7'))).toEqual(stats);
    expect(queryClient.getQueryData(srsKeys.stats(null))).toBeUndefined();
  });

  it('silently retries one same-user session_changed control race', async () => {
    const { getStats, result } = harness({
      initialState: usableState(),
      getStats: vi
        .fn<MobileSrsService['getStats']>()
        .mockRejectedValueOnce(new MobileApiError('session_changed'))
        .mockResolvedValueOnce(stats),
    });

    await vi.waitFor(() => expect(getStats).toHaveBeenCalledTimes(2));
    expect(result.stats.value).toEqual(stats);
    expect(result.error.value).toBeNull();
  });

  it('silently retries one same-user dispatch-time session_unavailable control race', async () => {
    const { getStats, result } = harness({
      initialState: usableState(),
      getStats: vi
        .fn<MobileSrsService['getStats']>()
        .mockRejectedValueOnce(new MobileApiError('session_unavailable'))
        .mockResolvedValueOnce(stats),
    });

    await vi.waitFor(() => expect(getStats).toHaveBeenCalledTimes(2));
    expect(result.stats.value).toEqual(stats);
    expect(result.error.value).toBeNull();
  });

  it('makes a repeated session control race manually retryable', async () => {
    const error = new MobileApiError('session_changed');
    const { getStats, result } = harness({
      initialState: usableState(),
      getStats: vi.fn<MobileSrsService['getStats']>().mockRejectedValue(error),
    });

    await vi.waitFor(() => expect(getStats).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(result.error.value).toBe(error));
  });

  it('keeps cached data while session recovery is pending', async () => {
    const { queryClient, result } = harness({
      initialState: recoveringState(),
      getStats: vi
        .fn<MobileSrsService['getStats']>()
        .mockRejectedValue(new MobileApiError('session_recovery_pending')),
    });
    queryClient.setQueryData(srsKeys.stats('user-1'), stats);
    await settle();

    await vi.waitFor(() => expect(result.sessionRecoveryPending.value).toBe(true));
    expect(result.stats.value).toEqual(stats);
    expect(result.error.value).toBeNull();
  });

  it('exposes recovery loading when session recovery is pending without cached data', async () => {
    const { result } = harness({
      initialState: recoveringState(),
      getStats: vi
        .fn<MobileSrsService['getStats']>()
        .mockRejectedValue(new MobileApiError('session_recovery_pending')),
    });

    await vi.waitFor(() => expect(result.sessionRecoveryPending.value).toBe(true));
    expect(result.stats.value).toBeUndefined();
    expect(result.error.value).toBeNull();
  });

  it('refetches once when a same-user recovery becomes usable after pending recovery', async () => {
    const { state, getStats, result } = harness({
      initialState: recoveringState(),
      getStats: vi
        .fn<MobileSrsService['getStats']>()
        .mockRejectedValueOnce(new MobileApiError('session_recovery_pending'))
        .mockResolvedValueOnce(stats),
    });
    await vi.waitFor(() => expect(result.sessionRecoveryPending.value).toBe(true));

    Object.assign(state, usableState());
    await vi.waitFor(() => expect(getStats).toHaveBeenCalledTimes(2));
    expect(result.stats.value).toEqual(stats);
  });

  it('disables the query while recovery has no usable session', async () => {
    const { getStats, result } = harness({ initialState: recoveringState('user-1', false) });
    await settle();

    expect(getStats).not.toHaveBeenCalled();
    expect(result.sessionStatus.value).toEqual({
      kind: 'recovering',
      userId: 'user-1',
      sessionUsable: false,
    });
  });

  it('selects a new user-scoped key when the authenticated user changes', async () => {
    const { state, getStats, queryClient } = harness({ initialState: usableState('user-1') });
    await vi.waitFor(() => expect(getStats).toHaveBeenCalledOnce());
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(srsKeys.stats('user-1'))).toEqual(stats),
    );

    state.user = { userId: 'user-2', email: null };
    await vi.waitFor(() => expect(getStats).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(queryClient.getQueryData(srsKeys.stats('user-2'))).toEqual(stats),
    );

    expect(queryClient.getQueryData(srsKeys.stats('user-2'))).toEqual(stats);
  });

  it('retains the manual error surface while a manual retry is pending', async () => {
    const secondRequest = deferred<SRSStats>();
    const error = new MobileApiError('forbidden');
    const { getStats, result } = harness({
      initialState: usableState(),
      getStats: vi
        .fn<MobileSrsService['getStats']>()
        .mockRejectedValueOnce(error)
        .mockImplementationOnce(() => secondRequest.promise),
    });
    await vi.waitFor(() => expect(result.error.value).toBe(error));

    const retry = result.retry();
    await vi.waitFor(() => expect(result.manualRetryPending.value).toBe(true));
    await vi.waitFor(() => expect(result.isFetching.value).toBe(true));
    expect(result.error.value).toBe(error);
    expect(getStats).toHaveBeenCalledTimes(2);

    secondRequest.resolve(stats);
    await retry;
    expect(result.manualRetryPending.value).toBe(false);
    expect(result.error.value).toBeNull();
    expect(result.stats.value).toEqual(stats);
  });
});

describe('retryDueCountQuery', () => {
  it.each([
    [0, new MobileApiError('network'), true],
    [1, new MobileApiError('server'), true],
    [2, new MobileApiError('network'), false],
    [0, new MobileApiError('unauthorized'), false],
    [0, new Error('network'), false],
  ])('returns %s only for bounded network/server retries', (failureCount, error, expected) => {
    expect(retryDueCountQuery(failureCount, error)).toBe(expected);
  });
});

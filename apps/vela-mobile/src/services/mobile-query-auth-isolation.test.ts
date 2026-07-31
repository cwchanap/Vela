import { QueryClient } from '@tanstack/vue-query';
import { srsKeys } from '@vela/common';
import { nextTick, reactive } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MobileAuthState } from '../auth/mobile-auth-contract';
import { installMobileQueryAuthIsolation } from './mobile-query-auth-isolation';

function authenticatedState(): MobileAuthState {
  return {
    phase: 'authenticated',
    operation: 'idle',
    sessionUsable: true,
    errorCode: null,
    retryAction: null,
    notice: null,
    user: { userId: 'user-1', email: null },
  };
}

function install() {
  const state = reactive(authenticatedState());
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(srsKeys.stats('user-1'), { due: 4 });
  const stop = installMobileQueryAuthIsolation({ state, queryClient });
  return { state, queryClient, stop };
}

async function settle(): Promise<void> {
  await nextTick();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('mobile query auth isolation', () => {
  const stops: (() => void)[] = [];

  afterEach(() => {
    stops.splice(0).forEach((stop) => stop());
  });

  it('retains cached data during usable soft refresh', async () => {
    const { state, queryClient, stop } = install();
    stops.push(stop);
    const cancelQueries = vi.spyOn(queryClient, 'cancelQueries');

    Object.assign(state, { operation: 'refreshing', sessionUsable: true });
    await settle();

    expect(cancelQueries).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(srsKeys.stats('user-1'))).toEqual({ due: 4 });
  });

  it('cancels without clearing during unusable session recovery', async () => {
    const { state, queryClient, stop } = install();
    stops.push(stop);
    const cancelQueries = vi.spyOn(queryClient, 'cancelQueries');
    const clear = vi.spyOn(queryClient, 'clear');

    Object.assign(state, { operation: 'refreshing', sessionUsable: false });
    await settle();

    expect(cancelQueries).toHaveBeenCalledOnce();
    expect(clear).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(srsKeys.stats('user-1'))).toEqual({ due: 4 });
  });

  it('cancels then removes prior user cache when sign-out starts', async () => {
    const { state, queryClient, stop } = install();
    stops.push(stop);
    const cancelQueries = vi.spyOn(queryClient, 'cancelQueries');
    const removeQueries = vi.spyOn(queryClient, 'removeQueries');
    const clear = vi.spyOn(queryClient, 'clear');

    Object.assign(state, { operation: 'signingOut', sessionUsable: false });
    await settle();

    expect(cancelQueries).toHaveBeenCalledWith({ queryKey: srsKeys.stats('user-1') });
    expect(removeQueries).toHaveBeenCalledWith({ queryKey: srsKeys.stats('user-1') });
    expect(clear).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(srsKeys.stats('user-1'))).toBeUndefined();
  });

  it.each([
    ['terminal signed-out state', { phase: 'signedOut', operation: 'idle', user: null }],
    [
      'cleanup failure',
      {
        phase: 'signedOut',
        operation: 'cleaningUp',
        sessionUsable: false,
        errorCode: 'session_cleanup_failed',
        user: null,
      },
    ],
  ])('clears cached data for %s', async (_label, transition) => {
    const { state, queryClient, stop } = install();
    stops.push(stop);

    Object.assign(state, transition);
    await settle();

    expect(queryClient.getQueryData(srsKeys.stats('user-1'))).toBeUndefined();
  });

  it('clears cached data when the authenticated identity changes', async () => {
    const { state, queryClient, stop } = install();
    stops.push(stop);

    state.user = { userId: 'user-2', email: null };
    await settle();

    expect(queryClient.getQueryData(srsKeys.stats('user-1'))).toBeUndefined();
  });

  it('does not touch cache for ordinary app backgrounding state', async () => {
    const { state, queryClient, stop } = install();
    stops.push(stop);
    const cancelQueries = vi.spyOn(queryClient, 'cancelQueries');
    const clear = vi.spyOn(queryClient, 'clear');

    state.notice = 'session_unusable';
    await settle();

    expect(cancelQueries).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(srsKeys.stats('user-1'))).toEqual({ due: 4 });
  });

  it('waits for scoped cancellation before removing prior user cache', async () => {
    const { state, queryClient, stop } = install();
    stops.push(stop);
    let resolveCancellation!: () => void;
    const cancellation = new Promise<void>((resolve) => {
      resolveCancellation = resolve;
    });
    const removeQueries = vi.spyOn(queryClient, 'removeQueries');
    vi.spyOn(queryClient, 'cancelQueries').mockReturnValue(cancellation);

    Object.assign(state, { operation: 'signingOut', sessionUsable: false });
    await nextTick();
    expect(removeQueries).not.toHaveBeenCalled();

    resolveCancellation();
    await settle();
    expect(removeQueries).toHaveBeenCalledWith({ queryKey: srsKeys.stats('user-1') });
    expect(queryClient.getQueryData(srsKeys.stats('user-1'))).toBeUndefined();
  });

  it('skips the global clear when a successor session starts during delayed cancellation', async () => {
    const { state, queryClient, stop } = install();
    stops.push(stop);
    let resolveCancellation!: () => void;
    const cancellation = new Promise<void>((resolve) => {
      resolveCancellation = resolve;
    });
    const clear = vi.spyOn(queryClient, 'clear');
    vi.spyOn(queryClient, 'cancelQueries').mockReturnValue(cancellation);

    // Sign-out begins: the watcher captures signOutClear = true and starts
    // awaiting cancelQueries(). Cancellation is delayed.
    Object.assign(state, { operation: 'signingOut', sessionUsable: false });
    await nextTick();
    expect(clear).not.toHaveBeenCalled();

    // While cancellation is pending, sign-out completes and a successor
    // user signs in, populating their own cache entry.
    Object.assign(state, {
      phase: 'signedOut',
      operation: 'idle',
      sessionUsable: false,
      user: null,
    });
    await nextTick();
    Object.assign(state, {
      phase: 'authenticated',
      operation: 'idle',
      sessionUsable: true,
      user: { userId: 'user-2', email: null },
    });
    queryClient.setQueryData(srsKeys.stats('user-2'), { due: 7 });
    await nextTick();

    // Now the delayed cancellation resolves. The stale signOutClear flag
    // must NOT cause clear() to erase the successor's freshly seeded cache.
    resolveCancellation();
    await settle();
    expect(clear).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(srsKeys.stats('user-2'))).toEqual({ due: 7 });
  });

  it('does not abort successor in-flight query and removes prior user cache on delayed sign-out', async () => {
    const { state, queryClient, stop } = install();
    stops.push(stop);
    const clear = vi.spyOn(queryClient, 'clear');

    // Sign-out begins and completes — scoped cleanup removes only User 1's
    // cache entry, without global cancelQueries()/clear().
    Object.assign(state, { operation: 'signingOut', sessionUsable: false });
    await settle();

    // Sign-out completes and a successor signs in.
    Object.assign(state, {
      phase: 'signedOut',
      operation: 'idle',
      sessionUsable: false,
      user: null,
    });
    await settle();
    Object.assign(state, {
      phase: 'authenticated',
      operation: 'idle',
      sessionUsable: true,
      user: { userId: 'user-2', email: null },
    });
    await settle();

    // Start an in-flight Home stats request for User 2.
    let signalAborted = false;
    let resolveFetcher!: (value: { due: 9 }) => void;
    const fetcherPromise = new Promise<{ due: 9 }>((resolve) => {
      resolveFetcher = resolve;
    });
    const user2Fetch = queryClient.fetchQuery({
      queryKey: srsKeys.stats('user-2'),
      queryFn: ({ signal }) => {
        signal.addEventListener('abort', () => {
          signalAborted = true;
        });
        return fetcherPromise;
      },
    });
    await settle();

    // User 2's in-flight request must not have been aborted by the
    // sign-out cleanup callbacks.
    expect(signalAborted).toBe(false);

    // User 2's request resolves normally.
    resolveFetcher({ due: 9 });
    await expect(user2Fetch).resolves.toEqual({ due: 9 });

    // User 1's cached data must be removed (no cross-user leak).
    expect(queryClient.getQueryData(srsKeys.stats('user-1'))).toBeUndefined();
    // User 2's resolved data must survive.
    expect(queryClient.getQueryData(srsKeys.stats('user-2'))).toEqual({ due: 9 });
    // Global clear must not have erased the successor's cache.
    expect(clear).not.toHaveBeenCalled();
  });
});

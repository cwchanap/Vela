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

    expect(cancelQueries).toHaveBeenCalledWith({ queryKey: srsKeys.stats('user-1') });
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

  it('does not clear a successor cache when a no-prior-user cleanup retry resumes after successor sign-in', async () => {
    // Begin from a signed-out cleanup state with no prior user, so the
    // watcher's previousUserId === null fallback is the reachable branch.
    const state = reactive<MobileAuthState>({
      phase: 'signedOut',
      operation: 'cleaningUp',
      sessionUsable: false,
      errorCode: 'session_cleanup_failed',
      retryAction: null,
      notice: null,
      user: null,
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const stop = installMobileQueryAuthIsolation({ state, queryClient });
    stops.push(stop);

    const realCancelQueries = queryClient.cancelQueries.bind(queryClient);
    let resolveCancellation!: () => void;
    const cancellation = new Promise<void>((resolve) => {
      resolveCancellation = resolve;
    });
    const clear = vi.spyOn(queryClient, 'clear');
    // Delay only unscoped (global) cancelQueries() — the buggy fallback
    // calls it with no queryKey. Scoped calls pass through so a successor
    // fetchQuery is not blocked.
    vi.spyOn(queryClient, 'cancelQueries').mockImplementation((args) => {
      if (args && typeof args === 'object' && 'queryKey' in args && args.queryKey) {
        return realCancelQueries(args);
      }
      return cancellation;
    });

    // A cleanup retry fires while still signed out with no prior user. The
    // watcher captures signOutClear = true and previousUserId === null.
    Object.assign(state, { operation: 'idle' });
    // Let the cleanup callback start and suspend at the awaited (mocked)
    // global cancelQueries(). The hazard requires the callback to be past
    // its revalidation guard and parked at the await when the successor
    // authenticates; otherwise the guard itself returns early.
    await settle();
    expect(clear).not.toHaveBeenCalled();

    // During the delayed cancellation, a successor authenticates, seeds
    // their cache, and starts an in-flight request.
    Object.assign(state, {
      phase: 'authenticated',
      operation: 'idle',
      sessionUsable: true,
      errorCode: null,
      user: { userId: 'user-2', email: null },
    });
    queryClient.setQueryData(srsKeys.stats('user-2'), { due: 7 });
    await nextTick();

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

    // The delayed cancellation resolves. The stale no-prior-user fallback
    // must NOT globally clear() and must NOT cancel the successor's request.
    resolveCancellation();
    await settle();

    expect(clear).not.toHaveBeenCalled();
    expect(signalAborted).toBe(false);
    expect(queryClient.getQueryData(srsKeys.stats('user-2'))).toEqual({ due: 7 });

    resolveFetcher({ due: 9 });
    await expect(user2Fetch).resolves.toEqual({ due: 9 });
    expect(queryClient.getQueryData(srsKeys.stats('user-2'))).toEqual({ due: 9 });
  });

  it('scopes unusable-recovery cancellation to the recovering user and does not abort a successor in-flight request', async () => {
    const state = reactive<MobileAuthState>({
      phase: 'authenticated',
      operation: 'idle',
      sessionUsable: true,
      errorCode: null,
      retryAction: null,
      notice: null,
      user: { userId: 'user-1', email: null },
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(srsKeys.stats('user-1'), { due: 4 });
    const stop = installMobileQueryAuthIsolation({ state, queryClient });
    stops.push(stop);

    const realCancelQueries = queryClient.cancelQueries.bind(queryClient);
    let resolveCancellation!: () => void;
    const cancellation = new Promise<void>((resolve) => {
      resolveCancellation = resolve;
    });
    const clear = vi.spyOn(queryClient, 'clear');
    // Delay only user-1's scoped cancellation; let other scoped calls and
    // any successor fetchQuery pass through.
    vi.spyOn(queryClient, 'cancelQueries').mockImplementation((args) => {
      if (args && typeof args === 'object' && 'queryKey' in args && args.queryKey) {
        const key = (args as { queryKey: unknown }).queryKey;
        if (Array.isArray(key) && key.includes('user-1')) {
          return cancellation;
        }
        return realCancelQueries(args);
      }
      // Unscoped cancelQueries() should not occur with the scoped fix.
      return cancellation;
    });

    // User 1's session becomes recovering + unusable → cancelOnly fires,
    // scoped to user-1, and awaits the delayed cancellation.
    Object.assign(state, { operation: 'refreshing', sessionUsable: false });
    // Let the cancelOnly callback start and suspend at the awaited (mocked)
    // scoped cancelQueries(). The hazard requires the callback to be parked
    // at the await when the identity changes; otherwise a later queued
    // callback would see the new state and take a different branch.
    await settle();

    // During the delayed cancellation, identity changes to user-2 and
    // user-2 starts an in-flight request.
    Object.assign(state, {
      operation: 'idle',
      sessionUsable: true,
      user: { userId: 'user-2', email: null },
    });
    await nextTick();

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

    // Resolve user-1's delayed cancellation. The stale cancelOnly callback
    // must NOT abort user-2's in-flight request (scoped to user-1 only).
    resolveCancellation();
    await settle();

    expect(clear).not.toHaveBeenCalled();
    expect(signalAborted).toBe(false);

    resolveFetcher({ due: 9 });
    await expect(user2Fetch).resolves.toEqual({ due: 9 });
  });
});

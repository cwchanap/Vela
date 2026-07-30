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

  it('cancels then clears when sign-out starts', async () => {
    const { state, queryClient, stop } = install();
    stops.push(stop);
    const events: string[] = [];
    vi.spyOn(queryClient, 'cancelQueries').mockImplementation(async () => {
      events.push('cancel');
    });
    const queryClientClear = queryClient.clear.bind(queryClient);
    vi.spyOn(queryClient, 'clear').mockImplementation(() => {
      events.push('clear');
      queryClientClear();
    });

    Object.assign(state, { operation: 'signingOut', sessionUsable: false });
    await settle();

    expect(events).toEqual(['cancel', 'clear']);
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

  it('waits for cancellation before clearing cache', async () => {
    const { state, queryClient, stop } = install();
    stops.push(stop);
    let resolveCancellation!: () => void;
    const cancellation = new Promise<void>((resolve) => {
      resolveCancellation = resolve;
    });
    const clear = vi.spyOn(queryClient, 'clear');
    vi.spyOn(queryClient, 'cancelQueries').mockReturnValue(cancellation);

    Object.assign(state, { operation: 'signingOut', sessionUsable: false });
    await nextTick();
    expect(clear).not.toHaveBeenCalled();

    resolveCancellation();
    await settle();
    expect(clear).toHaveBeenCalledOnce();
  });
});

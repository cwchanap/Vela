import { nextTick, reactive } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MobileAuthState } from '../auth/mobile-auth-contract';
import type { MobileTtsService } from './mobile-tts';
import { installMobileTtsAuthIsolation } from './mobile-tts-auth-isolation';

function authenticatedState(userId: string): MobileAuthState {
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

function signedOutState(): MobileAuthState {
  return {
    phase: 'signedOut',
    operation: 'idle',
    sessionUsable: false,
    errorCode: null,
    retryAction: null,
    notice: null,
    user: null,
  };
}

async function settle(): Promise<void> {
  await nextTick();
  await Promise.resolve();
  await Promise.resolve();
}

describe('mobile TTS auth isolation', () => {
  const stops: (() => void)[] = [];

  afterEach(() => {
    stops.splice(0).forEach((stop) => stop());
  });

  it('clears only the previous user on identity replacement', async () => {
    const state = reactive(authenticatedState('user-a'));
    const tts = { clearUser: vi.fn() } as unknown as MobileTtsService;
    stops.push(installMobileTtsAuthIsolation({ state, ttsService: tts }));

    Object.assign(state, authenticatedState('user-b'));
    await settle();

    expect(tts.clearUser).toHaveBeenCalledWith('user-a');
    expect(tts.clearUser).not.toHaveBeenCalledWith('user-b');
  });

  it('does nothing for a null-to-user transition', async () => {
    const state = reactive(signedOutState());
    const tts = { clearUser: vi.fn() } as unknown as MobileTtsService;
    stops.push(installMobileTtsAuthIsolation({ state, ttsService: tts }));

    Object.assign(state, authenticatedState('user-a'));
    await settle();

    expect(tts.clearUser).not.toHaveBeenCalled();
  });

  it('clears the signing-out user without clearing a successor', async () => {
    const state = reactive(authenticatedState('user-a'));
    const tts = { clearUser: vi.fn() } as unknown as MobileTtsService;
    stops.push(installMobileTtsAuthIsolation({ state, ttsService: tts }));

    Object.assign(state, { operation: 'signingOut', sessionUsable: false });
    await settle();
    Object.assign(state, signedOutState());
    await settle();
    Object.assign(state, authenticatedState('user-b'));
    await settle();

    expect(tts.clearUser).toHaveBeenCalledWith('user-a');
    expect(tts.clearUser).not.toHaveBeenCalledWith('user-b');
  });

  it('clears the prior user when terminal cleanup starts', async () => {
    const state = reactive(authenticatedState('user-a'));
    const tts = { clearUser: vi.fn() } as unknown as MobileTtsService;
    stops.push(installMobileTtsAuthIsolation({ state, ttsService: tts }));

    Object.assign(state, {
      ...signedOutState(),
      operation: 'cleaningUp',
    });
    await settle();

    expect(tts.clearUser).toHaveBeenCalledWith('user-a');
  });

  it('clears the recovering user when their session becomes unusable', async () => {
    const state = reactive(authenticatedState('user-a'));
    const tts = { clearUser: vi.fn() } as unknown as MobileTtsService;
    stops.push(installMobileTtsAuthIsolation({ state, ttsService: tts }));

    Object.assign(state, { operation: 'refreshing', sessionUsable: false });
    await settle();

    expect(tts.clearUser).toHaveBeenCalledWith('user-a');
  });

  it('does not clear a successor after a no-prior-user cleanup retry', async () => {
    const state = reactive<MobileAuthState>({
      ...signedOutState(),
      errorCode: 'session_cleanup_failed',
      retryAction: 'cleanup',
      notice: 'cleanup_incomplete',
    });
    const tts = { clearUser: vi.fn() } as unknown as MobileTtsService;
    stops.push(installMobileTtsAuthIsolation({ state, ttsService: tts }));

    Object.assign(state, {
      operation: 'cleaningUp',
      errorCode: null,
      retryAction: null,
      notice: null,
    });
    await settle();
    Object.assign(state, signedOutState());
    await settle();
    Object.assign(state, authenticatedState('user-b'));
    await settle();

    expect(tts.clearUser).not.toHaveBeenCalled();
  });

  it('continues scoped cleanup after a prior clear failure during successor races', async () => {
    const state = reactive(authenticatedState('user-a'));
    const clearUser = vi.fn((userId: string) => {
      if (userId === 'user-a') throw new Error('cache unavailable');
    });
    const tts = { clearUser } as unknown as MobileTtsService;
    stops.push(installMobileTtsAuthIsolation({ state, ttsService: tts }));

    Object.assign(state, authenticatedState('user-b'));
    await settle();
    Object.assign(state, authenticatedState('user-c'));
    await settle();

    expect(clearUser).toHaveBeenNthCalledWith(1, 'user-a');
    expect(clearUser).toHaveBeenNthCalledWith(2, 'user-b');
    expect(clearUser).not.toHaveBeenCalledWith('user-c');
  });

  it('consumes a terminal clear failure without surfacing an unhandled rejection', async () => {
    const state = reactive(authenticatedState('user-a'));
    const clearUser = vi.fn(() => {
      throw new Error('cache unavailable');
    });
    const tts = { clearUser } as unknown as MobileTtsService;
    const unhandledRejections: unknown[] = [];
    const captureUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);
    process.on('unhandledRejection', captureUnhandledRejection);
    stops.push(installMobileTtsAuthIsolation({ state, ttsService: tts }));

    try {
      Object.assign(state, authenticatedState('user-b'));
      await settle();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(clearUser).toHaveBeenCalledWith('user-a');
      expect(unhandledRejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', captureUnhandledRejection);
    }
  });
});

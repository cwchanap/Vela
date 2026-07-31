import { describe, expect, it, vi } from 'vitest';
import {
  MobileAuthenticatedApiRequestError,
  type MobileAuthCoordinator,
  type MobileAuthState,
} from '../auth/mobile-auth-contract';
import { createMobileApiClient, MOBILE_API_DEFAULT_TIMEOUT_MS } from './mobile-api-client';

const usableState: MobileAuthState = {
  phase: 'authenticated',
  operation: 'idle',
  sessionUsable: true,
  errorCode: null,
  retryAction: null,
  notice: null,
  user: { userId: 'user-1', email: null },
};

type AuthenticatedRequest = { init?: { signal?: AbortSignal | null } };

function response(status: number, value: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: vi.fn().mockResolvedValue(value),
  } as unknown as Response;
}

function coordinator(overrides: Partial<MobileAuthCoordinator> = {}): MobileAuthCoordinator {
  return {
    state: usableState,
    initialize: vi.fn(),
    startSignIn: vi.fn(),
    completeCallback: vi.fn(),
    requestAuthenticatedApi: vi.fn().mockResolvedValue(response(200, { due_today: 4 })),
    retryCurrentOperation: vi.fn(),
    signOut: vi.fn(),
    dispose: vi.fn(),
    ...overrides,
  };
}

function expectCallerCleanup(caller: AbortController, remove: ReturnType<typeof vi.spyOn>): void {
  expect(vi.getTimerCount()).toBe(0);
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
}

describe('mobile API client', () => {
  it('returns a successful JSON response', async () => {
    const auth = coordinator();
    const client = createMobileApiClient(auth);

    await expect(client.getJson('srs/stats')).resolves.toEqual({ due_today: 4 });
    expect(auth.requestAuthenticatedApi).toHaveBeenCalledWith({
      path: 'srs/stats',
      init: { signal: expect.any(AbortSignal) },
    });
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'server'],
    [409, 'server'],
    [500, 'server'],
  ] as const)('maps HTTP %i to %s', async (status, code) => {
    const client = createMobileApiClient(
      coordinator({ requestAuthenticatedApi: vi.fn().mockResolvedValue(response(status, {})) }),
    );

    await expect(client.getJson('srs/stats')).rejects.toMatchObject({ code });
  });

  it.each([
    ['invalid_request_path', 'invalid_request'],
    ['invalid_request_headers', 'invalid_request'],
    ['session_unavailable', 'session_unavailable'],
    ['session_changed', 'session_changed'],
    ['session_recovery_pending', 'session_recovery_pending'],
    ['request_timeout', 'network'],
  ] as const)('maps coordinator %s to %s', async (source, code) => {
    const client = createMobileApiClient(
      coordinator({
        requestAuthenticatedApi: vi
          .fn()
          .mockRejectedValue(new MobileAuthenticatedApiRequestError(source)),
      }),
    );

    await expect(client.getJson('srs/stats')).rejects.toMatchObject({ code });
  });

  it('maps a raw transport TypeError to network', async () => {
    const client = createMobileApiClient(
      coordinator({ requestAuthenticatedApi: vi.fn().mockRejectedValue(new TypeError('offline')) }),
    );

    await expect(client.getJson('srs/stats')).rejects.toMatchObject({ code: 'network' });
  });

  it('cleans the deadline and caller listener after a coordinator rejection', async () => {
    vi.useFakeTimers();
    try {
      const caller = new AbortController();
      const remove = vi.spyOn(caller.signal, 'removeEventListener');
      const client = createMobileApiClient(
        coordinator({
          requestAuthenticatedApi: vi
            .fn()
            .mockRejectedValue(new MobileAuthenticatedApiRequestError('session_unavailable')),
        }),
      );

      await expect(client.getJson('srs/stats', { signal: caller.signal })).rejects.toMatchObject({
        code: 'session_unavailable',
      });
      expectCallerCleanup(caller, remove);
    } finally {
      vi.useRealTimers();
    }
  });

  it('cleans the deadline and caller listener after an HTTP error', async () => {
    vi.useFakeTimers();
    try {
      const caller = new AbortController();
      const remove = vi.spyOn(caller.signal, 'removeEventListener');
      const client = createMobileApiClient(
        coordinator({ requestAuthenticatedApi: vi.fn().mockResolvedValue(response(500, {})) }),
      );

      await expect(client.getJson('srs/stats', { signal: caller.signal })).rejects.toMatchObject({
        code: 'server',
      });
      expectCallerCleanup(caller, remove);
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps malformed JSON to invalid_response and cleans request resources', async () => {
    vi.useFakeTimers();
    try {
      const caller = new AbortController();
      const remove = vi.spyOn(caller.signal, 'removeEventListener');
      const malformed = response(200, {});
      vi.mocked(malformed.json).mockRejectedValue(new SyntaxError('bad JSON'));
      const client = createMobileApiClient(
        coordinator({ requestAuthenticatedApi: vi.fn().mockResolvedValue(malformed) }),
      );

      await expect(client.getJson('srs/stats', { signal: caller.signal })).rejects.toMatchObject({
        code: 'invalid_response',
      });
      expectCallerCleanup(caller, remove);
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps a body transport rejection to network', async () => {
    const unreadable = response(200, {});
    vi.mocked(unreadable.json).mockRejectedValue(new TypeError('body stream failed'));
    const client = createMobileApiClient(
      coordinator({ requestAuthenticatedApi: vi.fn().mockResolvedValue(unreadable) }),
    );

    await expect(client.getJson('srs/stats')).rejects.toMatchObject({ code: 'network' });
  });

  it('maps an execution deadline outside recovery to network', async () => {
    vi.useFakeTimers();
    try {
      const auth = coordinator({
        requestAuthenticatedApi: vi.fn(
          ({ init }: AuthenticatedRequest) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () =>
                reject(new DOMException('aborted', 'AbortError')),
              );
            }),
        ),
      });
      const caller = new AbortController();
      const remove = vi.spyOn(caller.signal, 'removeEventListener');
      const promise = createMobileApiClient(auth).getJson('srs/stats', { signal: caller.signal });
      const expected = expect(promise).rejects.toMatchObject({ code: 'network' });

      await vi.advanceTimersByTimeAsync(MOBILE_API_DEFAULT_TIMEOUT_MS);

      await expected;
      expectCallerCleanup(caller, remove);
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps an execution deadline during recovery to session_recovery_pending', async () => {
    vi.useFakeTimers();
    try {
      const auth = coordinator({
        state: { ...usableState, operation: 'refreshing', sessionUsable: false },
        requestAuthenticatedApi: vi.fn(
          ({ init }: AuthenticatedRequest) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () =>
                reject(new DOMException('aborted', 'AbortError')),
              );
            }),
        ),
      });
      const promise = createMobileApiClient(auth).getJson('srs/stats');
      const expected = expect(promise).rejects.toMatchObject({ code: 'session_recovery_pending' });

      await vi.advanceTimersByTimeAsync(MOBILE_API_DEFAULT_TIMEOUT_MS);

      await expected;
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves a caller abort as AbortError', async () => {
    vi.useFakeTimers();
    try {
      const caller = new AbortController();
      const remove = vi.spyOn(caller.signal, 'removeEventListener');
      const auth = coordinator({
        requestAuthenticatedApi: vi.fn(
          ({ init }: AuthenticatedRequest) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () =>
                reject(new DOMException('aborted', 'AbortError')),
              );
            }),
        ),
      });
      const promise = createMobileApiClient(auth).getJson('srs/stats', { signal: caller.signal });
      const expected = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
      caller.abort();

      await expected;
      expectCallerCleanup(caller, remove);
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps a stalled response body at the execution deadline to network', async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const stalled = response(200, {});
      vi.mocked(stalled.json).mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      );
      const auth = coordinator({
        requestAuthenticatedApi: vi.fn(({ init }: AuthenticatedRequest) => {
          signal = init?.signal ?? undefined;
          return Promise.resolve(stalled);
        }),
      });
      const promise = createMobileApiClient(auth).getJson('srs/stats');
      const expected = expect(promise).rejects.toMatchObject({ code: 'network' });
      await vi.advanceTimersByTimeAsync(MOBILE_API_DEFAULT_TIMEOUT_MS);

      await expected;
    } finally {
      vi.useRealTimers();
    }
  });

  it('cleans its deadline timer and caller listener after success', async () => {
    vi.useFakeTimers();
    try {
      const caller = new AbortController();
      const remove = vi.spyOn(caller.signal, 'removeEventListener');
      await expect(
        createMobileApiClient(coordinator()).getJson('srs/stats', { signal: caller.signal }),
      ).resolves.toEqual({ due_today: 4 });

      expect(vi.getTimerCount()).toBe(0);
      expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    } finally {
      vi.useRealTimers();
    }
  });
});

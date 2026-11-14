import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn(),
}));

import { fetchAuthSession } from 'aws-amplify/auth';
import { DEFAULT_HTTP_TIMEOUT_MS, httpJson, httpJsonAuth } from './httpClient';

const mockFetchAuthSession = vi.mocked(fetchAuthSession);

describe('httpJson', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('makes a fetch request with Content-Type application/json', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: 'test' }) }),
    );

    const result = await httpJson('/api/test');
    expect(result).toEqual({ data: 'test' });
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/test',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });

  it('throws error with statusText on non-ok response without body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Not Found',
        json: async () => {
          throw new Error('parse error');
        },
      }),
    );

    await expect(httpJson('/api/missing')).rejects.toThrow('Not Found');
  });

  it('throws error with error field from response body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Bad Request',
        json: async () => ({ error: 'Invalid input' }),
      }),
    );

    await expect(httpJson('/api/bad')).rejects.toThrow('Invalid input');
  });

  it('throws error with stringified non-string error field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Bad Request',
        json: async () => ({ error: { code: 400 } }),
      }),
    );

    await expect(httpJson('/api/bad')).rejects.toThrow('{"code":400}');
  });

  it('merges caller headers with Content-Type header', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));

    await httpJson('/api/test', { headers: { 'X-Custom': 'value' } });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/test',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Custom': 'value',
        }),
      }),
    );
  });

  it('handles Headers instance as init headers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));

    const headers = new Headers({ 'X-Token': 'abc' });
    await httpJson('/api/test', { headers });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/test',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-token': 'abc' }),
      }),
    );
  });

  it('handles array of header pairs as init headers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));

    await httpJson('/api/test', { headers: [['X-Pair', 'yes']] });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/test',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Pair': 'yes' }),
      }),
    );
  });

  it('throws a controlled error when a successful response is HTML', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'text/html; charset=utf-8' }),
        text: async () => '<!doctype html>',
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
      }),
    );

    await expect(httpJson('/api/test')).rejects.toMatchObject({
      message: expect.stringContaining('Expected JSON response'),
      status: 200,
    });
  });

  describe('caller cancellation', () => {
    // The test environment's Request (injected from the host runtime) may
    // reject an AbortSignal from the jsdom realm, so attach the caller's
    // signal as an own property instead of via RequestInit.
    const requestWithSignal = (signal: AbortSignal): Request => {
      const request = new Request('http://localhost/api/test');
      Object.defineProperty(request, 'signal', { value: signal });
      return request;
    };

    it('rejects when the signal stored on a Request input aborts', async () => {
      const caller = new AbortController();
      const request = requestWithSignal(caller.signal);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(() => new Promise(() => {})),
      );

      const pending = httpJson(request);
      const assertion = expect(pending).rejects.toThrow(/abort/i);
      caller.abort();
      await assertion;
    });

    it('ignores the Request input signal when init.signal is explicitly null', async () => {
      const caller = new AbortController();
      const request = requestWithSignal(caller.signal);
      let capturedSignal: AbortSignal | undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((_input: RequestInfo, init?: RequestInit) => {
          capturedSignal = init?.signal as AbortSignal | undefined;
          return Promise.resolve({ ok: true, json: async () => ({}) });
        }),
      );

      await httpJson(request, { signal: null });
      caller.abort();
      expect(capturedSignal?.aborted).toBe(false);
    });
  });
});

describe('httpJsonAuth', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('includes Authorization Bearer token in request headers', async () => {
    mockFetchAuthSession.mockResolvedValue({
      tokens: { idToken: { toString: () => 'test-token-123' } },
    } as any);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }),
    );

    await httpJsonAuth('/api/protected');

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/protected',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-token-123' }),
      }),
    );
  });

  it('throws when no id token available', async () => {
    mockFetchAuthSession.mockResolvedValue({
      tokens: { idToken: undefined },
    } as any);

    await expect(httpJsonAuth('/api/protected')).rejects.toThrow('Authentication required');
  });

  it('throws when fetchAuthSession rejects', async () => {
    mockFetchAuthSession.mockRejectedValue(new Error('Network error'));

    await expect(httpJsonAuth('/api/protected')).rejects.toThrow('Authentication required');
  });

  it('throws on non-ok response with error body', async () => {
    mockFetchAuthSession.mockResolvedValue({
      tokens: { idToken: { toString: () => 'token' } },
    } as any);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Forbidden',
        json: async () => ({ error: 'Access denied' }),
      }),
    );

    await expect(httpJsonAuth('/api/protected')).rejects.toThrow('Access denied');
  });

  it('includes the response status on authenticated request errors', async () => {
    mockFetchAuthSession.mockResolvedValue({
      tokens: { idToken: { toString: () => 'token' } },
    } as any);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ error: 'Missing word' }),
      }),
    );

    await expect(httpJsonAuth('/api/protected')).rejects.toMatchObject({
      message: 'Missing word',
      status: 404,
    });
  });

  it('stringifies non-string error payloads for authenticated requests', async () => {
    mockFetchAuthSession.mockResolvedValue({
      tokens: { idToken: { toString: () => 'token' } },
    } as any);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Forbidden',
        json: async () => ({ error: { code: 403 } }),
      }),
    );

    await expect(httpJsonAuth('/api/protected')).rejects.toThrow('{"code":403}');
  });

  it('caller headers override auth headers', async () => {
    mockFetchAuthSession.mockResolvedValue({
      tokens: { idToken: { toString: () => 'original-token' } },
    } as any);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));

    await httpJsonAuth('/api/protected', {
      headers: { Authorization: 'Bearer override-token' },
    });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/protected',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer override-token' }),
      }),
    );
  });

  it('throws a controlled error when an authenticated response is HTML', async () => {
    mockFetchAuthSession.mockResolvedValue({
      tokens: { idToken: { toString: () => 'token' } },
    } as any);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'text/html' }),
        text: async () => '<!doctype html>',
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
      }),
    );

    await expect(httpJsonAuth('/api/protected')).rejects.toMatchObject({
      message: expect.stringContaining('Expected JSON response'),
      status: 200,
    });
  });

  describe('expectedUserId binding', () => {
    const sessionFor = (sub: string | undefined) => ({
      tokens: {
        idToken: {
          toString: () => `token-${sub}`,
          ...(sub === undefined ? {} : { payload: { sub } }),
        },
      },
    });

    it('sends the request when the token sub matches expectedUserId', async () => {
      mockFetchAuthSession.mockResolvedValue(sessionFor('user-a') as any);
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
      vi.stubGlobal('fetch', fetchMock);

      await httpJsonAuth('/api/protected', undefined, 'user-a');

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/protected',
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer token-user-a' }),
        }),
      );
    });

    it('rejects without fetching when the token sub differs from expectedUserId', async () => {
      mockFetchAuthSession.mockResolvedValue(sessionFor('user-b') as any);
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
      vi.stubGlobal('fetch', fetchMock);

      await expect(httpJsonAuth('/api/protected', undefined, 'user-a')).rejects.toThrow(
        /account changed/i,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects without fetching when the token carries no sub', async () => {
      mockFetchAuthSession.mockResolvedValue(sessionFor(undefined) as any);
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
      vi.stubGlobal('fetch', fetchMock);

      await expect(httpJsonAuth('/api/protected', undefined, 'user-a')).rejects.toThrow(
        /account changed/i,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('timeout handling', () => {
    it('aborts and rejects stalled httpJson requests after DEFAULT_HTTP_TIMEOUT_MS', async () => {
      vi.useFakeTimers();
      let capturedSignal: AbortSignal | undefined;
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
          capturedSignal = init?.signal as AbortSignal | undefined;
          return new Promise(() => {});
        }),
      );

      const pending = httpJson('/api/stalled');
      const assertion = expect(pending).rejects.toThrow('Request timed out');
      await vi.advanceTimersByTimeAsync(DEFAULT_HTTP_TIMEOUT_MS);
      await assertion;
      expect(capturedSignal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('aborts and rejects stalled httpJsonAuth requests and clears timers on success', async () => {
      vi.useFakeTimers();
      mockFetchAuthSession.mockResolvedValue({
        tokens: { idToken: { toString: () => 'token' } },
      } as any);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }),
      );

      await expect(httpJsonAuth('/api/fast')).resolves.toEqual({ ok: true });
      expect(vi.getTimerCount()).toBe(0);

      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(() => new Promise(() => {})),
      );
      const stalled = httpJsonAuth('/api/stalled-auth');
      const assertion = expect(stalled).rejects.toThrow('Request timed out');
      await vi.advanceTimersByTimeAsync(DEFAULT_HTTP_TIMEOUT_MS);
      await assertion;
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});

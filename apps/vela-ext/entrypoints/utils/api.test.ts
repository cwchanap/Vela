import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signIn, checkSession, refreshToken, saveDictionaryEntry, getMyDictionaries } from './api';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockJsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(data),
  };
}

beforeEach(() => {
  mockFetch.mockClear();
});

describe('signIn', () => {
  it('returns tokens on successful sign in', async () => {
    const tokens = { accessToken: 'access', refreshToken: 'refresh', idToken: 'id' };
    mockFetch.mockResolvedValue(mockJsonResponse({ tokens }));

    const result = await signIn('user@example.com', 'password123');

    expect(result).toEqual(tokens);
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('/auth/signin');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({
      email: 'user@example.com',
      password: 'password123',
    });
  });

  it('throws an error with message from response when sign in fails', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ error: 'Invalid credentials' }, 401));

    await expect(signIn('bad@example.com', 'wrong')).rejects.toThrow('Invalid credentials');
  });

  it('throws generic error when response has no error field', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({}, 500));

    await expect(signIn('user@example.com', 'pass')).rejects.toThrow('Sign in failed');
  });

  it('sends Content-Type: application/json header', async () => {
    const tokens = { accessToken: 'a', refreshToken: 'r', idToken: 'i' };
    mockFetch.mockResolvedValue(mockJsonResponse({ tokens }));

    await signIn('user@example.com', 'pass');

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['Content-Type']).toBe('application/json');
  });
});

describe('checkSession', () => {
  it('returns true when session is valid', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ authenticated: true }));

    const result = await checkSession('valid-id-token');

    expect(result).toBe(true);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('/auth/session');
    expect(options.headers['Authorization']).toBe('Bearer valid-id-token');
  });

  it('returns false when response is not ok', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ authenticated: false }, 401));

    const result = await checkSession('expired-token');

    expect(result).toBe(false);
  });

  it('returns false when authenticated is not true in response', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ authenticated: false }));

    const result = await checkSession('token');

    expect(result).toBe(false);
  });

  it('returns false when fetch throws an error', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const result = await checkSession('token');

    expect(result).toBe(false);
  });
});

describe('refreshToken', () => {
  it('returns new tokens on successful refresh', async () => {
    const newTokens = { accessToken: 'new-access', refreshToken: 'new-refresh', idToken: 'new-id' };
    mockFetch.mockResolvedValue(mockJsonResponse({ tokens: newTokens }));

    const result = await refreshToken('old-refresh-token');

    expect(result).toEqual(newTokens);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('/auth/refresh');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ refreshToken: 'old-refresh-token' });
  });

  it('throws an error with message from response when refresh fails', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ error: 'Token expired' }, 401));

    await expect(refreshToken('bad-refresh')).rejects.toThrow('Token expired');
  });

  it('throws generic error when response has no error field', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({}, 500));

    await expect(refreshToken('token')).rejects.toThrow('Token refresh failed');
  });
});

describe('saveDictionaryEntry', () => {
  it('calls the correct endpoint with auth token and params', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({}));

    await saveDictionaryEntry('my-id-token', {
      sentence: 'こんにちは',
      sourceUrl: 'https://example.com',
      context: 'greeting',
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('/my-dictionaries');
    expect(options.method).toBe('POST');
    expect(options.headers['Authorization']).toBe('Bearer my-id-token');
    expect(JSON.parse(options.body)).toMatchObject({
      sentence: 'こんにちは',
      sourceUrl: 'https://example.com',
      context: 'greeting',
    });
  });

  it('resolves without returning a value on success', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({}));

    const result = await saveDictionaryEntry('token', { sentence: 'テスト' });

    expect(result).toBeUndefined();
  });

  it('throws an error with message from response on failure', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ error: 'Unauthorized' }, 401));

    await expect(saveDictionaryEntry('bad-token', { sentence: 'テスト' })).rejects.toThrow(
      'Unauthorized',
    );
  });

  it('throws generic error when response has no error field', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({}, 500));

    await expect(saveDictionaryEntry('token', { sentence: 'テスト' })).rejects.toThrow(
      'Failed to save dictionary entry',
    );
  });

  it('works with only the required sentence parameter', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({}));

    await expect(saveDictionaryEntry('token', { sentence: 'テスト' })).resolves.toBeUndefined();
  });
});

describe('getMyDictionaries', () => {
  const mockEntries = [{ sentence_id: '1', sentence: 'テスト' }];

  it('returns entries from the data field', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ data: mockEntries }));

    const result = await getMyDictionaries('my-id-token');

    expect(result).toEqual(mockEntries);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toContain('/my-dictionaries');
    expect(options.headers['Authorization']).toBe('Bearer my-id-token');
  });

  it('uses default limit of 50', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ data: [] }));

    await getMyDictionaries('token');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('limit=50');
  });

  it('uses custom limit when provided', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ data: [] }));

    await getMyDictionaries('token', 20);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('limit=20');
  });

  it('throws an error with message from response on failure', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ error: 'Unauthorized' }, 401));

    await expect(getMyDictionaries('bad-token')).rejects.toThrow('Unauthorized');
  });

  it('throws generic error when response has no error field', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({}, 500));

    await expect(getMyDictionaries('token')).rejects.toThrow('Failed to fetch dictionary entries');
  });
});

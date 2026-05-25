import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkSession,
  refreshToken,
  saveDictionaryEntry,
  getMyDictionaries,
} from '../../entrypoints/utils/api';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockJsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: vi.fn((name: string) =>
        name.toLowerCase() === 'content-type' ? 'application/json' : null,
      ),
    },
    json: vi.fn().mockResolvedValue(data),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

afterAll(() => {
  vi.unstubAllGlobals();
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

  it('throws generic error with status when response has no error field', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({}, 500));

    await expect(refreshToken('token')).rejects.toThrow('Token refresh failed (HTTP 500)');
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

  it('throws generic error with status when response has no error field', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({}, 500));

    await expect(saveDictionaryEntry('token', { sentence: 'テスト' })).rejects.toThrow(
      'Failed to save dictionary entry (HTTP 500)',
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

  it('throws generic error with status when response has no error field', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({}, 500));

    await expect(getMyDictionaries('token')).rejects.toThrow(
      'Failed to fetch dictionary entries (HTTP 500)',
    );
  });

  it('throws fallback error when response body is not JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      headers: {
        get: vi.fn((name: string) => (name.toLowerCase() === 'content-type' ? 'text/plain' : null)),
      },
      json: vi.fn(),
    });

    await expect(getMyDictionaries('token')).rejects.toThrow(
      'Failed to fetch dictionary entries (HTTP 500)',
    );
  });

  it('throws fallback error when json() rejects in getJsonBody', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: {
        get: vi.fn(() => 'application/json'),
      },
      json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
    });

    await expect(getMyDictionaries('token')).rejects.toThrow(
      'Failed to fetch dictionary entries: invalid response from server',
    );
  });

  it('throws fallback error with status when error field is empty string', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ error: '' }, 500));

    await expect(getMyDictionaries('token')).rejects.toThrow(
      'Failed to fetch dictionary entries (HTTP 500)',
    );
  });

  it('extracts error message from response message field when error field is missing', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ message: 'Custom error from server' }, 400));

    await expect(getMyDictionaries('token')).rejects.toThrow('Custom error from server');
  });

  it('falls back to status message when both error and message fields are empty', async () => {
    mockFetch.mockResolvedValue(mockJsonResponse({ error: '', message: '' }, 422));

    await expect(getMyDictionaries('token')).rejects.toThrow(
      'Failed to fetch dictionary entries (HTTP 422)',
    );
  });

  it('falls back to status message when json() throws during error extraction', async () => {
    const response = {
      ok: false,
      status: 502,
      headers: {
        get: vi.fn(() => 'application/json'),
      },
      json: vi.fn().mockRejectedValue(new SyntaxError('Invalid JSON')),
    };
    mockFetch.mockResolvedValue(response);

    await expect(getMyDictionaries('token')).rejects.toThrow(
      'Failed to fetch dictionary entries (HTTP 502)',
    );
  });
});

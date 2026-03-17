import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn(),
}));

import { fetchAuthSession } from 'aws-amplify/auth';
import { httpJson, httpJsonAuth } from './httpClient';

const mockFetchAuthSession = vi.mocked(fetchAuthSession);

describe('httpJson', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('makes a fetch request with Content-Type application/json', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: 'test' }),
    } as Response);

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
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Not Found',
      json: async () => {
        throw new Error('parse error');
      },
    } as unknown as Response);

    await expect(httpJson('/api/missing')).rejects.toThrow('Not Found');
  });

  it('throws error with error field from response body', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Bad Request',
      json: async () => ({ error: 'Invalid input' }),
    } as unknown as Response);

    await expect(httpJson('/api/bad')).rejects.toThrow('Invalid input');
  });

  it('throws error with stringified non-string error field', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Bad Request',
      json: async () => ({ error: { code: 400 } }),
    } as unknown as Response);

    await expect(httpJson('/api/bad')).rejects.toThrow('{"code":400}');
  });

  it('merges caller headers with Content-Type header', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

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
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

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
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

    await httpJson('/api/test', { headers: [['X-Pair', 'yes']] });

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/test',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Pair': 'yes' }),
      }),
    );
  });
});

describe('httpJsonAuth', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('includes Authorization Bearer token in request headers', async () => {
    mockFetchAuthSession.mockResolvedValue({
      tokens: { idToken: { toString: () => 'test-token-123' } },
    } as any);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

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

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: 'Forbidden',
      json: async () => ({ error: 'Access denied' }),
    } as unknown as Response);

    await expect(httpJsonAuth('/api/protected')).rejects.toThrow('Access denied');
  });

  it('caller headers override auth headers', async () => {
    mockFetchAuthSession.mockResolvedValue({
      tokens: { idToken: { toString: () => 'original-token' } },
    } as any);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    } as Response);

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
});

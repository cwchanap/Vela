import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  saveAuthTokens,
  getAuthTokens,
  getUserEmail,
  clearAuthData,
  getValidAccessToken,
  refreshAccessToken,
} from './storage';
import type { AuthTokens } from './api';

const { mockRefreshToken } = vi.hoisted(() => {
  const mockRefreshToken = vi.fn(
    async (token: string): Promise<AuthTokens> => ({
      accessToken: `${token}-access`,
      refreshToken: `${token}-refresh`,
      idToken: `${token}-id`,
    }),
  );

  return { mockRefreshToken };
});

defineBrowserMocks();

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return {
    ...actual,
    refreshToken: mockRefreshToken,
  };
});

function defineBrowserMocks() {
  const storageState: Record<string, any> = {};

  beforeEach(() => {
    Object.keys(storageState).forEach((key) => delete storageState[key]);
    mockRefreshToken.mockClear();

    (globalThis as any).browser = {
      storage: {
        local: {
          set: vi.fn(async (data: Record<string, unknown>) => {
            Object.assign(storageState, data);
          }),
          get: vi.fn(async (key: string | string[]) => {
            if (Array.isArray(key)) {
              return key.reduce<Record<string, unknown>>((acc, current) => {
                acc[current] = storageState[current];
                return acc;
              }, {});
            }

            return { [key]: storageState[key] };
          }),
          remove: vi.fn(async (keys: string | string[]) => {
            const list = Array.isArray(keys) ? keys : [keys];
            list.forEach((current) => {
              delete storageState[current];
            });
          }),
        },
      },
    };
  });
}

describe('storage utils', () => {
  const tokens: AuthTokens = {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    idToken: 'id-token',
  };

  it('saves and retrieves auth tokens with optional email', async () => {
    await saveAuthTokens(tokens, 'user@example.com');

    await expect(getAuthTokens()).resolves.toStrictEqual(tokens);
    await expect(getUserEmail()).resolves.toBe('user@example.com');
  });

  it('clears stored auth data', async () => {
    await saveAuthTokens(tokens, 'user@example.com');
    await clearAuthData();

    await expect(getAuthTokens()).resolves.toBeNull();
    await expect(getUserEmail()).resolves.toBeNull();
  });

  it('returns valid access token when available', async () => {
    await saveAuthTokens(tokens);

    await expect(getValidAccessToken()).resolves.toBe(tokens.accessToken);
  });

  it('refreshes access token and persists new credentials', async () => {
    await saveAuthTokens(tokens);

    const newAccessToken = await refreshAccessToken();

    expect(newAccessToken).toBe('refresh-token-access');
    await expect(getAuthTokens()).resolves.toStrictEqual({
      accessToken: 'refresh-token-access',
      refreshToken: 'refresh-token-refresh',
      idToken: 'refresh-token-id',
    });
    expect(mockRefreshToken).toHaveBeenCalledWith('refresh-token');
  });
});

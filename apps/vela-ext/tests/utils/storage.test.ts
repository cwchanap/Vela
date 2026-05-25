import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  saveAuthTokens,
  getAuthTokens,
  getUserEmail,
  clearAuthData,
  getValidAccessToken,
  refreshAccessToken,
  setExplicitSignout,
  isExplicitSignout,
  clearExplicitSignout,
  isAuthenticated,
  getValidIdToken,
  refreshIdToken,
} from '../../entrypoints/utils/storage';
import type { AuthTokens } from '../../entrypoints/utils/api';

const { mockRefreshToken, mockClearAllPending } = vi.hoisted(() => {
  const mockRefreshToken = vi.fn(
    async (token: string): Promise<AuthTokens> => ({
      accessToken: `${token}-access`,
      refreshToken: `${token}-refresh`,
      idToken: `${token}-id`,
    }),
  );
  const mockClearAllPending = vi.fn().mockResolvedValue(undefined);

  return { mockRefreshToken, mockClearAllPending };
});

defineBrowserMocks();

vi.mock('../../entrypoints/utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../entrypoints/utils/api')>();
  return {
    ...actual,
    refreshToken: mockRefreshToken,
  };
});

vi.mock('../../entrypoints/utils/idb', () => ({
  clearAllPending: mockClearAllPending,
  openDB: vi.fn(),
  STORE_NAME: 'vela-pending-sentences',
  DB_NAME: 'vela-offline-queue',
  DB_VERSION: 1,
}));

function defineBrowserMocks() {
  const storageState: Record<string, any> = {};

  beforeEach(() => {
    Object.keys(storageState).forEach((key) => delete storageState[key]);
    mockRefreshToken.mockClear();
    mockClearAllPending.mockClear();

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

  it('does not clear the offline queue when clearing auth data', async () => {
    await saveAuthTokens(tokens, 'user@example.com');
    await clearAuthData();

    expect(mockClearAllPending).not.toHaveBeenCalled();
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

  it('getValidAccessToken throws Not authenticated when no tokens stored', async () => {
    await expect(getValidAccessToken()).rejects.toThrow('Not authenticated');
  });

  describe('refreshAccessToken', () => {
    it('throws No refresh token available when empty refreshToken', async () => {
      await saveAuthTokens({ ...tokens, refreshToken: '' });

      await expect(refreshAccessToken()).rejects.toThrow('No refresh token available');
    });

    it('clears auth data when API errors', async () => {
      mockRefreshToken.mockRejectedValueOnce(new Error('API error'));
      await saveAuthTokens(tokens);

      await expect(refreshAccessToken()).rejects.toThrow('Session expired. Please log in again.');
      await expect(getAuthTokens()).resolves.toBeNull();
    });
  });

  describe('isAuthenticated', () => {
    it('returns true when tokens with accessToken exist', async () => {
      await saveAuthTokens(tokens);

      await expect(isAuthenticated()).resolves.toBe(true);
    });

    it('returns false when no tokens stored', async () => {
      await expect(isAuthenticated()).resolves.toBe(false);
    });

    it('returns false when accessToken is empty', async () => {
      await saveAuthTokens({ ...tokens, accessToken: '' });

      await expect(isAuthenticated()).resolves.toBe(false);
    });
  });

  describe('getValidIdToken', () => {
    it('returns id token when available', async () => {
      await saveAuthTokens(tokens);

      await expect(getValidIdToken()).resolves.toBe('id-token');
    });

    it('throws Not authenticated when no tokens', async () => {
      await expect(getValidIdToken()).rejects.toThrow('Not authenticated');
    });

    it('throws No ID token available when idToken is empty', async () => {
      await saveAuthTokens({ ...tokens, idToken: '' });

      await expect(getValidIdToken()).rejects.toThrow('No ID token available');
    });
  });

  describe('refreshIdToken', () => {
    it('refreshes and returns new id token', async () => {
      await saveAuthTokens(tokens);

      const idToken = await refreshIdToken();

      expect(idToken).toBe('refresh-token-id');
      await expect(getAuthTokens()).resolves.toStrictEqual({
        accessToken: 'refresh-token-access',
        refreshToken: 'refresh-token-refresh',
        idToken: 'refresh-token-id',
      });
    });

    it('throws No refresh token available', async () => {
      await saveAuthTokens({ ...tokens, refreshToken: '' });

      await expect(refreshIdToken()).rejects.toThrow('No refresh token available');
    });

    it('clears auth data when refresh API fails', async () => {
      mockRefreshToken.mockRejectedValueOnce(new Error('Network error'));
      await saveAuthTokens(tokens);

      await expect(refreshIdToken()).rejects.toThrow('Session expired. Please log in again.');
      await expect(getAuthTokens()).resolves.toBeNull();
    });

    it('throws Missing ID token after refresh when refreshed tokens have empty idToken', async () => {
      mockRefreshToken.mockResolvedValueOnce({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        idToken: '',
      });
      await saveAuthTokens(tokens);

      await expect(refreshIdToken()).rejects.toThrow('Missing ID token after refresh');
    });
  });

  describe('explicit signout flag', () => {
    it('is false by default', async () => {
      await expect(isExplicitSignout()).resolves.toBe(false);
    });

    it('is true after setExplicitSignout is called', async () => {
      await setExplicitSignout();
      await expect(isExplicitSignout()).resolves.toBe(true);
    });

    it('is false after clearExplicitSignout is called', async () => {
      await setExplicitSignout();
      await clearExplicitSignout();
      await expect(isExplicitSignout()).resolves.toBe(false);
    });

    it('is not affected by clearAuthData', async () => {
      await setExplicitSignout();
      await clearAuthData();
      await expect(isExplicitSignout()).resolves.toBe(true);
    });
  });
});

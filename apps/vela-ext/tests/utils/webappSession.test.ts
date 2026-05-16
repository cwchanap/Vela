import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthTokens } from '../../entrypoints/utils/api';

const { mockCheckSession, mockSaveAuthTokens } = vi.hoisted(() => ({
  mockCheckSession: vi.fn(),
  mockSaveAuthTokens: vi.fn(),
}));

vi.mock('../../entrypoints/utils/api', () => ({
  checkSession: mockCheckSession,
}));

vi.mock('../../entrypoints/utils/storage', () => ({
  saveAuthTokens: mockSaveAuthTokens,
}));

import {
  importWebappSession,
  readCognitoSessionFromStorage,
} from '../../entrypoints/utils/webappSession';

function jwtWithPayload(payload: Record<string, unknown>) {
  return `header.${btoa(JSON.stringify(payload))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')}.signature`;
}

function makeStorage(values: Record<string, string>) {
  const keys = Object.keys(values);
  return {
    length: keys.length,
    key: (index: number) => keys[index] ?? null,
    getItem: (key: string) => values[key] ?? null,
  } as Storage;
}

describe('readCognitoSessionFromStorage', () => {
  it('extracts Amplify Cognito tokens and email from web-app localStorage', () => {
    const idToken = jwtWithPayload({ email: 'user@example.com' });
    const storage = makeStorage({
      'CognitoIdentityServiceProvider.client-id.LastAuthUser': 'user@example.com',
      'CognitoIdentityServiceProvider.client-id.user@example.com.accessToken': 'access-token',
      'CognitoIdentityServiceProvider.client-id.user@example.com.refreshToken': 'refresh-token',
      'CognitoIdentityServiceProvider.client-id.user@example.com.idToken': idToken,
    });

    expect(readCognitoSessionFromStorage(storage)).toEqual({
      tokens: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        idToken,
      },
      email: 'user@example.com',
    });
  });

  it('returns null when the web-app storage does not contain a complete Cognito session', () => {
    const storage = makeStorage({
      'CognitoIdentityServiceProvider.client-id.LastAuthUser': 'user@example.com',
      'CognitoIdentityServiceProvider.client-id.user@example.com.accessToken': 'access-token',
    });

    expect(readCognitoSessionFromStorage(storage)).toBeNull();
  });
});

describe('importWebappSession', () => {
  const tokens: AuthTokens = {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    idToken: 'id-token',
  };

  beforeEach(() => {
    mockCheckSession.mockReset();
    mockSaveAuthTokens.mockReset();

    (globalThis as any).browser = {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue(undefined),
      },
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 10, active: true }]),
        sendMessage: vi.fn().mockResolvedValue({ tokens, email: 'user@example.com' }),
      },
    };
  });

  it('imports and saves a valid session from an open Vela web-app tab', async () => {
    mockCheckSession.mockResolvedValue(true);

    await expect(importWebappSession()).resolves.toBe(true);

    expect(browser.tabs.query).toHaveBeenCalledWith({
      url: ['https://vela.cwchanap.dev/*', 'http://localhost:9000/*', 'http://127.0.0.1:9000/*'],
    });
    expect(browser.tabs.sendMessage).toHaveBeenCalledWith(10, { type: 'GET_VELA_WEBAPP_SESSION' });
    expect(mockCheckSession).toHaveBeenCalledWith('id-token');
    expect(mockSaveAuthTokens).toHaveBeenCalledWith(tokens, 'user@example.com');
  });

  it('does not import a session that the API rejects', async () => {
    mockCheckSession.mockResolvedValue(false);

    await expect(importWebappSession()).resolves.toBe(false);

    expect(mockSaveAuthTokens).not.toHaveBeenCalled();
  });

  it('skips a tab when sendMessage rejects (content script not ready)', async () => {
    (browser.tabs.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Could not establish connection'),
    );
    mockCheckSession.mockResolvedValue(true);

    await expect(importWebappSession()).resolves.toBe(false);

    expect(mockSaveAuthTokens).not.toHaveBeenCalled();
  });

  it('skips a tab without an id', async () => {
    (browser.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: undefined, active: true },
    ]);

    await expect(importWebappSession()).resolves.toBe(false);

    expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it('propagates saveAuthTokens errors instead of swallowing them', async () => {
    mockCheckSession.mockResolvedValue(true);
    mockSaveAuthTokens.mockRejectedValue(new Error('Storage full'));

    await expect(importWebappSession()).rejects.toThrow('Storage full');
  });
});

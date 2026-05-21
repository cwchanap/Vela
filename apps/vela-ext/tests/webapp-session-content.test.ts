import { describe, it, expect, beforeEach, vi } from 'vitest';

import webappSessionContentConfig from '../entrypoints/webapp-session.content';

const webappSessionContent = webappSessionContentConfig as unknown as {
  matches: string[];
  main(): void;
};

const localStorageState: Record<string, string> = {};

Object.defineProperty(window, 'localStorage', {
  value: {
    get length() {
      return Object.keys(localStorageState).length;
    },
    key: (index: number) => Object.keys(localStorageState)[index] ?? null,
    getItem: (key: string) => localStorageState[key] ?? null,
    setItem: (key: string, value: string) => {
      localStorageState[key] = value;
    },
    removeItem: (key: string) => {
      delete localStorageState[key];
    },
    clear: () => {
      Object.keys(localStorageState).forEach((key) => delete localStorageState[key]);
    },
  },
  configurable: true,
});

function getRegisteredMessageListener() {
  const addListener = (globalThis as any).browser.runtime.onMessage.addListener;
  if (!vi.isMockFunction(addListener)) {
    throw new Error('browser.runtime.onMessage.addListener is not a mock function');
  }
  const call = addListener.mock.calls.at(-1);
  if (!call) {
    throw new Error('Expected web-app session content script to register a message listener');
  }

  return call[0] as (
    _message: unknown,
    _sender: unknown,
    _sendResponse: (_response?: unknown) => void,
  ) => void;
}

function jwtWithPayload(payload: Record<string, unknown>) {
  return `header.${btoa(JSON.stringify(payload))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')}.signature`;
}

beforeEach(() => {
  localStorage.clear();
  (globalThis as any).browser.runtime.onMessage.addListener.mockClear();
});

describe('web-app session content script config', () => {
  it('runs only on Vela web-app origins', () => {
    expect(webappSessionContent.matches).toEqual([
      'https://vela.cwchanap.dev/*',
      'http://localhost:9000/*',
      'http://127.0.0.1:9000/*',
    ]);
  });
});

describe('web-app session content script message listener', () => {
  it('sends the web-app Cognito session from localStorage via sendResponse when requested by the popup', () => {
    const idToken = jwtWithPayload({ email: 'user@example.com' });
    localStorage.setItem(
      'CognitoIdentityServiceProvider.client-id.LastAuthUser',
      'user@example.com',
    );
    localStorage.setItem(
      'CognitoIdentityServiceProvider.client-id.user@example.com.accessToken',
      'access-token',
    );
    localStorage.setItem(
      'CognitoIdentityServiceProvider.client-id.user@example.com.refreshToken',
      'refresh-token',
    );
    localStorage.setItem(
      'CognitoIdentityServiceProvider.client-id.user@example.com.idToken',
      idToken,
    );

    webappSessionContent.main();
    const listener = getRegisteredMessageListener();
    const sendResponse = vi.fn();
    listener({ type: 'GET_VELA_WEBAPP_SESSION' }, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({
      tokens: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        idToken,
      },
      email: 'user@example.com',
    });
  });

  it('responds with null when localStorage access throws a SecurityError', () => {
    const originalGetItem = window.localStorage.getItem;
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });

    webappSessionContent.main();
    const listener = getRegisteredMessageListener();
    const sendResponse = vi.fn();
    listener({ type: 'GET_VELA_WEBAPP_SESSION' }, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(null);

    vi.restoreAllMocks();
    window.localStorage.getItem = originalGetItem;
  });

  it('ignores scanner messages so the Vela app never receives the scanner overlay', () => {
    webappSessionContent.main();
    const listener = getRegisteredMessageListener();
    const sendResponse = vi.fn();
    listener({ type: 'SCAN_PAGE' }, {}, sendResponse);

    expect(sendResponse).not.toHaveBeenCalled();
    expect(document.getElementById('vela-ext-overlay-host')).toBeNull();
  });
});

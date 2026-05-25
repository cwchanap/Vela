import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockReadCognitoSession } = vi.hoisted(() => ({
  mockReadCognitoSession: vi.fn(),
}));

vi.mock('../entrypoints/utils/webappSession', () => ({
  readCognitoSessionFromStorage: mockReadCognitoSession,
}));

import webappSessionContentConfig from '../entrypoints/webapp-session.content';

const webappSessionContent = webappSessionContentConfig as unknown as {
  matches: string[];
  main(): void;
};

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

beforeEach(() => {
  mockReadCognitoSession.mockReset();
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
    const session = {
      tokens: { accessToken: 'a', refreshToken: 'r', idToken: 'i' },
      email: 'u@e.com',
    };
    mockReadCognitoSession.mockReturnValue(session);

    webappSessionContent.main();
    const listener = getRegisteredMessageListener();
    const sendResponse = vi.fn();
    listener({ type: 'GET_VELA_WEBAPP_SESSION' }, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(session);
  });

  it('responds with null when localStorage access throws a SecurityError', () => {
    mockReadCognitoSession.mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });

    webappSessionContent.main();
    const listener = getRegisteredMessageListener();
    const sendResponse = vi.fn();
    listener({ type: 'GET_VELA_WEBAPP_SESSION' }, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(null);
  });

  it('returns early for messages without a type property', () => {
    webappSessionContent.main();
    const listener = getRegisteredMessageListener();
    const sendResponse = vi.fn();
    listener({ something: 'else' }, {}, sendResponse);

    expect(sendResponse).not.toHaveBeenCalled();
    expect(mockReadCognitoSession).not.toHaveBeenCalled();
  });

  it('returns early for non-object messages', () => {
    webappSessionContent.main();
    const listener = getRegisteredMessageListener();
    const sendResponse = vi.fn();
    listener('some-string', {}, sendResponse);

    expect(sendResponse).not.toHaveBeenCalled();
    expect(mockReadCognitoSession).not.toHaveBeenCalled();
  });

  it('returns early for null messages', () => {
    webappSessionContent.main();
    const listener = getRegisteredMessageListener();
    const sendResponse = vi.fn();
    listener(null, {}, sendResponse);

    expect(sendResponse).not.toHaveBeenCalled();
    expect(mockReadCognitoSession).not.toHaveBeenCalled();
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

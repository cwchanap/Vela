import { readCognitoSessionFromStorage } from './utils/webappSession';

export default defineContentScript({
  matches: ['https://vela.cwchanap.dev/*', 'http://localhost:9000/*', 'http://127.0.0.1:9000/*'],
  main() {
    browser.runtime.onMessage.addListener(
      (message: unknown, _sender: unknown, sendResponse: (_response?: unknown) => void) => {
        if (typeof message !== 'object' || message === null || !('type' in message)) {
          return;
        }
        if (message.type !== 'GET_VELA_WEBAPP_SESSION') {
          return;
        }

        try {
          sendResponse(readCognitoSessionFromStorage(window.localStorage));
        } catch {
          sendResponse(null);
        }
      },
    );
  },
});

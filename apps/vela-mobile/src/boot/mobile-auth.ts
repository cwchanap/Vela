import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { CapacitorHttp } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { defineBoot } from '#q-app/wrappers';
import { createOAuthTransactionStore } from '../auth/oauth-transaction-store';
import { config } from '../config';
import { createMobileAuthCoordinator, MOBILE_AUTH_KEY } from '../services/mobile-auth';

export default defineBoot(({ app }) => {
  const coordinator = createMobileAuthCoordinator({
    app: CapacitorApp,
    browser: Browser,
    transactionStore: createOAuthTransactionStore(Preferences, Date.now),
    tokenTransport: {
      request: (options) => {
        const { timeoutMs, ...httpOptions } = options;
        return CapacitorHttp.request(
          timeoutMs === undefined
            ? httpOptions
            : { ...httpOptions, connectTimeout: timeoutMs, readTimeout: timeoutMs },
        );
      },
    },
    crypto: window.crypto,
    isSecureContext: window.isSecureContext,
    fetch: window.fetch.bind(window),
    now: Date.now,
    config: {
      apiUrl: config.api.url,
      userPoolId: config.auth.userPoolId,
      mobileClientId: config.auth.mobileClientId,
      oauthDomain: config.auth.oauthDomain,
      region: config.auth.region,
      callbackUri: config.auth.callbackUri,
    },
  });

  app.provide(MOBILE_AUTH_KEY, coordinator);
  void coordinator.initialize();
});

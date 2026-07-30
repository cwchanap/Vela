import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { defineBoot } from '#q-app/wrappers';
import { createMobileInstallationStore } from '../auth/mobile-installation-store';
import {
  createIosKeychainSessionStore,
  createUnsupportedMobileSessionStore,
} from '../auth/mobile-session-store';
import { createOAuthTransactionStore } from '../auth/oauth-transaction-store';
import { config } from '../config';
import { createMobileAuthCoordinator, MOBILE_AUTH_KEY } from '../services/mobile-auth';
import { provideMobileServices } from '../services/mobile-services';

export default defineBoot(({ app }) => {
  const isNativeIos = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
  const sessionStore = isNativeIos
    ? createIosKeychainSessionStore({
        secureStorage: SecureStorage,
        runtime: Capacitor,
        config: {
          userPoolId: config.auth.userPoolId,
          mobileClientId: config.auth.mobileClientId,
        },
      })
    : createUnsupportedMobileSessionStore();
  const installationStore = createMobileInstallationStore(Preferences, {
    userPoolId: config.auth.userPoolId,
    mobileClientId: config.auth.mobileClientId,
  });
  const coordinator = createMobileAuthCoordinator({
    app: CapacitorApp,
    browser: Browser,
    transactionStore: createOAuthTransactionStore(Preferences, Date.now),
    sessionStore,
    installationStore,
    isNativeIos,
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
  provideMobileServices(app, coordinator);
  void coordinator.initialize();
});

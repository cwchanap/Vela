import { defineConfig } from '#q-app/wrappers';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// The version shown on the Home page (VITE_APP_VERSION below) and the iOS
// MARKETING_VERSION (synced by scripts/sync-ios-version.mjs) are resolved
// from the same source: VITE_APP_VERSION env override first, then
// package.json "version" as fallback. sync-ios-version.mjs mirrors this
// resolution so the UI and native bundle never drift.
const pkg = require('./package.json') as { version: string };

export default defineConfig(() => {
  return {
    boot: ['main'],

    css: ['app.scss'],

    extras: ['material-icons', 'roboto-font'],

    build: {
      target: {
        browser: ['es2022', 'safari14'],
        node: 'node20',
      },

      typescript: {
        strict: true,
        vueShim: true,
      },

      vueRouterMode: 'history',

      publicPath: '/',

      env: {
        VITE_APP_NAME: process.env.VITE_APP_NAME,
        VITE_APP_VERSION: process.env.VITE_APP_VERSION || pkg.version,
      },
    },

    devServer: {
      open: false,
      // Distinct from apps/vela (9000) so `turbo dev --parallel` doesn't race
      // for the same listener. API runs on 9005.
      port: 9100,
    },

    framework: {
      plugins: ['Notify', 'LocalStorage', 'Dark'],
    },

    capacitor: {
      hideSplashscreen: true,
    },

    animations: [],
  };
});

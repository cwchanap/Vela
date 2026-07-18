import { defineConfig } from '#q-app/wrappers';

// The Home page version (import.meta.env.VITE_APP_VERSION, populated by Vite's
// loadEnv) and the iOS MARKETING_VERSION (synced by
// scripts/sync-ios-version.mjs) are resolved from the same source:
// VITE_APP_VERSION env override first, then package.json "version" as
// fallback (see src/config/index.ts). sync-ios-version.mjs mirrors this
// resolution so the UI and native bundle never drift. No build.env override is
// needed here — Vite's loadEnv populates import.meta.env directly from .env
// files, and a build.env entry would only create a process.env.* define that
// import.meta.env never reads.

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

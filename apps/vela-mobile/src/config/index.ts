import { version as pkgVersion } from '../../package.json';

// Mirrors scripts/sync-ios-version.mjs: VITE_APP_VERSION (from Vite's loadEnv)
// first, then package.json "version" as fallback — so the Home page and the
// iOS MARKETING_VERSION resolve from the same sources and never drift.
export const config = {
  app: {
    name: import.meta.env.VITE_APP_NAME || 'Vela',
    version: import.meta.env.VITE_APP_VERSION || pkgVersion,
    isDev: import.meta.env.DEV,
    isProd: import.meta.env.PROD,
  },
} as const;

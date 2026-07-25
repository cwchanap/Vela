import { defineConfig } from '#q-app/wrappers';
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

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

      extendViteConf(viteConf) {
        viteConf.plugins = viteConf.plugins || [];
        viteConf.plugins.push({
          name: 'validate-mobile-api-url',
          config(_, { mode }) {
            if (mode !== 'production') return;
            // Opt-in skip for CI pipelines that run inject-env.ts (or an
            // equivalent) before the build and therefore already guarantee
            // .env.production exists. Default: enforce, so a clean checkout
            // without .env.production fails at build time rather than at app
            // launch. Set MOBILE_SKIP_ENV_VALIDATION=true to bypass.
            if (process.env.MOBILE_SKIP_ENV_VALIDATION === 'true') return;

            const envPath = resolve(__dirname, '.env.production');
            if (!existsSync(envPath)) {
              throw new Error(
                'apps/vela-mobile/.env.production not found. ' +
                  'Run packages/cdk/scripts/inject-env.ts after cdk:deploy, ' +
                  'or create it manually with VITE_MOBILE_API_URL.',
              );
            }

            const content = readFileSync(envPath, 'utf8');
            const match = content.match(/^VITE_MOBILE_API_URL=(.+)$/m);
            // Strip surrounding quotes so a hand-authored quoted value
            // (e.g. VITE_MOBILE_API_URL="https://...") parses correctly.
            const fileUrl = match?.[1]?.trim().replace(/^["']|["']$/g, '');

            // Vite gives process.env vars prefixed with VITE_ precedence over
            // .env files, so a release environment that exports an invalid
            // VITE_MOBILE_API_URL would override a valid file value. Validate
            // the effective value that Vite will actually inject, not just the
            // file contents — otherwise the build succeeds and the native app
            // crashes at boot via validateConfig().
            const url = process.env.VITE_MOBILE_API_URL ?? fileUrl;

            if (!url) {
              throw new Error(
                'VITE_MOBILE_API_URL is missing from apps/vela-mobile/.env.production.',
              );
            }

            try {
              const parsed = new URL(url);
              if (
                (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
                !parsed.hostname
              ) {
                throw new Error('invalid');
              }
            } catch {
              throw new Error(
                `VITE_MOBILE_API_URL must be a valid absolute http(s) URL with a hostname, got: ${url}`,
              );
            }
          },
        });
      },
    },

    devServer: {
      open: false,
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

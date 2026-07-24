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
            const url = match?.[1]?.trim();

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

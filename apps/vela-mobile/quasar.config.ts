import { defineConfig } from '#q-app/wrappers';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { expand } from 'dotenv-expand';

function loadMobileApiUrl(mode: string): string | undefined {
  const parsed: Record<string, string> = {};
  const envFiles = ['.env', '.env.local', `.env.${mode}`, `.env.${mode}.local`];

  for (const envFile of envFiles) {
    const envPath = resolve(__dirname, envFile);
    if (existsSync(envPath)) {
      Object.assign(parsed, parse(readFileSync(envPath)));
    }
  }

  const processEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  const expanded = expand({ parsed, processEnv }).parsed ?? {};

  // Match Vite's precedence: an existing, non-empty process.env value wins
  // over .env, .env.local, .env.[mode], and .env.[mode].local.
  return process.env.VITE_MOBILE_API_URL || expanded.VITE_MOBILE_API_URL;
}

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

            // Quasar executes this config during postinstall, so importing Vite
            // directly would require an otherwise redundant direct dependency.
            // Use the package's declared dotenv dependencies to reproduce the
            // same env-file and process.env precedence Vite applies at build time.
            const url = loadMobileApiUrl(mode);

            if (!url) {
              throw new Error(
                'VITE_MOBILE_API_URL is missing. Vite loads .env, .env.local, ' +
                  '.env.production, and .env.production.local (in that order, ' +
                  'with existing process.env values winning). Set it in one of ' +
                  'those, or export VITE_MOBILE_API_URL. Run ' +
                  'packages/cdk/scripts/inject-env.ts after cdk:deploy to ' +
                  'generate .env.production.',
              );
            }

            try {
              const parsedUrl = new URL(url);
              if (
                (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') ||
                !parsedUrl.hostname
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

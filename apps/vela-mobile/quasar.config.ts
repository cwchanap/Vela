import { defineConfig } from '#q-app/wrappers';
import { loadEnv } from 'vite';

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

            // Validate the same merged env Vite injects at build time. Vite's
            // loadEnv merges .env, .env.local, .env.[mode], and .env.[mode].local
            // in precedence order (later files win), then gives existing
            // process.env values final priority — so a relative override in
            // .env.production.local would otherwise pass this check while
            // validateConfig() crashes the native app at boot. loadEnv expands
            // against a process.env clone and does not mutate the live env.
            const env = loadEnv(mode, __dirname, 'VITE_');
            const url = env.VITE_MOBILE_API_URL;

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

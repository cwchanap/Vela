import { defineConfig } from '#q-app';
import { resolve } from 'node:path';
import { getMobileBootFiles } from './src/boot/boot-files';
import { validateMobileApiUrlPlugin } from './build/validate-mobile-api-url';

export default defineConfig((ctx) => {
  return {
    boot: getMobileBootFiles({
      isCapacitor: ctx.modeName === 'capacitor',
      isDevelopment: ctx.dev,
    }),

    css: ['app.scss'],

    extras: ['material-icons', 'roboto-font'],

    build: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@vela/common': resolve(__dirname, '../../packages/common/src/index.ts'),
      },

      target: {
        browser: ['es2022', 'safari14'],
        node: 'node20',
      },

      typescript: {
        strict: true,
        vueShim: true,
      },

      env: {
        clientPrefix: 'VITE_',
        // Quasar always loads `.env` and `.env.local` (the latter outside CI).
        // Add the mode files and their `.local` overrides so the order stays
        // the one Vite's loadEnv used: .env, .env.local, .env.<mode>,
        // .env.<mode>.local. Keep the production list in sync with
        // build/mobile-cli-env.ts and turbo.json inputs.
        file: ctx.prod
          ? ['.env.production', '.env.production.local']
          : ['.env.development', '.env.development.local'],
      },

      vueRouterMode: 'history',

      publicPath: '/',

      extendViteConf(viteConf) {
        viteConf.plugins = viteConf.plugins || [];
        // The plugin reads Quasar's resolved client define values, so it needs
        // no .env file parsing of its own, and knows which mode is building.
        viteConf.plugins.push(
          validateMobileApiUrlPlugin({
            rootDir: resolve(__dirname),
            isCapacitor: ctx.modeName === 'capacitor',
          }),
        );
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

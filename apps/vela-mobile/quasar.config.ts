import { defineConfig } from '#q-app/wrappers';
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
        // rootDir must be the quasar.config.ts directory so Vite's loadEnv
        // resolves .env / .env.production from the project root.
        viteConf.plugins.push(validateMobileApiUrlPlugin(resolve(__dirname)));
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

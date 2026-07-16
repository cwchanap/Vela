import { defineConfig } from '#q-app/wrappers';

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
        VITE_APP_VERSION: process.env.VITE_APP_VERSION,
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

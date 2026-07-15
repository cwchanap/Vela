import { defineConfig } from '#q-app/wrappers';

export default defineConfig(() => {
  return {
    boot: ['main'],

    css: ['app.scss'],

    extras: ['roboto-font', 'material-icons'],

    build: {
      target: {
        browser: ['es2022', 'safari16'],
        node: 'node20',
      },

      typescript: {
        strict: true,
        vueShim: true,
      },

      vueRouterMode: 'history',

      publicPath: '/',

      env: {
        VITE_APP_NAME: process.env.VITE_APP_NAME || 'Vela',
        VITE_APP_VERSION: process.env.VITE_APP_VERSION || '0.0.1',
      },
    },

    devServer: {
      open: false,
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

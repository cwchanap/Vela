// Configuration for your app
// https://v2.quasar.dev/quasar-cli-vite/quasar-config-file

import { defineConfig } from '#q-app';
import { resolve } from 'node:path';

export default defineConfig((ctx) => {
  return {
    // https://v2.quasar.dev/quasar-cli-vite/prefetch-feature
    // preFetch: true,

    // app boot file (/src/boot)
    // --> boot files are part of "main.js"
    // https://v2.quasar.dev/quasar-cli-vite/boot-files
    boot: ['query', 'main'],

    // https://v2.quasar.dev/quasar-cli-vite/quasar-config-file#css
    css: ['app.scss'],

    // https://github.com/quasarframework/quasar/tree/dev/extras
    extras: [
      // 'ionicons-v4',
      // 'mdi-v7',
      // 'fontawesome-v6',
      // 'eva-icons',
      // 'themify',
      // 'line-awesome',
      // 'roboto-font-latin-ext', // this or either 'roboto-font', NEVER both!

      'roboto-font', // optional, you are not bound to it
      'material-icons', // optional, you are not bound to it
    ],

    // Full list of options: https://v2.quasar.dev/quasar-cli-vite/quasar-config-file#build
    build: {
      target: {
        browser: ['es2022', 'firefox115', 'chrome115', 'safari14'],
        node: 'node20',
      },

      alias: {
        '@': resolve(__dirname, 'src'),
      },

      typescript: {
        strict: true,
        vueShim: true,
      },

      vueRouterMode: 'history', // Use history mode for better SEO and UX
      // vueRouterBase,
      vueDevtools: true, // Enable Vue devtools in development
      // vueOptionsAPI: false,

      // rebuildCache: true, // rebuilds Vite/linter/etc cache on startup

      publicPath: '/',
      // analyze: true, // Enable bundle analyzer when needed
      env: {
        // Expose VITE_* vars from .env files and process.env to the client.
        clientPrefix: 'VITE_',
        file: ctx.prod ? '.env.production' : [],
      },
      // rawDefine: {}
      // ignorePublicFolder: true,
      minify: true, // Enable minification for production
      // polyfillModulePreload: true,
      // distDir

      extendViteConf(viteConf) {
        // Optimize build performance
        viteConf.build = viteConf.build || {};
        viteConf.build.rollupOptions = viteConf.build.rollupOptions || {};
        viteConf.resolve = viteConf.resolve || {};

        const commonPath = resolve(__dirname, '../../packages/common/src/index.ts');
        const commonTokenizerPath = resolve(__dirname, '../../packages/common/src/tokenizer.ts');

        if (Array.isArray(viteConf.resolve.alias)) {
          viteConf.resolve.alias = [
            ...viteConf.resolve.alias.filter(
              (a) =>
                a.find !== '@vela/common' &&
                a.find !== '@vela/common/tokenizer' &&
                a.find !== 'path',
            ),
            {
              find: '@vela/common/tokenizer',
              replacement: commonTokenizerPath,
            },
            {
              find: '@vela/common',
              replacement: commonPath,
            },
            {
              // kuromoji's DictionaryLoader uses require("path") internally.
              // Vite externalises Node builtins in browser builds, so we
              // provide the standard browser-compatible implementation.
              find: 'path',
              replacement: 'path-browserify',
            },
          ];
        } else {
          viteConf.resolve.alias = {
            ...(viteConf.resolve.alias || {}),
            '@vela/common/tokenizer': commonTokenizerPath,
            '@vela/common': commonPath,
            // kuromoji's DictionaryLoader uses require("path") internally.
            // Vite externalises Node builtins in browser builds, so we
            // provide the standard browser-compatible implementation.
            path: 'path-browserify',
          };
        }

        // Optimize chunk size
        viteConf.build.chunkSizeWarningLimit = 1000;
      },
      // viteVuePluginOptions: {},

      vitePlugins: [
        [
          'vite-plugin-checker',
          {
            vueTsc: true,
            // Temporarily disable ESLint during build to fix CDK deployment
            // eslint: {
            //   lintCommand: 'cd ../.. && eslint "apps/vela/src/**/*.{ts,js,vue}"',
            //   useFlatConfig: true,
            // },
          },
          { server: false },
        ],
      ],
    },

    // Full list of options: https://v2.quasar.dev/quasar-cli-vite/quasar-config-file#devserver
    devServer: {
      // https: true,
      open: true, // opens browser window automatically
      proxy: {
        '/api': {
          target: 'http://localhost:9005',
          changeOrigin: true,
        },
      },
    },

    // https://v2.quasar.dev/quasar-cli-vite/quasar-config-file#framework
    framework: {
      config: {},

      // iconSet: 'material-icons', // Quasar icon set
      // lang: 'en-US', // Quasar language pack

      // For special cases outside of where the auto-import strategy can have an impact
      // (like functional components as one of the examples),
      // you can manually specify Quasar components/directives to be available everywhere:
      //
      // components: [],
      // directives: [],

      // Quasar plugins
      plugins: [
        'Notify',
        'Loading',
        'LoadingBar',
        'Dialog',
        'LocalStorage',
        'SessionStorage',
        'Dark',
      ],
    },

    // animations: 'all', // --- includes all animations
    // https://v2.quasar.dev/options/animations
    animations: [
      'fadeIn',
      'fadeOut',
      'slideInUp',
      'slideOutDown',
      'slideInLeft',
      'slideOutRight',
      'bounceIn',
      'bounceOut',
      'zoomIn',
      'zoomOut',
    ],
  };
});

// Configuration for your app
// https://v2.quasar.dev/quasar-cli-vite/quasar-config-file

import { defineConfig } from '#q-app';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/*
 * Rolldown treats zlibjs's UMD gunzip as ESM because it never references
 * `module`/`exports`, so the UMD's top-level `this` becomes undefined and
 * kuromoji initialization dies with `'Zlib' in undefined`. Binding the UMD
 * factory to CommonJS `exports` also marks the file as CJS for Rolldown.
 */
const zlibjsCjsThisPlugin: Plugin = {
  name: 'vela:zlibjs-cjs-this',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('zlibjs/bin/gunzip.min.js')) return;
    const patched = code.replace('}).call(this);', '}).call(exports);');
    if (patched === code) {
      this.error('zlibjs UMD wrapper changed; the kuromoji gunzip interop patch no longer applies');
    }
    return patched;
  },
};

/*
 * Vite's dev file server (sirv) tags every requested *.gz file with
 * `Content-Encoding: gzip`, so the browser transparently inflates the
 * pre-gzipped kuromoji dictionaries and kuromoji's gunzip receives plain
 * bytes. A header already set on the response wins over sirv's file
 * headers, so pinning Content-Encoding to identity for the dictionary
 * path restores the real gzipped payload.
 */
const kuromojiDictEncodingPlugin: Plugin = {
  name: 'vela:kuromoji-dict-encoding',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.startsWith('/kuromoji-dict/')) {
        res.setHeader('Content-Encoding', 'identity');
      }
      next();
    });
  },
};

// Only these vars may reach the client bundle; a bare 'VITE_' clientPrefix
// alone would inline every matching .env and process.env value.
const CLIENT_ENV_ALLOWLIST = new Set([
  'VITE_COGNITO_USER_POOL_ID',
  'VITE_COGNITO_USER_POOL_CLIENT_ID',
  'VITE_COGNITO_OAUTH_DOMAIN',
  'VITE_COGNITO_REDIRECT_SIGN_IN',
  'VITE_COGNITO_REDIRECT_SIGN_OUT',
  'VITE_AWS_REGION',
  'VITE_API_URL',
  'VITE_APP_NAME',
  'VITE_APP_VERSION',
  'VITE_DEV_MODE',
]);

const ENV_DEFINE_PREFIX = 'import.meta.env.';

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
      // vuedraggable (SentenceBuilder) is an Options API component; app-vite
      // v3 disables the Options API runtime by default.
      vueOptionsAPI: true,

      // rebuildCache: true, // rebuilds Vite/linter/etc cache on startup

      publicPath: '/',
      // analyze: true, // Enable bundle analyzer when needed
      env: {
        clientPrefix: 'VITE_',
        filter: (env, type) =>
          type === 'backend'
            ? env
            : Object.fromEntries(
                Object.entries(env).filter(([key]) =>
                  CLIENT_ENV_ALLOWLIST.has(key.slice(ENV_DEFINE_PREFIX.length)),
                ),
              ),
        // Quasar always loads `.env` and `.env.local` (the latter outside CI).
        // Add the mode files and their `.local` overrides so the order stays
        // the one Vite's loadEnv used: .env, .env.local, .env.<mode>,
        // .env.<mode>.local.
        file: ctx.prod
          ? ['.env.production', '.env.production.local']
          : ['.env.development', '.env.development.local'],
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

        // Dev dependency optimization and the production build are separate
        // Rolldown pipelines, so the zlibjs CJS fix is registered in both.
        viteConf.plugins = viteConf.plugins || [];
        viteConf.plugins.push(zlibjsCjsThisPlugin, kuromojiDictEncodingPlugin);
        viteConf.optimizeDeps = viteConf.optimizeDeps || {};
        viteConf.optimizeDeps.rolldownOptions = viteConf.optimizeDeps.rolldownOptions || {};
        viteConf.optimizeDeps.rolldownOptions.plugins = [
          viteConf.optimizeDeps.rolldownOptions.plugins,
          zlibjsCjsThisPlugin,
        ];
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
      vueDevtools: true, // Enable Vue devtools in development
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

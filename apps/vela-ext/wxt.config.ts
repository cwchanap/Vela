import { defineConfig } from 'wxt';

const isExtensionTestMode = process.env.VELA_EXT_TEST_MODE === '1';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  webExt: {
    disabled: !isExtensionTestMode,
    startUrls: ['http://localhost:9000/auth/login', 'http://localhost:9000/extension-test.html'],
    chromiumArgs: [
      '--user-data-dir=.wxt/chrome-data',
      '--remote-debugging-port=9222',
      '--window-size=1280,900',
    ],
  },
  manifest: {
    name: 'Vela Japanese Dictionary',
    description: 'Save Japanese sentences to your Vela dictionary',
    permissions: ['contextMenus', 'storage', 'notifications', 'tabs'],
    host_permissions: [
      'https://vela.cwchanap.dev/*',
      'http://localhost:9000/*', // Allow localhost in development (Quasar dev server)
      'http://127.0.0.1:9000/*', // Allow 127.0.0.1 in development (Quasar dev server)
      'http://localhost:9005/*', // Allow localhost API in development
    ],
  },
});

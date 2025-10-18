import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-vue'],
  runner: {
    disabled: true, // Don't automatically open browser on dev server start
  },
  manifest: {
    name: 'Vela Japanese Dictionary',
    description: 'Save Japanese sentences to your Vela dictionary',
    permissions: ['contextMenus', 'storage', 'notifications'],
    host_permissions: ['https://vela.cwchanap.dev/*'],
  },
});

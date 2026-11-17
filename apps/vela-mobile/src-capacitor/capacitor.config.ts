import { defineCapacitorConfig } from '@quasar/app-vite/capacitor';

export default defineCapacitorConfig({
  appId: 'com.vela.app',
  appName: 'Vela',
  webDir: 'www',
  ios: {
    contentInset: 'never',
  },
  plugins: {
    Keyboard: {
      resize: 'native',
    },
  },
});

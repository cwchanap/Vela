import { boot } from 'quasar/wrappers';
import { configureDicPath } from '@vela/common/tokenizer';
import { useThemeStore } from 'src/stores/theme';
import { useAuthStore } from 'src/stores/auth';

export default boot(async ({ store }) => {
  // Set kuromoji dictionary path (served from public/kuromoji-dict/)
  configureDicPath('/kuromoji-dict');

  console.log('✅ App boot initialized');

  // Initialize theme
  const themeStore = useThemeStore(store);
  themeStore.initialize();

  // Watch for auth changes and sync theme from user preferences
  const authStore = useAuthStore(store);
  authStore.$subscribe((mutation, state) => {
    if (state.user?.preferences?.darkMode !== undefined) {
      themeStore.syncWithUserPreferences(state.user.preferences.darkMode);
    }
  });
});

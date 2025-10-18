import { boot } from 'quasar/wrappers';
import { useThemeStore } from 'src/stores/theme';
import { useAuthStore } from 'src/stores/auth';

export default boot(async ({ store }) => {
  // Boot file for additional app initialization
  // Pinia is now initialized via stores/index.ts
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

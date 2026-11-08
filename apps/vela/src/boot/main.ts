import { boot } from 'quasar/wrappers';
import { configureDicPath } from '@vela/common/tokenizer';
import { useThemeStore } from 'src/stores/theme';
import { useAuthStore } from 'src/stores/auth';
import { validateConfig } from 'src/config';

export default boot(async ({ store }) => {
  // Fail fast on missing Cognito env vars in production
  validateConfig();

  // Set kuromoji dictionary path (served from public/kuromoji-dict/)
  configureDicPath('/kuromoji-dict');

  console.log('✅ App boot initialized');

  // Initialize theme
  const themeStore = useThemeStore(store);
  themeStore.initialize();

  // Watch for auth changes and sync theme only when user identity changes or
  // saved darkMode preference actually changes (preventing unsaved local toggles
  // from being reverted on unrelated auth mutations).
  const authStore = useAuthStore(store);
  let lastSyncedUserId: string | null = null;
  let lastSyncedDarkMode: boolean | undefined = undefined;

  authStore.$subscribe((_mutation, state) => {
    const currentUserId = state.user ? (state.user.id ?? '__authenticated__') : null;
    const currentDarkMode = state.user?.preferences?.darkMode;

    // Track removal as a real state: if the saved preference is absent now and
    // a defined value returns later, it must be re-applied like any change.
    if (currentUserId !== lastSyncedUserId || currentDarkMode !== lastSyncedDarkMode) {
      lastSyncedUserId = currentUserId;
      lastSyncedDarkMode = currentDarkMode;
      if (currentDarkMode !== undefined) {
        themeStore.syncWithUserPreferences(currentDarkMode);
      }
    }
  });
});

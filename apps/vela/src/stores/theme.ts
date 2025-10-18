import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { Dark, LocalStorage } from 'quasar';
import { useAuthStore } from './auth';

const THEME_STORAGE_KEY = 'vela-dark-mode';

export const useThemeStore = defineStore('theme', () => {
  // State
  const darkMode = ref<boolean>(false);
  const initialized = ref(false);

  // Getters
  const isDark = computed(() => darkMode.value);
  const themeLabel = computed(() => (darkMode.value ? 'Dark' : 'Light'));

  // Actions
  const setDarkMode = (enabled: boolean) => {
    darkMode.value = enabled;
    Dark.set(enabled);
    LocalStorage.set(THEME_STORAGE_KEY, enabled);
  };

  const toggle = () => {
    setDarkMode(!darkMode.value);
  };

  /**
   * Initialize dark mode from user preferences or localStorage
   */
  const initialize = () => {
    if (initialized.value) return;

    const authStore = useAuthStore();

    // Priority: user preferences > localStorage > system preference
    let darkModePreference: boolean | undefined;

    // 1. Check user preferences if logged in
    if (authStore.user?.preferences?.darkMode !== undefined) {
      darkModePreference = authStore.user.preferences.darkMode;
    }
    // 2. Check localStorage
    else if (LocalStorage.has(THEME_STORAGE_KEY)) {
      darkModePreference = LocalStorage.getItem(THEME_STORAGE_KEY) as boolean;
    }
    // 3. Use system preference as fallback
    else {
      darkModePreference = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    setDarkMode(darkModePreference);
    initialized.value = true;
  };

  /**
   * Sync theme with user preferences from database
   */
  const syncWithUserPreferences = (darkModePreference: boolean | undefined) => {
    if (darkModePreference !== undefined) {
      setDarkMode(darkModePreference);
    }
  };

  /**
   * Save current theme to user preferences
   */
  const saveToUserPreferences = async () => {
    const authStore = useAuthStore();

    if (authStore.user) {
      await authStore.updatePreferences({
        darkMode: darkMode.value,
      });
    }
  };

  return {
    // State
    darkMode,
    initialized,

    // Getters
    isDark,
    themeLabel,

    // Actions
    setDarkMode,
    toggle,
    initialize,
    syncWithUserPreferences,
    saveToUserPreferences,
  };
});

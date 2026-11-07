import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { Quasar, Notify } from 'quasar';
import ThemeSection from './ThemeSection.vue';
import { useThemeStore } from 'src/stores/theme';
import { useAuthStore } from 'src/stores/auth';

const stubs = {
  'q-card': { template: '<div><slot /></div>' },
  'q-card-section': { template: '<div><slot /></div>' },
  'q-card-actions': { template: '<div><slot /></div>' },
  'q-separator': true,
  'q-toggle': {
    template: '<input type="checkbox" @change="$emit(\'update:modelValue\', !modelValue)" />',
    props: ['modelValue'],
    emits: ['update:modelValue'],
  },
  'q-btn': {
    template: '<button :disabled="disable" @click="$emit(\'click\')"><slot /></button>',
    props: ['disable'],
    emits: ['click'],
  },
  'q-icon': true,
};

describe('ThemeSection', () => {
  let wrapper: VueWrapper;
  let themeStore: ReturnType<typeof useThemeStore>;
  let authStore: ReturnType<typeof useAuthStore>;

  const mountComponent = () =>
    mount(ThemeSection, {
      global: { plugins: [Quasar], stubs },
    });

  beforeEach(() => {
    setActivePinia(createPinia());
    themeStore = useThemeStore();
    authStore = useAuthStore();
    vi.clearAllMocks();
    Notify.create = vi.fn() as never;
    wrapper = mountComponent();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  describe('toggleDarkMode', () => {
    it('calls themeStore.toggle when dark mode is toggled', () => {
      const toggleSpy = vi.spyOn(themeStore, 'toggle').mockImplementation(() => {});
      wrapper.vm.toggleDarkMode();
      expect(toggleSpy).toHaveBeenCalled();
    });

    it('updates darkModeEnabled to reflect themeStore.isDark after toggle', () => {
      // Mock toggle to use $patch to properly update pinia state
      vi.spyOn(themeStore, 'toggle').mockImplementation(() => {
        themeStore.$patch({ darkMode: !themeStore.darkMode });
      });
      const initialDark = themeStore.isDark;
      wrapper.vm.toggleDarkMode();
      expect(wrapper.vm.darkModeEnabled).toBe(!initialDark);
    });
  });

  describe('theme preference persistence', () => {
    it('saves the theme preference and shows a success notification', async () => {
      const saveSpy = vi.spyOn(themeStore, 'saveToUserPreferences').mockResolvedValue(undefined);

      await wrapper.vm.saveThemeToProfile();

      expect(saveSpy).toHaveBeenCalled();
      expect(Notify.create).toHaveBeenCalledWith({
        type: 'positive',
        message: 'Theme preference saved to your profile',
        position: 'top',
      });
    });
  });

  describe('isAuthenticated computed', () => {
    it('returns false when not authenticated', () => {
      expect(wrapper.vm.isAuthenticated).toBe(false);
    });

    it('returns true when authenticated', () => {
      authStore.user = {
        id: 'user-1',
        email: 'test@example.com',
        avatar_url: null,
        preferences: null,
      };
      authStore.setSession({ user: authStore.user });
      expect(wrapper.vm.isAuthenticated).toBe(true);
    });
  });
});

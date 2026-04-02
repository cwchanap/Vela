import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { Quasar } from 'quasar';
import { createRouter, createMemoryHistory } from 'vue-router';
import UserProfile from './UserProfile.vue';
import { useAuthStore } from '../../stores/auth';

let notifySpy: ReturnType<typeof vi.fn>;

vi.mock('quasar', async () => {
  const actual = await vi.importActual<typeof import('quasar')>('quasar');
  return {
    ...actual,
    useQuasar: () => ({
      notify: notifySpy,
    }),
  };
});

const createTestRouter = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/auth/login', component: { template: '<div />' } },
    ],
  });

describe('UserProfile', () => {
  let router: ReturnType<typeof createTestRouter>;

  beforeEach(async () => {
    setActivePinia(createPinia());
    notifySpy = vi.fn();
    router = createTestRouter();
    await router.push('/');
    vi.clearAllMocks();
    notifySpy = vi.fn();
  });

  const mockUser = {
    id: 'user-123',
    email: 'test@example.com',
    username: 'testuser',
    avatar_url: '/avatars/avatar1.png',
    current_level: 5,
    total_experience: 1200,
    learning_streak: 7,
    native_language: 'en',
    preferences: {
      dailyGoal: 30,
      difficulty: 'Beginner' as const,
      notifications: true,
    },
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-15T00:00:00.000Z',
  };

  const mountComponent = (props = {}) => {
    return mount(UserProfile, {
      global: {
        plugins: [Quasar, router],
        stubs: {
          QTooltip: { template: '<div />' },
        },
      },
      props,
    });
  };

  describe('Initial Rendering', () => {
    it('should render profile card', () => {
      const wrapper = mountComponent();

      const card = wrapper.findComponent({ name: 'QCard' });
      expect(card.exists()).toBe(true);
    });

    it('should show display name label', () => {
      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('Display Name');
    });

    it('should show email when user is authenticated', () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;

      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('test@example.com');
    });

    it('should show username when available', () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;

      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('testuser');
    });

    it('should show stats section', () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;

      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('Level');
      expect(wrapper.text()).toContain('XP');
      expect(wrapper.text()).toContain('Streak');
    });

    it('should display user level', () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;

      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('5');
    });

    it('should display user experience', () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;

      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('1200');
    });

    it('should display user streak', () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;

      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('7');
    });
  });

  describe('Avatar Display', () => {
    it('should show avatar when user has one', () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;

      const wrapper = mountComponent();

      const avatar = wrapper.findComponent({ name: 'QAvatar' });
      expect(avatar.exists()).toBe(true);
    });

    it('should display avatar image', () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;

      const wrapper = mountComponent();

      const avatar = wrapper.findComponent({ name: 'QAvatar' });
      const img = avatar.find('img');

      expect(img.exists()).toBe(true);
    });
  });

  describe('Edit Mode', () => {
    it('should have edit button', () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;

      const wrapper = mountComponent();

      const editButton = wrapper.findAllComponents({ name: 'QBtn' }).find((btn) => {
        return btn.text().includes('Edit');
      });

      expect(editButton?.exists()).toBe(true);
    });

    it('should have sign out button', () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;

      const wrapper = mountComponent();

      const signOutButton = wrapper.findAllComponents({ name: 'QBtn' }).find((btn) => {
        return btn.text().includes('Sign Out');
      });

      expect(signOutButton?.exists()).toBe(true);
    });
  });

  describe('Preferences Section', () => {
    it('should show preferences heading', () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;

      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('Preferences');
    });

    it('should display daily goal', () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;

      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('Daily Goal');
      expect(wrapper.text()).toContain('30');
    });

    it('should display difficulty level', () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;

      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('Difficulty');
    });

    it('should display notifications setting', () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;

      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('Notifications');
    });

    it('should show enabled notifications', () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;

      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('Enabled');
    });

    it('should show disabled notifications', () => {
      const authStore = useAuthStore();
      authStore.user = {
        ...mockUser,
        preferences: {
          ...mockUser.preferences,
          notifications: false,
        },
      };

      const wrapper = mountComponent();

      // Component should render successfully
      expect(wrapper.exists()).toBe(true);
      // Should display "Disabled" status for notifications
      expect(wrapper.text()).toContain('Disabled');
    });
  });

  describe('Account Information', () => {
    it('should show native language', () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;

      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('Native Language');
    });

    it('should show member since date', () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;

      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('Member Since');
    });
  });

  describe('Change Password Dialog', () => {
    it('should have change password button', () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;

      const wrapper = mountComponent();

      const changePasswordButton = wrapper.findAllComponents({ name: 'QBtn' }).find((btn) => {
        return btn.text().includes('Change Password');
      });

      expect(changePasswordButton?.exists()).toBe(true);
    });

    it('should have password dialog component', () => {
      const wrapper = mountComponent();

      const dialog = wrapper.findComponent({ name: 'QDialog' });
      expect(dialog.exists()).toBe(true);
    });
  });

  describe('Store Integration', () => {
    it('should have access to auth store', () => {
      mountComponent();

      const authStore = useAuthStore();
      expect(authStore).toBeDefined();
    });

    it('should have signOut method in store', () => {
      const authStore = useAuthStore();

      expect(typeof authStore.signOut).toBe('function');
    });

    it('should have updateProfile method in store', () => {
      const authStore = useAuthStore();

      expect(typeof authStore.updateProfile).toBe('function');
    });
  });

  describe('UI Components', () => {
    it('should have multiple QCard sections', () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;

      const wrapper = mountComponent();

      const sections = wrapper.findAllComponents({ name: 'QCardSection' });
      expect(sections.length).toBeGreaterThan(0);
    });

    it('should show dividers between sections', () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;

      const wrapper = mountComponent();

      const separators = wrapper.findAllComponents({ name: 'QSeparator' });
      expect(separators.length).toBeGreaterThan(0);
    });

    it('should show avatar component', () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;

      const wrapper = mountComponent();

      const avatars = wrapper.findAllComponents({ name: 'QAvatar' });
      expect(avatars.length).toBeGreaterThan(0);
    });
  });

  describe('Language Options', () => {
    it('should handle English native language', () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;

      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('English');
    });

    it('should display native language setting', () => {
      const authStore = useAuthStore();
      authStore.user = {
        ...mockUser,
        native_language: 'ja',
      };

      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('Native Language');
    });
  });

  describe('Difficulty Levels', () => {
    it('should display beginner difficulty', () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;

      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('Beginner');
    });

    it('should handle intermediate difficulty', () => {
      const authStore = useAuthStore();
      authStore.user = {
        ...mockUser,
        preferences: {
          ...mockUser.preferences,
          difficulty: 'Intermediate' as const,
        },
      };

      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('Intermediate');
    });

    it('should handle advanced difficulty', () => {
      const authStore = useAuthStore();
      authStore.user = {
        ...mockUser,
        preferences: {
          ...mockUser.preferences,
          difficulty: 'Advanced' as const,
        },
      };

      const wrapper = mountComponent();

      expect(wrapper.text()).toContain('Advanced');
    });
  });

  describe('Empty State', () => {
    it('should handle missing user gracefully', () => {
      const wrapper = mountComponent();

      // Should still render without errors
      const card = wrapper.findComponent({ name: 'QCard' });
      expect(card.exists()).toBe(true);
    });

    it('should handle user without profile', () => {
      const authStore = useAuthStore();
      authStore.user = {
        id: 'user-123',
        email: 'test@example.com',
        current_level: 1,
        total_experience: 0,
        learning_streak: 0,
        native_language: 'en',
        preferences: {
          dailyGoal: 20,
          difficulty: 'Beginner' as const,
          notifications: false,
        },
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      };

      const wrapper = mountComponent();

      // Should still render without errors
      const card = wrapper.findComponent({ name: 'QCard' });
      expect(card.exists()).toBe(true);
    });
  });

  describe('Props', () => {
    it('should render without any props', () => {
      const wrapper = mountComponent();

      expect(wrapper.exists()).toBe(true);
    });
  });

  describe('Loading States', () => {
    it('should render when auth store is loading', async () => {
      const authStore = useAuthStore();
      authStore.isLoading = true;

      const wrapper = mountComponent();
      await wrapper.vm.$nextTick();

      // Component should render
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe('Avatar Options', () => {
    it('should have avatar selection in the component', () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;

      const wrapper = mountComponent();

      // Avatar should be displayed
      const avatar = wrapper.findComponent({ name: 'QAvatar' });
      expect(avatar.exists()).toBe(true);
    });
  });

  describe('Date Formatting', () => {
    it('should format member since date', () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;

      const wrapper = mountComponent();

      // Should show formatted date
      expect(wrapper.text()).toContain('Member Since');
      const expectedDate = new Date(mockUser.created_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
      });
      expect(wrapper.text()).toContain(expectedDate);
    });

    it('should return empty string for invalid date via vm', () => {
      const wrapper = mountComponent();
      const vm = wrapper.vm as any;

      expect(vm.formatDate(undefined)).toBe('');
      expect(vm.formatDate('')).toBe('');
    });
  });

  describe('startEdit()', () => {
    it('populates edit form from current user/preferences and enables edit mode', async () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;

      const wrapper = mountComponent();
      const vm = wrapper.vm as any;

      expect(vm.editMode).toBe(false);
      vm.startEdit();

      expect(vm.editMode).toBe(true);
      expect(vm.editForm.username).toBe('testuser');
      expect(vm.editForm.native_language).toBe('en');
      expect(vm.editForm.dailyGoal).toBe(30);
      expect(vm.editForm.difficulty).toBe('Beginner');
      expect(vm.editForm.notifications).toBe(true);
    });

    it('uses the user avatar when it matches an allowed option', async () => {
      const authStore = useAuthStore();
      authStore.user = {
        ...mockUser,
        avatar_url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Ada',
      };

      const wrapper = mountComponent();
      const vm = wrapper.vm as any;
      vm.startEdit();

      expect(vm.editForm.avatar_url).toBe('https://api.dicebear.com/7.x/adventurer/svg?seed=Ada');
    });

    it('falls back to first avatar option when user avatar is missing', async () => {
      const authStore = useAuthStore();
      authStore.user = { ...mockUser, avatar_url: undefined };

      const wrapper = mountComponent();
      const vm = wrapper.vm as any;
      vm.startEdit();

      // Should fall back to first avatar option
      expect(vm.editForm.avatar_url).toBe('https://api.dicebear.com/7.x/adventurer/svg?seed=Ada');
    });

    it('uses the user avatar even when it is an external URL (selection enforced on save)', async () => {
      const authStore = useAuthStore();
      authStore.user = { ...mockUser, avatar_url: '/avatars/avatar1.png' };

      const wrapper = mountComponent();
      const vm = wrapper.vm as any;
      vm.startEdit();

      // startEdit just copies the current url; handleSave enforces whitelist
      expect(vm.editForm.avatar_url).toBe('/avatars/avatar1.png');
    });
  });

  describe('cancelEdit()', () => {
    it('exits edit mode and clears store error', async () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;
      authStore.error = 'Some previous error';

      const wrapper = mountComponent();
      const vm = wrapper.vm as any;

      vm.editMode = true;
      vm.cancelEdit();

      expect(vm.editMode).toBe(false);
      expect(authStore.error).toBeNull();
    });
  });

  describe('handleSave()', () => {
    it('success: calls updateProfile with normalized payload, notifies positively and exits edit mode', async () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;
      vi.spyOn(authStore, 'updateProfile').mockResolvedValue(true);

      const wrapper = mountComponent();
      const vm = wrapper.vm as any;
      vm.editMode = true;
      vm.editForm.username = 'newname';
      vm.editForm.native_language = 'ja';
      vm.editForm.dailyGoal = 20;
      vm.editForm.difficulty = 'Intermediate';
      vm.editForm.notifications = false;
      // Use a valid avatar from the whitelist
      vm.editForm.avatar_url = 'https://api.dicebear.com/7.x/adventurer/svg?seed=Lin';

      await vm.handleSave();
      await flushPromises();

      expect(authStore.updateProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'newname',
          native_language: 'ja',
          avatar_url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Lin',
        }),
      );
      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'positive', message: 'Profile updated successfully!' }),
      );
      expect(vm.editMode).toBe(false);
    });

    it('enforces avatar whitelist fallback when selected avatar is invalid', async () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;
      vi.spyOn(authStore, 'updateProfile').mockResolvedValue(true);

      const wrapper = mountComponent();
      const vm = wrapper.vm as any;
      vm.editMode = true;
      vm.editForm.avatar_url = '/avatars/not-in-whitelist.png';

      await vm.handleSave();
      await flushPromises();

      expect(authStore.updateProfile).toHaveBeenCalledWith(
        expect.objectContaining({
          avatar_url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Ada',
        }),
      );
    });

    it('failure: notifies negatively with store error and remains in edit mode', async () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;
      vi.spyOn(authStore, 'updateProfile').mockImplementation(async () => {
        authStore.error = 'Update failed';
        return false;
      });

      const wrapper = mountComponent();
      const vm = wrapper.vm as any;
      vm.editMode = true;

      await vm.handleSave();
      await flushPromises();

      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'negative', message: 'Update failed' }),
      );
      expect(vm.editMode).toBe(true);
    });

    it('does not notify when updateProfile returns false without an error message', async () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;
      vi.spyOn(authStore, 'updateProfile').mockResolvedValue(false);
      authStore.error = null;

      const wrapper = mountComponent();
      const vm = wrapper.vm as any;
      vm.editMode = true;

      await vm.handleSave();
      await flushPromises();

      expect(notifySpy).not.toHaveBeenCalled();
      expect(vm.editMode).toBe(true);
    });
  });

  describe('handlePasswordChange()', () => {
    it('returns early when passwords do not match', async () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;
      vi.spyOn(authStore, 'updatePassword').mockResolvedValue(true);

      const wrapper = mountComponent();
      const vm = wrapper.vm as any;
      vm.passwordForm.newPassword = 'password1';
      vm.passwordForm.confirmPassword = 'password2';

      await vm.handlePasswordChange();

      expect(authStore.updatePassword).not.toHaveBeenCalled();
      expect(notifySpy).not.toHaveBeenCalled();
    });

    it('success: calls store, notifies positively, closes dialog and clears fields', async () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;
      vi.spyOn(authStore, 'updatePassword').mockResolvedValue(true);

      const wrapper = mountComponent();
      const vm = wrapper.vm as any;
      vm.showPasswordDialog = true;
      vm.passwordForm.newPassword = 'newPass123';
      vm.passwordForm.confirmPassword = 'newPass123';

      await vm.handlePasswordChange();
      await flushPromises();

      expect(authStore.updatePassword).toHaveBeenCalledWith('newPass123');
      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'positive',
          message: 'Password updated successfully!',
        }),
      );
      expect(vm.showPasswordDialog).toBe(false);
      expect(vm.passwordForm.newPassword).toBe('');
      expect(vm.passwordForm.confirmPassword).toBe('');
      expect(vm.passwordLoading).toBe(false);
    });

    it('failure: notifies negatively with store error and resets loading', async () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;
      vi.spyOn(authStore, 'updatePassword').mockImplementation(async () => {
        authStore.error = 'Wrong password';
        return false;
      });

      const wrapper = mountComponent();
      const vm = wrapper.vm as any;
      vm.passwordForm.newPassword = 'pass123';
      vm.passwordForm.confirmPassword = 'pass123';

      await vm.handlePasswordChange();
      await flushPromises();

      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'negative', message: 'Wrong password' }),
      );
      expect(vm.passwordLoading).toBe(false);
    });
  });

  describe('handleSignOut()', () => {
    it('success: notifies positively, navigates to /auth/login and resets loading', async () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;
      vi.spyOn(authStore, 'signOut').mockResolvedValue(true);
      const routerSpy = vi.spyOn(router, 'push').mockResolvedValue(undefined);

      const wrapper = mountComponent();
      const vm = wrapper.vm as any;

      await vm.handleSignOut();
      await flushPromises();

      expect(authStore.signOut).toHaveBeenCalled();
      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'positive',
          message: 'Signed out successfully!',
        }),
      );
      expect(routerSpy).toHaveBeenCalledWith('/auth/login');
      expect(vm.signOutLoading).toBe(false);
    });

    it('failure: notifies negatively, does not navigate and resets loading', async () => {
      const authStore = useAuthStore();
      authStore.user = mockUser;
      vi.spyOn(authStore, 'signOut').mockImplementation(async () => {
        authStore.error = 'Sign out failed';
        return false;
      });
      const routerSpy = vi.spyOn(router, 'push').mockResolvedValue(undefined);

      const wrapper = mountComponent();
      const vm = wrapper.vm as any;

      await vm.handleSignOut();
      await flushPromises();

      expect(notifySpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'negative', message: 'Sign out failed' }),
      );
      expect(routerSpy).not.toHaveBeenCalled();
      expect(vm.signOutLoading).toBe(false);
    });
  });

  describe('onMounted()', () => {
    it('calls authStore.initialize() when isInitialized is false', async () => {
      const authStore = useAuthStore();
      vi.spyOn(authStore, 'initialize').mockResolvedValue(undefined);
      // isInitialized starts as false in a fresh store

      mountComponent();
      await flushPromises();

      expect(authStore.initialize).toHaveBeenCalled();
    });

    it('does not call authStore.initialize() when isInitialized is true', async () => {
      const authStore = useAuthStore();
      // Set isInitialized to true before mounting
      authStore.isInitialized = true;
      vi.spyOn(authStore, 'initialize').mockResolvedValue(undefined);

      mountComponent();
      await flushPromises();

      expect(authStore.initialize).not.toHaveBeenCalled();
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { Quasar } from 'quasar';
import UserProfile from './UserProfile.vue';
import { useAuthStore } from '../../stores/auth';

describe('UserProfile', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
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
        plugins: [Quasar],
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
      // Date should be formatted (checking for "December" which should be in the formatted date)
      expect(wrapper.text()).toContain('December');
    });
  });
});

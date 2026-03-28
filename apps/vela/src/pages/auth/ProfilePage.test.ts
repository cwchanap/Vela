import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { Quasar } from 'quasar';
import { createRouter, createMemoryHistory } from 'vue-router';
import ProfilePage from './ProfilePage.vue';
import { useAuthStore } from '../../stores/auth';

// Mock UserProfile component
vi.mock('../../components/auth/UserProfile.vue', () => ({
  default: {
    template: '<div data-testid="user-profile">UserProfile</div>',
    name: 'UserProfile',
  },
}));

const createTestRouter = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/auth/login', component: { template: '<div />' } },
      { path: '/profile', component: { template: '<div />' } },
    ],
  });

describe('ProfilePage', () => {
  let router: ReturnType<typeof createTestRouter>;

  beforeEach(() => {
    setActivePinia(createPinia());
    router = createTestRouter();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mountComponent = () =>
    mount(ProfilePage, {
      global: {
        plugins: [Quasar, router],
        stubs: {
          'q-page': { template: '<div><slot /></div>' },
          'q-card': { template: '<div><slot /></div>' },
          'q-card-section': { template: '<div><slot /></div>' },
          'q-icon': true,
          'q-spinner-dots': true,
          'q-linear-progress': true,
          'q-list': { template: '<ul><slot /></ul>' },
          'q-item': { template: '<li><slot /></li>' },
          'q-item-section': { template: '<div><slot /></div>' },
          'q-item-label': { template: '<span><slot /></span>' },
          'q-avatar': { template: '<div><slot /></div>' },
          'q-btn': {
            template: '<button @click="$emit(\'click\')"><slot /></button>',
            props: ['label', 'color'],
            emits: ['click'],
          },
        },
      },
    });

  describe('Not authenticated state', () => {
    it('shows not signed in message when user is not authenticated', () => {
      const wrapper = mountComponent();
      expect(wrapper.text()).toContain('Not Signed In');
      wrapper.unmount();
    });

    it('shows sign in prompt', () => {
      const wrapper = mountComponent();
      expect(wrapper.text()).toContain('Please sign in to view your profile');
      wrapper.unmount();
    });

    it('does not show profile content when not authenticated', () => {
      const wrapper = mountComponent();
      expect(wrapper.text()).not.toContain('Learning Statistics');
      wrapper.unmount();
    });
  });

  describe('Loading state', () => {
    it('shows loading spinner when auth is loading and no user', () => {
      const authStore = useAuthStore();
      authStore.isLoading = true;
      const wrapper = mountComponent();
      // isLoading and !user → shows loading state
      expect(wrapper.text()).toContain('Loading profile...');
      wrapper.unmount();
    });
  });

  const mockUser = {
    id: 'user-1',
    email: 'test@example.com',
    username: 'testuser',
    current_level: 2,
    total_experience: 1500,
    learning_streak: 5,
    native_language: 'en',
    avatar_url: null,
    preferences: {
      dailyGoal: 30,
      dailyLessonGoal: 5,
      lessonDurationMinutes: 30,
      theme: 'light',
    },
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
  } as any;

  describe('Authenticated state', () => {
    beforeEach(() => {
      const authStore = useAuthStore();
      authStore.setUser(mockUser);
      authStore.setSession({
        user: { id: 'user-1', email: 'test@example.com' },
        provider: 'cognito',
      });
    });

    it('shows learning statistics section', () => {
      const wrapper = mountComponent();
      expect(wrapper.text()).toContain('Learning Statistics');
      wrapper.unmount();
    });

    it('renders UserProfile component', () => {
      const wrapper = mountComponent();
      expect(wrapper.find('[data-testid="user-profile"]').exists()).toBe(true);
      wrapper.unmount();
    });

    it('shows Level stat', () => {
      const wrapper = mountComponent();
      expect(wrapper.text()).toContain('Level');
      wrapper.unmount();
    });

    it('shows Total XP stat', () => {
      const wrapper = mountComponent();
      expect(wrapper.text()).toContain('Total XP');
      wrapper.unmount();
    });

    it('shows Day Streak stat', () => {
      const wrapper = mountComponent();
      expect(wrapper.text()).toContain('Day Streak');
      wrapper.unmount();
    });

    it('shows Next Level stat', () => {
      const wrapper = mountComponent();
      expect(wrapper.text()).toContain('Next Level');
      wrapper.unmount();
    });

    it('shows Recent Activity section', () => {
      const wrapper = mountComponent();
      expect(wrapper.text()).toContain('Recent Activity');
      wrapper.unmount();
    });

    it('shows mock recent activity items', () => {
      const wrapper = mountComponent();
      const text = wrapper.text();
      expect(text).toContain('Vocabulary Game Completed');
      expect(text).toContain('AI Chat Session');
      expect(text).toContain('Level Up!');
      wrapper.unmount();
    });
  });

  describe('Computed properties', () => {
    it('calculates currentLevelXP correctly', () => {
      const authStore = useAuthStore();
      authStore.setUser({ ...mockUser, total_experience: 1500 });
      authStore.setSession({ user: { id: 'user-1', email: 'test@example.com' } });
      const wrapper = mountComponent();
      // currentLevelXP = 1500 % 1000 = 500
      expect((wrapper.vm as any).currentLevelXP).toBe(500);
      wrapper.unmount();
    });

    it('calculates nextLevelXP correctly', () => {
      const authStore = useAuthStore();
      authStore.setUser({ ...mockUser, total_experience: 1500 });
      authStore.setSession({ user: { id: 'user-1', email: 'test@example.com' } });
      const wrapper = mountComponent();
      // nextLevelXP = 1000 - 500 = 500
      expect((wrapper.vm as any).nextLevelXP).toBe(500);
      wrapper.unmount();
    });

    it('calculates levelProgress correctly', () => {
      const authStore = useAuthStore();
      authStore.setUser({ ...mockUser, total_experience: 1500 });
      authStore.setSession({ user: { id: 'user-1', email: 'test@example.com' } });
      const wrapper = mountComponent();
      // levelProgress = 500 / 1000 = 0.5
      expect((wrapper.vm as any).levelProgress).toBe(0.5);
      wrapper.unmount();
    });

    it('returns fixed recent activity list', () => {
      const authStore = useAuthStore();
      authStore.setUser(mockUser);
      authStore.setSession({ user: { id: 'user-1', email: 'test@example.com' } });
      const wrapper = mountComponent();
      const activities = (wrapper.vm as any).recentActivity;
      expect(activities).toHaveLength(3);
      expect(activities[0].title).toBe('Vocabulary Game Completed');
      expect(activities[1].title).toBe('AI Chat Session');
      expect(activities[2].title).toBe('Level Up!');
      wrapper.unmount();
    });
  });

  describe('onMounted', () => {
    it('calls authStore.initialize when not already initialized', async () => {
      const authStore = useAuthStore();
      authStore.isInitialized = false;
      const initializeSpy = vi.spyOn(authStore, 'initialize').mockResolvedValue(undefined);

      const wrapper = mountComponent();
      await wrapper.vm.$nextTick();

      expect(initializeSpy).toHaveBeenCalled();
      wrapper.unmount();
    });

    it('does not call authStore.initialize when already initialized', async () => {
      const authStore = useAuthStore();
      authStore.isInitialized = true;
      const initializeSpy = vi.spyOn(authStore, 'initialize').mockResolvedValue(undefined);

      const wrapper = mountComponent();
      await wrapper.vm.$nextTick();

      expect(initializeSpy).not.toHaveBeenCalled();
      wrapper.unmount();
    });
  });
});

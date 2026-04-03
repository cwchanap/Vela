import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, VueWrapper, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { Quasar } from 'quasar';
import { createRouter, createMemoryHistory } from 'vue-router';
import IndexPage from './IndexPage.vue';
import { useAuthStore } from 'src/stores/auth';
import { httpJsonAuth } from 'src/utils/httpClient';

// Mock httpClient to avoid real API calls
vi.mock('src/utils/httpClient', () => ({
  httpJsonAuth: vi.fn().mockResolvedValue({ achievements: [] }),
}));

vi.mock('src/utils/api', () => ({
  getApiUrl: (path: string) => `http://localhost:9005/api/${path}`,
}));

const createTestRouter = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/auth/login', component: { template: '<div />' } },
      { path: '/games', component: { template: '<div />' } },
      { path: '/games/vocabulary', component: { template: '<div />' } },
      { path: '/games/sentence', component: { template: '<div />' } },
      { path: '/chat', component: { template: '<div />' } },
      { path: '/my-dictionaries', component: { template: '<div />' } },
      { path: '/progress', component: { template: '<div />' } },
    ],
  });

describe('IndexPage', () => {
  let wrapper: VueWrapper;
  let router: ReturnType<typeof createTestRouter>;

  beforeEach(async () => {
    setActivePinia(createPinia());
    router = createTestRouter();
    await router.push('/');
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  const mountComponent = (
    authState: Partial<{
      isInitialized: boolean;
      isAuthenticated: boolean;
      user: any;
      session: any;
    }> = {},
  ) => {
    // Configure store BEFORE mounting so onMounted sees the correct auth state
    const authStore = useAuthStore();
    authStore.isInitialized = authState.isInitialized ?? true;
    authStore.user = authState.user ?? null;
    // Drive isAuthenticated via setSession (it's a computed of user + session)
    const session =
      authState.session ?? (authState.isAuthenticated ? { user: authStore.user } : null);
    authStore.setSession(session);

    return mount(IndexPage, {
      global: {
        plugins: [Quasar, router],
        stubs: {
          'q-page': { template: '<div><slot /></div>' },
          'q-circular-progress': true,
          'q-btn': { template: '<button @click="$emit(\'click\')"><slot /></button>' },
          'q-icon': true,
          'q-spinner': true,
        },
      },
    });
  };

  describe('Rendering', () => {
    it('renders without errors', () => {
      wrapper = mountComponent();
      expect(wrapper.exists()).toBe(true);
    });

    it('renders Start Learning button', () => {
      wrapper = mountComponent();
      expect(wrapper.text()).toContain('Start Learning');
    });

    it('shows Continue Learning section', () => {
      wrapper = mountComponent();
      expect(wrapper.text()).toContain('Continue Learning');
    });

    it('shows action cards for vocabulary, sentences, chat, and words', () => {
      wrapper = mountComponent();
      const text = wrapper.text();
      expect(text).toContain('Vocabulary');
      expect(text).toContain('Sentences');
      expect(text).toContain('AI Tutor');
      expect(text).toContain('My Words');
    });
  });

  describe('dailyProgress computed', () => {
    it('returns 0 when dailyGoal is 0', () => {
      wrapper = mountComponent({
        user: {
          id: '1',
          email: 'test@example.com',
          avatar_url: null,
          preferences: {
            dailyGoal: 0,
            dailyLessonGoal: 5,
            lessonDurationMinutes: 30,
            todayStudyTime: 10,
          },
        },
      });
      expect(wrapper.vm.dailyProgress).toBe(0);
    });

    it('calculates dailyProgress correctly', () => {
      wrapper = mountComponent({
        user: {
          id: '1',
          email: 'test@example.com',
          avatar_url: null,
          preferences: {
            dailyGoal: 30,
            dailyLessonGoal: 5,
            lessonDurationMinutes: 30,
            todayStudyTime: 15,
          },
        },
      });
      // 15/30 * 100 = 50
      expect(wrapper.vm.dailyProgress).toBe(50);
    });

    it('caps dailyProgress at 100', () => {
      wrapper = mountComponent({
        user: {
          id: '1',
          email: 'test@example.com',
          avatar_url: null,
          preferences: {
            dailyGoal: 10,
            dailyLessonGoal: 5,
            lessonDurationMinutes: 30,
            todayStudyTime: 60,
          },
        },
      });
      expect(wrapper.vm.dailyProgress).toBe(100);
    });

    it('uses default dailyGoal of 30 when not set', () => {
      wrapper = mountComponent({ user: null });
      // todayStudyTime defaults to 0
      expect(wrapper.vm.dailyProgress).toBe(0);
    });
  });

  describe('mapAchievement helper', () => {
    it('maps valid achievement with string id', () => {
      wrapper = mountComponent();
      const result = wrapper.vm.mapAchievement({
        id: 'ach-1',
        name: 'First Steps',
        description: 'Complete your first game',
        icon: 'school',
        color: 'primary',
      });
      expect(result).not.toBeNull();
      expect(result?.id).toBe('ach-1');
      expect(result?.title).toBe('First Steps');
    });

    it('maps achievement using achievement_id as fallback', () => {
      wrapper = mountComponent();
      const result = wrapper.vm.mapAchievement({
        achievement_id: 'ach-2',
        name: 'Level Up',
        description: 'Reach level 5',
        icon: 'star',
        color: 'gold',
      });
      expect(result?.id).toBe('ach-2');
    });

    it('returns null for null input', () => {
      wrapper = mountComponent();
      expect(wrapper.vm.mapAchievement(null)).toBeNull();
    });

    it('returns null for non-object input', () => {
      wrapper = mountComponent();
      expect(wrapper.vm.mapAchievement('string')).toBeNull();
      expect(wrapper.vm.mapAchievement(42)).toBeNull();
    });

    it('returns null for array input', () => {
      wrapper = mountComponent();
      expect(wrapper.vm.mapAchievement([])).toBeNull();
    });

    it('returns null when id is empty string', () => {
      wrapper = mountComponent();
      expect(wrapper.vm.mapAchievement({ id: '', name: 'Test' })).toBeNull();
    });

    it('returns null when id is whitespace', () => {
      wrapper = mountComponent();
      expect(wrapper.vm.mapAchievement({ id: '   ', name: 'Test' })).toBeNull();
    });

    it('maps numeric id to string', () => {
      wrapper = mountComponent();
      const result = wrapper.vm.mapAchievement({ id: 42, name: 'Test' });
      expect(result?.id).toBe('42');
    });

    it('uses rawId as title when name/title are missing', () => {
      wrapper = mountComponent();
      const result = wrapper.vm.mapAchievement({ id: 'my-ach' });
      expect(result?.title).toBe('my-ach');
    });

    it('defaults icon to emoji_events when not a valid string', () => {
      wrapper = mountComponent();
      const result = wrapper.vm.mapAchievement({ id: 'ach-3', name: 'Test' });
      expect(result?.icon).toBe('emoji_events');
    });

    it('defaults color to primary when not set', () => {
      wrapper = mountComponent();
      const result = wrapper.vm.mapAchievement({ id: 'ach-4', name: 'Test' });
      expect(result?.color).toBe('primary');
    });

    it('uses provided icon and color', () => {
      wrapper = mountComponent();
      const result = wrapper.vm.mapAchievement({
        id: 'ach-5',
        name: 'Test',
        icon: 'star',
        color: 'orange',
      });
      expect(result?.icon).toBe('star');
      expect(result?.color).toBe('orange');
    });

    it('uses name field over title field', () => {
      wrapper = mountComponent();
      const result = wrapper.vm.mapAchievement({ id: 'ach-6', name: 'Name', title: 'Title' });
      // raw.name takes precedence over raw.title
      expect(result?.title).toBe('Name');
    });
  });

  describe('Navigation functions', () => {
    it('navigateToLearn pushes to /games', async () => {
      wrapper = mountComponent();
      const routerPushSpy = vi.spyOn(router, 'push');
      await wrapper.vm.navigateToLearn();
      expect(routerPushSpy).toHaveBeenCalledWith('/games');
    });

    it('handleActionKeydown navigates on Enter', async () => {
      wrapper = mountComponent();
      const routerPushSpy = vi.spyOn(router, 'push');
      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      Object.defineProperty(event, 'preventDefault', { value: vi.fn() });
      await wrapper.vm.handleActionKeydown('/games/vocabulary', event as any);
      expect(routerPushSpy).toHaveBeenCalledWith('/games/vocabulary');
    });

    it('handleActionKeydown navigates on Space', async () => {
      wrapper = mountComponent();
      const routerPushSpy = vi.spyOn(router, 'push');
      const event = new KeyboardEvent('keydown', { key: ' ' });
      Object.defineProperty(event, 'preventDefault', { value: vi.fn() });
      await wrapper.vm.handleActionKeydown('/games/sentence', event as any);
      expect(routerPushSpy).toHaveBeenCalledWith('/games/sentence');
    });

    it('handleActionKeydown does not navigate on other keys', async () => {
      wrapper = mountComponent();
      const routerPushSpy = vi.spyOn(router, 'push');
      const event = new KeyboardEvent('keydown', { key: 'Tab' });
      await wrapper.vm.handleActionKeydown('/games/vocabulary', event as any);
      expect(routerPushSpy).not.toHaveBeenCalled();
    });
  });

  describe('achievements loading', () => {
    const authenticatedUser = {
      id: 'user-1',
      email: 'test@example.com',
      avatar_url: null,
      current_level: 1,
      total_experience: 0,
      learning_streak: 0,
      native_language: 'en',
      preferences: {
        dailyGoal: 30,
        dailyLessonGoal: 5,
        lessonDurationMinutes: 30,
        todayStudyTime: 0,
      },
    };

    it('loads achievements from the userStats fallback payload', async () => {
      vi.mocked(httpJsonAuth).mockResolvedValueOnce({
        userStats: {
          achievements: [
            {
              achievement_id: 'ach-1',
              title: 'First Steps',
              description: 'Complete your first lesson',
              icon: 'school',
              color: 'positive',
            },
          ],
        },
      } as any);

      wrapper = mountComponent({
        user: authenticatedUser,
        isAuthenticated: true,
      });
      await flushPromises();

      expect(wrapper.vm.achievements).toEqual([
        {
          id: 'ach-1',
          title: 'First Steps',
          description: 'Complete your first lesson',
          icon: 'school',
          color: 'positive',
        },
      ]);
      expect(wrapper.text()).toContain('1 achievements unlocked');
      expect(wrapper.text()).toContain('View all');
    });

    it('loads achievements from the primary achievements payload', async () => {
      vi.mocked(httpJsonAuth).mockResolvedValueOnce({
        achievements: [
          {
            id: 'ach-primary',
            name: 'Primary Path',
            description: 'Loaded from the primary achievements array',
            icon: 'emoji_events',
            color: 'secondary',
          },
        ],
      } as any);

      wrapper = mountComponent({
        user: authenticatedUser,
        isAuthenticated: true,
      });
      await flushPromises();

      expect(wrapper.vm.achievements).toEqual([
        {
          id: 'ach-primary',
          title: 'Primary Path',
          description: 'Loaded from the primary achievements array',
          icon: 'emoji_events',
          color: 'secondary',
        },
      ]);
      expect(wrapper.text()).toContain('1 achievements unlocked');
    });

    it('shows the generic achievements error message for non-Error failures', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        vi.mocked(httpJsonAuth).mockRejectedValueOnce('boom');

        wrapper = mountComponent({
          user: authenticatedUser,
          isAuthenticated: true,
        });
        await flushPromises();

        expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to fetch achievements:', 'boom');
        expect(wrapper.vm.achievementsError).toBe('Failed to load achievements');
        expect(wrapper.text()).toContain('Failed to load achievements');
        expect(wrapper.text()).toContain('Retry');
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });

    it('ignores AbortError failures when fetching achievements', async () => {
      vi.mocked(httpJsonAuth).mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));

      wrapper = mountComponent({
        user: authenticatedUser,
        isAuthenticated: true,
      });
      await flushPromises();

      expect(wrapper.vm.achievementsError).toBeNull();
      expect(wrapper.vm.achievementsLoading).toBe(false);
      expect(wrapper.text()).toContain('Complete lessons to earn achievements!');
    });
  });
});

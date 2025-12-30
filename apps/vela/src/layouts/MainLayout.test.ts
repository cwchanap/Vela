import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { Quasar } from 'quasar';
import { createRouter, createMemoryHistory } from 'vue-router';
import MainLayout from './MainLayout.vue';
import { useAuthStore } from 'src/stores/auth';

describe('MainLayout', () => {
  let router: any;

  beforeEach(async () => {
    setActivePinia(createPinia());

    // Create a mock router
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { template: '<div>Home</div>' } },
        { path: '/auth/profile', component: { template: '<div>Profile</div>' } },
      ],
    });

    await router.push('/');
    vi.clearAllMocks();
  });

  const mountComponent = () => {
    return mount(MainLayout, {
      global: {
        plugins: [Quasar, router],
        stubs: {
          'q-layout': true,
          'q-header': true,
          'q-toolbar': true,
          'q-btn': true,
          'q-toolbar-title': true,
          'q-avatar': true,
          'q-space': true,
          'q-badge': true,
          'q-tooltip': true,
          'q-menu': true,
          'q-list': true,
          'q-item': true,
          'q-item-section': true,
          'q-icon': true,
          'q-drawer': true,
          'q-scroll-area': true,
          'q-page-container': true,
          'router-view': true,
        },
      },
    });
  };

  it('shows notification when dailyGoal is missing', async () => {
    const authStore = useAuthStore();
    authStore.user = {
      id: '1',
      email: 'test@example.com',
      avatar_url: null,
      preferences: {
        dailyGoal: null,
        dailyLessonGoal: 5,
        lessonDurationMinutes: 30,
      },
    };
    authStore.isInitialized = true;

    const wrapper = mountComponent();
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.notificationItems).toHaveLength(1);
    expect(wrapper.vm.notificationItems[0].id).toBe('learning-preferences');
    expect(wrapper.vm.notificationItems[0].label).toBe('Complete your learning preferences');
  });

  it('shows notification when dailyLessonGoal is missing', async () => {
    const authStore = useAuthStore();
    authStore.user = {
      id: '1',
      email: 'test@example.com',
      avatar_url: null,
      preferences: {
        dailyGoal: 10,
        dailyLessonGoal: null,
        lessonDurationMinutes: 30,
      },
    };
    authStore.isInitialized = true;

    const wrapper = mountComponent();
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.notificationItems).toHaveLength(1);
    expect(wrapper.vm.notificationItems[0].id).toBe('learning-preferences');
  });

  it('shows notification when lessonDurationMinutes is missing', async () => {
    const authStore = useAuthStore();
    authStore.user = {
      id: '1',
      email: 'test@example.com',
      avatar_url: null,
      preferences: {
        dailyGoal: 10,
        dailyLessonGoal: 5,
        lessonDurationMinutes: null,
      },
    };
    authStore.isInitialized = true;

    const wrapper = mountComponent();
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.notificationItems).toHaveLength(1);
    expect(wrapper.vm.notificationItems[0].id).toBe('learning-preferences');
  });

  it('shows notification when all preferences are missing', async () => {
    const authStore = useAuthStore();
    authStore.user = {
      id: '1',
      email: 'test@example.com',
      avatar_url: null,
      preferences: {
        dailyGoal: null,
        dailyLessonGoal: null,
        lessonDurationMinutes: null,
      },
    };
    authStore.isInitialized = true;

    const wrapper = mountComponent();
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.notificationItems).toHaveLength(1);
    expect(wrapper.vm.notificationItems[0].id).toBe('learning-preferences');
  });

  it('does not show notification when all preferences are set', async () => {
    const authStore = useAuthStore();
    authStore.user = {
      id: '1',
      email: 'test@example.com',
      avatar_url: null,
      preferences: {
        dailyGoal: 10,
        dailyLessonGoal: 5,
        lessonDurationMinutes: 30,
      },
    };
    authStore.isInitialized = true;

    const wrapper = mountComponent();
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.notificationItems).toHaveLength(0);
    expect(wrapper.vm.notificationCount).toBe(0);
  });

  it('does not show notification when user has no preferences', async () => {
    const authStore = useAuthStore();
    authStore.user = {
      id: '1',
      email: 'test@example.com',
      avatar_url: null,
      preferences: null,
    };
    authStore.isInitialized = true;

    const wrapper = mountComponent();
    await wrapper.vm.$nextTick();

    expect(wrapper.vm.notificationItems).toHaveLength(0);
  });
});

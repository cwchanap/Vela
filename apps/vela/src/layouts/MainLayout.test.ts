import { describe, it, expect, beforeEach, vi, type MockInstance } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { Quasar } from 'quasar';
import { reactive, nextTick } from 'vue';
import { createRouter, createMemoryHistory } from 'vue-router';
import MainLayout from './MainLayout.vue';
import { useAuthStore } from 'src/stores/auth';

// Shared reactive screen state – mutate per-test to control $q.screen
const mockScreen = reactive({ gt: { sm: false }, lt: { md: false } });

vi.mock('quasar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('quasar')>();
  return {
    ...actual,
    useQuasar: () => ({ screen: mockScreen }),
  };
});

const ALL_STUBS = {
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
};

describe('MainLayout', () => {
  let router: any;

  beforeEach(async () => {
    setActivePinia(createPinia());

    // Reset screen state
    mockScreen.gt.sm = false;
    mockScreen.lt.md = false;

    // Create a mock router
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { template: '<div>Home</div>' } },
        { path: '/auth/profile', component: { template: '<div>Profile</div>' } },
        { path: '/games', component: { template: '<div>Games</div>' } },
        { path: '/games/vocabulary', component: { template: '<div>Vocabulary</div>' } },
        { path: '/other', component: { template: '<div>Other</div>' } },
        { path: '/auth/login', component: { template: '<div>Login</div>' } },
      ],
    });

    await router.push('/');
    vi.clearAllMocks();
  });

  const mountComponent = () => {
    return mount(MainLayout, {
      global: {
        plugins: [Quasar, router],
        stubs: ALL_STUBS,
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

describe('MainLayout – normalizePath', () => {
  let router: any;

  beforeEach(async () => {
    setActivePinia(createPinia());
    mockScreen.gt.sm = false;
    mockScreen.lt.md = false;
    router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    });
    await router.push('/');
    vi.clearAllMocks();
  });

  const mountComponent = () =>
    mount(MainLayout, { global: { plugins: [Quasar, router], stubs: ALL_STUBS } });

  it('returns / for empty string', () => {
    const vm = mountComponent().vm as any;
    expect(vm.normalizePath('')).toBe('/');
  });

  it('returns / for whitespace-only string', () => {
    const vm = mountComponent().vm as any;
    expect(vm.normalizePath('   ')).toBe('/');
  });

  it('strips query string', () => {
    const vm = mountComponent().vm as any;
    expect(vm.normalizePath('/foo?q=1')).toBe('/foo');
  });

  it('strips hash fragment', () => {
    const vm = mountComponent().vm as any;
    expect(vm.normalizePath('/foo#anchor')).toBe('/foo');
  });

  it('adds missing leading slash', () => {
    const vm = mountComponent().vm as any;
    expect(vm.normalizePath('foo')).toBe('/foo');
  });

  it('collapses multiple consecutive slashes', () => {
    const vm = mountComponent().vm as any;
    // URL parser treats //host as authority; use a path with internal doubles
    expect(vm.normalizePath('/foo//bar')).toBe('/foo/bar');
  });

  it('strips trailing slash except root', () => {
    const vm = mountComponent().vm as any;
    expect(vm.normalizePath('/foo/')).toBe('/foo');
  });

  it('leaves root / unchanged', () => {
    const vm = mountComponent().vm as any;
    expect(vm.normalizePath('/')).toBe('/');
  });

  it('trims surrounding whitespace before normalizing', () => {
    const vm = mountComponent().vm as any;
    expect(vm.normalizePath('  /foo  ')).toBe('/foo');
  });

  it('falls back to raw.split when URL constructor throws (e.g. null byte)', () => {
    const vm = mountComponent().vm as any;
    // A null byte makes new URL() throw; the catch splits on ?/# and returns the first segment
    expect(vm.normalizePath('\x00')).toBe('/');
  });
});

describe('MainLayout – isActiveRoute', () => {
  let router: any;

  beforeEach(async () => {
    setActivePinia(createPinia());
    mockScreen.gt.sm = false;
    mockScreen.lt.md = false;
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { template: '<div />' } },
        { path: '/games', component: { template: '<div />' } },
        { path: '/games/vocabulary', component: { template: '<div />' } },
        { path: '/other', component: { template: '<div />' } },
      ],
    });
    vi.clearAllMocks();
  });

  const mountAt = async (path: string) => {
    await router.push(path);
    return mount(MainLayout, { global: { plugins: [Quasar, router], stubs: ALL_STUBS } }).vm as any;
  };

  it('root matches exactly when current is /', async () => {
    const vm = await mountAt('/');
    expect(vm.isActiveRoute('/')).toBe(true);
  });

  it('root does not match when current is a sub-path', async () => {
    const vm = await mountAt('/games');
    expect(vm.isActiveRoute('/')).toBe(false);
  });

  it('exact path matches when current equals target', async () => {
    const vm = await mountAt('/games');
    expect(vm.isActiveRoute('/games')).toBe(true);
  });

  it('parent path matches when current starts with target + /', async () => {
    const vm = await mountAt('/games/vocabulary');
    expect(vm.isActiveRoute('/games')).toBe(true);
  });

  it('does not match an unrelated route', async () => {
    const vm = await mountAt('/other');
    expect(vm.isActiveRoute('/games')).toBe(false);
  });
});

describe('MainLayout – drawer handlers', () => {
  let router: any;

  beforeEach(async () => {
    setActivePinia(createPinia());
    mockScreen.gt.sm = false;
    mockScreen.lt.md = false;
    router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    });
    await router.push('/');
    vi.clearAllMocks();
  });

  const mountComponent = () =>
    mount(MainLayout, { global: { plugins: [Quasar, router], stubs: ALL_STUBS } }).vm as any;

  it('toggleLeftDrawer flips leftDrawerOpen', () => {
    const vm = mountComponent();
    const before = vm.leftDrawerOpen;
    vm.toggleLeftDrawer();
    expect(vm.leftDrawerOpen).toBe(!before);
    vm.toggleLeftDrawer();
    expect(vm.leftDrawerOpen).toBe(before);
  });

  it('toggleMini flips drawerMini', () => {
    const vm = mountComponent();
    expect(vm.drawerMini).toBe(false);
    vm.toggleMini();
    expect(vm.drawerMini).toBe(true);
    vm.toggleMini();
    expect(vm.drawerMini).toBe(false);
  });

  it('toggleMini opens the drawer on desktop (gt.sm = true)', () => {
    mockScreen.gt.sm = true;
    const vm = mountComponent();
    vm.leftDrawerOpen = false;
    vm.toggleMini();
    expect(vm.leftDrawerOpen).toBe(true);
  });

  it('toggleMini does not force-open drawer on mobile (gt.sm = false)', () => {
    mockScreen.gt.sm = false;
    const vm = mountComponent();
    vm.leftDrawerOpen = false;
    vm.toggleMini();
    // leftDrawerOpen should remain false (not forced open)
    expect(vm.leftDrawerOpen).toBe(false);
  });
});

describe('MainLayout – handleLogout & onUserItemClick', () => {
  let router: any;
  let signOutSpy: MockInstance;
  let pushSpy: MockInstance;

  beforeEach(async () => {
    setActivePinia(createPinia());
    mockScreen.gt.sm = false;
    mockScreen.lt.md = false;
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { template: '<div />' } },
        { path: '/auth/login', component: { template: '<div />' } },
      ],
    });
    await router.push('/');
    vi.clearAllMocks();

    const authStore = useAuthStore();
    signOutSpy = vi.spyOn(authStore, 'signOut').mockResolvedValue(undefined);
    pushSpy = vi.spyOn(router, 'push');
  });

  const mountComponent = () =>
    mount(MainLayout, { global: { plugins: [Quasar, router], stubs: ALL_STUBS } }).vm as any;

  it('handleLogout calls signOut and navigates to /auth/login', async () => {
    const vm = mountComponent();
    await vm.handleLogout();
    expect(signOutSpy).toHaveBeenCalledOnce();
    expect(pushSpy).toHaveBeenCalledWith('/auth/login');
  });

  it('onUserItemClick triggers logout for action=logout item', async () => {
    const vm = mountComponent();
    await vm.onUserItemClick({ type: 'action', action: 'logout', name: 'Logout', icon: 'logout' });
    expect(signOutSpy).toHaveBeenCalledOnce();
  });

  it('onUserItemClick does nothing for a route item', async () => {
    const vm = mountComponent();
    vm.onUserItemClick({ type: 'route', name: 'Profile', icon: 'person', path: '/profile' });
    await nextTick();
    expect(signOutSpy).not.toHaveBeenCalled();
  });
});

describe('MainLayout – onMounted and screen watcher', () => {
  let router: any;

  beforeEach(async () => {
    setActivePinia(createPinia());
    mockScreen.gt.sm = false;
    mockScreen.lt.md = false;
    router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    });
    await router.push('/');
    vi.clearAllMocks();
  });

  const mountComponent = () =>
    mount(MainLayout, { global: { plugins: [Quasar, router], stubs: ALL_STUBS } });

  it('leftDrawerOpen is false on mount when gt.sm is false', () => {
    mockScreen.gt.sm = false;
    const wrapper = mountComponent();
    expect((wrapper.vm as any).leftDrawerOpen).toBe(false);
  });

  it('leftDrawerOpen is true on mount when gt.sm is true', () => {
    mockScreen.gt.sm = true;
    const wrapper = mountComponent();
    expect((wrapper.vm as any).leftDrawerOpen).toBe(true);
  });

  it('watcher sets leftDrawerOpen true when screen becomes desktop', async () => {
    mockScreen.gt.sm = false;
    const wrapper = mountComponent();
    expect((wrapper.vm as any).leftDrawerOpen).toBe(false);

    mockScreen.gt.sm = true;
    await nextTick();

    expect((wrapper.vm as any).leftDrawerOpen).toBe(true);
  });

  it('watcher sets leftDrawerOpen false when screen becomes mobile', async () => {
    mockScreen.gt.sm = true;
    const wrapper = mountComponent();
    expect((wrapper.vm as any).leftDrawerOpen).toBe(true);

    mockScreen.gt.sm = false;
    await nextTick();

    expect((wrapper.vm as any).leftDrawerOpen).toBe(false);
  });
});

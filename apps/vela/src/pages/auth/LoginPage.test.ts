import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, VueWrapper, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { Quasar, Notify } from 'quasar';
import { createRouter, createMemoryHistory } from 'vue-router';
import LoginPage from './LoginPage.vue';
import { useAuthStore } from '../../stores/auth';

const createTestRouter = () =>
  createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/auth/login', component: { template: '<div />' } },
      { path: '/auth/signup', component: { template: '<div />' } },
      { path: '/auth/callback', component: { template: '<div />' } },
    ],
  });

describe('LoginPage', () => {
  let wrapper: VueWrapper;
  let router: ReturnType<typeof createTestRouter>;

  beforeEach(async () => {
    setActivePinia(createPinia());
    router = createTestRouter();
    await router.push('/auth/login');
    vi.clearAllMocks();
    Notify.create = vi.fn() as any;
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  const mountComponent = () =>
    mount(LoginPage, {
      global: {
        plugins: [[Quasar, { plugins: { Notify } }], router],
        stubs: {
          'q-page': { template: '<div><slot /></div>' },
          'q-icon': true,
          AuthForm: {
            name: 'AuthForm',
            template: '<div data-testid="auth-form" />',
            props: ['mode', 'redirectTo'],
            emits: ['error'],
          },
        },
      },
    });

  describe('Rendering', () => {
    it('renders without errors', () => {
      wrapper = mountComponent();
      expect(wrapper.exists()).toBe(true);
    });

    it('renders branding title', () => {
      wrapper = mountComponent();
      expect(wrapper.text()).toContain('日本語学習');
    });

    it('renders tagline', () => {
      wrapper = mountComponent();
      expect(wrapper.text()).toContain('Master Japanese with Interactive Learning');
    });

    it('renders feature pills', () => {
      wrapper = mountComponent();
      const text = wrapper.text();
      expect(text).toContain('Vocabulary Games');
      expect(text).toContain('AI-Powered Tutor');
      expect(text).toContain('Track Progress');
    });
  });

  describe('authMode initialization', () => {
    it('starts in signin mode', () => {
      wrapper = mountComponent();
      expect(wrapper.vm.authMode).toBe('signin');
    });

    it('keeps signin mode when route includes signup', async () => {
      await router.push('/auth/signup');
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.authMode).toBe('signin');
    });

    it('keeps signin mode on callback route', async () => {
      await router.push('/auth/callback');
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.authMode).toBe('signin');
    });
  });

  describe('handleAuthError', () => {
    it('does not throw when called with error message', () => {
      wrapper = mountComponent();
      expect(() => wrapper.vm.handleAuthError('Invalid credentials')).not.toThrow();
    });
  });

  describe('redirectTo', () => {
    it('defaults redirectTo to /', () => {
      wrapper = mountComponent();
      expect(wrapper.vm.redirectTo).toBe('/');
    });

    it('sets redirectTo from query param', async () => {
      await router.push('/auth/login?redirect=/progress');
      wrapper = mountComponent();
      await flushPromises();
      expect(wrapper.vm.redirectTo).toBe('/progress');
    });

    it('redirects immediately on mount when a session already exists', async () => {
      const authStore = useAuthStore();
      const initializeSpy = vi.spyOn(authStore, 'initialize').mockResolvedValue(undefined);
      authStore.setSession({
        user: { id: 'user-1', email: 'test@example.com' },
        provider: 'cognito',
      });
      const routerPushSpy = vi.spyOn(router, 'push');

      wrapper = mountComponent();
      await flushPromises();

      expect(initializeSpy).toHaveBeenCalled();
      expect(routerPushSpy).toHaveBeenCalledWith('/');
    });

    it('redirects an existing session to the query redirect on mount', async () => {
      await router.push('/auth/login?redirect=/progress');
      const authStore = useAuthStore();
      const initializeSpy = vi.spyOn(authStore, 'initialize').mockResolvedValue(undefined);
      authStore.setSession({
        user: { id: 'user-1', email: 'test@example.com' },
        provider: 'cognito',
      });
      const routerPushSpy = vi.spyOn(router, 'push');

      wrapper = mountComponent();
      await flushPromises();

      expect(initializeSpy).toHaveBeenCalled();
      expect(routerPushSpy).toHaveBeenCalledWith('/progress');
    });

    it('uses the pending Hosted UI redirect on callback when a session exists', async () => {
      await router.push('/auth/callback');
      const authStore = useAuthStore();
      const initializeSpy = vi.spyOn(authStore, 'initialize').mockResolvedValue(undefined);
      const consumeRedirectSpy = vi
        .spyOn(authStore, 'consumePendingAuthRedirect')
        .mockReturnValue('/progress');
      authStore.setSession({
        user: { id: 'user-1', email: 'test@example.com' },
        provider: 'cognito',
      });
      const routerPushSpy = vi.spyOn(router, 'push');

      wrapper = mountComponent();
      await flushPromises();

      expect(initializeSpy).toHaveBeenCalled();
      expect(consumeRedirectSpy).toHaveBeenCalledWith('/');
      expect(routerPushSpy).toHaveBeenCalledWith('/progress');
    });

    it('redirects when session arrives after mount (asynchronous OAuth callback)', async () => {
      const authStore = useAuthStore();
      const initializeSpy = vi.spyOn(authStore, 'initialize').mockResolvedValue(undefined);
      const routerPushSpy = vi.spyOn(router, 'push');

      wrapper = mountComponent();
      await flushPromises();

      // Session wasn't present during mount
      expect(initializeSpy).toHaveBeenCalled();
      expect(routerPushSpy).not.toHaveBeenCalled();

      // Simulate OAuth callback completing after mount
      authStore.setSession({
        user: { id: 'user-1', email: 'test@example.com' },
        provider: 'cognito',
      });
      await flushPromises();

      expect(routerPushSpy).toHaveBeenCalledWith('/');
    });
  });
});

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
            template:
              '<div data-testid="auth-form" /><button @click="$emit(\'success\', \'signin\')" data-testid="trigger-success">trigger</button>',
            props: ['mode', 'redirectTo'],
            emits: ['success', 'error'],
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

    it('sets signup mode when route includes signup', async () => {
      await router.push('/auth/signup');
      wrapper = mountComponent();
      // onMounted runs and checks if route includes signup
      await flushPromises();
      expect(wrapper.vm.authMode).toBe('signup');
    });
  });

  describe('handleAuthSuccess', () => {
    it('sets authMode to signin on signup success', async () => {
      wrapper = mountComponent();
      await wrapper.vm.handleAuthSuccess('signup');
      expect(wrapper.vm.authMode).toBe('signin');
    });

    it('redirects to "/" after signin success', async () => {
      vi.useFakeTimers();
      try {
        wrapper = mountComponent();
        const routerPushSpy = vi.spyOn(router, 'push');
        // handleAuthSuccess with 'signin' waits 1 second then pushes
        const promise = wrapper.vm.handleAuthSuccess('signin');
        await vi.runAllTimersAsync();
        await promise;
        expect(routerPushSpy).toHaveBeenCalledWith('/');
      } finally {
        vi.useRealTimers();
      }
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
  });
});

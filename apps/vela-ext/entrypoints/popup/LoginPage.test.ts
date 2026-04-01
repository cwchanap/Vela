import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises, VueWrapper } from '@vue/test-utils';
import type { ComponentPublicInstance } from 'vue';
import LoginPage from './LoginPage.vue';

const { mockSignIn, mockSaveAuthTokens } = vi.hoisted(() => ({
  mockSignIn: vi.fn(),
  mockSaveAuthTokens: vi.fn(),
}));

vi.mock('../utils/api', () => ({
  signIn: mockSignIn,
}));

vi.mock('../utils/storage', () => ({
  saveAuthTokens: mockSaveAuthTokens,
}));

const storageState: Record<string, unknown> = {};

function setupBrowserMocks() {
  (globalThis as any).browser = {
    storage: {
      local: {
        set: vi.fn(async (data: Record<string, unknown>) => {
          Object.assign(storageState, data);
        }),
        get: vi.fn(async (key: string | string[]) => {
          if (Array.isArray(key)) {
            return key.reduce<Record<string, unknown>>((acc, k) => {
              acc[k] = storageState[k];
              return acc;
            }, {});
          }
          return { [key]: storageState[key] };
        }),
      },
    },
  };
}

describe('LoginPage', () => {
  let wrapper: VueWrapper<ComponentPublicInstance>;

  beforeEach(() => {
    Object.keys(storageState).forEach((k) => delete storageState[k]);
    mockSignIn.mockClear();
    mockSaveAuthTokens.mockClear();
    setupBrowserMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
      wrapper = null as any;
    }
  });

  describe('rendering', () => {
    it('renders the login form', () => {
      wrapper = mount(LoginPage);
      expect(wrapper.find('form').exists()).toBe(true);
      expect(wrapper.find('#email').exists()).toBe(true);
      expect(wrapper.find('#password').exists()).toBe(true);
      expect(wrapper.find('button[type="submit"]').exists()).toBe(true);
    });

    it('shows "Sign In" text on submit button by default', () => {
      wrapper = mount(LoginPage);
      expect(wrapper.find('button[type="submit"]').text()).toBe('Sign In');
    });

    it('renders the page title', () => {
      wrapper = mount(LoginPage);
      expect(wrapper.text()).toContain('Vela Login');
    });

    it('does not show error message initially', () => {
      wrapper = mount(LoginPage);
      expect(wrapper.find('.error-message').exists()).toBe(false);
    });
  });

  describe('theme toggle', () => {
    it('defaults to light mode', async () => {
      wrapper = mount(LoginPage);
      await flushPromises();
      expect(wrapper.find('.login-container').classes()).not.toContain('dark');
    });

    it('loads dark mode from storage when preference is "dark"', async () => {
      storageState.theme_preference = 'dark';
      wrapper = mount(LoginPage);
      await flushPromises();
      expect(wrapper.find('.login-container').classes()).toContain('dark');
    });

    it('toggles to dark mode when theme button is clicked', async () => {
      wrapper = mount(LoginPage);
      await flushPromises();

      const themeBtn = wrapper.find('.theme-toggle');
      await themeBtn.trigger('click');

      expect(wrapper.find('.login-container').classes()).toContain('dark');
    });

    it('toggles back to light mode on second click', async () => {
      wrapper = mount(LoginPage);
      await flushPromises();

      const themeBtn = wrapper.find('.theme-toggle');
      await themeBtn.trigger('click');
      await themeBtn.trigger('click');

      expect(wrapper.find('.login-container').classes()).not.toContain('dark');
    });

    it('persists theme preference to storage on change', async () => {
      wrapper = mount(LoginPage);
      await flushPromises();

      await wrapper.find('.theme-toggle').trigger('click');
      await flushPromises();

      expect(browser.storage.local.set).toHaveBeenCalledWith({ theme_preference: 'dark' });
    });

    it('shows moon emoji in light mode', async () => {
      wrapper = mount(LoginPage);
      await flushPromises();
      expect(wrapper.find('.theme-toggle').text()).toBe('🌙');
    });

    it('shows sun emoji in dark mode', async () => {
      wrapper = mount(LoginPage);
      await flushPromises();

      await wrapper.find('.theme-toggle').trigger('click');

      expect(wrapper.find('.theme-toggle').text()).toBe('☀️');
    });
  });

  describe('form submission', () => {
    const mockTokens = { accessToken: 'acc', refreshToken: 'ref', idToken: 'id' };

    it('calls signIn with email and password on submit', async () => {
      mockSignIn.mockResolvedValue(mockTokens);
      wrapper = mount(LoginPage);
      await flushPromises();

      await wrapper.find('#email').setValue('user@example.com');
      await wrapper.find('#password').setValue('password123');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(mockSignIn).toHaveBeenCalledWith('user@example.com', 'password123');
    });

    it('saves tokens and emits loginSuccess on successful login', async () => {
      mockSignIn.mockResolvedValue(mockTokens);
      mockSaveAuthTokens.mockResolvedValue(undefined);
      wrapper = mount(LoginPage);
      await flushPromises();

      await wrapper.find('#email').setValue('user@example.com');
      await wrapper.find('#password').setValue('pass');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(mockSaveAuthTokens).toHaveBeenCalledWith(mockTokens, 'user@example.com');
      expect(wrapper.emitted('loginSuccess')).toBeTruthy();
    });

    it('shows error message when signIn throws', async () => {
      mockSignIn.mockRejectedValue(new Error('Invalid credentials'));
      wrapper = mount(LoginPage);
      await flushPromises();

      await wrapper.find('#email').setValue('user@example.com');
      await wrapper.find('#password').setValue('wrong');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(wrapper.find('.error-message').exists()).toBe(true);
      expect(wrapper.find('.error-message').text()).toBe('Invalid credentials');
    });

    it('shows generic error when non-Error is thrown', async () => {
      mockSignIn.mockRejectedValue('unexpected');
      wrapper = mount(LoginPage);
      await flushPromises();

      await wrapper.find('#email').setValue('user@example.com');
      await wrapper.find('#password').setValue('pass');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(wrapper.find('.error-message').text()).toBe('Login failed');
    });

    it('shows loading state during sign in', async () => {
      let resolve: (_value: any) => void;
      const promise = new Promise((res) => {
        resolve = res;
      });
      mockSignIn.mockReturnValue(promise);
      wrapper = mount(LoginPage);
      await flushPromises();

      await wrapper.find('#email').setValue('user@example.com');
      await wrapper.find('#password').setValue('pass');

      const submitBtn = wrapper.find('button[type="submit"]');
      wrapper.find('form').trigger('submit');
      await wrapper.vm.$nextTick();

      expect(submitBtn.text()).toBe('Signing in...');
      expect(submitBtn.attributes('disabled')).toBeDefined();

      resolve!(mockTokens);
      await flushPromises();
    });

    it('disables inputs during loading', async () => {
      let resolve: (_value: any) => void;
      const promise = new Promise((res) => {
        resolve = res;
      });
      mockSignIn.mockReturnValue(promise);
      wrapper = mount(LoginPage);
      await flushPromises();

      await wrapper.find('#email').setValue('user@example.com');
      await wrapper.find('#password').setValue('pass');

      wrapper.find('form').trigger('submit');
      await wrapper.vm.$nextTick();

      expect(wrapper.find('#email').attributes('disabled')).toBeDefined();
      expect(wrapper.find('#password').attributes('disabled')).toBeDefined();

      resolve!(mockTokens);
      await flushPromises();
    });

    it('re-enables submit button after failed login', async () => {
      mockSignIn.mockRejectedValue(new Error('Failed'));
      wrapper = mount(LoginPage);
      await flushPromises();

      await wrapper.find('#email').setValue('user@example.com');
      await wrapper.find('#password').setValue('pass');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      const submitBtn = wrapper.find('button[type="submit"]');
      expect(submitBtn.text()).toBe('Sign In');
      expect(submitBtn.attributes('disabled')).toBeUndefined();
    });

    it('shows validation error when email is empty', async () => {
      wrapper = mount(LoginPage);
      await flushPromises();

      await wrapper.find('#password').setValue('pass');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(wrapper.find('.error-message').exists()).toBe(true);
      expect(wrapper.find('.error-message').text()).toContain('email and password');
      expect(mockSignIn).not.toHaveBeenCalled();
    });

    it('shows validation error when password is empty', async () => {
      wrapper = mount(LoginPage);
      await flushPromises();

      await wrapper.find('#email').setValue('user@example.com');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(wrapper.find('.error-message').exists()).toBe(true);
      expect(wrapper.find('.error-message').text()).toContain('email and password');
      expect(mockSignIn).not.toHaveBeenCalled();
    });
  });
});

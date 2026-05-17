import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises, VueWrapper } from '@vue/test-utils';
import type { ComponentPublicInstance } from 'vue';
import LoginPage from '../../entrypoints/popup/LoginPage.vue';

const { mockImportWebappSession, mockOpenWebappLogin, mockGetWebappLoginUrl } = vi.hoisted(() => ({
  mockImportWebappSession: vi.fn(),
  mockOpenWebappLogin: vi.fn(),
  mockGetWebappLoginUrl: vi.fn(),
}));

vi.mock('../../entrypoints/utils/webappSession', () => ({
  importWebappSession: mockImportWebappSession,
  openWebappLogin: mockOpenWebappLogin,
  getWebappLoginUrl: mockGetWebappLoginUrl,
}));

const { mockClearExplicitSignout } = vi.hoisted(() => ({
  mockClearExplicitSignout: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../entrypoints/utils/storage', () => ({
  clearExplicitSignout: mockClearExplicitSignout,
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
  let wrapper: VueWrapper<ComponentPublicInstance> | null = null;

  beforeEach(() => {
    Object.keys(storageState).forEach((k) => delete storageState[k]);
    mockImportWebappSession.mockReset();
    mockOpenWebappLogin.mockReset();
    mockGetWebappLoginUrl.mockReset().mockReturnValue('https://vela.cwchanap.dev/auth/login');
    mockClearExplicitSignout.mockClear().mockResolvedValue(undefined);
    setupBrowserMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
      wrapper = null;
    }
  });

  describe('rendering', () => {
    it('renders a web-app login redirect URL instead of an extension credential form', () => {
      wrapper = mount(LoginPage);

      expect(wrapper.text()).toContain('https://vela.cwchanap.dev/auth/login');
      expect(wrapper.find('form').exists()).toBe(false);
      expect(wrapper.find('#email').exists()).toBe(false);
      expect(wrapper.find('#password').exists()).toBe(false);
      expect(wrapper.find('button[type="submit"]').exists()).toBe(false);
    });

    it('renders the page title', () => {
      wrapper = mount(LoginPage);
      expect(wrapper.text()).toContain('Sign in on Vela');
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

    it('persists theme preference to storage on change', async () => {
      wrapper = mount(LoginPage);
      await flushPromises();

      await wrapper.find('.theme-toggle').trigger('click');
      await flushPromises();

      expect(browser.storage.local.set).toHaveBeenCalledWith({ theme_preference: 'dark' });
    });
  });

  describe('web-app session actions', () => {
    it('opens the web-app login URL when requested', async () => {
      wrapper = mount(LoginPage);
      await flushPromises();

      await wrapper.find('.open-webapp-button').trigger('click');
      await flushPromises();

      expect(mockOpenWebappLogin).toHaveBeenCalledOnce();
    });

    it('shows error when opening webapp login fails', async () => {
      mockOpenWebappLogin.mockRejectedValue(new Error('tabs.create failed'));
      wrapper = mount(LoginPage);
      await flushPromises();

      await wrapper.find('.open-webapp-button').trigger('click');
      await flushPromises();

      expect(wrapper.find('.error-message').text()).toBe('tabs.create failed');
    });

    it('imports the web-app session when the user has signed in there', async () => {
      mockImportWebappSession.mockResolvedValue(true);
      wrapper = mount(LoginPage);
      await flushPromises();

      await wrapper.find('.web-session-button').trigger('click');
      await flushPromises();

      expect(mockImportWebappSession).toHaveBeenCalledOnce();
      expect(mockClearExplicitSignout).toHaveBeenCalledOnce();
      expect(wrapper.emitted('loginSuccess')).toBeTruthy();
    });

    it('does not clear explicit signout flag when import fails', async () => {
      mockImportWebappSession.mockResolvedValue(false);
      wrapper = mount(LoginPage);
      await flushPromises();

      await wrapper.find('.web-session-button').trigger('click');
      await flushPromises();

      expect(mockClearExplicitSignout).not.toHaveBeenCalled();
    });

    it('shows a readable message when no web-app session can be imported', async () => {
      mockImportWebappSession.mockResolvedValue(false);
      wrapper = mount(LoginPage);
      await flushPromises();

      await wrapper.find('.web-session-button').trigger('click');
      await flushPromises();

      expect(wrapper.find('.error-message').text()).toContain('Sign in at the URL above');
      expect(wrapper.emitted('loginSuccess')).toBeUndefined();
    });

    it('shows refresh loading state while checking for the web-app session', async () => {
      let resolve: (_value: boolean) => void = () => {};
      mockImportWebappSession.mockReturnValue(
        new Promise<boolean>((promiseResolve) => {
          resolve = promiseResolve;
        }),
      );
      wrapper = mount(LoginPage);
      await flushPromises();

      const importButton = wrapper.find('.web-session-button');
      await importButton.trigger('click');
      await wrapper.vm.$nextTick();

      expect(importButton.text()).toBe('Checking...');
      expect(importButton.attributes('disabled')).toBeDefined();

      resolve(true);
      await flushPromises();
    });
  });
});

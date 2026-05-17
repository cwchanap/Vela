import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { mockIsAuthenticated, mockImportWebappSession, mockClearAuthData, mockIsExplicitSignout } =
  vi.hoisted(() => ({
    mockIsAuthenticated: vi.fn(),
    mockImportWebappSession: vi.fn(),
    mockClearAuthData: vi.fn(),
    mockIsExplicitSignout: vi.fn(),
  }));

vi.mock('../../entrypoints/utils/storage', () => ({
  isAuthenticated: mockIsAuthenticated,
  clearAuthData: mockClearAuthData,
  isExplicitSignout: mockIsExplicitSignout,
}));

vi.mock('../../entrypoints/utils/webappSession', () => ({
  importWebappSession: mockImportWebappSession,
}));

vi.mock('../../entrypoints/popup/LoginPage.vue', () => ({
  default: {
    name: 'LoginPage',
    emits: ['loginSuccess'],
    template: '<div data-testid="login-page" />',
  },
}));

vi.mock('../../entrypoints/popup/DashboardPage.vue', () => ({
  default: {
    name: 'DashboardPage',
    emits: ['sessionExpired'],
    template: '<div data-testid="dashboard-page" />',
  },
}));

import App from '../../entrypoints/popup/App.vue';

describe('popup App', () => {
  beforeEach(() => {
    mockIsAuthenticated.mockReset();
    mockImportWebappSession.mockReset();
    mockClearAuthData.mockReset().mockResolvedValue(undefined);
    mockIsExplicitSignout.mockReset().mockResolvedValue(false);

    (globalThis as any).browser = {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue(undefined),
      },
    };
  });

  it('uses an existing extension session when present', async () => {
    mockIsAuthenticated.mockResolvedValue(true);

    const wrapper = mount(App);
    await flushPromises();

    expect(wrapper.find('[data-testid="dashboard-page"]').exists()).toBe(true);
    expect(mockImportWebappSession).not.toHaveBeenCalled();
  });

  it('imports an open web-app session before showing the login page', async () => {
    mockIsAuthenticated.mockResolvedValue(false);
    mockImportWebappSession.mockResolvedValue(true);

    const wrapper = mount(App);
    await flushPromises();

    expect(mockImportWebappSession).toHaveBeenCalledOnce();
    expect(wrapper.find('[data-testid="dashboard-page"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="login-page"]').exists()).toBe(false);
  });

  it('sends LOGIN_SUCCESS to background after successful auto-import', async () => {
    mockIsAuthenticated.mockResolvedValue(false);
    mockImportWebappSession.mockResolvedValue(true);

    mount(App);
    await flushPromises();

    expect((globalThis as any).browser.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'LOGIN_SUCCESS',
    });
  });

  it('does not send LOGIN_SUCCESS when no session is imported', async () => {
    mockIsAuthenticated.mockResolvedValue(false);
    mockImportWebappSession.mockResolvedValue(false);

    mount(App);
    await flushPromises();

    expect((globalThis as any).browser.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('logs error and recovers when initialisation throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockIsAuthenticated.mockRejectedValue(new Error('Storage corrupted'));

    const wrapper = mount(App);
    await flushPromises();

    expect(consoleSpy).toHaveBeenCalledWith(
      '[Vela] Failed to initialise session:',
      expect.any(Error),
    );
    // Loading should complete even after error
    expect(wrapper.find('[data-testid="login-page"]').exists()).toBe(true);
    expect(wrapper.find('.loading').exists()).toBe(false);

    consoleSpy.mockRestore();
  });

  it('returns to the redirect page when the dashboard reports an expired session', async () => {
    mockIsAuthenticated.mockResolvedValue(true);

    const wrapper = mount(App);
    await flushPromises();

    wrapper.findComponent({ name: 'DashboardPage' }).vm.$emit('sessionExpired');
    await flushPromises();

    expect(wrapper.find('[data-testid="login-page"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="dashboard-page"]').exists()).toBe(false);
    expect(mockClearAuthData).toHaveBeenCalledOnce();
  });

  it('logs error when clearAuthData fails during session expiry', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockIsAuthenticated.mockResolvedValue(true);
    mockClearAuthData.mockRejectedValue(new Error('Storage corrupted'));

    const wrapper = mount(App);
    await flushPromises();

    wrapper.findComponent({ name: 'DashboardPage' }).vm.$emit('sessionExpired');
    await flushPromises();

    expect(wrapper.find('[data-testid="login-page"]').exists()).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(
      '[Vela] Failed to clear auth data on session expiry:',
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });

  it('skips web-app auto-import when the user explicitly signed out', async () => {
    mockIsAuthenticated.mockResolvedValue(false);
    mockIsExplicitSignout.mockResolvedValue(true);

    const wrapper = mount(App);
    await flushPromises();

    expect(mockImportWebappSession).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="login-page"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="dashboard-page"]').exists()).toBe(false);
  });

  it('attempts web-app auto-import when explicit signout flag is not set', async () => {
    mockIsAuthenticated.mockResolvedValue(false);
    mockIsExplicitSignout.mockResolvedValue(false);
    mockImportWebappSession.mockResolvedValue(false);

    const wrapper = mount(App);
    await flushPromises();

    expect(mockImportWebappSession).toHaveBeenCalledOnce();
    expect(wrapper.find('[data-testid="login-page"]').exists()).toBe(true);
  });
});

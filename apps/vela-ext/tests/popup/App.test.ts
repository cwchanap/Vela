import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';

const { mockIsAuthenticated, mockImportWebappSession } = vi.hoisted(() => ({
  mockIsAuthenticated: vi.fn(),
  mockImportWebappSession: vi.fn(),
}));

vi.mock('../../entrypoints/utils/storage', () => ({
  isAuthenticated: mockIsAuthenticated,
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
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="login-page"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="dashboard-page"]').exists()).toBe(false);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useThemeStore } from 'src/stores/theme';
import { useAuthStore } from 'src/stores/auth';

// Mock Quasar Dark module
vi.mock('quasar', () => ({
  Dark: {
    set: vi.fn(),
    isActive: false,
  },
  LocalStorage: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    set: vi.fn(),
    has: vi.fn(() => false),
  },
}));

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

describe('boot/main', () => {
  let pinia: ReturnType<typeof createPinia>;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
  });

  it('should initialize theme store', async () => {
    const themeStore = useThemeStore();
    const initializeSpy = vi.spyOn(themeStore, 'initialize');

    const { default: mainBoot } = await import('./main');
    await mainBoot({ store: pinia });

    expect(initializeSpy).toHaveBeenCalledOnce();
  });

  it('should subscribe to auth store changes', async () => {
    const authStore = useAuthStore();
    const subscribeSpy = vi.spyOn(authStore, '$subscribe');

    const { default: mainBoot } = await import('./main');
    await mainBoot({ store: pinia });

    expect(subscribeSpy).toHaveBeenCalledOnce();
    expect(subscribeSpy).toHaveBeenCalledWith(expect.any(Function));
  });

  it('should sync theme when user.preferences.darkMode is defined', async () => {
    const authStore = useAuthStore();
    const themeStore = useThemeStore();
    const syncSpy = vi.spyOn(themeStore, 'syncWithUserPreferences');
    const subscribeSpy = vi.spyOn(authStore, '$subscribe');

    const { default: mainBoot } = await import('./main');
    await mainBoot({ store: pinia });

    // Get the subscription callback
    const subscribeCallback = subscribeSpy.mock.calls[0][0];

    // Simulate auth state change with darkMode preference
    const mutation = {} as any;
    const state = {
      user: {
        preferences: {
          darkMode: true,
        },
      },
    } as any;

    subscribeCallback(mutation, state);

    expect(syncSpy).toHaveBeenCalledWith(true);
  });

  it('should not sync theme when user.preferences.darkMode is undefined', async () => {
    const authStore = useAuthStore();
    const themeStore = useThemeStore();
    const syncSpy = vi.spyOn(themeStore, 'syncWithUserPreferences');
    const subscribeSpy = vi.spyOn(authStore, '$subscribe');

    const { default: mainBoot } = await import('./main');
    await mainBoot({ store: pinia });

    // Get the subscription callback
    const subscribeCallback = subscribeSpy.mock.calls[0][0];

    // Clear previous calls
    syncSpy.mockClear();

    // Simulate auth state change without darkMode preference
    const mutation = {} as any;
    const stateWithoutDarkMode = {
      user: {
        preferences: {},
      },
    } as any;

    subscribeCallback(mutation, stateWithoutDarkMode);

    expect(syncSpy).not.toHaveBeenCalled();
  });

  it('should not sync theme when user is undefined', async () => {
    const authStore = useAuthStore();
    const themeStore = useThemeStore();
    const syncSpy = vi.spyOn(themeStore, 'syncWithUserPreferences');
    const subscribeSpy = vi.spyOn(authStore, '$subscribe');

    const { default: mainBoot } = await import('./main');
    await mainBoot({ store: pinia });

    // Get the subscription callback
    const subscribeCallback = subscribeSpy.mock.calls[0][0];

    // Clear previous calls
    syncSpy.mockClear();

    // Simulate auth state change without user
    const mutation = {} as any;
    const stateWithoutUser = {
      user: null,
    } as any;

    subscribeCallback(mutation, stateWithoutUser);

    expect(syncSpy).not.toHaveBeenCalled();
  });
});

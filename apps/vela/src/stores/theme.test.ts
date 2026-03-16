import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// Mock Quasar Dark and LocalStorage
const mockDark = { set: vi.fn() };
const mockLocalStorage = {
  set: vi.fn(),
  has: vi.fn(() => false),
  getItem: vi.fn(() => null),
};

vi.mock('quasar', () => ({
  Dark: mockDark,
  LocalStorage: mockLocalStorage,
}));

const mockAuthStore = {
  user: null as null | { id: string; preferences?: Record<string, unknown> },
  updatePreferences: vi.fn(),
};

vi.mock('./auth', () => ({
  useAuthStore: () => mockAuthStore,
}));

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
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

describe('useThemeStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockAuthStore.user = null;
    mockLocalStorage.has.mockReturnValue(false);
    mockLocalStorage.getItem.mockReturnValue(null);
  });

  describe('initial state', () => {
    it('has darkMode false by default', async () => {
      const { useThemeStore } = await import('./theme');
      const store = useThemeStore();
      expect(store.darkMode).toBe(false);
      expect(store.initialized).toBe(false);
    });
  });

  describe('computed: isDark', () => {
    it('reflects darkMode state', async () => {
      const { useThemeStore } = await import('./theme');
      const store = useThemeStore();
      expect(store.isDark).toBe(false);
      store.setDarkMode(true);
      expect(store.isDark).toBe(true);
    });
  });

  describe('computed: themeLabel', () => {
    it('returns "Light" when not dark', async () => {
      const { useThemeStore } = await import('./theme');
      const store = useThemeStore();
      expect(store.themeLabel).toBe('Light');
    });

    it('returns "Dark" when dark', async () => {
      const { useThemeStore } = await import('./theme');
      const store = useThemeStore();
      store.setDarkMode(true);
      expect(store.themeLabel).toBe('Dark');
    });
  });

  describe('setDarkMode', () => {
    it('sets dark mode and calls Quasar Dark.set', async () => {
      const { useThemeStore } = await import('./theme');
      const store = useThemeStore();
      store.setDarkMode(true);
      expect(store.darkMode).toBe(true);
      expect(mockDark.set).toHaveBeenCalledWith(true);
      expect(mockLocalStorage.set).toHaveBeenCalledWith('vela-dark-mode', true);
    });

    it('can disable dark mode', async () => {
      const { useThemeStore } = await import('./theme');
      const store = useThemeStore();
      store.setDarkMode(true);
      store.setDarkMode(false);
      expect(store.darkMode).toBe(false);
      expect(mockDark.set).toHaveBeenLastCalledWith(false);
    });
  });

  describe('toggle', () => {
    it('toggles dark mode on', async () => {
      const { useThemeStore } = await import('./theme');
      const store = useThemeStore();
      expect(store.darkMode).toBe(false);
      store.toggle();
      expect(store.darkMode).toBe(true);
    });

    it('toggles dark mode off', async () => {
      const { useThemeStore } = await import('./theme');
      const store = useThemeStore();
      store.setDarkMode(true);
      store.toggle();
      expect(store.darkMode).toBe(false);
    });
  });

  describe('initialize', () => {
    it('uses user preferences when logged in', async () => {
      const { useThemeStore } = await import('./theme');
      mockAuthStore.user = { id: 'user-1', preferences: { darkMode: true } };
      const store = useThemeStore();
      store.initialize();
      expect(store.darkMode).toBe(true);
      expect(store.initialized).toBe(true);
    });

    it('falls back to localStorage when no user preferences', async () => {
      const { useThemeStore } = await import('./theme');
      mockLocalStorage.has.mockReturnValue(true);
      mockLocalStorage.getItem.mockReturnValue(true);
      const store = useThemeStore();
      store.initialize();
      expect(store.darkMode).toBe(true);
      expect(store.initialized).toBe(true);
    });

    it('falls back to system preference when no localStorage', async () => {
      const { useThemeStore } = await import('./theme');
      (window.matchMedia as ReturnType<typeof vi.fn>).mockImplementation((query: string) => ({
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      const store = useThemeStore();
      store.initialize();
      expect(store.darkMode).toBe(true);
      expect(store.initialized).toBe(true);
    });

    it('does not re-initialize if already initialized', async () => {
      const { useThemeStore } = await import('./theme');
      const store = useThemeStore();
      store.initialized = true;
      const callsBefore = mockDark.set.mock.calls.length;
      store.initialize();
      expect(mockDark.set.mock.calls.length).toBe(callsBefore); // no new calls
    });
  });

  describe('syncWithUserPreferences', () => {
    it('updates dark mode when preference provided', async () => {
      const { useThemeStore } = await import('./theme');
      const store = useThemeStore();
      store.syncWithUserPreferences(true);
      expect(store.darkMode).toBe(true);
    });

    it('does nothing when preference is undefined', async () => {
      const { useThemeStore } = await import('./theme');
      const store = useThemeStore();
      store.setDarkMode(false);
      store.syncWithUserPreferences(undefined);
      expect(store.darkMode).toBe(false);
      // Dark.set was called once by setDarkMode but not by syncWithUserPreferences
    });
  });

  describe('saveToUserPreferences', () => {
    it('calls updatePreferences when user is logged in', async () => {
      const { useThemeStore } = await import('./theme');
      mockAuthStore.user = { id: 'user-1' };
      mockAuthStore.updatePreferences.mockResolvedValue(true);
      const store = useThemeStore();
      store.setDarkMode(true);
      await store.saveToUserPreferences();
      expect(mockAuthStore.updatePreferences).toHaveBeenCalledWith({ darkMode: true });
    });

    it('does nothing when no user', async () => {
      const { useThemeStore } = await import('./theme');
      const store = useThemeStore();
      await store.saveToUserPreferences();
      expect(mockAuthStore.updatePreferences).not.toHaveBeenCalled();
    });
  });
});

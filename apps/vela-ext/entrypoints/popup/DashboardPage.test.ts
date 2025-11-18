import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, VueWrapper, flushPromises } from '@vue/test-utils';
import DashboardPage from './DashboardPage.vue';
import type { ComponentPublicInstance } from 'vue';

// Mock dependencies
const { mockGetMyDictionaries } = vi.hoisted(() => {
  return {
    mockGetMyDictionaries: vi.fn(),
  };
});

const { mockGetValidAccessToken, mockRefreshAccessToken, mockGetUserEmail, mockClearAuthData } =
  vi.hoisted(() => {
    return {
      mockGetValidAccessToken: vi.fn(),
      mockRefreshAccessToken: vi.fn(),
      mockGetUserEmail: vi.fn(),
      mockClearAuthData: vi.fn(),
    };
  });

// Define browser mocks
function defineBrowserMocks() {
  const storageState: Record<string, any> = {};

  beforeEach(() => {
    // Reset storage and tabs before each test
    Object.keys(storageState).forEach((key) => delete storageState[key]);

    // Mock all functions
    mockGetMyDictionaries.mockClear();
    mockGetValidAccessToken.mockClear();
    mockRefreshAccessToken.mockClear();
    mockGetUserEmail.mockClear();
    mockClearAuthData.mockClear();

    (globalThis as any).browser = {
      storage: {
        local: {
          set: vi.fn(async (data: Record<string, unknown>) => {
            Object.assign(storageState, data);
          }),
          get: vi.fn(async (key: string | string[]) => {
            if (Array.isArray(key)) {
              return key.reduce<Record<string, unknown>>((acc, current) => {
                acc[current] = storageState[current];
                return acc;
              }, {});
            }
            return { [key]: storageState[key] };
          }),
        },
      },
      tabs: {
        create: vi.fn(async () => {
          return { id: 1 };
        }),
      },
    };
  });

  return { storageState };
}

const { storageState } = defineBrowserMocks();

vi.mock('../utils/api', () => ({
  getMyDictionaries: mockGetMyDictionaries,
}));

vi.mock('../utils/storage', () => ({
  getValidAccessToken: mockGetValidAccessToken,
  refreshAccessToken: mockRefreshAccessToken,
  getUserEmail: mockGetUserEmail,
  clearAuthData: mockClearAuthData,
}));

describe('DashboardPage', () => {
  let wrapper: VueWrapper<ComponentPublicInstance>;

  const mockEntries = [
    {
      sentence_id: '1',
      sentence: 'こんにちは',
      source_url: 'https://example.com/1',
      created_at: 1700000000000,
    },
    {
      sentence_id: '2',
      sentence: 'ありがとう',
      source_url: 'https://example.com/2',
      created_at: 1700000001000,
    },
    {
      sentence_id: '3',
      sentence: 'さようなら',
      source_url: '',
      created_at: 1700000002000,
    },
    {
      sentence_id: '4',
      sentence: 'おはよう',
      source_url: 'https://example.com/4',
      created_at: 1700000003000,
    },
    {
      sentence_id: '5',
      sentence: 'おやすみ',
      source_url: 'https://example.com/5',
      created_at: 1700000004000,
    },
    {
      sentence_id: '6',
      sentence: 'いただきます',
      source_url: 'https://example.com/6',
      created_at: 1700000005000,
    },
  ];

  beforeEach(() => {
    // Set default mock implementations
    mockGetUserEmail.mockResolvedValue('test@example.com');
    mockGetValidAccessToken.mockResolvedValue('valid-token');
    mockGetMyDictionaries.mockResolvedValue(mockEntries);
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe('Component Mounting and Initialization', () => {
    it('should mount successfully', () => {
      wrapper = mount(DashboardPage);
      expect(wrapper.exists()).toBe(true);
    });

    it('should display user email on mount', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      expect(mockGetUserEmail).toHaveBeenCalled();
      expect(wrapper.text()).toContain('test@example.com');
    });

    it('should load dictionary entries on mount', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      expect(mockGetValidAccessToken).toHaveBeenCalled();
      expect(mockGetMyDictionaries).toHaveBeenCalledWith('valid-token');
    });

    it('should load theme preference from storage on mount', async () => {
      storageState.theme_preference = 'dark';

      wrapper = mount(DashboardPage);
      await flushPromises();

      const container = wrapper.find('.dashboard-container');
      expect(container.classes()).toContain('dark');
    });

    it('should default to light theme if no preference is saved', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      const container = wrapper.find('.dashboard-container');
      expect(container.classes()).not.toContain('dark');
    });
  });

  describe('Theme Toggle', () => {
    it('should toggle theme when theme button is clicked', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      // Find the button and trigger click
      const themeButton = wrapper.findAll('.icon-button')[0];
      expect(themeButton.exists()).toBe(true);

      // Trigger the click event
      await themeButton.trigger('click');
      await flushPromises();

      // Wait for all async operations to complete
      await wrapper.vm.$nextTick();
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Verify the dark class is applied
      const container = wrapper.find('.dashboard-container');
      const classes = container.classes();
      expect(classes).toContain('dark');
    });

    it('should persist theme preference to storage when changed', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      const themeButton = wrapper.findAll('.icon-button')[0];
      await themeButton.trigger('click');
      await flushPromises();
      await wrapper.vm.$nextTick();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(browser.storage.local.set).toHaveBeenCalledWith({
        theme_preference: 'dark',
      });
    });

    it('should display correct emoji for light mode', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      const themeButton = wrapper.findAll('.icon-button')[0];
      expect(themeButton.text()).toBe('🌙');
    });

    it('should display correct emoji for dark mode', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      const themeButton = wrapper.findAll('.icon-button')[0];
      await themeButton.trigger('click');
      await flushPromises();
      await wrapper.vm.$nextTick();
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Re-query to get updated text
      const updatedButton = wrapper.findAll('.icon-button')[0];
      expect(updatedButton.text()).toBe('☀️');
    });
  });

  describe('Logout Functionality', () => {
    it('should call clearAuthData when logout button is clicked', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      const logoutButton = wrapper.findAll('.icon-button')[1];
      await logoutButton.trigger('click');

      expect(mockClearAuthData).toHaveBeenCalled();
    });

    it('should emit logout event when logout button is clicked', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      const logoutButton = wrapper.findAll('.icon-button')[1];
      await logoutButton.trigger('click');

      expect(wrapper.emitted('logout')).toBeTruthy();
      expect(wrapper.emitted('logout')?.length).toBe(1);
    });
  });

  describe('Instructions Section', () => {
    it('should render instructions section', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      expect(wrapper.find('.instructions').exists()).toBe(true);
      expect(wrapper.text()).toContain('How to save entries');
    });

    it('should toggle instructions visibility when header is clicked', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      const instructionsHeader = wrapper.find('.instructions-header');

      // Initially collapsed - check via style or v-show attribute
      let instructionsList = wrapper.find('.instructions ol');
      expect(instructionsList.element.style.display).toBe('none');

      // Click to expand
      await instructionsHeader.trigger('click');
      await wrapper.vm.$nextTick();
      instructionsList = wrapper.find('.instructions ol');
      expect(instructionsList.element.style.display).not.toBe('none');

      // Click to collapse
      await instructionsHeader.trigger('click');
      await wrapper.vm.$nextTick();
      instructionsList = wrapper.find('.instructions ol');
      expect(instructionsList.element.style.display).toBe('none');
    });

    it('should display correct collapse icon based on expanded state', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      const instructionsHeader = wrapper.find('.instructions-header');
      const collapseIcon = wrapper.find('.collapse-icon');

      // Initially collapsed
      expect(collapseIcon.text()).toBe('▶');

      // After expanding
      await instructionsHeader.trigger('click');
      await wrapper.vm.$nextTick();
      expect(collapseIcon.text()).toBe('▼');
    });
  });

  describe('Dictionary Entries Display', () => {
    it('should display loading state while fetching entries', async () => {
      let resolvePromise: (_value: any) => void;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockGetMyDictionaries.mockReturnValue(promise);

      wrapper = mount(DashboardPage);
      await wrapper.vm.$nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Check that the refresh button shows "Loading..."
      const refreshButton = wrapper.find('.refresh-button');
      expect(refreshButton.text()).toContain('Loading');

      // Resolve the promise
      resolvePromise!(mockEntries);
      await wrapper.vm.$nextTick();
    });

    it('should display dictionary entries after loading', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      const entries = wrapper.findAll('.entry-item');
      expect(entries.length).toBe(5); // Only first 5 entries
    });

    it('should display only first 5 entries when more than 5 exist', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      const entries = wrapper.findAll('.entry-item');
      expect(entries.length).toBe(5);

      // Verify the 6th entry is not displayed
      const allEntryTexts = entries.map((e) => e.find('.entry-text').text());
      expect(allEntryTexts).not.toContain('いただきます'); // 6th entry
    });

    it('should display empty state when no entries exist', async () => {
      mockGetMyDictionaries.mockResolvedValue([]);

      wrapper = mount(DashboardPage);
      await flushPromises();

      expect(wrapper.find('.empty-state').exists()).toBe(true);
      expect(wrapper.text()).toContain('No dictionary entries yet');
    });

    it('should display entry text correctly', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      const firstEntry = wrapper.findAll('.entry-item')[0];
      expect(firstEntry.text()).toContain('こんにちは');
    });

    it('should display source link when source_url exists', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      const firstEntry = wrapper.findAll('.entry-item')[0];
      const sourceLink = firstEntry.find('.source-link');
      expect(sourceLink.exists()).toBe(true);
      expect(sourceLink.attributes('href')).toBe('https://example.com/1');
    });

    it('should not display source link when source_url is empty', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      const thirdEntry = wrapper.findAll('.entry-item')[2];
      const sourceLink = thirdEntry.find('.source-link');
      expect(sourceLink.exists()).toBe(false);
    });

    it('should format and display entry date', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      const firstEntry = wrapper.findAll('.entry-item')[0];
      const dateElement = firstEntry.find('.entry-date');
      expect(dateElement.exists()).toBe(true);
      // Date formatting is locale-dependent, so just check it exists
      expect(dateElement.text().length).toBeGreaterThan(0);
    });

    it('should display "View All" button when entries exist', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      const viewAllButton = wrapper.find('.view-all-button');
      expect(viewAllButton.exists()).toBe(true);
      expect(viewAllButton.text()).toContain('Open in Web App');
    });

    it('should not display "View All" button when no entries exist', async () => {
      mockGetMyDictionaries.mockResolvedValue([]);

      wrapper = mount(DashboardPage);
      await flushPromises();

      const viewAllButton = wrapper.find('.view-all-button');
      expect(viewAllButton.exists()).toBe(false);
    });
  });

  describe('Refresh Functionality', () => {
    it('should reload entries when refresh button is clicked', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      mockGetMyDictionaries.mockClear();

      const refreshButton = wrapper.find('.refresh-button');
      await refreshButton.trigger('click');

      expect(mockGetMyDictionaries).toHaveBeenCalled();
    });

    it('should disable refresh button while loading', async () => {
      let resolvePromise: (_value: any) => void;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockGetMyDictionaries.mockReturnValue(promise);

      wrapper = mount(DashboardPage);
      await wrapper.vm.$nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const refreshButton = wrapper.find('.refresh-button');
      // The :disabled selector checks if the disabled attribute exists
      expect(refreshButton.attributes()).toHaveProperty('disabled');

      // Resolve the promise
      resolvePromise!(mockEntries);
      await wrapper.vm.$nextTick();
    });
  });

  describe('Error Handling', () => {
    it('should display error message when loading entries fails', async () => {
      mockGetMyDictionaries.mockRejectedValue(new Error('Network error'));

      wrapper = mount(DashboardPage);
      await flushPromises();

      expect(wrapper.find('.error-message').exists()).toBe(true);
      expect(wrapper.text()).toContain('Network error');
    });

    it('should retry with refreshed token on Unauthorized error', async () => {
      mockGetMyDictionaries
        .mockRejectedValueOnce(new Error('Unauthorized'))
        .mockResolvedValueOnce(mockEntries);
      mockRefreshAccessToken.mockResolvedValue('new-token');

      wrapper = mount(DashboardPage);
      await flushPromises();

      expect(mockRefreshAccessToken).toHaveBeenCalled();
      expect(mockGetMyDictionaries).toHaveBeenCalledTimes(2);
      expect(mockGetMyDictionaries).toHaveBeenLastCalledWith('new-token');
    });

    it('should retry with refreshed token on expired token error', async () => {
      mockGetMyDictionaries
        .mockRejectedValueOnce(new Error('expired token'))
        .mockResolvedValueOnce(mockEntries);
      mockRefreshAccessToken.mockResolvedValue('new-token');

      wrapper = mount(DashboardPage);
      await flushPromises();

      expect(mockRefreshAccessToken).toHaveBeenCalled();
      expect(mockGetMyDictionaries).toHaveBeenCalledTimes(2);
    });

    it('should logout user after 2 seconds when session expired', async () => {
      vi.useFakeTimers();

      mockGetMyDictionaries.mockRejectedValue(new Error('Session expired. Please log in again.'));

      wrapper = mount(DashboardPage);
      await flushPromises();
      await vi.runAllTimersAsync();

      expect(wrapper.find('.error-message').exists()).toBe(true);

      // Fast-forward time by 2 seconds
      await vi.advanceTimersByTimeAsync(2000);

      expect(mockClearAuthData).toHaveBeenCalled();
      expect(wrapper.emitted('logout')).toBeTruthy();

      vi.useRealTimers();
    });

    it('should show error when refresh token fails', async () => {
      mockGetMyDictionaries.mockRejectedValue(new Error('Unauthorized'));
      mockRefreshAccessToken.mockResolvedValue(''); // Return empty token to simulate failure

      wrapper = mount(DashboardPage);
      await flushPromises();

      expect(wrapper.find('.error-message').exists()).toBe(true);
    });
  });

  describe('Open Web App', () => {
    it('should open web app when view all button is clicked', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      const viewAllButton = wrapper.find('.view-all-button');
      await viewAllButton.trigger('click');

      expect(browser.tabs.create).toHaveBeenCalled();
      const callArg = (browser.tabs.create as any).mock.calls[0][0];
      expect(callArg.url).toContain('/my-dictionaries');
    });
  });

  describe('Date Formatting', () => {
    it('should format date correctly', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      const firstEntry = wrapper.findAll('.entry-item')[0];
      const dateText = firstEntry.find('.entry-date').text();

      // Just verify that the date is formatted (contains date and time parts)
      expect(dateText).toBeTruthy();
      expect(dateText.length).toBeGreaterThan(0);
    });
  });
});

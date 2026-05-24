import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, VueWrapper, flushPromises } from '@vue/test-utils';
import DashboardPage from '../../entrypoints/popup/DashboardPage.vue';
import type { ComponentPublicInstance } from 'vue';

// Mock dependencies
const { mockGetMyDictionaries } = vi.hoisted(() => ({
  mockGetMyDictionaries: vi.fn(),
}));

const { mockGetPendingQueueCount } = vi.hoisted(() => ({
  mockGetPendingQueueCount: vi.fn(),
}));

const {
  mockGetValidIdToken,
  mockRefreshIdToken,
  mockGetUserEmail,
  mockClearAllPending,
  mockClearAuthData,
  mockSetExplicitSignout,
} = vi.hoisted(() => ({
  mockGetValidIdToken: vi.fn(),
  mockRefreshIdToken: vi.fn(),
  mockGetUserEmail: vi.fn(),
  mockClearAllPending: vi.fn().mockResolvedValue(undefined),
  mockClearAuthData: vi.fn().mockResolvedValue(undefined),
  mockSetExplicitSignout: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../entrypoints/utils/api', () => ({
  getMyDictionaries: mockGetMyDictionaries,
}));

vi.mock('../../entrypoints/utils/pendingQueue', () => ({
  getPendingQueueCount: mockGetPendingQueueCount,
}));

vi.mock('../../entrypoints/utils/storage', () => ({
  getValidIdToken: mockGetValidIdToken,
  refreshIdToken: mockRefreshIdToken,
  getUserEmail: mockGetUserEmail,
  clearAuthData: mockClearAuthData,
  setExplicitSignout: mockSetExplicitSignout,
}));

vi.mock('../../entrypoints/utils/idb', () => ({
  clearAllPending: mockClearAllPending,
}));

describe('DashboardPage', () => {
  let wrapper: VueWrapper<ComponentPublicInstance>;
  const storageState: Record<string, any> = {};

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
    // Reset storage state
    Object.keys(storageState).forEach((key) => delete storageState[key]);

    // Clear all mock functions
    mockGetMyDictionaries.mockClear();
    mockGetValidIdToken.mockClear();
    mockRefreshIdToken.mockClear();
    mockGetUserEmail.mockClear();
    mockClearAllPending.mockClear();
    mockGetPendingQueueCount.mockClear();
    mockClearAuthData.mockClear().mockResolvedValue(undefined);
    mockSetExplicitSignout.mockClear().mockResolvedValue(undefined);

    // Set up browser API mocks
    // Using 'as any' to assign mock implementation to the global browser object in the test environment.
    (globalThis as any).browser = {
      runtime: {
        onMessage: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
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

    // Set default mock implementations
    mockGetUserEmail.mockResolvedValue('test@example.com');
    mockGetValidIdToken.mockResolvedValue('valid-token');
    mockGetMyDictionaries.mockResolvedValue(mockEntries);
    mockGetPendingQueueCount.mockResolvedValue(0);
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
      wrapper = null as any;
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

      expect(mockGetValidIdToken).toHaveBeenCalled();
      expect(mockGetMyDictionaries).toHaveBeenCalledWith('valid-token');
    });

    it('should show the pending queue badge using the mocked queue count', async () => {
      mockGetPendingQueueCount.mockResolvedValueOnce(3);

      wrapper = mount(DashboardPage);
      await flushPromises();

      expect(wrapper.find('.pending-badge').text()).toContain('3');
    });
  });

  describe('Session Actions', () => {
    it('renders a sign-out button that clears auth data and emits sessionExpired', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      const signOutButton = wrapper.find('[title="Sign Out"]');
      expect(signOutButton.exists()).toBe(true);

      await signOutButton.trigger('click');
      await flushPromises();

      expect(mockClearAuthData).toHaveBeenCalledOnce();
      expect(mockSetExplicitSignout).toHaveBeenCalledOnce();
      expect(wrapper.emitted('sessionExpired')).toBeTruthy();
    });

    it('renders sign-out button even when no email is stored', async () => {
      mockGetUserEmail.mockResolvedValue(null);

      wrapper = mount(DashboardPage);
      await flushPromises();

      expect(wrapper.find('[title="Sign Out"]').exists()).toBe(true);
      expect(wrapper.find('.user-pill').exists()).toBe(false);
    });

    it('renders user-pill only when email is available', async () => {
      mockGetUserEmail.mockResolvedValue('user@example.com');

      wrapper = mount(DashboardPage);
      await flushPromises();

      expect(wrapper.find('.user-pill').exists()).toBe(true);
      expect(wrapper.find('.user-pill').text()).toContain('user@example.com');
    });

    it('emits sessionExpired even if clearAuthData fails on sign-out', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockClearAuthData.mockRejectedValue(new Error('Storage corrupted'));

      wrapper = mount(DashboardPage);
      await flushPromises();

      const signOutButton = wrapper.find('[title="Sign Out"]');
      await signOutButton.trigger('click');
      await flushPromises();

      expect(mockClearAuthData).toHaveBeenCalledOnce();
      expect(wrapper.emitted('sessionExpired')).toBeTruthy();
      // setExplicitSignout is always called regardless of clearAuthData outcome
      expect(mockSetExplicitSignout).toHaveBeenCalledOnce();
      expect(consoleSpy).toHaveBeenCalledWith(
        '[Vela] Failed to clear auth data on sign out:',
        expect.any(Error),
      );

      consoleSpy.mockRestore();
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
      let instructionsList = wrapper.find<HTMLElement>('.instructions ol');
      expect(instructionsList.element.style.display).toBe('none');

      // Click to expand
      await instructionsHeader.trigger('click');
      await wrapper.vm.$nextTick();
      instructionsList = wrapper.find<HTMLElement>('.instructions ol');
      expect(instructionsList.element.style.display).not.toBe('none');

      // Click to collapse
      await instructionsHeader.trigger('click');
      await wrapper.vm.$nextTick();
      instructionsList = wrapper.find<HTMLElement>('.instructions ol');
      expect(instructionsList.element.style.display).toBe('none');
    });

    it('should rotate the chevron icon based on expanded state', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      const instructionsHeader = wrapper.find('.instructions-header');
      const chevron = wrapper.find('.instructions-chevron');

      // Initially collapsed — no "open" class
      expect(chevron.classes()).not.toContain('open');

      // After expanding
      await instructionsHeader.trigger('click');
      await wrapper.vm.$nextTick();
      expect(chevron.classes()).toContain('open');
    });

    it('should have ARIA disclosure attributes on the instructions accordion', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      const button = wrapper.find('.instructions-header');
      expect(button.attributes('aria-expanded')).toBe('false');
      expect(button.attributes('aria-controls')).toBe('instructions-panel');

      const panel = wrapper.find('#instructions-panel');
      expect(panel.exists()).toBe(true);
      expect(panel.attributes('role')).toBe('region');

      // Click to expand
      await button.trigger('click');
      await wrapper.vm.$nextTick();
      expect(button.attributes('aria-expanded')).toBe('true');
    });
  });

  describe('Dictionary Entries Display', () => {
    it('should display loading state while fetching entries', async () => {
      let resolvePromise: (_value: any) => void = () => {};
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockGetMyDictionaries.mockReturnValue(promise);

      wrapper = mount(DashboardPage);
      await flushPromises();

      // Check that the refresh button shows "Loading"
      const refreshButton = wrapper.find('.refresh-btn');
      expect(refreshButton.text()).toContain('Loading');

      // Resolve the promise
      resolvePromise(mockEntries);
      await flushPromises();
    });

    it('should display dictionary entries after loading', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      const entries = wrapper.findAll('.entry');
      expect(entries.length).toBe(5); // Only first 5 entries
    });

    it('should display only first 5 entries when more than 5 exist', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      const entries = wrapper.findAll('.entry');
      expect(entries.length).toBe(5);

      // Verify the 6th entry is not displayed
      const allEntryTexts = entries.map((e) => e.find('.entry-sentence').text());
      expect(allEntryTexts).not.toContain('いただきます'); // 6th entry
    });

    it('should display empty state when no entries exist', async () => {
      mockGetMyDictionaries.mockResolvedValue([]);

      wrapper = mount(DashboardPage);
      await flushPromises();

      expect(wrapper.find('.empty-state').exists()).toBe(true);
      expect(wrapper.text()).toContain('No entries yet');
    });

    it('should display entry text correctly', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      const entries = wrapper.findAll('.entry');
      const entryTexts = entries.map((entry) => entry.find('.entry-sentence').text());
      expect(entryTexts).toContain('こんにちは');
    });

    it('should display source link when source_url exists', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      const entries = wrapper.findAll('.entry');
      // Find entry with 'こんにちは' which has a source URL in mockEntries
      const entryWithSource = entries.find(
        (entry) => entry.find('.entry-sentence').text() === 'こんにちは',
      );

      if (!entryWithSource) {
        throw new Error('Expected to find entry with text こんにちは');
      }

      const sourceLink = entryWithSource.find('.source-link');
      expect(sourceLink.exists()).toBe(true);
      expect(sourceLink.attributes('href')).toBe('https://example.com/1');
    });

    it('should not display source link when source_url is empty', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      const entries = wrapper.findAll('.entry');
      // Find entry with 'さようなら' which has no source URL in mockEntries
      const entryWithoutSource = entries.find(
        (entry) => entry.find('.entry-sentence').text() === 'さようなら',
      );

      if (!entryWithoutSource) {
        throw new Error('Expected to find entry with text さようなら');
      }

      const sourceLink = entryWithoutSource.find('.source-link');
      expect(sourceLink.exists()).toBe(false);
    });

    it('should format and display entry date', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      const entries = wrapper.findAll('.entry');
      expect(entries.length).toBeGreaterThan(0);

      // Check that all entries have date elements
      entries.forEach((entry) => {
        const dateElement = entry.find('.entry-date');
        expect(dateElement.exists()).toBe(true);
        // Date formatting is locale-dependent, so just check it exists
        expect(dateElement.text().length).toBeGreaterThan(0);
      });
    });

    it('should display "Open in Web App" button when entries exist', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      const viewAllButton = wrapper.find('.view-all-btn');
      expect(viewAllButton.exists()).toBe(true);
      expect(viewAllButton.text()).toContain('Open in Web App');
    });

    it('should not display "Open in Web App" button when no entries exist', async () => {
      mockGetMyDictionaries.mockResolvedValue([]);

      wrapper = mount(DashboardPage);
      await flushPromises();

      const viewAllButton = wrapper.find('.view-all-btn');
      expect(viewAllButton.exists()).toBe(false);
    });
  });

  describe('Refresh Functionality', () => {
    it('should reload entries when refresh button is clicked', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      mockGetMyDictionaries.mockClear();

      const refreshButton = wrapper.find('.refresh-btn');
      await refreshButton.trigger('click');

      expect(mockGetMyDictionaries).toHaveBeenCalled();
    });

    it('should refresh the pending queue count when entries are refreshed', async () => {
      mockGetPendingQueueCount.mockResolvedValueOnce(2).mockResolvedValueOnce(0);

      wrapper = mount(DashboardPage);
      await flushPromises();
      expect(wrapper.find('.pending-badge').text()).toContain('2');

      const refreshButton = wrapper.find('.refresh-btn');
      await refreshButton.trigger('click');
      await flushPromises();

      expect(mockGetPendingQueueCount).toHaveBeenCalledTimes(2);
      expect(wrapper.find('.pending-badge').exists()).toBe(false);
    });

    it('should refresh the pending queue count when background sync reports queue changes', async () => {
      mockGetPendingQueueCount.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

      wrapper = mount(DashboardPage);
      await flushPromises();
      expect(wrapper.find('.pending-badge').text()).toContain('1');

      const listener = vi.mocked(browser.runtime.onMessage.addListener).mock.calls[0]?.[0] as
        | ((_message: unknown) => void)
        | undefined;
      if (!listener) {
        throw new Error('Expected DashboardPage to register a runtime message listener');
      }

      listener({ type: 'PENDING_QUEUE_UPDATED' });
      await flushPromises();

      expect(mockGetPendingQueueCount).toHaveBeenCalledTimes(2);
      expect(wrapper.find('.pending-badge').exists()).toBe(false);
    });

    it('should disable refresh button while loading', async () => {
      let resolvePromise: (_value: any) => void = () => {};
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      mockGetMyDictionaries.mockReturnValue(promise);

      wrapper = mount(DashboardPage);
      await flushPromises();

      const refreshButton = wrapper.find('.refresh-btn');
      // The :disabled selector checks if the disabled attribute exists
      expect(refreshButton.attributes()).toHaveProperty('disabled');

      // Resolve the promise
      resolvePromise(mockEntries);
      await flushPromises();
    });
  });

  describe('Error Handling', () => {
    it('should display error banner when loading entries fails', async () => {
      mockGetMyDictionaries.mockRejectedValue(new Error('Network error'));

      wrapper = mount(DashboardPage);
      await flushPromises();

      expect(wrapper.find('.error-banner').exists()).toBe(true);
      expect(wrapper.text()).toContain('Network error');
    });

    it('should retry with refreshed token on Unauthorized error', async () => {
      mockGetMyDictionaries
        .mockRejectedValueOnce(new Error('Unauthorized'))
        .mockResolvedValueOnce(mockEntries);
      mockRefreshIdToken.mockResolvedValue('new-token');

      wrapper = mount(DashboardPage);
      await flushPromises();

      expect(mockRefreshIdToken).toHaveBeenCalled();
      expect(mockGetMyDictionaries).toHaveBeenCalledTimes(2);
      expect(mockGetMyDictionaries).toHaveBeenLastCalledWith('new-token');
    });

    it('should retry with refreshed token on expired token error', async () => {
      mockGetMyDictionaries
        .mockRejectedValueOnce(new Error('expired token'))
        .mockResolvedValueOnce(mockEntries);
      mockRefreshIdToken.mockResolvedValue('new-token');

      wrapper = mount(DashboardPage);
      await flushPromises();

      expect(mockRefreshIdToken).toHaveBeenCalled();
      expect(mockGetMyDictionaries).toHaveBeenCalledTimes(2);
    });

    it('reports an expired session after 2 seconds without clearing extension auth data directly', async () => {
      vi.useFakeTimers();

      try {
        mockGetMyDictionaries.mockRejectedValue(new Error('Session expired. Please log in again.'));

        wrapper = mount(DashboardPage);
        await flushPromises();

        expect(wrapper.find('.error-banner').exists()).toBe(true);

        // Fast-forward time by 2 seconds to trigger the expired-session transition
        await vi.advanceTimersByTimeAsync(2000);

        expect(mockClearAllPending).not.toHaveBeenCalled();
        expect(wrapper.emitted('sessionExpired')).toBeTruthy();
      } finally {
        vi.useRealTimers();
      }
    });

    it('should show error when refresh token fails', async () => {
      mockGetMyDictionaries.mockRejectedValue(new Error('Unauthorized'));
      mockRefreshIdToken.mockResolvedValue(''); // Return empty token to simulate failure

      wrapper = mount(DashboardPage);
      await flushPromises();

      expect(wrapper.find('.error-banner').exists()).toBe(true);
    });
  });

  describe('Open Web App', () => {
    it('should open web app when view all button is clicked', async () => {
      wrapper = mount(DashboardPage);
      await flushPromises();

      const viewAllButton = wrapper.find('.view-all-btn');
      await viewAllButton.trigger('click');

      expect(browser.tabs.create).toHaveBeenCalled();
      const callArg = vi.mocked(browser.tabs.create).mock.calls[0][0];
      expect(callArg.url).toContain('/my-dictionaries');
    });
  });
});

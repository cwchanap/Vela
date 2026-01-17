import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { Quasar } from 'quasar';
import SrsStatsCard from './SrsStatsCard.vue';

// Mock srsService
const mockGetStats = vi.fn();
vi.mock('src/services/srsService', () => ({
  srsService: {
    getStats: mockGetStats,
  },
}));

// Mock auth store
const mockAuthStore = {
  isAuthenticated: false,
  user: null,
};

vi.mock('src/stores/auth', () => ({
  useAuthStore: () => mockAuthStore,
}));

describe('SrsStatsCard', () => {
  const mockStats = {
    total_items: 100,
    due_today: 15,
    mastery_breakdown: {
      new: 20,
      learning: 50,
      reviewing: 0,
      mastered: 30,
    },
    average_ease_factor: 2.5,
    total_reviews: 200,
    accuracy_rate: 0.85,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthStore.isAuthenticated = false;
    mockAuthStore.user = null;
    mockGetStats.mockClear();
  });

  function createWrapper() {
    return mount(SrsStatsCard, {
      global: {
        plugins: [Quasar],
        stubs: {
          QBanner: {
            template:
              '<div class="q-banner"><slot /><slot name="avatar" /><slot name="action" /></div>',
          },
          QLinearProgress: true,
        },
      },
    });
  }

  async function createAuthenticatedWrapper(mockStatsResponse = mockStats) {
    mockAuthStore.isAuthenticated = true;
    mockAuthStore.user = { id: 'user-123' } as any;
    mockGetStats.mockResolvedValue(mockStatsResponse);

    const wrapper = createWrapper();
    await flushPromises();
    return wrapper;
  }

  async function createAuthenticatedWrapperWithError(error: Error) {
    mockAuthStore.isAuthenticated = true;
    mockAuthStore.user = { id: 'user-123' } as any;
    mockGetStats.mockRejectedValue(error);

    const wrapper = createWrapper();
    await flushPromises();
    return wrapper;
  }

  it('shows sign-in message when not authenticated', () => {
    mockAuthStore.isAuthenticated = false;
    const wrapper = createWrapper();
    expect(wrapper.text()).toContain('Sign in to track your spaced repetition progress');
  });

  it('fetches stats when authenticated', async () => {
    await createAuthenticatedWrapper();

    expect(mockGetStats).toHaveBeenCalledWith();
  });

  it('displays stats correctly', async () => {
    const wrapper = await createAuthenticatedWrapper();

    expect(wrapper.text()).toContain('100'); // total_items
    expect(wrapper.text()).toContain('30'); // mastery_breakdown.mastered
    expect(wrapper.text()).toContain('50'); // mastery_breakdown.learning
    expect(wrapper.text()).toContain('20'); // mastery_breakdown.new
  });

  it('shows due items alert when items are due', async () => {
    const wrapper = await createAuthenticatedWrapper();

    expect(wrapper.text()).toContain('15 words due for review');
  });

  it('calculates mastery percentage correctly', async () => {
    const wrapper = await createAuthenticatedWrapper();

    // 30 mastered out of 100 total = 30%
    expect(wrapper.text()).toContain('30%');
  });

  it('shows empty state when no words', async () => {
    const emptyStats = {
      total_items: 0,
      due_today: 0,
      mastery_breakdown: {
        new: 0,
        learning: 0,
        reviewing: 0,
        mastered: 0,
      },
      average_ease_factor: 0,
      total_reviews: 0,
      accuracy_rate: 0,
    };
    const wrapper = await createAuthenticatedWrapper(emptyStats);

    expect(wrapper.text()).toContain('Start learning vocabulary to build your SRS progress');
  });

  it('displays average ease factor', async () => {
    const wrapper = await createAuthenticatedWrapper();

    expect(wrapper.text()).toContain('2.50');
  });

  it('does not show empty state when progress exists but average_ease_factor is 0', async () => {
    const statsWithZeroEaseFactor = {
      total_items: 10,
      due_today: 0,
      mastery_breakdown: {
        new: 10,
        learning: 0,
        reviewing: 0,
        mastered: 0,
      },
      average_ease_factor: 0,
      total_reviews: 0,
      accuracy_rate: 0,
    };
    const wrapper = await createAuthenticatedWrapper(statsWithZeroEaseFactor);

    // Should show stats, not empty state
    expect(wrapper.text()).not.toContain('Start learning vocabulary to build your SRS progress');
    expect(wrapper.text()).toContain('10'); // total_items
    expect(wrapper.text()).toContain('0.00'); // ease factor
  });

  it('eventually displays stats after loading', async () => {
    const wrapper = await createAuthenticatedWrapper();

    // After loading, should show stats not loading
    expect(wrapper.text()).not.toContain('Loading SRS stats');
    expect(wrapper.text()).toContain('100'); // total_items
  });

  it('handles fetch error gracefully', async () => {
    const wrapper = await createAuthenticatedWrapperWithError(new Error('API Error'));

    // Should show error state with error message and retry button
    expect(wrapper.text()).toContain('Failed to load your SRS stats');
    expect(wrapper.text()).toContain('Retry');
  });
});

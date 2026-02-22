import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VueQueryPlugin, QueryClient } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { flushPromises } from '@vue/test-utils';

const mockProgressService = {
  getProgressAnalytics: vi.fn(),
  recordGameSession: vi.fn(),
};

vi.mock('src/services/progressService', () => ({ progressService: mockProgressService }));

function withQueryClient<T>(composableFn: () => T): { result: T; queryClient: QueryClient } {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  let result!: T;
  const Wrapper = defineComponent({
    setup() {
      result = composableFn();
      return {};
    },
    template: '<div />',
  });
  mount(Wrapper, { global: { plugins: [[VueQueryPlugin, { queryClient }]] } });
  return { result, queryClient };
}

describe('useProgressQueries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('progressKeys', () => {
    it('generates correct all key', async () => {
      const { progressKeys } = await import('./useProgressQueries');
      expect(progressKeys.all).toEqual(['progress']);
    });

    it('generates correct analytics key for a user', async () => {
      const { progressKeys } = await import('./useProgressQueries');
      expect(progressKeys.analytics('user-123')).toEqual(['progress', 'analytics', 'user-123']);
    });

    it('generates correct analytics key for null userId', async () => {
      const { progressKeys } = await import('./useProgressQueries');
      expect(progressKeys.analytics(null)).toEqual(['progress', 'analytics', null]);
    });
  });

  describe('useProgressAnalyticsQuery', () => {
    it('is disabled when userId is null', async () => {
      const { useProgressAnalyticsQuery } = await import('./useProgressQueries');
      const { result } = withQueryClient(() => useProgressAnalyticsQuery(null));
      expect(result).toBeDefined();
      expect(mockProgressService.getProgressAnalytics).not.toHaveBeenCalled();
    });

    it('is disabled when userId is undefined', async () => {
      const { useProgressAnalyticsQuery } = await import('./useProgressQueries');
      const { result } = withQueryClient(() => useProgressAnalyticsQuery(undefined));
      expect(result).toBeDefined();
      expect(mockProgressService.getProgressAnalytics).not.toHaveBeenCalled();
    });

    it('returns a query object when userId is provided', async () => {
      mockProgressService.getProgressAnalytics.mockResolvedValue([]);
      const { useProgressAnalyticsQuery } = await import('./useProgressQueries');
      const { result } = withQueryClient(() => useProgressAnalyticsQuery('user-123'));
      expect(result).toBeDefined();
      expect(typeof result.isPending).toBe('object');
    });

    it('calls getProgressAnalytics when userId is provided', async () => {
      mockProgressService.getProgressAnalytics.mockResolvedValue([]);
      const { useProgressAnalyticsQuery } = await import('./useProgressQueries');
      withQueryClient(() => useProgressAnalyticsQuery('user-123'));
      await flushPromises();
      expect(mockProgressService.getProgressAnalytics).toHaveBeenCalled();
    });
  });

  describe('useRecordGameSessionMutation', () => {
    it('calls progressService.recordGameSession with all required fields', async () => {
      mockProgressService.recordGameSession.mockResolvedValueOnce({ success: true });
      const { useRecordGameSessionMutation } = await import('./useProgressQueries');
      const { result } = withQueryClient(() => useRecordGameSessionMutation());
      await result.mutateAsync({
        gameType: 'vocabulary',
        score: 80,
        durationSeconds: 120,
        questionsAnswered: 10,
        correctAnswers: 8,
        experienceGained: 50,
      });
      expect(mockProgressService.recordGameSession).toHaveBeenCalledWith(
        'vocabulary',
        80,
        120,
        10,
        8,
        50,
      );
    });

    it('invalidates progress queries on success', async () => {
      mockProgressService.recordGameSession.mockResolvedValueOnce({ success: true });
      const { useRecordGameSessionMutation } = await import('./useProgressQueries');
      const { result, queryClient } = withQueryClient(() => useRecordGameSessionMutation());
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      await result.mutateAsync({
        gameType: 'vocabulary',
        score: 80,
        durationSeconds: 120,
        questionsAnswered: 10,
        correctAnswers: 8,
        experienceGained: 50,
      });
      expect(invalidateSpy).toHaveBeenCalled();
    });

    it('returns mutation object with mutateAsync', async () => {
      const { useRecordGameSessionMutation } = await import('./useProgressQueries');
      const { result } = withQueryClient(() => useRecordGameSessionMutation());
      expect(typeof result.mutateAsync).toBe('function');
    });
  });
});

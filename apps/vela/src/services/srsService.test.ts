import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { srsService } from './srsService';
import type { UserVocabularyProgress, Vocabulary } from 'src/types/database';

// Mock the API utility
vi.mock('src/utils/api', () => ({
  getApiUrl: vi.fn((endpoint: string) => `/api/${endpoint}`),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('srsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockAccessToken = 'mock-access-token';

  const mockVocabulary: Vocabulary = {
    id: 'vocab-1',
    japanese_word: '猫',
    hiragana: 'ねこ',
    romaji: 'neko',
    english_translation: 'cat',
    difficulty_level: 1,
    category: 'animals',
    created_at: '2024-01-01T00:00:00Z',
    jlpt_level: 5,
  };

  const mockProgress: UserVocabularyProgress = {
    user_id: 'user-123',
    vocabulary_id: 'vocab-1',
    next_review_date: '2024-01-02T00:00:00Z',
    ease_factor: 2.5,
    interval: 1,
    repetitions: 1,
    last_quality: 4,
    last_reviewed_at: '2024-01-01T00:00:00Z',
    first_learned_at: '2024-01-01T00:00:00Z',
    total_reviews: 1,
    correct_count: 1,
  };

  describe('getDueItems', () => {
    it('should fetch due vocabulary items with default limit', async () => {
      const mockResponse = {
        items: [{ progress: mockProgress, vocabulary: mockVocabulary }],
        total: 1,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      const result = await srsService.getDueItems(mockAccessToken);

      expect(mockFetch).toHaveBeenCalledWith('/api/srs/due?limit=20', {
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${mockAccessToken}`,
        },
      });
      expect(result).toEqual(mockResponse);
    });

    it('should fetch due items with custom limit', async () => {
      const mockResponse = { items: [], total: 0 };

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      await srsService.getDueItems(mockAccessToken, 10);

      expect(mockFetch).toHaveBeenCalledWith('/api/srs/due?limit=10', {
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${mockAccessToken}`,
        },
      });
    });

    it('should filter by JLPT levels', async () => {
      const mockResponse = { items: [], total: 0 };

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      await srsService.getDueItems(mockAccessToken, 20, [5, 4]);

      expect(mockFetch).toHaveBeenCalledWith('/api/srs/due?limit=20&jlpt=5,4', {
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${mockAccessToken}`,
        },
      });
    });

    it('should throw error on API failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Unauthorized',
        json: vi.fn().mockResolvedValue({ error: 'Invalid token' }),
      });

      await expect(srsService.getDueItems(mockAccessToken)).rejects.toThrow('Invalid token');
    });
  });

  describe('getStats', () => {
    it('should fetch SRS statistics', async () => {
      const mockStats = {
        total_items: 100,
        due_today: 15,
        mastery_breakdown: {
          new: 50,
          learning: 30,
          reviewing: 15,
          mastered: 5,
        },
        average_ease_factor: 2.4,
        total_reviews: 500,
        accuracy_rate: 0.85,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockStats),
      });

      const result = await srsService.getStats(mockAccessToken);

      expect(mockFetch).toHaveBeenCalledWith('/api/srs/stats', {
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${mockAccessToken}`,
        },
      });
      expect(result).toEqual(mockStats);
    });

    it('should throw error when fetching stats fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Server Error',
        json: vi.fn().mockRejectedValue(new Error('Parse error')),
      });

      await expect(srsService.getStats(mockAccessToken)).rejects.toThrow('Server Error');
    });
  });

  describe('recordReview', () => {
    it('should record a review with quality rating', async () => {
      const mockResult = {
        progress: {
          ...mockProgress,
          repetitions: 2,
          interval: 6,
          next_review_date: '2024-01-07T00:00:00Z',
        },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResult),
      });

      const result = await srsService.recordReview(mockAccessToken, 'vocab-1', 4);

      expect(mockFetch).toHaveBeenCalledWith('/api/srs/review', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${mockAccessToken}`,
        },
        body: JSON.stringify({ vocabulary_id: 'vocab-1', quality: 4 }),
      });
      expect(result).toEqual(mockResult);
    });

    it('should throw error on review failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Bad Request',
        json: vi.fn().mockResolvedValue({ error: 'Invalid quality rating' }),
      });

      await expect(srsService.recordReview(mockAccessToken, 'vocab-1', 6)).rejects.toThrow(
        'Invalid quality rating',
      );
    });
  });

  describe('recordBatchReview', () => {
    it('should record multiple reviews at once', async () => {
      const reviews = [
        { vocabulary_id: 'vocab-1', quality: 4 },
        { vocabulary_id: 'vocab-2', quality: 3 },
      ];

      const mockResult = {
        results: [
          { vocabulary_id: 'vocab-1', success: true },
          { vocabulary_id: 'vocab-2', success: true },
        ],
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResult),
      });

      const result = await srsService.recordBatchReview(mockAccessToken, reviews);

      expect(mockFetch).toHaveBeenCalledWith('/api/srs/batch-review', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${mockAccessToken}`,
        },
        body: JSON.stringify({ reviews }),
      });
      expect(result).toEqual(mockResult);
    });
  });

  describe('getProgress', () => {
    it('should fetch progress for a specific vocabulary', async () => {
      const vocabularyId = 'vocab/1';
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ progress: mockProgress }),
      });

      const result = await srsService.getProgress(mockAccessToken, vocabularyId);

      expect(mockFetch).toHaveBeenCalledWith('/api/srs/progress/vocab%2F1', {
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${mockAccessToken}`,
        },
      });
      expect(result).toEqual({ progress: mockProgress });
    });

    it('should return null progress for new vocabulary', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ progress: null }),
      });

      const result = await srsService.getProgress(mockAccessToken, 'new-vocab');

      expect(result.progress).toBeNull();
    });
  });

  describe('deleteProgress', () => {
    it('should delete progress for a vocabulary', async () => {
      const vocabularyId = 'vocab/1';
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true }),
      });

      const result = await srsService.deleteProgress(mockAccessToken, vocabularyId);

      expect(mockFetch).toHaveBeenCalledWith('/api/srs/progress/vocab%2F1', {
        method: 'DELETE',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${mockAccessToken}`,
        },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('qualityFromCorrectness', () => {
    it('should return 4 for correct answers', () => {
      expect(srsService.qualityFromCorrectness(true)).toBe(4);
    });

    it('should return 1 for incorrect answers', () => {
      expect(srsService.qualityFromCorrectness(false)).toBe(1);
    });

    it('should return 5 for perfect answers with fast response', () => {
      expect(srsService.qualityFromCorrectness(true, true)).toBe(5);
    });

    it('should return 3 for correct but hesitant answers', () => {
      expect(srsService.qualityFromCorrectness(true, false, true)).toBe(3);
    });

    it('should return 2 for incorrect but close answers', () => {
      expect(srsService.qualityFromCorrectness(false, false, false, true)).toBe(2);
    });

    it('should return 0 for complete blackout', () => {
      expect(srsService.qualityFromCorrectness(false, false, false, false, true)).toBe(0);
    });
  });
});

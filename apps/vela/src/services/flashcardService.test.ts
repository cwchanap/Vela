import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flashcardService } from './flashcardService';
import { srsService } from './srsService';
import type { Vocabulary, UserVocabularyProgress } from 'src/types/database';
import type { ReviewInput } from './srsService';

// Mock API utility
vi.mock('src/utils/api', () => ({
  getApiUrl: vi.fn((endpoint: string) => `/api/${endpoint}`),
}));

// Mock srsService
vi.mock('./srsService', () => ({
  srsService: {
    getDueItems: vi.fn(),
    getStats: vi.fn(),
    recordReview: vi.fn(),
    recordBatchReview: vi.fn(),
  },
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('flashcardService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const mockVocabulary: Vocabulary = {
    id: 'vocab-1',
    japanese_word: '猫',
    hiragana: 'ねこ',
    romaji: 'neko',
    english_translation: 'cat',
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

  describe('getVocabularyForCram', () => {
    it('should fetch vocabulary with default limit', async () => {
      const mockResponse = {
        vocabulary: [mockVocabulary],
        filters: { jlpt_levels: 'all', limit: 20 },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      const result = await flashcardService.getVocabularyForCram();

      expect(mockFetch).toHaveBeenCalledWith('/api/games/vocabulary?limit=20');
      expect(result).toEqual([mockVocabulary]);
    });

    it('should fetch vocabulary with custom limit', async () => {
      const mockResponse = {
        vocabulary: [mockVocabulary],
        filters: { jlpt_levels: 'all', limit: 10 },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      await flashcardService.getVocabularyForCram(10);

      expect(mockFetch).toHaveBeenCalledWith('/api/games/vocabulary?limit=10');
    });

    it('should filter by JLPT levels', async () => {
      const mockResponse = {
        vocabulary: [mockVocabulary],
        filters: { jlpt_levels: [5, 4], limit: 20 },
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockResponse),
      });

      await flashcardService.getVocabularyForCram(20, [5, 4]);

      expect(mockFetch).toHaveBeenCalledWith('/api/games/vocabulary?limit=20&jlpt=5,4');
    });

    it('should throw error on API failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Server Error',
      });

      await expect(flashcardService.getVocabularyForCram()).rejects.toThrow(
        'Failed to fetch vocabulary',
      );
    });
  });

  describe('getVocabularyForSRS', () => {
    it('should fetch due vocabulary from SRS service', async () => {
      const mockDueResponse = {
        items: [{ progress: mockProgress, vocabulary: mockVocabulary }],
        total: 1,
      };

      vi.mocked(srsService.getDueItems).mockResolvedValue(mockDueResponse);

      const result = await flashcardService.getVocabularyForSRS();

      expect(srsService.getDueItems).toHaveBeenCalledWith(20, undefined);
      expect(result.vocabulary).toEqual([mockVocabulary]);
      expect(result.totalDue).toBe(1);
    });

    it('should pass limit and JLPT filter to SRS service', async () => {
      const mockDueResponse = {
        items: [],
        total: 0,
      };

      vi.mocked(srsService.getDueItems).mockResolvedValue(mockDueResponse);

      await flashcardService.getVocabularyForSRS(10, [5, 4]);

      expect(srsService.getDueItems).toHaveBeenCalledWith(10, [5, 4]);
    });

    it('should filter out null vocabulary items', async () => {
      const mockDueResponse = {
        items: [
          { progress: mockProgress, vocabulary: mockVocabulary },
          { progress: mockProgress, vocabulary: null as any },
        ],
        total: 2,
      };

      vi.mocked(srsService.getDueItems).mockResolvedValue(mockDueResponse);

      const result = await flashcardService.getVocabularyForSRS();

      expect(result.vocabulary).toHaveLength(1);
      expect(result.vocabulary[0].id).toBe('vocab-1');
    });
  });

  describe('validateAnswer', () => {
    it('should return true for correct japanese_word', () => {
      expect(flashcardService.validateAnswer('猫', mockVocabulary)).toBe(true);
    });

    it('should return true for correct hiragana', () => {
      expect(flashcardService.validateAnswer('ねこ', mockVocabulary)).toBe(true);
    });

    it('should return true for correct romaji', () => {
      expect(flashcardService.validateAnswer('neko', mockVocabulary)).toBe(true);
    });

    it('should be case insensitive', () => {
      expect(flashcardService.validateAnswer('NEKO', mockVocabulary)).toBe(true);
    });

    it('should trim whitespace', () => {
      expect(flashcardService.validateAnswer('  neko  ', mockVocabulary)).toBe(true);
    });

    it('should return false for incorrect answer', () => {
      expect(flashcardService.validateAnswer('wrong', mockVocabulary)).toBe(false);
    });

    it('should return false for empty answer', () => {
      expect(flashcardService.validateAnswer('', mockVocabulary)).toBe(false);
      expect(flashcardService.validateAnswer('   ', mockVocabulary)).toBe(false);
    });

    it('should handle vocabulary without optional fields', () => {
      const minimalVocab: Vocabulary = {
        id: 'vocab-2',
        japanese_word: '犬',
        english_translation: 'dog',
        created_at: '2024-01-01T00:00:00Z',
      };

      expect(flashcardService.validateAnswer('犬', minimalVocab)).toBe(true);
      expect(flashcardService.validateAnswer('neko', minimalVocab)).toBe(false);
    });

    it('should check katakana if available', () => {
      const vocabWithKatakana: Vocabulary = {
        ...mockVocabulary,
        katakana: 'ネコ',
      };

      expect(flashcardService.validateAnswer('ネコ', vocabWithKatakana)).toBe(true);
    });
  });

  describe('recordReview', () => {
    it('should delegate to SRS service', async () => {
      await flashcardService.recordReview('vocab-1', 4);

      expect(srsService.recordReview).toHaveBeenCalledWith('vocab-1', 4);
    });
  });

  describe('recordBatchReview', () => {
    it('should delegate to SRS service', async () => {
      const reviews: ReviewInput[] = [
        { vocabulary_id: 'vocab-1', quality: 4 },
        { vocabulary_id: 'vocab-2', quality: 3 },
      ];

      await flashcardService.recordBatchReview(reviews);

      expect(srsService.recordBatchReview).toHaveBeenCalledWith(reviews);
    });

    it('should not call SRS service for empty array', async () => {
      await flashcardService.recordBatchReview([]);

      expect(srsService.recordBatchReview).not.toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('should delegate to SRS service', async () => {
      const mockStats = {
        total_items: 100,
        due_today: 15,
        mastery_breakdown: { new: 50, learning: 30, reviewing: 15, mastered: 5 },
        average_ease_factor: 2.4,
        total_reviews: 500,
        accuracy_rate: 0.85,
      };

      vi.mocked(srsService.getStats).mockResolvedValue(mockStats);

      const result = await flashcardService.getStats([5, 4]);

      expect(srsService.getStats).toHaveBeenCalledWith([5, 4]);
      expect(result).toEqual(mockStats);
    });
  });
});

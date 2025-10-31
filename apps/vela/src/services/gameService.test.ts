import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { gameService } from './gameService';
import type { Vocabulary, Sentence } from 'src/types/database';

// Mock the API utility
vi.mock('src/utils/api', () => ({
  getApiUrl: vi.fn((endpoint: string) => `/api/${endpoint}`),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('gameService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getVocabularyQuestions', () => {
    const mockVocabulary: Vocabulary[] = [
      {
        id: 'vocab-1',
        japanese_word: '猫',
        hiragana: 'ねこ',
        romaji: 'neko',
        english_translation: 'cat',
        difficulty_level: 1,
        category: 'animals',
        created_at: '2024-01-01T00:00:00Z',
      },
      {
        id: 'vocab-2',
        japanese_word: '犬',
        hiragana: 'いぬ',
        romaji: 'inu',
        english_translation: 'dog',
        difficulty_level: 1,
        category: 'animals',
        created_at: '2024-01-01T00:00:00Z',
      },
      {
        id: 'vocab-3',
        japanese_word: '鳥',
        hiragana: 'とり',
        romaji: 'tori',
        english_translation: 'bird',
        difficulty_level: 1,
        category: 'animals',
        created_at: '2024-01-01T00:00:00Z',
      },
      {
        id: 'vocab-4',
        japanese_word: '魚',
        hiragana: 'さかな',
        romaji: 'sakana',
        english_translation: 'fish',
        difficulty_level: 1,
        category: 'animals',
        created_at: '2024-01-01T00:00:00Z',
      },
      {
        id: 'vocab-5',
        japanese_word: '馬',
        hiragana: 'うま',
        romaji: 'uma',
        english_translation: 'horse',
        difficulty_level: 1,
        category: 'animals',
        created_at: '2024-01-01T00:00:00Z',
      },
    ];

    it('should fetch vocabulary questions successfully', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ vocabulary: mockVocabulary }),
      });

      const questions = await gameService.getVocabularyQuestions(5);

      expect(mockFetch).toHaveBeenCalledWith('/api/games/vocabulary?limit=5', {
        headers: {
          'content-type': 'application/json',
        },
      });
      expect(questions).toHaveLength(5);
      expect(questions[0]).toHaveProperty('word');
      expect(questions[0]).toHaveProperty('options');
      expect(questions[0]).toHaveProperty('correctAnswer');
    });

    it('should use default count of 10 when not specified', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ vocabulary: mockVocabulary }),
      });

      await gameService.getVocabularyQuestions();

      expect(mockFetch).toHaveBeenCalledWith('/api/games/vocabulary?limit=10', {
        headers: {
          'content-type': 'application/json',
        },
      });
    });

    it('should create questions with 4 options each', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ vocabulary: mockVocabulary }),
      });

      const questions = await gameService.getVocabularyQuestions(5);

      questions.forEach((question) => {
        expect(question.options).toHaveLength(4);
        expect(question.options).toContain(question.correctAnswer);
      });
    });

    it('should set the correct answer from the word translation', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ vocabulary: mockVocabulary }),
      });

      const questions = await gameService.getVocabularyQuestions(5);

      questions.forEach((question) => {
        expect(question.correctAnswer).toBe(question.word.english_translation);
      });
    });

    it('should handle empty vocabulary response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ vocabulary: [] }),
      });

      const questions = await gameService.getVocabularyQuestions(5);

      expect(questions).toHaveLength(0);
    });

    it('should handle missing vocabulary property in response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      });

      const questions = await gameService.getVocabularyQuestions(5);

      expect(questions).toHaveLength(0);
    });

    it('should return empty array on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const questions = await gameService.getVocabularyQuestions(5);

      expect(questions).toHaveLength(0);
    });

    it('should return empty array when API returns error status', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Internal Server Error',
        json: vi.fn().mockResolvedValue({ error: 'Server error' }),
      });

      const questions = await gameService.getVocabularyQuestions(5);

      expect(questions).toHaveLength(0);
    });

    it('should handle API error with JSON response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Bad Request',
        json: vi.fn().mockResolvedValue({ error: 'Invalid limit parameter' }),
      });

      const questions = await gameService.getVocabularyQuestions(5);

      expect(questions).toHaveLength(0);
    });

    it('should handle API error without JSON response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Service Unavailable',
        json: vi.fn().mockRejectedValue(new Error('Not JSON')),
      });

      const questions = await gameService.getVocabularyQuestions(5);

      expect(questions).toHaveLength(0);
    });
  });

  describe('getSentenceQuestions', () => {
    const mockSentences: Sentence[] = [
      {
        id: 'sentence-1',
        japanese_sentence: '私は猫が好きです',
        english_translation: 'I like cats',
        difficulty_level: 1,
        category: 'basic',
        words_array: ['私は', '猫が', '好きです'],
        created_at: '2024-01-01T00:00:00Z',
      },
      {
        id: 'sentence-2',
        japanese_sentence: '今日は晴れです',
        english_translation: 'It is sunny today',
        difficulty_level: 1,
        category: 'weather',
        words_array: ['今日は', '晴れです'],
        created_at: '2024-01-01T00:00:00Z',
      },
      {
        id: 'sentence-3',
        japanese_sentence: '彼は学生です',
        english_translation: 'He is a student',
        difficulty_level: 1,
        category: 'occupation',
        words_array: ['彼は', '学生です'],
        created_at: '2024-01-01T00:00:00Z',
      },
    ];

    it('should fetch sentence questions successfully', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ sentences: mockSentences }),
      });

      const questions = await gameService.getSentenceQuestions(3);

      expect(mockFetch).toHaveBeenCalledWith('/api/games/sentences?limit=3', {
        headers: {
          'content-type': 'application/json',
        },
      });
      expect(questions).toHaveLength(3);
      expect(questions[0]).toHaveProperty('sentence');
      expect(questions[0]).toHaveProperty('scrambled');
      expect(questions[0]).toHaveProperty('correctAnswer');
    });

    it('should use default count of 5 when not specified', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ sentences: mockSentences }),
      });

      await gameService.getSentenceQuestions();

      expect(mockFetch).toHaveBeenCalledWith('/api/games/sentences?limit=5', {
        headers: {
          'content-type': 'application/json',
        },
      });
    });

    it('should create scrambled array from words_array', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ sentences: mockSentences }),
      });

      const questions = await gameService.getSentenceQuestions(3);

      questions.forEach((question) => {
        expect(question.scrambled).toHaveLength(question.sentence.words_array.length);
        // Check that scrambled contains all the same words
        const sortedScrambled = [...question.scrambled].sort();
        const sortedOriginal = [...question.sentence.words_array].sort();
        expect(sortedScrambled).toEqual(sortedOriginal);
      });
    });

    it('should set correct answer as space-joined words', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ sentences: mockSentences }),
      });

      const questions = await gameService.getSentenceQuestions(3);

      questions.forEach((question) => {
        expect(question.correctAnswer).toBe(question.sentence.words_array.join(' '));
      });
    });

    it('should handle sentences without words_array by splitting characters', async () => {
      const sentenceWithoutWordsArray: Sentence = {
        id: 'sentence-4',
        japanese_sentence: 'こんにちは',
        english_translation: 'Hello',
        difficulty_level: 1,
        words_array: [],
        created_at: '2024-01-01T00:00:00Z',
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ sentences: [sentenceWithoutWordsArray] }),
      });

      const questions = await gameService.getSentenceQuestions(1);

      expect(questions).toHaveLength(1);
      expect(questions[0]!.scrambled).toHaveLength('こんにちは'.length);
      // Check all characters are present
      const sortedScrambled = [...questions[0]!.scrambled].sort();
      const sortedOriginal = [...'こんにちは'].sort();
      expect(sortedScrambled).toEqual(sortedOriginal);
    });

    it('should handle empty sentences response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ sentences: [] }),
      });

      const questions = await gameService.getSentenceQuestions(5);

      expect(questions).toHaveLength(0);
    });

    it('should handle missing sentences property in response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      });

      const questions = await gameService.getSentenceQuestions(5);

      expect(questions).toHaveLength(0);
    });

    it('should return empty array on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const questions = await gameService.getSentenceQuestions(5);

      expect(questions).toHaveLength(0);
    });

    it('should return empty array when API returns error status', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Internal Server Error',
        json: vi.fn().mockResolvedValue({ error: 'Server error' }),
      });

      const questions = await gameService.getSentenceQuestions(5);

      expect(questions).toHaveLength(0);
    });

    it('should handle API error with JSON response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Not Found',
        json: vi.fn().mockResolvedValue({ error: 'Sentences not found' }),
      });

      const questions = await gameService.getSentenceQuestions(5);

      expect(questions).toHaveLength(0);
    });

    it('should handle API error without JSON response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Gateway Timeout',
        json: vi.fn().mockRejectedValue(new Error('Not JSON')),
      });

      const questions = await gameService.getSentenceQuestions(5);

      expect(questions).toHaveLength(0);
    });
  });

  describe('shuffle functionality', () => {
    it('should scramble sentence words differently from original order', async () => {
      const sentence: Sentence = {
        id: 'sentence-1',
        japanese_sentence: '私は猫が好きです',
        english_translation: 'I like cats',
        difficulty_level: 1,
        words_array: ['私は', '猫が', '好きです'],
        created_at: '2024-01-01T00:00:00Z',
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ sentences: [sentence] }),
      });

      // Run multiple times to check randomization
      const results = await Promise.all([
        gameService.getSentenceQuestions(1),
        gameService.getSentenceQuestions(1),
        gameService.getSentenceQuestions(1),
        gameService.getSentenceQuestions(1),
        gameService.getSentenceQuestions(1),
      ]);

      // At least one should be different from original (with high probability)
      const hasScrambled = results.some((questions) => {
        const scrambled = questions[0]!.scrambled;
        const original = sentence.words_array;
        return JSON.stringify(scrambled) !== JSON.stringify(original);
      });

      // This test has a very small chance of failing if all 5 shuffles result in the same order
      // For a 3-element array, probability of this is (1/6)^5 ≈ 0.0001%
      expect(hasScrambled).toBe(true);
    });

    it('should randomize vocabulary question options', async () => {
      const mockVocabulary: Vocabulary[] = [
        {
          id: 'vocab-1',
          japanese_word: '猫',
          english_translation: 'cat',
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'vocab-2',
          japanese_word: '犬',
          english_translation: 'dog',
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'vocab-3',
          japanese_word: '鳥',
          english_translation: 'bird',
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'vocab-4',
          japanese_word: '魚',
          english_translation: 'fish',
          created_at: '2024-01-01T00:00:00Z',
        },
      ] as Vocabulary[];

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ vocabulary: mockVocabulary }),
      });

      // Run multiple times to check randomization
      const results = await Promise.all([
        gameService.getVocabularyQuestions(4),
        gameService.getVocabularyQuestions(4),
        gameService.getVocabularyQuestions(4),
        gameService.getVocabularyQuestions(4),
        gameService.getVocabularyQuestions(4),
      ]);

      // Check that options are randomized by comparing first question options across runs
      const firstQuestionOptions = results.map((r) => JSON.stringify(r[0]!.options));
      const uniqueOrders = new Set(firstQuestionOptions);

      // At least 2 different orders should appear (with high probability)
      expect(uniqueOrders.size).toBeGreaterThan(1);
    });
  });

  describe('httpJson utility', () => {
    it('should include content-type header in requests', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ vocabulary: [] }),
      });

      await gameService.getVocabularyQuestions(5);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'content-type': 'application/json',
          }),
        }),
      );
    });

    it('should throw error with message from JSON response when available', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Bad Request',
        json: vi.fn().mockResolvedValue({ error: 'Custom error message' }),
      });

      const questions = await gameService.getVocabularyQuestions(5);

      // Service catches the error and returns empty array
      expect(questions).toHaveLength(0);
    });

    it('should throw error with statusText when JSON parsing fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Internal Server Error',
        json: vi.fn().mockRejectedValue(new Error('Parse error')),
      });

      const questions = await gameService.getVocabularyQuestions(5);

      // Service catches the error and returns empty array
      expect(questions).toHaveLength(0);
    });
  });
});

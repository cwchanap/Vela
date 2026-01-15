import { describe, it, expect, beforeEach, vi } from 'vitest';
import { savedSentences, userVocabularyProgress, vocabulary, sentences } from '../src/dynamodb';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
}));

// Mock the AWS SDK
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({
      send: mocks.send,
    })),
  },
  PutCommand: vi.fn(),
  QueryCommand: vi.fn(),
  DeleteCommand: vi.fn(),
  UpdateCommand: vi.fn(),
  GetCommand: vi.fn(),
  ScanCommand: vi.fn(),
}));

describe('DynamoDB Operations', () => {
  const mockUserId = 'test-user-123';
  const mockSentence = 'これは日本語の文章です。';
  const mockSourceUrl = 'https://example.com';
  const mockContext = 'Test Page Title';

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.send.mockReset();
  });

  describe('Saved Sentences', () => {
    it('should create a saved sentence with all parameters', async () => {
      mocks.send.mockResolvedValue({});

      const result = await savedSentences.create(
        mockUserId,
        mockSentence,
        mockSourceUrl,
        mockContext,
      );

      expect(result).toBeDefined();
      expect(result?.user_id).toBe(mockUserId);
      expect(result?.sentence).toBe(mockSentence);
      expect(result?.source_url).toBe(mockSourceUrl);
      expect(result?.context).toBe(mockContext);
      expect(result?.sentence_id).toBeDefined();
      expect(result?.created_at).toBeDefined();
      expect(result?.updated_at).toBeDefined();
    });

    it('should create a saved sentence with minimal parameters', async () => {
      mocks.send.mockResolvedValue({});

      const result = await savedSentences.create(mockUserId, mockSentence);

      expect(result).toBeDefined();
      expect(result?.user_id).toBe(mockUserId);
      expect(result?.sentence).toBe(mockSentence);
      expect(result?.source_url).toBeUndefined();
      expect(result?.context).toBeUndefined();
    });

    it('should generate unique sentence IDs', async () => {
      mocks.send.mockResolvedValue({});

      const result1 = await savedSentences.create(mockUserId, mockSentence);
      const result2 = await savedSentences.create(mockUserId, mockSentence);

      expect(result1?.sentence_id).not.toBe(result2?.sentence_id);
    });
  });

  describe('User Vocabulary Progress', () => {
    it('should paginate results when fetching user progress', async () => {
      const item1 = { vocabulary_id: 'vocab-1', user_id: mockUserId, interval: 1 };
      const item2 = { vocabulary_id: 'vocab-2', user_id: mockUserId, interval: 5 };

      // Mock first page response with LastEvaluatedKey
      mocks.send.mockResolvedValueOnce({
        Items: [item1],
        LastEvaluatedKey: { user_id: mockUserId, vocabulary_id: 'vocab-1' },
      });

      // Mock second page response without LastEvaluatedKey
      mocks.send.mockResolvedValueOnce({
        Items: [item2],
      });

      const result = await userVocabularyProgress.getByUser(mockUserId);

      expect(mocks.send).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(2);
      expect(result).toEqual(expect.arrayContaining([item1, item2]));
    });

    it('should handle empty results gracefully', async () => {
      mocks.send.mockResolvedValueOnce({
        Items: [],
      });

      const result = await userVocabularyProgress.getByUser(mockUserId);
      expect(result).toEqual([]);
    });
  });

  describe('Vocabulary getByJlptLevel', () => {
    it('should return empty array when jlptLevels is empty', async () => {
      const result = await vocabulary.getByJlptLevel([], 10);

      // Should not call the database
      expect(mocks.send).not.toHaveBeenCalled();
      // Should return empty array
      expect(result).toEqual([]);
    });

    it('should call scan with filter when jlptLevels has values', async () => {
      const mockItems = [
        { id: 'vocab-1', word: '日本語', jlpt_level: 5 },
        { id: 'vocab-2', word: '勉強', jlpt_level: 5 },
      ];
      mocks.send.mockResolvedValue({
        Items: mockItems,
      });

      const result = await vocabulary.getByJlptLevel([5], 10);

      // Should call scan with filter
      expect(mocks.send).toHaveBeenCalled();
      // Should return items (shuffled but containing all items)
      expect(result).toHaveLength(2);
      expect(result).toEqual(expect.arrayContaining(mockItems));
    });

    it('should stop scanning when scan hard cap is reached', async () => {
      // Simulate sparse matches where DynamoDB scans many items but returns none.
      // The implementation should stop once total scanned reaches 1000.
      mocks.send
        .mockResolvedValueOnce({
          Items: [],
          ScannedCount: 600,
          LastEvaluatedKey: { id: 'lek-1' },
        })
        .mockResolvedValueOnce({
          Items: [],
          ScannedCount: 400,
          LastEvaluatedKey: { id: 'lek-2' },
        });

      const result = await vocabulary.getByJlptLevel([1], 10);

      expect(result).toEqual([]);
      // Should not scan indefinitely; should stop after hitting hard cap.
      expect(mocks.send).toHaveBeenCalledTimes(2);
    });
  });

  describe('Sentences getByJlptLevel', () => {
    it('should return empty array when jlptLevels is empty', async () => {
      const result = await sentences.getByJlptLevel([], 5);

      // Should not call the database
      expect(mocks.send).not.toHaveBeenCalled();
      // Should return empty array
      expect(result).toEqual([]);
    });

    it('should call scan with filter when jlptLevels has values', async () => {
      const mockItems = [
        { id: 'sent-1', sentence: '日本語を勉強します。', jlpt_level: 5 },
        { id: 'sent-2', sentence: 'これは本です。', jlpt_level: 4 },
      ];
      mocks.send.mockResolvedValue({
        Items: mockItems,
      });

      const result = await sentences.getByJlptLevel([4, 5], 5);

      // Should call scan with filter
      expect(mocks.send).toHaveBeenCalled();
      // Should return items (shuffled but containing all items)
      expect(result).toHaveLength(2);
      expect(result).toEqual(expect.arrayContaining(mockItems));
    });

    it('should stop scanning when scan hard cap is reached', async () => {
      mocks.send
        .mockResolvedValueOnce({
          Items: [],
          ScannedCount: 700,
          LastEvaluatedKey: { id: 'lek-1' },
        })
        .mockResolvedValueOnce({
          Items: [],
          ScannedCount: 300,
          LastEvaluatedKey: { id: 'lek-2' },
        });

      const result = await sentences.getByJlptLevel([1], 5);

      expect(result).toEqual([]);
      expect(mocks.send).toHaveBeenCalledTimes(2);
    });
  });
});

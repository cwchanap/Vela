import { describe, it, expect, beforeEach, vi } from 'vitest';
import { savedSentences, userVocabularyProgress } from '../src/dynamodb';

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
});

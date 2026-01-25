import { describe, test, expect, beforeEach, vi } from 'bun:test';

let mockSend: ReturnType<typeof vi.fn>;
let mockScanCommand: ReturnType<typeof vi.fn>;
let mockPutCommand: ReturnType<typeof vi.fn>;
let mockQueryCommand: ReturnType<typeof vi.fn>;
let vocabulary: typeof import('../src/dynamodb').vocabulary;
let sentences: typeof import('../src/dynamodb').sentences;
let savedSentences: typeof import('../src/dynamodb').savedSentences;
let userVocabularyProgress: typeof import('../src/dynamodb').userVocabularyProgress;
const globalMock = globalThis as typeof globalThis & {
  __dynamoMockSend?: ReturnType<typeof vi.fn>;
  __dynamoMockPutCommand?: ReturnType<typeof vi.fn>;
  __dynamoMockQueryCommand?: ReturnType<typeof vi.fn>;
  __dynamoMockScanCommand?: ReturnType<typeof vi.fn>;
};

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn().mockImplementation(() => ({
      send: (...args: any[]) => globalMock.__dynamoMockSend?.(...args),
    })),
  },
  ScanCommand: vi.fn().mockImplementation((input: any) => {
    if (!globalMock.__dynamoMockScanCommand) {
      globalMock.__dynamoMockScanCommand = vi.fn();
    }
    globalMock.__dynamoMockScanCommand(input);
    return { input };
  }),
  PutCommand: vi.fn().mockImplementation((input: any) => {
    if (!globalMock.__dynamoMockPutCommand) {
      globalMock.__dynamoMockPutCommand = vi.fn();
    }
    globalMock.__dynamoMockPutCommand(input);
    return { input };
  }),
  QueryCommand: vi.fn().mockImplementation((input: any) => {
    if (!globalMock.__dynamoMockQueryCommand) {
      globalMock.__dynamoMockQueryCommand = vi.fn();
    }
    globalMock.__dynamoMockQueryCommand(input);
    return { input };
  }),
  GetCommand: vi.fn(),
  BatchGetCommand: vi.fn(),
  UpdateCommand: vi.fn(),
  DeleteCommand: vi.fn(),
}));

({ vocabulary, sentences, savedSentences, userVocabularyProgress } =
  await import('../src/dynamodb'));

describe('DynamoDB Operations', () => {
  const mockUserId = 'test-user-123';

  beforeEach(() => {
    vi.clearAllMocks();
    mockSend = vi.fn();
    mockScanCommand = vi.fn();
    mockPutCommand = vi.fn();
    mockQueryCommand = vi.fn();
    globalMock.__dynamoMockSend = mockSend;
    globalMock.__dynamoMockScanCommand = mockScanCommand;
    globalMock.__dynamoMockPutCommand = mockPutCommand;
    globalMock.__dynamoMockQueryCommand = mockQueryCommand;
  });

  describe('Saved Sentences', () => {
    test('should create a saved sentence with all parameters', async () => {
      mockSend.mockResolvedValue({});

      const result = await savedSentences.create(
        mockUserId,
        'これは日本語の文章です。',
        'https://example.com',
        'Test Page Title',
      );

      expect(mockPutCommand).toHaveBeenCalled();
      expect(mockPutCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'vela-saved-sentences',
          Item: expect.objectContaining({
            user_id: mockUserId,
            sentence: 'これは日本語の文章です。',
            source_url: 'https://example.com',
            context: 'Test Page Title',
          }),
        }),
      );
      expect(result).toBeDefined();
      expect(result.user_id).toBe(mockUserId);
      expect(result.sentence).toBe('これは日本語の文章です。');
      expect(result.source_url).toBe('https://example.com');
      expect(result.context).toBe('Test Page Title');
      expect(result.sentence_id).toBeDefined();
      expect(result.created_at).toBeDefined();
      expect(result.updated_at).toBeDefined();
    });

    test('should create a saved sentence with minimal parameters', async () => {
      mockSend.mockResolvedValue({});

      const result = await savedSentences.create(mockUserId, 'mock sentence');

      expect(mockPutCommand).toHaveBeenCalled();
      expect(mockPutCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'vela-saved-sentences',
          Item: expect.objectContaining({
            user_id: mockUserId,
            sentence: 'mock sentence',
            source_url: undefined,
            context: undefined,
          }),
        }),
      );
      expect(result).toBeDefined();
      expect(result.user_id).toBe(mockUserId);
      expect(result.sentence).toBe('mock sentence');
      expect(result.source_url).toBeUndefined();
      expect(result.context).toBeUndefined();
      expect(result.sentence_id).toBeDefined();
    });

    test('should generate unique sentence IDs', async () => {
      mockSend.mockResolvedValue({});

      const result1 = await savedSentences.create(mockUserId, 'mock sentence');
      const result2 = await savedSentences.create(mockUserId, 'mock sentence');

      expect(mockPutCommand).toHaveBeenCalledTimes(2);
      expect(result1.sentence_id).toBeDefined();
      expect(result2.sentence_id).toBeDefined();
      expect(result1.sentence_id).not.toBe(result2.sentence_id);
    });
  });

  describe('User Vocabulary Progress', () => {
    test('should call getByUser', async () => {
      const mockItems = [
        { vocabulary_id: 'vocab-1', user_id: mockUserId, interval: 1 },
        { vocabulary_id: 'vocab-2', user_id: mockUserId, interval: 5 },
      ];

      mockSend.mockResolvedValue({
        Items: mockItems,
        Count: mockItems.length,
        LastEvaluatedKey: undefined,
      });

      const result = await userVocabularyProgress.getByUser(mockUserId);

      expect(mockQueryCommand).toHaveBeenCalled();
      expect(mockQueryCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'vela-user-vocabulary-progress',
          KeyConditionExpression: 'user_id = :userId',
          ExpressionAttributeValues: {
            ':userId': mockUserId,
          },
        }),
      );
      expect(result).toHaveLength(2);
      expect(result[0].vocabulary_id).toBe('vocab-1');
      expect(result[1].vocabulary_id).toBe('vocab-2');
    });

    test('should handle empty results gracefully', async () => {
      mockSend.mockResolvedValue({
        Items: [],
        Count: 0,
        LastEvaluatedKey: undefined,
      });

      const result = await userVocabularyProgress.getByUser(mockUserId);

      expect(mockQueryCommand).toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe('Vocabulary getByJlptLevel', () => {
    test('should not call database when jlptLevels is empty', async () => {
      const result = await vocabulary.getByJlptLevel([], 10);

      expect(mockSend).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    test('should call getByJlptLevel when jlptLevels has values', async () => {
      const mockItems = [
        { id: 'vocab-1', word: '日本語', jlpt_level: 5 },
        { id: 'vocab-2', word: '勉強', jlpt_level: 5 },
      ];

      mockSend.mockResolvedValueOnce({
        Items: mockItems,
        ScannedCount: mockItems.length,
        LastEvaluatedKey: undefined,
      });

      const result = await vocabulary.getByJlptLevel([5], 10);

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(2);
    });

    test('should respect hard cap when scanning', async () => {
      mockSend
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

      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(result).toEqual([]);
    });
  });

  describe('Sentences getByJlptLevel', () => {
    test('should not call database when jlptLevels is empty', async () => {
      const result = await sentences.getByJlptLevel([], 5);

      expect(mockSend).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });

    test('should call getByJlptLevel when jlptLevels has values', async () => {
      const mockItems = [
        { id: 'sent-1', sentence: '日本語を勉強します。', jlpt_level: 5 },
        { id: 'sent-2', sentence: 'これは本です。', jlpt_level: 4 },
      ];

      mockSend.mockResolvedValueOnce({
        Items: mockItems,
        ScannedCount: mockItems.length,
        LastEvaluatedKey: undefined,
      });

      const result = await sentences.getByJlptLevel([4], 5);

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(2);
    });

    test('should respect hard cap when scanning', async () => {
      mockSend
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

      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(result).toEqual([]);
    });
  });
});

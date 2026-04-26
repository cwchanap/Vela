import { describe, test, expect, beforeEach, vi } from 'bun:test';

let mockSend: ReturnType<typeof vi.fn>;
let mockScanCommand: ReturnType<typeof vi.fn>;
let mockPutCommand: ReturnType<typeof vi.fn>;
let mockQueryCommand: ReturnType<typeof vi.fn>;
let mockBatchWriteCommand: ReturnType<typeof vi.fn>;
let mockGetCommand: ReturnType<typeof vi.fn>;
let mockUpdateCommand: ReturnType<typeof vi.fn>;
let mockDeleteCommand: ReturnType<typeof vi.fn>;
let vocabulary: typeof import('../src/dynamodb').vocabulary;
let sentences: typeof import('../src/dynamodb').sentences;
let savedSentences: typeof import('../src/dynamodb').savedSentences;
let userVocabularyProgress: typeof import('../src/dynamodb').userVocabularyProgress;
let profiles: typeof import('../src/dynamodb').profiles;
let gameSessions: typeof import('../src/dynamodb').gameSessions;
let dailyProgress: typeof import('../src/dynamodb').dailyProgress;
let myDictionaries: typeof import('../src/dynamodb').myDictionaries;
let ttsSettings: typeof import('../src/dynamodb').ttsSettings;
const globalMock = globalThis as typeof globalThis & {
  __dynamoMockSend?: ReturnType<typeof vi.fn>;
  __dynamoMockPutCommand?: ReturnType<typeof vi.fn>;
  __dynamoMockQueryCommand?: ReturnType<typeof vi.fn>;
  __dynamoMockScanCommand?: ReturnType<typeof vi.fn>;
  __dynamoMockBatchWriteCommand?: ReturnType<typeof vi.fn>;
  __dynamoMockGetCommand?: ReturnType<typeof vi.fn>;
  __dynamoMockUpdateCommand?: ReturnType<typeof vi.fn>;
  __dynamoMockDeleteCommand?: ReturnType<typeof vi.fn>;
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
  GetCommand: vi.fn().mockImplementation((input: any) => {
    if (!globalMock.__dynamoMockGetCommand) {
      globalMock.__dynamoMockGetCommand = vi.fn();
    }
    globalMock.__dynamoMockGetCommand(input);
    return { input };
  }),
  BatchGetCommand: vi.fn().mockImplementation((input: any) => {
    return { input };
  }),
  BatchWriteCommand: vi.fn().mockImplementation((input: any) => {
    if (!globalMock.__dynamoMockBatchWriteCommand) {
      globalMock.__dynamoMockBatchWriteCommand = vi.fn();
    }
    globalMock.__dynamoMockBatchWriteCommand(input);
    return { input };
  }),
  UpdateCommand: vi.fn().mockImplementation((input: any) => {
    if (!globalMock.__dynamoMockUpdateCommand) {
      globalMock.__dynamoMockUpdateCommand = vi.fn();
    }
    globalMock.__dynamoMockUpdateCommand(input);
    return { input };
  }),
  DeleteCommand: vi.fn().mockImplementation((input: any) => {
    if (!globalMock.__dynamoMockDeleteCommand) {
      globalMock.__dynamoMockDeleteCommand = vi.fn();
    }
    globalMock.__dynamoMockDeleteCommand(input);
    return { input };
  }),
}));

({
  vocabulary,
  sentences,
  savedSentences,
  userVocabularyProgress,
  profiles,
  gameSessions,
  dailyProgress,
  myDictionaries,
  ttsSettings,
} = await import('../src/dynamodb'));

describe('DynamoDB Operations', () => {
  const mockUserId = 'test-user-123';

  beforeEach(() => {
    vi.clearAllMocks();
    mockSend = vi.fn();
    mockScanCommand = vi.fn();
    mockPutCommand = vi.fn();
    mockQueryCommand = vi.fn();
    mockBatchWriteCommand = vi.fn();
    mockGetCommand = vi.fn();
    mockUpdateCommand = vi.fn();
    mockDeleteCommand = vi.fn();
    globalMock.__dynamoMockSend = mockSend;
    globalMock.__dynamoMockScanCommand = mockScanCommand;
    globalMock.__dynamoMockPutCommand = mockPutCommand;
    globalMock.__dynamoMockQueryCommand = mockQueryCommand;
    globalMock.__dynamoMockBatchWriteCommand = mockBatchWriteCommand;
    globalMock.__dynamoMockGetCommand = mockGetCommand;
    globalMock.__dynamoMockUpdateCommand = mockUpdateCommand;
    globalMock.__dynamoMockDeleteCommand = mockDeleteCommand;
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

    test('should generate time-sortable sentence IDs', async () => {
      mockSend.mockResolvedValue({});
      const timestamp1 = 1_710_000_000_000;
      const timestamp2 = timestamp1 + 1;
      const dateNowSpy = vi.spyOn(Date, 'now');
      dateNowSpy.mockReturnValueOnce(timestamp1).mockReturnValueOnce(timestamp2);

      try {
        const result1 = await myDictionaries.create(mockUserId, 'mock sentence');
        const result2 = await myDictionaries.create(mockUserId, 'another sentence');

        expect(mockPutCommand).toHaveBeenCalledTimes(2);
        expect(result1.sentence_id).toBeDefined();
        expect(result2.sentence_id).toBeDefined();
        // IDs are base-36 zero-padded timestamps with a random suffix to prevent
        // same-millisecond collisions. Format: 12-char timestamp + 8-char random.
        expect(result1.sentence_id).toMatch(/^[0-9a-z]{20}$/);
        expect(result2.sentence_id).toMatch(/^[0-9a-z]{20}$/);
        expect(result1.sentence_id).not.toBe(result2.sentence_id);
        expect(result1.sentence_id < result2.sentence_id).toBe(true);
      } finally {
        dateNowSpy.mockRestore();
      }
    });

    test('should generate different sentence IDs across different milliseconds', async () => {
      mockSend.mockResolvedValue({});
      const timestamp1 = 1_710_000_000_100;
      const timestamp2 = timestamp1 + 1;
      const dateNowSpy = vi.spyOn(Date, 'now');
      dateNowSpy.mockReturnValueOnce(timestamp1).mockReturnValueOnce(timestamp2);

      try {
        const result1 = await myDictionaries.create(mockUserId, 'sentence one');
        const result2 = await myDictionaries.create(mockUserId, 'sentence two');

        expect(result1.sentence_id).not.toBe(result2.sentence_id);
        expect(result1.sentence_id.slice(0, 12)).not.toBe(result2.sentence_id.slice(0, 12));
      } finally {
        dateNowSpy.mockRestore();
      }
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

  describe('Profiles', () => {
    test('should get a profile by userId', async () => {
      const mockProfile = { user_id: mockUserId, email: 'test@example.com', username: 'testuser' };
      mockSend.mockResolvedValueOnce({ Item: mockProfile });

      const result = await profiles.get(mockUserId);

      expect(mockGetCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'vela-profiles',
          Key: { user_id: mockUserId },
        }),
      );
      expect(result).toEqual(mockProfile);
    });

    test('should return undefined when profile not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await profiles.get(mockUserId);
      expect(result).toBeUndefined();
    });

    test('should create a profile', async () => {
      const newProfile = { user_id: mockUserId, email: 'test@example.com' };
      mockSend.mockResolvedValueOnce({});

      const result = await profiles.create(newProfile);

      expect(mockPutCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'vela-profiles',
          Item: newProfile,
        }),
      );
      expect(result).toEqual(newProfile);
    });

    test('should update a profile', async () => {
      const updatedAttrs = { email: 'new@example.com', username: 'newuser' };
      mockSend.mockResolvedValueOnce({ Attributes: { user_id: mockUserId, ...updatedAttrs } });

      const result = await profiles.update(mockUserId, updatedAttrs);

      expect(mockUpdateCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'vela-profiles',
          Key: { user_id: mockUserId },
        }),
      );
      expect(result).toEqual({ user_id: mockUserId, ...updatedAttrs });
    });

    test('should throw on DynamoDB error', async () => {
      const err = new Error('DynamoDB error');
      mockSend.mockRejectedValueOnce(err);

      await expect(profiles.get(mockUserId)).rejects.toThrow('DynamoDB operation failed');
    });

    test('should throw on ConditionalCheckFailedException', async () => {
      const err = Object.assign(new Error('Condition failed'), {
        name: 'ConditionalCheckFailedException',
      });
      mockSend.mockRejectedValueOnce(err);

      await expect(profiles.get(mockUserId)).rejects.toThrow('Item not found or condition not met');
    });
  });

  describe('Vocabulary operations', () => {
    test('should get all vocabulary', async () => {
      const mockItems = [
        { id: 'v1', word: '猫' },
        { id: 'v2', word: '犬' },
      ];
      mockSend.mockResolvedValueOnce({ Items: mockItems });

      const result = await vocabulary.getAll(2);

      expect(mockScanCommand).toHaveBeenCalledWith(
        expect.objectContaining({ TableName: 'vela-vocabulary', Limit: 2 }),
      );
      expect(result).toEqual(mockItems);
    });

    test('should get vocabulary by id', async () => {
      const mockItem = { id: 'v1', word: '猫', jlpt_level: 5 };
      mockSend.mockResolvedValueOnce({ Item: mockItem });

      const result = await vocabulary.getById('v1');

      expect(mockGetCommand).toHaveBeenCalledWith(
        expect.objectContaining({ TableName: 'vela-vocabulary', Key: { id: 'v1' } }),
      );
      expect(result).toEqual(mockItem);
    });

    test('getByIds should return empty map for empty ids', async () => {
      const result = await vocabulary.getByIds([]);
      expect(result).toEqual({});
      expect(mockSend).not.toHaveBeenCalled();
    });

    test('getByIds should fetch and map vocabulary by id', async () => {
      const mockItems = [
        { id: 'v1', word: '猫' },
        { id: 'v2', word: '犬' },
      ];
      mockSend.mockResolvedValueOnce({
        Responses: { 'vela-vocabulary': mockItems },
        UnprocessedKeys: {},
      });

      const result = await vocabulary.getByIds(['v1', 'v2']);

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(result['v1']).toEqual(mockItems[0]);
      expect(result['v2']).toEqual(mockItems[1]);
    });

    test('getRandom should return shuffled items without jlptLevels filter', async () => {
      const mockItems = [
        { id: 'v1', word: '猫' },
        { id: 'v2', word: '犬' },
      ];
      mockSend.mockResolvedValueOnce({ Items: mockItems });

      const result = await vocabulary.getRandom(2);

      expect(mockScanCommand).toHaveBeenCalledWith(
        expect.objectContaining({ TableName: 'vela-vocabulary' }),
      );
      expect(result).toHaveLength(2);
    });

    test('getRandom should filter by jlptLevels when provided', async () => {
      const mockItems = [{ id: 'v1', word: '猫', jlpt_level: 5 }];
      mockSend.mockResolvedValueOnce({
        Items: mockItems,
        ScannedCount: 1,
        LastEvaluatedKey: undefined,
      });

      const result = await vocabulary.getRandom(5, [5]);

      expect(result).toHaveLength(1);
    });

    test('findByWord should paginate until it finds a later-page match', async () => {
      mockSend
        .mockResolvedValueOnce({
          Items: [],
          LastEvaluatedKey: { id: 'page-1' },
        })
        .mockResolvedValueOnce({
          Items: [{ id: 'v2', japanese_word: '食べる', normalized_japanese_word: '食べる' }],
          LastEvaluatedKey: undefined,
        });

      const result = await vocabulary.findByWord('食べる');

      expect(result).toEqual({
        id: 'v2',
        japanese_word: '食べる',
        normalized_japanese_word: '食べる',
      });
      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(mockScanCommand).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          TableName: 'vela-vocabulary',
          FilterExpression: 'normalized_japanese_word = :word',
          ExpressionAttributeValues: { ':word': '食べる' },
        }),
      );
      expect(mockScanCommand).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          TableName: 'vela-vocabulary',
          FilterExpression: 'normalized_japanese_word = :word',
          ExpressionAttributeValues: { ':word': '食べる' },
          ExclusiveStartKey: { id: 'page-1' },
        }),
      );
    });

    test('create should preserve uppercase in word id (no toLowerCase)', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await vocabulary.create({
        japanese_word: 'Tシャツ',
        hiragana: 'ティーシャツ',
        english_translation: 'T-shirt',
        created_at: '2026-04-20T00:00:00.000Z',
      });

      expect(result.item.id).toBe('Tシャツ:ティーシャツ');
      expect(result.item.normalized_japanese_word).toBe('Tシャツ');
    });

    test('create should throw when ConditionalCheckFailedException fires and getById returns undefined', async () => {
      const err = Object.assign(new Error('Condition failed'), {
        name: 'ConditionalCheckFailedException',
      });
      // First call: PutCommand throws; second call: GetCommand returns undefined (Item missing)
      mockSend.mockRejectedValueOnce(err).mockResolvedValueOnce({ Item: undefined });

      await expect(
        vocabulary.create({
          japanese_word: 'Tシャツ',
          hiragana: 'ティーシャツ',
          english_translation: 'T-shirt',
          created_at: '2026-04-20T00:00:00.000Z',
        }),
      ).rejects.toThrow(
        "Vocabulary item 'Tシャツ:ティーシャツ' failed conditional check but could not be retrieved",
      );
    });

    test('create should throw when the retrieved existing item is missing a string id', async () => {
      const err = Object.assign(new Error('Condition failed'), {
        name: 'ConditionalCheckFailedException',
      });
      mockSend.mockRejectedValueOnce(err).mockResolvedValueOnce({
        Item: {
          japanese_word: '食べる',
          normalized_japanese_word: '食べる',
          english_translation: 'to eat',
        },
      });

      await expect(
        vocabulary.create({
          japanese_word: '食べる',
          hiragana: 'たべる',
          english_translation: 'to eat',
          created_at: '2026-04-20T00:00:00.000Z',
        }),
      ).rejects.toThrow(
        "Vocabulary item '食べる:タベル' failed conditional check because the existing item is missing a string id",
      );
    });

    test('create should use a normalized id (with reading) and reuse an existing item on conditional failure', async () => {
      const err = Object.assign(new Error('Condition failed'), {
        name: 'ConditionalCheckFailedException',
      });
      mockSend.mockRejectedValueOnce(err).mockResolvedValueOnce({
        Item: {
          id: '食べる:タベル',
          japanese_word: '食べる',
          normalized_japanese_word: '食べる',
          english_translation: 'to eat',
        },
      });

      const result = await vocabulary.create({
        japanese_word: ' 食べる ',
        hiragana: 'たべる',
        english_translation: 'to eat',
        created_at: '2026-04-19T00:00:00.000Z',
      });

      expect(mockPutCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'vela-vocabulary',
          ConditionExpression: 'attribute_not_exists(id)',
          Item: expect.objectContaining({
            id: '食べる:タベル',
            normalized_japanese_word: '食べる',
          }),
        }),
      );
      expect(mockGetCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'vela-vocabulary',
          Key: { id: '食べる:タベル' },
        }),
      );
      expect(result).toEqual({
        item: expect.objectContaining({
          id: '食べる:タベル',
          normalized_japanese_word: '食べる',
        }),
        created: false,
      });
    });

    test('create should disambiguate homographs by reading', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await vocabulary.create({
        japanese_word: '今日',
        hiragana: 'きょう',
        english_translation: 'today',
        created_at: '2026-04-20T00:00:00.000Z',
      });

      expect(result.item.id).toBe('今日:キョウ');

      mockSend.mockResolvedValueOnce({});
      const result2 = await vocabulary.create({
        japanese_word: '今日',
        hiragana: 'こんにち',
        english_translation: 'hello (formal)',
        created_at: '2026-04-20T00:00:00.000Z',
      });

      expect(result2.item.id).toBe('今日:コンニチ');
      expect(result.item.id).not.toBe(result2.item.id);
    });

    test('create should omit reading from id when hiragana is empty', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await vocabulary.create({
        japanese_word: '猫',
        english_translation: 'cat',
        created_at: '2026-04-20T00:00:00.000Z',
      });

      expect(result.item.id).toBe('猫');
    });

    test('create should produce the same id regardless of hiragana vs katakana reading', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await vocabulary.create({
        japanese_word: '食べる',
        hiragana: 'たべる', // hiragana input
        english_translation: 'to eat',
        created_at: '2026-04-20T00:00:00.000Z',
      });

      expect(result.item.id).toBe('食べる:タベル');

      mockSend.mockResolvedValueOnce({});
      const result2 = await vocabulary.create({
        japanese_word: '食べる',
        hiragana: 'タベル', // katakana input
        english_translation: 'to eat',
        created_at: '2026-04-20T00:00:00.000Z',
      });

      expect(result2.item.id).toBe('食べる:タベル');
      expect(result.item.id).toBe(result2.item.id);
    });
  });

  describe('Sentences operations', () => {
    test('should get all sentences', async () => {
      const mockItems = [{ id: 's1', sentence: '日本語を勉強します。' }];
      mockSend.mockResolvedValueOnce({ Items: mockItems });

      const result = await sentences.getAll(5);

      expect(mockScanCommand).toHaveBeenCalledWith(
        expect.objectContaining({ TableName: 'vela-sentences', Limit: 5 }),
      );
      expect(result).toEqual(mockItems);
    });

    test('should get sentence by id', async () => {
      const mockItem = { id: 's1', sentence: '猫がいます' };
      mockSend.mockResolvedValueOnce({ Item: mockItem });

      const result = await sentences.getById('s1');

      expect(mockGetCommand).toHaveBeenCalledWith(
        expect.objectContaining({ TableName: 'vela-sentences', Key: { id: 's1' } }),
      );
      expect(result).toEqual(mockItem);
    });

    test('getRandom should return shuffled items without filter', async () => {
      const mockItems = [{ id: 's1' }, { id: 's2' }];
      mockSend.mockResolvedValueOnce({ Items: mockItems });

      const result = await sentences.getRandom(5);

      expect(mockScanCommand).toHaveBeenCalledWith(
        expect.objectContaining({ TableName: 'vela-sentences' }),
      );
      expect(result).toHaveLength(2);
    });

    test('getRandom should filter by jlptLevels when provided', async () => {
      const mockItems = [{ id: 's1', jlpt_level: 4 }];
      mockSend.mockResolvedValueOnce({
        Items: mockItems,
        ScannedCount: 1,
        LastEvaluatedKey: undefined,
      });

      const result = await sentences.getRandom(3, [4]);
      expect(result).toHaveLength(1);
    });
  });

  describe('GameSessions', () => {
    test('should create a game session with auto-generated id', async () => {
      mockSend.mockResolvedValueOnce({});
      const session = {
        user_id: mockUserId,
        game_type: 'vocabulary',
        score: 80,
        duration_seconds: 120,
        questions_answered: 10,
        correct_answers: 8,
        experience_gained: 120,
      };

      const result = await gameSessions.create(session);

      expect(mockPutCommand).toHaveBeenCalledWith(
        expect.objectContaining({ TableName: 'vela-game-sessions' }),
      );
      expect(result?.session_id).toBeDefined();
    });

    test('should use provided session_id', async () => {
      mockSend.mockResolvedValueOnce({});
      const session = {
        session_id: 'custom-session-id',
        user_id: mockUserId,
        game_type: 'sentence',
        score: 90,
        duration_seconds: 60,
        questions_answered: 5,
        correct_answers: 5,
        experience_gained: 100,
      };

      const result = await gameSessions.create(session);

      expect(result?.session_id).toBe('custom-session-id');
    });
  });

  describe('DailyProgress', () => {
    test('should get progress by user and date', async () => {
      const mockProgress = { user_id: mockUserId, date: '2024-01-07', experience_gained: 50 };
      mockSend.mockResolvedValueOnce({ Item: mockProgress });

      const result = await dailyProgress.getByUserAndDate(mockUserId, '2024-01-07');

      expect(mockGetCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'vela-daily-progress',
          Key: { user_id: mockUserId, date: '2024-01-07' },
        }),
      );
      expect(result).toEqual(mockProgress);
    });

    test('should create daily progress', async () => {
      mockSend.mockResolvedValueOnce({});
      const progress = {
        user_id: mockUserId,
        date: '2024-01-07',
        vocabulary_studied: 10,
        sentences_completed: 5,
        time_spent_minutes: 20,
        experience_gained: 100,
        games_played: 3,
        accuracy_percentage: 80,
      };

      const result = await dailyProgress.create(progress);

      expect(mockPutCommand).toHaveBeenCalledWith(
        expect.objectContaining({ TableName: 'vela-daily-progress', Item: progress }),
      );
      expect(result).toEqual(progress);
    });

    test('should update daily progress', async () => {
      const updatedAttrs = { vocabulary_studied: 15, experience_gained: 150 };
      mockSend.mockResolvedValueOnce({
        Attributes: { user_id: mockUserId, date: '2024-01-07', ...updatedAttrs },
      });

      const result = await dailyProgress.update(mockUserId, '2024-01-07', updatedAttrs);

      expect(mockUpdateCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'vela-daily-progress',
          Key: { user_id: mockUserId, date: '2024-01-07' },
        }),
      );
      expect(result).toEqual(expect.objectContaining(updatedAttrs));
    });

    test('should return null for empty updates', async () => {
      const result = await dailyProgress.update(mockUserId, '2024-01-07', {});
      expect(result).toBeNull();
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('MyDictionaries', () => {
    test('should create a dictionary entry with all fields', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await myDictionaries.create(
        mockUserId,
        'これは猫です',
        'https://example.com',
        'Page title',
      );

      expect(mockPutCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'vela-saved-sentences',
          Item: expect.objectContaining({
            user_id: mockUserId,
            sentence: 'これは猫です',
            source_url: 'https://example.com',
            context: 'Page title',
          }),
        }),
      );
      expect(result?.user_id).toBe(mockUserId);
      expect(result?.sentence_id).toBeDefined();
    });

    test('should create a dictionary entry with minimal fields', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await myDictionaries.create(mockUserId, '猫がいる');

      expect(result?.source_url).toBeUndefined();
      expect(result?.context).toBeUndefined();
    });

    test('should get entries by user', async () => {
      const mockItems = [{ user_id: mockUserId, sentence_id: 'sent-1', sentence: '猫がいる' }];
      mockSend.mockResolvedValueOnce({ Items: mockItems });

      const result = await myDictionaries.getByUser(mockUserId);

      expect(mockQueryCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'vela-saved-sentences',
          KeyConditionExpression: 'user_id = :userId',
        }),
      );
      expect(result).toHaveLength(1);
    });

    test('should delete a dictionary entry', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await myDictionaries.delete(mockUserId, 'sent-1');

      expect(mockDeleteCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'vela-saved-sentences',
          Key: { user_id: mockUserId, sentence_id: 'sent-1' },
        }),
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe('TTS Settings', () => {
    test('should get TTS settings by userId', async () => {
      const mockTtsSettings = {
        user_id: mockUserId,
        provider: 'elevenlabs',
        api_key: 'key-123',
        voice_id: 'voice-1',
        model: null,
      };
      mockSend.mockResolvedValueOnce({ Item: mockTtsSettings });

      const result = await ttsSettings.get(mockUserId);

      expect(mockGetCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'vela-tts-settings',
          Key: { user_id: mockUserId },
        }),
      );
      expect(result).toEqual(mockTtsSettings);
    });

    test('should put TTS settings', async () => {
      mockSend.mockResolvedValueOnce({});
      const settings = {
        user_id: mockUserId,
        provider: 'elevenlabs',
        api_key: 'new-key',
        voice_id: 'voice-2',
        model: 'eleven_monolingual_v1',
      };

      await ttsSettings.put(settings);

      expect(mockUpdateCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'vela-tts-settings',
          Key: { user_id: mockUserId },
        }),
      );
    });

    test('should throw when user_id missing', async () => {
      await expect(
        ttsSettings.put({
          user_id: '',
          provider: 'elevenlabs',
          api_key: 'key',
          voice_id: null,
          model: null,
        }),
      ).rejects.toThrow('user_id is required');
    });
  });

  describe('UserVocabularyProgress extended', () => {
    test('should get a specific progress record', async () => {
      const mockItem = {
        user_id: mockUserId,
        vocabulary_id: 'vocab-1',
        next_review_date: '2024-01-14T00:00:00Z',
        ease_factor: 2.5,
        interval: 5,
        repetitions: 2,
        first_learned_at: '2024-01-01T00:00:00Z',
        total_reviews: 3,
        correct_count: 2,
      };
      mockSend.mockResolvedValueOnce({ Item: mockItem });

      const result = await userVocabularyProgress.get(mockUserId, 'vocab-1');

      expect(mockGetCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'vela-user-vocabulary-progress',
          Key: { user_id: mockUserId, vocabulary_id: 'vocab-1' },
        }),
      );
      expect(result).toEqual(mockItem);
    });

    test('should get due items for a user', async () => {
      const mockItems = [
        {
          user_id: mockUserId,
          vocabulary_id: 'vocab-1',
          next_review_date: '2024-01-01T00:00:00Z',
          ease_factor: 2.5,
          interval: 1,
          repetitions: 1,
          first_learned_at: '2024-01-01',
          total_reviews: 1,
          correct_count: 1,
        },
      ];
      mockSend.mockResolvedValueOnce({ Items: mockItems, LastEvaluatedKey: undefined });

      const result = await userVocabularyProgress.getDueItems(mockUserId, new Date('2024-01-07'));

      expect(mockQueryCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'vela-user-vocabulary-progress',
          IndexName: 'NextReviewDateIndex',
        }),
      );
      expect(result).toHaveLength(1);
    });

    test('should put a progress record', async () => {
      mockSend.mockResolvedValueOnce({});
      const progress = {
        user_id: mockUserId,
        vocabulary_id: 'vocab-1',
        next_review_date: '2024-01-14T00:00:00Z',
        ease_factor: 2.5,
        interval: 7,
        repetitions: 2,
        first_learned_at: '2024-01-01T00:00:00Z',
        total_reviews: 2,
        correct_count: 2,
      };

      const result = await userVocabularyProgress.put(progress);

      expect(mockPutCommand).toHaveBeenCalledWith(
        expect.objectContaining({ TableName: 'vela-user-vocabulary-progress', Item: progress }),
      );
      expect(result).toEqual(progress);
    });

    test('should initialize progress for new vocabulary', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await userVocabularyProgress.initializeProgress(
        mockUserId,
        'vocab-new',
        '2024-01-08T00:00:00Z',
      );

      expect(result.user_id).toBe(mockUserId);
      expect(result.vocabulary_id).toBe('vocab-new');
      expect(result.ease_factor).toBe(2.5);
      expect(result.interval).toBe(0);
      expect(result.repetitions).toBe(0);
      expect(result.total_reviews).toBe(0);
      expect(result.correct_count).toBe(0);
    });

    test('should initialize progress conditionally for new vocabulary', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await userVocabularyProgress.initializeProgressIfNotExists(
        mockUserId,
        'vocab-new',
        '2024-01-08T00:00:00Z',
      );

      expect(result.user_id).toBe(mockUserId);
      expect(result.vocabulary_id).toBe('vocab-new');
      expect(mockPutCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'vela-user-vocabulary-progress',
          ConditionExpression: 'attribute_not_exists(user_id)',
        }),
      );
    });

    test('initializeProgressIfNotExists should rethrow ConditionalCheckFailedException', async () => {
      const err = Object.assign(new Error('Condition failed'), {
        name: 'ConditionalCheckFailedException',
      });
      mockSend.mockRejectedValueOnce(err);

      await expect(
        userVocabularyProgress.initializeProgressIfNotExists(
          mockUserId,
          'vocab-existing',
          '2024-01-08T00:00:00Z',
        ),
      ).rejects.toMatchObject({ name: 'ConditionalCheckFailedException' });
    });

    test('should delete a progress record', async () => {
      mockSend.mockResolvedValueOnce({});

      await userVocabularyProgress.delete(mockUserId, 'vocab-1');

      expect(mockDeleteCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'vela-user-vocabulary-progress',
          Key: { user_id: mockUserId, vocabulary_id: 'vocab-1' },
        }),
      );
    });

    test('updateAfterReview should return undefined for ConditionalCheckFailedException', async () => {
      const err = Object.assign(new Error('Condition failed'), {
        name: 'ConditionalCheckFailedException',
      });
      mockSend.mockRejectedValueOnce(err);

      const result = await userVocabularyProgress.updateAfterReview(mockUserId, 'vocab-1', {
        next_review_date: '2024-01-14T00:00:00Z',
        ease_factor: 2.6,
        interval: 7,
        repetitions: 2,
        last_quality: 4,
      });

      expect(result).toBeUndefined();
    });

    test('updateAfterReview should update record successfully', async () => {
      const updatedAttrs = {
        user_id: mockUserId,
        vocabulary_id: 'vocab-1',
        next_review_date: '2024-01-21T00:00:00Z',
        ease_factor: 2.7,
        interval: 14,
        repetitions: 3,
        first_learned_at: '2024-01-01T00:00:00Z',
        total_reviews: 4,
        correct_count: 4,
      };
      mockSend.mockResolvedValueOnce({ Attributes: updatedAttrs });

      const result = await userVocabularyProgress.updateAfterReview(mockUserId, 'vocab-1', {
        next_review_date: '2024-01-21T00:00:00Z',
        ease_factor: 2.7,
        interval: 14,
        repetitions: 3,
        last_quality: 5,
      });

      expect(result).toEqual(updatedAttrs);
    });

    test('getStats should return statistics for user', async () => {
      const mockItems = [
        {
          user_id: mockUserId,
          vocabulary_id: 'vocab-1',
          next_review_date: '2024-01-01T00:00:00Z',
          ease_factor: 2.5,
          interval: 0,
          repetitions: 0,
          first_learned_at: '2024-01-01',
          total_reviews: 5,
          correct_count: 4,
        },
        {
          user_id: mockUserId,
          vocabulary_id: 'vocab-2',
          next_review_date: '2024-01-10T00:00:00Z',
          ease_factor: 2.8,
          interval: 21,
          repetitions: 3,
          first_learned_at: '2024-01-01',
          total_reviews: 10,
          correct_count: 9,
        },
        {
          user_id: mockUserId,
          vocabulary_id: 'vocab-3',
          next_review_date: '2024-02-01T00:00:00Z',
          ease_factor: 3.0,
          interval: 60,
          repetitions: 5,
          first_learned_at: '2024-01-01',
          total_reviews: 15,
          correct_count: 14,
        },
      ];
      mockSend.mockResolvedValueOnce({ Items: mockItems, LastEvaluatedKey: undefined });

      const result = await userVocabularyProgress.getStats(mockUserId);

      expect(result.total_items).toBe(3);
      expect(result.total_reviews).toBe(30);
      expect(result.accuracy_rate).toBeGreaterThan(0);
      expect(result.mastery_breakdown).toBeDefined();
      expect(result.mastery_breakdown.new).toBe(1); // interval=0
      expect(result.mastery_breakdown.reviewing).toBe(1); // interval=21
      expect(result.mastery_breakdown.mastered).toBe(1); // interval=60
    });

    test('getByUser should handle pagination', async () => {
      const page1 = [
        {
          vocabulary_id: 'v1',
          user_id: mockUserId,
          interval: 1,
          ease_factor: 2.5,
          repetitions: 1,
          next_review_date: '2024-01-10',
          first_learned_at: '2024-01-01',
          total_reviews: 1,
          correct_count: 1,
        },
      ];
      const page2 = [
        {
          vocabulary_id: 'v2',
          user_id: mockUserId,
          interval: 5,
          ease_factor: 2.5,
          repetitions: 2,
          next_review_date: '2024-01-15',
          first_learned_at: '2024-01-01',
          total_reviews: 2,
          correct_count: 2,
        },
      ];
      mockSend
        .mockResolvedValueOnce({ Items: page1, LastEvaluatedKey: { pk: 'last-key' } })
        .mockResolvedValueOnce({ Items: page2, LastEvaluatedKey: undefined });

      const result = await userVocabularyProgress.getByUser(mockUserId);

      expect(mockSend).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(2);
    });
  });
});

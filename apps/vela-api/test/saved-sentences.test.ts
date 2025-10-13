import { describe, it, expect, beforeEach, vi } from 'vitest';
import { savedSentences } from '../src/dynamodb';

// Mock the AWS SDK
vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn(),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: vi.fn(() => ({
      send: vi.fn(),
    })),
  },
  PutCommand: vi.fn(),
  QueryCommand: vi.fn(),
  DeleteCommand: vi.fn(),
}));

describe('Saved Sentences DynamoDB Operations', () => {
  const mockUserId = 'test-user-123';
  const mockSentence = 'これは日本語の文章です。';
  const mockSourceUrl = 'https://example.com';
  const mockContext = 'Test Page Title';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a saved sentence with all parameters', async () => {
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
    const result = await savedSentences.create(mockUserId, mockSentence);

    expect(result).toBeDefined();
    expect(result?.user_id).toBe(mockUserId);
    expect(result?.sentence).toBe(mockSentence);
    expect(result?.source_url).toBeUndefined();
    expect(result?.context).toBeUndefined();
  });

  it('should generate unique sentence IDs', async () => {
    const result1 = await savedSentences.create(mockUserId, mockSentence);
    const result2 = await savedSentences.create(mockUserId, mockSentence);

    expect(result1?.sentence_id).not.toBe(result2?.sentence_id);
  });
});

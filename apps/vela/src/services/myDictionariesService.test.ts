import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getMyDictionaries, deleteDictionaryEntry } from './myDictionariesService';
import type { MyDictionaryEntry } from './myDictionariesService';

// Mock AWS Amplify auth
vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn(),
}));

// Mock config
vi.mock('src/config', () => ({
  config: {
    api: {
      url: '/api/',
    },
  },
}));

import { fetchAuthSession } from 'aws-amplify/auth';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('myDictionariesService', () => {
  const mockAccessToken = 'mock-access-token-12345';
  const mockSession = {
    tokens: {
      accessToken: {
        toString: () => mockAccessToken,
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
    vi.mocked(fetchAuthSession).mockResolvedValue(mockSession as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getMyDictionaries', () => {
    const mockDictionaryEntries: MyDictionaryEntry[] = [
      {
        user_id: 'user-123',
        sentence_id: 'sentence-1',
        sentence: '私は猫が好きです',
        source_url: 'https://example.com',
        context: 'Learning basic sentences',
        created_at: 1630000000000,
        updated_at: 1630000000000,
      },
      {
        user_id: 'user-123',
        sentence_id: 'sentence-2',
        sentence: '今日は晴れです',
        created_at: 1630000001000,
        updated_at: 1630000001000,
      },
    ];

    it('should fetch dictionary entries successfully', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: mockDictionaryEntries }),
      });

      const result = await getMyDictionaries(50);

      expect(fetchAuthSession).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith('/api/my-dictionaries?limit=50', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${mockAccessToken}`,
          'Content-Type': 'application/json',
        },
      });
      expect(result).toEqual(mockDictionaryEntries);
    });

    it('should use default limit of 50 when not specified', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: mockDictionaryEntries }),
      });

      await getMyDictionaries();

      expect(mockFetch).toHaveBeenCalledWith('/api/my-dictionaries?limit=50', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${mockAccessToken}`,
          'Content-Type': 'application/json',
        },
      });
    });

    it('should use custom limit when provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: mockDictionaryEntries }),
      });

      await getMyDictionaries(20);

      expect(mockFetch).toHaveBeenCalledWith('/api/my-dictionaries?limit=20', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${mockAccessToken}`,
          'Content-Type': 'application/json',
        },
      });
    });

    it('should return empty array when data property is missing', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      });

      const result = await getMyDictionaries();

      expect(result).toEqual([]);
    });

    it('should throw error when not authenticated', async () => {
      vi.mocked(fetchAuthSession).mockResolvedValue({
        tokens: undefined,
      } as any);

      await expect(getMyDictionaries()).rejects.toThrow('Not authenticated');
    });

    it('should throw error when access token is missing', async () => {
      vi.mocked(fetchAuthSession).mockResolvedValue({
        tokens: {
          accessToken: undefined,
        },
      } as any);

      await expect(getMyDictionaries()).rejects.toThrow('Not authenticated');
    });

    it('should throw error when API returns error status', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: vi.fn().mockResolvedValue({ error: 'Unauthorized' }),
      });

      await expect(getMyDictionaries()).rejects.toThrow('Unauthorized');
    });

    it('should throw generic error when API error message is missing', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: vi.fn().mockResolvedValue({}),
      });

      await expect(getMyDictionaries()).rejects.toThrow('Failed to fetch dictionary entries');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(getMyDictionaries()).rejects.toThrow('Network error');
    });

    it('should handle session fetch errors', async () => {
      vi.mocked(fetchAuthSession).mockRejectedValue(new Error('Session expired'));

      await expect(getMyDictionaries()).rejects.toThrow('Session expired');
    });

    it('should include authorization header with correct token', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: [] }),
      });

      await getMyDictionaries();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockAccessToken}`,
          }),
        }),
      );
    });

    it('should return entries with optional fields undefined', async () => {
      const entriesWithoutOptionalFields: MyDictionaryEntry[] = [
        {
          user_id: 'user-123',
          sentence_id: 'sentence-3',
          sentence: '元気です',
          created_at: 1630000002000,
          updated_at: 1630000002000,
        },
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: entriesWithoutOptionalFields }),
      });

      const result = await getMyDictionaries();

      expect(result).toEqual(entriesWithoutOptionalFields);
      expect(result[0]?.source_url).toBeUndefined();
      expect(result[0]?.context).toBeUndefined();
    });
  });

  describe('deleteDictionaryEntry', () => {
    const sentenceId = 'sentence-123';

    it('should delete dictionary entry successfully', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      });

      await deleteDictionaryEntry(sentenceId);

      expect(fetchAuthSession).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith(`/api/my-dictionaries/${sentenceId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${mockAccessToken}`,
          'Content-Type': 'application/json',
        },
      });
    });

    it('should throw error when not authenticated', async () => {
      vi.mocked(fetchAuthSession).mockResolvedValue({
        tokens: undefined,
      } as any);

      await expect(deleteDictionaryEntry(sentenceId)).rejects.toThrow('Not authenticated');
    });

    it('should throw error when access token is missing', async () => {
      vi.mocked(fetchAuthSession).mockResolvedValue({
        tokens: {
          accessToken: undefined,
        },
      } as any);

      await expect(deleteDictionaryEntry(sentenceId)).rejects.toThrow('Not authenticated');
    });

    it('should throw error when API returns error status', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: vi.fn().mockResolvedValue({ error: 'Sentence not found' }),
      });

      await expect(deleteDictionaryEntry(sentenceId)).rejects.toThrow('Sentence not found');
    });

    it('should throw generic error when API error message is missing', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: vi.fn().mockResolvedValue({}),
      });

      await expect(deleteDictionaryEntry(sentenceId)).rejects.toThrow(
        'Failed to delete dictionary entry',
      );
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(deleteDictionaryEntry(sentenceId)).rejects.toThrow('Network error');
    });

    it('should handle session fetch errors', async () => {
      vi.mocked(fetchAuthSession).mockRejectedValue(new Error('Session expired'));

      await expect(deleteDictionaryEntry(sentenceId)).rejects.toThrow('Session expired');
    });

    it('should include authorization header with correct token', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      });

      await deleteDictionaryEntry(sentenceId);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockAccessToken}`,
          }),
        }),
      );
    });

    it('should construct correct URL with sentence ID', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      });

      const customSentenceId = 'custom-sentence-456';
      await deleteDictionaryEntry(customSentenceId);

      expect(mockFetch).toHaveBeenCalledWith(
        `/api/my-dictionaries/${customSentenceId}`,
        expect.any(Object),
      );
    });

    it('should use DELETE method', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      });

      await deleteDictionaryEntry(sentenceId);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'DELETE',
        }),
      );
    });

    it('should not return any value on success', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({}),
      });

      const result = await deleteDictionaryEntry(sentenceId);

      expect(result).toBeUndefined();
    });
  });
});

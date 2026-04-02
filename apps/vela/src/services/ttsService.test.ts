import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generatePronunciation,
  getAudioUrl,
  saveTTSSettings,
  getTTSSettings,
  playAudio,
  pronounceWord,
  clearAudioUrlCache,
} from './ttsService';
import type { TTSResponse, TTSSettings } from './ttsService';
import type { Vocabulary } from '../types/database';

// Mock AWS Amplify auth
vi.mock('aws-amplify/auth', () => ({
  fetchAuthSession: vi.fn(),
}));

// Mock API utility
vi.mock('../utils/api', () => ({
  getApiUrl: vi.fn((endpoint: string) => `/api/${endpoint}`),
}));

import { fetchAuthSession } from 'aws-amplify/auth';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// Mock Audio
class MockAudio {
  src: string;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  currentTime = 0;
  pause = vi.fn();

  constructor(src: string) {
    this.src = src;
  }

  play() {
    return Promise.resolve();
  }
}

global.Audio = MockAudio as any;

describe('ttsService', () => {
  const mockIdToken = 'mock-id-token-12345';
  const mockSession = {
    tokens: {
      idToken: {
        toString: () => mockIdToken,
      },
    },
  };

  const mockTTSSettings: TTSSettings = {
    provider: 'elevenlabs',
    voiceId: 'voice-123',
    model: 'model-456',
    hasApiKey: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
    clearAudioUrlCache();
    vi.mocked(fetchAuthSession).mockResolvedValue(mockSession as any);

    // Default mock for TTS settings endpoint (called internally by generatePronunciation/getAudioUrl)
    mockFetch.mockImplementation((url: string) => {
      if (url === '/api/tts/settings') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTTSSettings),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({}),
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAuthHeader', () => {
    it('should return auth header with JWT token', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi
          .fn()
          .mockResolvedValue({ audioUrl: 'https://example.com/audio.mp3', cached: false }),
      });

      await generatePronunciation('vocab-1', '猫', 'user-123');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockIdToken}`,
            'Content-Type': 'application/json',
          }),
        }),
      );
    });

    it('should throw error when no authentication token available', async () => {
      vi.mocked(fetchAuthSession).mockResolvedValue({
        tokens: undefined,
      } as any);

      await expect(generatePronunciation('vocab-1', '猫', 'user-123')).rejects.toThrow(
        'Authentication required. Please sign in.',
      );
    });

    it('should throw error when id token is missing', async () => {
      vi.mocked(fetchAuthSession).mockResolvedValue({
        tokens: {
          idToken: undefined,
        },
      } as any);

      await expect(generatePronunciation('vocab-1', '猫', 'user-123')).rejects.toThrow(
        'Authentication required. Please sign in.',
      );
    });

    it('should throw error when fetchAuthSession fails', async () => {
      vi.mocked(fetchAuthSession).mockRejectedValue(new Error('Session expired'));

      await expect(generatePronunciation('vocab-1', '猫', 'user-123')).rejects.toThrow(
        'Authentication required. Please sign in.',
      );
    });
  });

  describe('generatePronunciation', () => {
    const mockTTSResponse: TTSResponse = {
      audioUrl: 'https://example.com/audio/neko.mp3',
      cached: false,
    };

    it('should generate pronunciation successfully', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockTTSResponse),
      });

      const result = await generatePronunciation('vocab-1', '猫', 'user-123');

      expect(fetchAuthSession).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith('/api/tts/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${mockIdToken}`,
        },
        body: JSON.stringify({
          vocabularyId: 'vocab-1',
          text: '猫',
        }),
      });
      expect(result).toEqual(mockTTSResponse);
    });

    it('should return cached audio URL when available', async () => {
      const cachedResponse: TTSResponse = {
        audioUrl: 'https://example.com/audio/cached.mp3',
        cached: true,
      };

      mockFetch.mockImplementation((url: string) => {
        if (url === '/api/tts/settings') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockTTSSettings),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(cachedResponse),
        });
      });

      const firstResult = await generatePronunciation('vocab-2', '犬', 'user-123');
      const secondResult = await generatePronunciation('vocab-2', '犬', 'user-123');

      expect(firstResult.cached).toBe(true);
      expect(firstResult.audioUrl).toBe('https://example.com/audio/cached.mp3');
      expect(secondResult.cached).toBe(true);
      expect(secondResult.audioUrl).toBe('https://example.com/audio/cached.mp3');
      // Called for settings + generate on first call, settings only on second (cached)
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should reuse the same in-flight generate request for concurrent callers', async () => {
      const mockTTSResponse: TTSResponse = {
        audioUrl: 'https://example.com/audio/shared.mp3',
        cached: false,
      };
      let resolveGenerateResponse!: (_value: Awaited<ReturnType<typeof mockFetch>>) => void;
      const generateResponsePromise = new Promise<Awaited<ReturnType<typeof mockFetch>>>(
        (resolve) => {
          resolveGenerateResponse = resolve;
        },
      );

      mockFetch.mockImplementation((url: string) => {
        if (url === '/api/tts/settings') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockTTSSettings),
          });
        }

        if (url === '/api/tts/generate') {
          return generateResponsePromise;
        }

        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({}),
        });
      });

      const firstRequest = generatePronunciation('vocab-4', '鳥', 'user-123');
      const secondRequest = generatePronunciation('vocab-4', '鳥', 'user-123');

      await vi.waitFor(() => {
        expect(mockFetch.mock.calls.filter((call) => call[0] === '/api/tts/generate')).toHaveLength(
          1,
        );
      });

      resolveGenerateResponse({
        ok: true,
        json: () => Promise.resolve(mockTTSResponse),
      });

      const [firstResult, secondResult] = await Promise.all([firstRequest, secondRequest]);

      expect(firstResult).toEqual(mockTTSResponse);
      expect(secondResult).toEqual(mockTTSResponse);
      expect(mockFetch.mock.calls.filter((call) => call[0] === '/api/tts/generate')).toHaveLength(
        1,
      );
    });

    it('should accept deprecated userId parameter without using it', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockTTSResponse),
      });

      const result = await generatePronunciation('vocab-1', '猫', 'user-123');

      expect(result).toEqual(mockTTSResponse);
      // userId should not be in the request body
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/tts/generate',
        expect.objectContaining({
          body: expect.not.stringContaining('user-123'),
        }),
      );
    });

    it('should throw error when API returns error status', async () => {
      const text = vi.fn().mockResolvedValue(JSON.stringify({ error: 'TTS service unavailable' }));
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        text,
      });

      await expect(generatePronunciation('vocab-1', '猫', 'user-123')).rejects.toThrow(
        'TTS service unavailable',
      );
      expect(text).toHaveBeenCalledTimes(1);
    });

    it('should fall back to the raw error body when the response is not JSON', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url === '/api/tts/settings') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockTTSSettings),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: () => Promise.resolve('Upstream TTS timeout'),
        });
      });

      await expect(generatePronunciation('vocab-1', '猫', 'user-123')).rejects.toThrow(
        'Upstream TTS timeout',
      );
    });

    it('should fall back to status info when the API error body is empty', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url === '/api/tts/settings') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockTTSSettings),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: () => Promise.resolve(''),
        });
      });

      await expect(generatePronunciation('vocab-1', '猫', 'user-123')).rejects.toThrow(
        'Failed to generate pronunciation (status: 500): Internal Server Error',
      );
    });

    it('should use POST method', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockTTSResponse),
      });

      await generatePronunciation('vocab-1', '猫', 'user-123');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });

    it('should handle Japanese characters correctly', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockTTSResponse),
      });

      await generatePronunciation('vocab-3', 'こんにちは', 'user-123');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('こんにちは'),
        }),
      );
    });

    it('should fall back to statusText when response.text() itself rejects', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url === '/api/tts/settings') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockTTSSettings),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          text: () => Promise.reject(new Error('body read error')),
        });
      });

      await expect(generatePronunciation('vocab-1', '猫', 'user-123')).rejects.toThrow(
        'Failed to generate pronunciation (status: 503): Service Unavailable',
      );
    });
  });

  describe('getAudioUrl', () => {
    it('should fetch audio URL successfully', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ audioUrl: 'https://example.com/audio/word.mp3' }),
      });

      const result = await getAudioUrl('vocab-1', 'user-123');

      expect(fetchAuthSession).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith('/api/tts/audio/vocab-1', {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${mockIdToken}`,
        },
      });
      expect(result).toBe('https://example.com/audio/word.mp3');
    });

    it('should return null when audio does not exist (404)', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url === '/api/tts/settings') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockTTSSettings),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({ error: 'Audio not found' }),
        });
      });

      const result = await getAudioUrl('vocab-999', 'user-123');

      expect(result).toBeNull();
    });

    it('should throw error for non-404 error responses', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url === '/api/tts/settings') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockTTSSettings),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: () => Promise.resolve('Internal Server Error'),
        });
      });

      await expect(getAudioUrl('vocab-1', 'user-123')).rejects.toThrow(
        'Failed to fetch audio URL: 500 Internal Server Error',
      );
    });

    it('should throw error for authentication failures', async () => {
      vi.mocked(fetchAuthSession).mockRejectedValue(new Error('Auth failed'));

      await expect(getAudioUrl('vocab-1', 'user-123')).rejects.toThrow(
        'Authentication required. Please sign in.',
      );
    });

    it('should validate vocabularyId input', async () => {
      await expect(getAudioUrl('', 'user-123')).rejects.toThrow(
        'vocabularyId is required and must be a non-empty string',
      );
      await expect(getAudioUrl(null as any, 'user-123')).rejects.toThrow(
        'vocabularyId is required and must be a non-empty string',
      );
      await expect(getAudioUrl(undefined as any, 'user-123')).rejects.toThrow(
        'vocabularyId is required and must be a non-empty string',
      );
    });

    it('should URL encode vocabulary IDs with special characters', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ audioUrl: 'https://example.com/audio.mp3' }),
      });

      await getAudioUrl('vocab/1', 'user-123');

      expect(mockFetch).toHaveBeenCalledWith('/api/tts/audio/vocab%2F1', expect.any(Object));
    });

    it('should use GET method (default)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ audioUrl: 'https://example.com/audio.mp3' }),
      });

      await getAudioUrl('vocab-1', 'user-123');

      // GET is default, no method property should be set
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs?.[1]?.method).toBeUndefined();
    });

    it('should return cached URL on second call without re-fetching audio endpoint', async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url === '/api/tts/settings') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockTTSSettings),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ audioUrl: 'https://example.com/audio/cached-get.mp3' }),
        });
      });

      const first = await getAudioUrl('vocab-cache-get', 'user-123');
      const second = await getAudioUrl('vocab-cache-get', 'user-123');

      expect(first).toBe('https://example.com/audio/cached-get.mp3');
      expect(second).toBe('https://example.com/audio/cached-get.mp3');
      const audioCalls = mockFetch.mock.calls.filter(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('tts/audio/'),
      );
      expect(audioCalls).toHaveLength(1);
    });
  });

  describe('saveTTSSettings', () => {
    it('should save TTS settings successfully', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true }),
      });

      await saveTTSSettings('elevenlabs', 'sk-test-api-key', 'voice-id-1', 'model-1');

      expect(fetchAuthSession).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith('/api/tts/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${mockIdToken}`,
        },
        body: JSON.stringify({
          provider: 'elevenlabs',
          apiKey: 'sk-test-api-key',
          voiceId: 'voice-id-1',
          model: 'model-1',
        }),
      });
    });

    it('should save settings with null voice ID and model when not provided', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true }),
      });

      await saveTTSSettings('openai', 'sk-test-api-key');

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/tts/settings',
        expect.objectContaining({
          body: JSON.stringify({
            provider: 'openai',
            apiKey: 'sk-test-api-key',
            voiceId: null,
            model: null,
          }),
        }),
      );
    });

    it('should not send userId in request body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true }),
      });

      await saveTTSSettings('elevenlabs', 'sk-test-api-key');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.not.stringContaining('user-123'),
        }),
      );
    });

    it('should throw error when API returns error status', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: vi.fn().mockResolvedValue({ error: 'Invalid API key' }),
      });

      await expect(saveTTSSettings('elevenlabs', 'invalid-key')).rejects.toThrow('Invalid API key');
    });

    it('should throw generic error when API error message is missing', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: vi.fn().mockResolvedValue({}),
      });

      await expect(saveTTSSettings('elevenlabs', 'sk-test-api-key')).rejects.toThrow(
        'Failed to save TTS settings',
      );
    });

    it('should use POST method', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true }),
      });

      await saveTTSSettings('elevenlabs', 'sk-test-api-key');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });

    it('should handle empty string voice ID and model as null', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true }),
      });

      await saveTTSSettings('gemini', 'sk-test-api-key', '', '');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            provider: 'gemini',
            apiKey: 'sk-test-api-key',
            voiceId: null,
            model: null,
          }),
        }),
      );
    });

    it('should fall back to response.text() when response.json() throws', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Bad Request',
        json: () => Promise.reject(new Error('not JSON')),
        text: () => Promise.resolve('API key is invalid'),
      });

      await expect(saveTTSSettings('elevenlabs', 'bad-key')).rejects.toThrow('API key is invalid');
    });

    it('should fall back to statusText when json() throws and text() is empty', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Unprocessable Entity',
        json: () => Promise.reject(new Error('not JSON')),
        text: () => Promise.resolve(''),
      });

      await expect(saveTTSSettings('elevenlabs', 'bad-key')).rejects.toThrow(
        'Unprocessable Entity',
      );
    });
  });

  describe('cache behavior', () => {
    const CACHE_TTL = 14 * 60 * 1000;
    const SWEEP_INTERVAL = 5 * 60 * 1000;

    beforeEach(() => {
      mockFetch.mockImplementation((url: string) => {
        if (url === '/api/tts/settings') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockTTSSettings),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ audioUrl: 'https://example.com/audio/item.mp3' }),
        });
      });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should individually drop an expired entry when sweep interval has not elapsed since last sweep', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      clearAudioUrlCache();

      // Add entry at t=0; it expires at t=14 min
      await getAudioUrl('vocab-indiv-expire', 'user-123');

      // Advance to t=11 min: trigger a sweep (11 min >= 5 min since lastExpiredSweepAt=0)
      vi.setSystemTime(SWEEP_INTERVAL * 2 + 60_000); // 660 000 ms
      // Sweep runs; entry not yet expired (expires at 840 000). lastExpiredSweepAt=660 000.
      await getAudioUrl('vocab-indiv-expire', 'user-123');

      // Advance to t=14 min+1 ms: entry is expired, but 840 001 - 660 000 = 180 001 < 300 000 → no sweep
      vi.setSystemTime(CACHE_TTL + 1);
      await getAudioUrl('vocab-indiv-expire', 'user-123');

      // Entry was dropped by the per-key check (lines 71-73); a fresh audio fetch was needed
      const audioCalls = mockFetch.mock.calls.filter(
        (c) =>
          typeof c[0] === 'string' && (c[0] as string).includes('tts/audio/vocab-indiv-expire'),
      );
      expect(audioCalls).toHaveLength(2);
    });

    it('should sweep and remove expired entries when sweep interval elapses', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      clearAudioUrlCache();

      // Add entry at t=0; expires at t=14 min
      await getAudioUrl('vocab-sweep-expire', 'user-123');

      // Advance past both TTL (14 min) and sweep interval (5 min) so the sweep loop fires
      vi.setSystemTime(CACHE_TTL + SWEEP_INTERVAL); // 1 140 000 ms
      await getAudioUrl('vocab-sweep-expire', 'user-123');

      // sweepExpiredEntries deleted the stale entry (lines 38-41); fresh fetch was required
      const audioCalls = mockFetch.mock.calls.filter(
        (c) =>
          typeof c[0] === 'string' && (c[0] as string).includes('tts/audio/vocab-sweep-expire'),
      );
      expect(audioCalls).toHaveLength(2);
    });

    it('should evict the oldest entry when cache exceeds MAX_CACHE_ENTRIES', async () => {
      // Populate 301 unique entries to exceed MAX_CACHE_ENTRIES (300) by one
      for (let i = 0; i <= 300; i++) {
        await getAudioUrl(`vocab-evict-${i}`, 'user-evict');
      }

      // vocab-evict-0 (oldest insertion) should have been evicted by enforceCacheSizeLimit
      mockFetch.mockClear();
      await getAudioUrl('vocab-evict-0', 'user-evict');
      const evictedCalls = mockFetch.mock.calls.filter(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('tts/audio/vocab-evict-0'),
      );
      expect(evictedCalls).toHaveLength(1); // had to re-fetch

      // vocab-evict-300 (newest) should still be in cache
      mockFetch.mockClear();
      await getAudioUrl('vocab-evict-300', 'user-evict');
      const newestCalls = mockFetch.mock.calls.filter(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('tts/audio/vocab-evict-300'),
      );
      expect(newestCalls).toHaveLength(0); // served from cache
    });
  });

  describe('getTTSSettings', () => {
    const mockSettings: TTSSettings = {
      provider: 'openai',
      voiceId: 'alloy',
      model: 'tts-1',
      hasApiKey: true,
    };

    it('should fetch TTS settings successfully', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockSettings),
      });

      const result = await getTTSSettings();

      expect(fetchAuthSession).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith('/api/tts/settings', {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${mockIdToken}`,
        },
      });
      expect(result).toEqual(mockSettings);
    });

    it('should accept deprecated userId parameter without using it', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockSettings),
      });

      const result = await getTTSSettings('user-123');

      expect(result).toEqual(mockSettings);
      // userId should not be in the request
      expect(mockFetch).toHaveBeenCalledWith('/api/tts/settings', expect.any(Object));
    });

    it('should return settings with null values when not configured', async () => {
      const emptySettings: TTSSettings = {
        provider: 'openai',
        voiceId: null,
        model: null,
        hasApiKey: false,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(emptySettings),
      });

      const result = await getTTSSettings();

      expect(result.voiceId).toBeNull();
      expect(result.model).toBeNull();
      expect(result.hasApiKey).toBe(false);
    });

    it('should throw error when API returns error status', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: vi.fn().mockResolvedValue({ error: 'Settings not found' }),
      });

      await expect(getTTSSettings()).rejects.toThrow('Settings not found');
    });

    it('should use GET method (default)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockSettings),
      });

      await getTTSSettings();

      // GET is default, no method property should be set
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs?.[1]?.method).toBeUndefined();
    });
  });

  describe('playAudio', () => {
    it('should play audio successfully', async () => {
      const audioUrl = 'https://example.com/audio/test.mp3';
      let audioInstance: MockAudio | null = null as MockAudio | null;

      const CustomMockAudio = class extends MockAudio {
        constructor(src: string) {
          super(src);
          audioInstance = this;
        }
      };

      global.Audio = CustomMockAudio as any;

      const playback = playAudio(audioUrl);

      // Simulate audio ended
      if (audioInstance && audioInstance.onended) {
        audioInstance.onended();
      }

      await expect(playback.finished).resolves.toBeUndefined();
      expect(playback.audio.src).toBe(audioUrl);
    });

    it('should reject when audio fails to load', async () => {
      const audioUrl = 'https://example.com/audio/invalid.mp3';
      let audioInstance: MockAudio | null = null as MockAudio | null;

      const CustomMockAudio = class extends MockAudio {
        constructor(src: string) {
          super(src);
          audioInstance = this;
        }
      };

      global.Audio = CustomMockAudio as any;

      const playback = playAudio(audioUrl);

      // Simulate audio error
      if (audioInstance && audioInstance.onerror) {
        audioInstance.onerror();
      }

      await expect(playback.finished).rejects.toThrow('Failed to play audio');
    });

    it('should reject when play() fails', async () => {
      const audioUrl = 'https://example.com/audio/test.mp3';

      const CustomMockAudio = class extends MockAudio {
        override play() {
          return Promise.reject(new Error('Playback error'));
        }
      };

      global.Audio = CustomMockAudio as any;

      await expect(playAudio(audioUrl).finished).rejects.toThrow('Playback error');
    });

    it('should expose a stop method that cancels playback', async () => {
      const audioUrl = 'https://example.com/audio/test.mp3';
      let audioInstance: MockAudio | null = null as MockAudio | null;

      const CustomMockAudio = class extends MockAudio {
        constructor(src: string) {
          super(src);
          audioInstance = this;
          this.currentTime = 12;
        }
      };

      global.Audio = CustomMockAudio as any;

      const playback = playAudio(audioUrl);
      playback.stop();

      await expect(playback.finished).resolves.toBeUndefined();
      expect(audioInstance?.pause).toHaveBeenCalledTimes(1);
      expect(audioInstance?.currentTime).toBe(0);
    });

    it('should create Audio instance with correct URL', async () => {
      const audioUrl = 'https://example.com/audio/japanese.mp3';
      let capturedSrc = '';

      const CustomMockAudio = class extends MockAudio {
        constructor(src: string) {
          super(src);
          capturedSrc = src;
          setTimeout(() => {
            if (this.onended) this.onended();
          }, 0);
        }
      };

      global.Audio = CustomMockAudio as any;

      const playback = playAudio(audioUrl);
      await playback.finished;

      expect(capturedSrc).toBe(audioUrl);
    });
  });

  describe('pronounceWord', () => {
    const mockVocabulary: Vocabulary = {
      id: 'vocab-1',
      japanese_word: '猫',
      hiragana: 'ねこ',
      romaji: 'neko',
      english_translation: 'cat',
      created_at: '2024-01-01T00:00:00Z',
    };

    it('should pronounce word successfully', async () => {
      const mockTTSResponse: TTSResponse = {
        audioUrl: 'https://example.com/audio/neko.mp3',
        cached: false,
      };

      mockFetch.mockImplementation((url: string) => {
        if (url === '/api/tts/settings') {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(mockTTSSettings),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockTTSResponse),
        });
      });

      let audioInstance: MockAudio | null = null as MockAudio | null;
      const CustomMockAudio = class extends MockAudio {
        constructor(src: string) {
          super(src);
          audioInstance = this;
          setTimeout(() => {
            if (this.onended) this.onended();
          }, 0);
        }
      };

      global.Audio = CustomMockAudio as any;

      await pronounceWord(mockVocabulary, 'user-123');

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/tts/generate',
        expect.objectContaining({
          body: JSON.stringify({
            vocabularyId: 'vocab-1',
            text: '猫',
          }),
        }),
      );
      expect(audioInstance?.src).toBe('https://example.com/audio/neko.mp3');

      // Verify that the deprecated userId is not included in the request body
      const generateCall = mockFetch.mock.calls.find((call) => call[0] === '/api/tts/generate');
      if (!generateCall) {
        throw new Error('Expected fetch to be called with /api/tts/generate');
      }

      const [, requestInit] = generateCall as [string, RequestInit];
      const body = requestInit.body;
      if (typeof body !== 'string') {
        throw new Error('Expected request body to be a string');
      }

      const requestBody = JSON.parse(body);
      expect(requestBody).toStrictEqual({
        vocabularyId: 'vocab-1',
        text: '猫',
      });
      expect(requestBody).not.toHaveProperty('userId');
    });

    it('should throw error when TTS generation fails', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: vi.fn().mockResolvedValue({ error: 'TTS service unavailable' }),
      });

      await expect(pronounceWord(mockVocabulary, 'user-123')).rejects.toThrow(
        'TTS service unavailable',
      );
    });

    it('should throw error when audio playback fails', async () => {
      const mockTTSResponse: TTSResponse = {
        audioUrl: 'https://example.com/audio/neko.mp3',
        cached: false,
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockTTSResponse),
      });

      const CustomMockAudio = class extends MockAudio {
        override play() {
          return Promise.reject(new Error('Playback error'));
        }
      };

      global.Audio = CustomMockAudio as any;

      await expect(pronounceWord(mockVocabulary, 'user-123')).rejects.toThrow('Playback error');
    });

    it('should use vocabulary ID and japanese_word for TTS', async () => {
      const customVocab: Vocabulary = {
        id: 'vocab-custom',
        japanese_word: 'こんにちは',
        english_translation: 'hello',
        created_at: '2024-01-01T00:00:00Z',
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          audioUrl: 'https://example.com/audio/hello.mp3',
          cached: false,
        }),
      });

      const CustomMockAudio = class extends MockAudio {
        constructor(src: string) {
          super(src);
          setTimeout(() => {
            if (this.onended) this.onended();
          }, 0);
        }
      };

      global.Audio = CustomMockAudio as any;

      await pronounceWord(customVocab, 'user-123');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('vocab-custom'),
        }),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('こんにちは'),
        }),
      );
    });
  });
});

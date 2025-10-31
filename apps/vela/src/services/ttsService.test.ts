import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generatePronunciation,
  getAudioUrl,
  saveTTSSettings,
  getTTSSettings,
  playAudio,
  pronounceWord,
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
global.fetch = mockFetch;

// Mock Audio
class MockAudio {
  src: string;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;

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

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
    vi.mocked(fetchAuthSession).mockResolvedValue(mockSession as any);
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

      await generatePronunciation('vocab-1', '猫');

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

      await expect(generatePronunciation('vocab-1', '猫')).rejects.toThrow(
        'Authentication required. Please sign in.',
      );
    });

    it('should throw error when id token is missing', async () => {
      vi.mocked(fetchAuthSession).mockResolvedValue({
        tokens: {
          idToken: undefined,
        },
      } as any);

      await expect(generatePronunciation('vocab-1', '猫')).rejects.toThrow(
        'Authentication required. Please sign in.',
      );
    });

    it('should throw error when fetchAuthSession fails', async () => {
      vi.mocked(fetchAuthSession).mockRejectedValue(new Error('Session expired'));

      await expect(generatePronunciation('vocab-1', '猫')).rejects.toThrow(
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

      const result = await generatePronunciation('vocab-1', '猫');

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

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(cachedResponse),
      });

      const result = await generatePronunciation('vocab-2', '犬');

      expect(result.cached).toBe(true);
      expect(result.audioUrl).toBe('https://example.com/audio/cached.mp3');
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
      mockFetch.mockResolvedValue({
        ok: false,
        json: vi.fn().mockResolvedValue({ error: 'TTS service unavailable' }),
      });

      await expect(generatePronunciation('vocab-1', '猫')).rejects.toThrow(
        'TTS service unavailable',
      );
    });

    it('should throw generic error when API error message is missing', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: vi.fn().mockResolvedValue({}),
      });

      await expect(generatePronunciation('vocab-1', '猫')).rejects.toThrow(
        'Failed to generate pronunciation',
      );
    });

    it('should use POST method', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockTTSResponse),
      });

      await generatePronunciation('vocab-1', '猫');

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

      await generatePronunciation('vocab-3', 'こんにちは');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('こんにちは'),
        }),
      );
    });
  });

  describe('getAudioUrl', () => {
    it('should fetch audio URL successfully', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ audioUrl: 'https://example.com/audio/word.mp3' }),
      });

      const result = await getAudioUrl('vocab-1');

      expect(fetchAuthSession).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith('/api/tts/audio/vocab-1', {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${mockIdToken}`,
        },
      });
      expect(result).toBe('https://example.com/audio/word.mp3');
    });

    it('should return null when audio does not exist', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: vi.fn().mockResolvedValue({ error: 'Audio not found' }),
      });

      const result = await getAudioUrl('vocab-999');

      expect(result).toBeNull();
    });

    it('should return null on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await getAudioUrl('vocab-1');

      expect(result).toBeNull();
    });

    it('should return null when authentication fails', async () => {
      vi.mocked(fetchAuthSession).mockRejectedValue(new Error('Auth failed'));

      const result = await getAudioUrl('vocab-1');

      expect(result).toBeNull();
    });

    it('should construct correct URL with vocabulary ID', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ audioUrl: 'https://example.com/audio.mp3' }),
      });

      await getAudioUrl('custom-vocab-456');

      expect(mockFetch).toHaveBeenCalledWith('/api/tts/audio/custom-vocab-456', expect.any(Object));
    });

    it('should use GET method (default)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ audioUrl: 'https://example.com/audio.mp3' }),
      });

      await getAudioUrl('vocab-1');

      // GET is default, no method property should be set
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs?.[1]?.method).toBeUndefined();
    });
  });

  describe('saveTTSSettings', () => {
    it('should save TTS settings successfully', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true }),
      });

      await saveTTSSettings('user-123', 'sk-test-api-key', 'voice-id-1', 'model-1');

      expect(fetchAuthSession).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith('/api/tts/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${mockIdToken}`,
        },
        body: JSON.stringify({
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

      await saveTTSSettings('user-123', 'sk-test-api-key');

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/tts/settings',
        expect.objectContaining({
          body: JSON.stringify({
            apiKey: 'sk-test-api-key',
            voiceId: null,
            model: null,
          }),
        }),
      );
    });

    it('should not send userId in request body (deprecated parameter)', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true }),
      });

      await saveTTSSettings('user-123', 'sk-test-api-key');

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

      await expect(saveTTSSettings('user-123', 'invalid-key')).rejects.toThrow('Invalid API key');
    });

    it('should throw generic error when API error message is missing', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: vi.fn().mockResolvedValue({}),
      });

      await expect(saveTTSSettings('user-123', 'sk-test-api-key')).rejects.toThrow(
        'Failed to save TTS settings',
      );
    });

    it('should use POST method', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true }),
      });

      await saveTTSSettings('user-123', 'sk-test-api-key');

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

      await saveTTSSettings('user-123', 'sk-test-api-key', '', '');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({
            apiKey: 'sk-test-api-key',
            voiceId: null,
            model: null,
          }),
        }),
      );
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

      await expect(getTTSSettings()).rejects.toThrow('Failed to fetch TTS settings');
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

      const playPromise = playAudio(audioUrl);

      // Simulate audio ended
      if (audioInstance && audioInstance.onended) {
        audioInstance.onended();
      }

      await expect(playPromise).resolves.toBeUndefined();
      expect(audioInstance?.src).toBe(audioUrl);
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

      const playPromise = playAudio(audioUrl);

      // Simulate audio error
      if (audioInstance && audioInstance.onerror) {
        audioInstance.onerror();
      }

      await expect(playPromise).rejects.toThrow('Failed to play audio');
    });

    it('should reject when play() fails', async () => {
      const audioUrl = 'https://example.com/audio/test.mp3';

      const CustomMockAudio = class extends MockAudio {
        override play() {
          return Promise.reject(new Error('Playback error'));
        }
      };

      global.Audio = CustomMockAudio as any;

      await expect(playAudio(audioUrl)).rejects.toThrow('Playback error');
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

      await playAudio(audioUrl);

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

      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockTTSResponse),
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

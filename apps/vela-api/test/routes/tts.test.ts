import { describe, test, expect, beforeEach, vi } from 'bun:test';
import { Hono } from 'hono';
import type { Env } from '../../src/types';

const mockTtsSettingsDB = {
  get: vi.fn(),
  put: vi.fn(),
};

const mockS3Client = {
  send: vi.fn(),
};

const mockGetSignedUrl = vi.fn();

const mockTTSProvider = {
  name: 'elevenlabs',
  generate: vi.fn(),
};

vi.mock('../../src/dynamodb', () => ({
  ttsSettings: mockTtsSettingsDB,
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => mockS3Client),
  PutObjectCommand: vi.fn().mockImplementation((params) => ({ ...params, _type: 'PutObject' })),
  GetObjectCommand: vi.fn().mockImplementation((params) => ({ ...params, _type: 'GetObject' })),
  HeadObjectCommand: vi.fn().mockImplementation((params) => ({ ...params, _type: 'HeadObject' })),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mockGetSignedUrl,
}));

vi.mock('../../src/tts/factory', () => ({
  createTTSProvider: vi.fn().mockReturnValue(mockTTSProvider),
}));

vi.mock('../../src/middleware/auth', () => ({
  requireAuth: async (_c: any, next: any) => {
    _c.set('userId', 'test-user-id');
    _c.set('userEmail', 'test@example.com');
    await next();
  },
  AuthContext: {},
}));

// Import AFTER mocks
const { default: createTTSRoute } = await import('../../src/routes/tts');

const TEST_ENV: Env = {
  TTS_AUDIO_BUCKET_NAME: 'test-bucket',
  AWS_REGION: 'us-east-1',
};

function createTestApp(env: Env = TEST_ENV) {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', async (c, next) => {
    c.env = c.env || {};
    Object.assign(c.env, env);
    await next();
  });
  const ttsRoute = createTTSRoute(env);
  app.route('/', ttsRoute);
  return app;
}

describe('TTS Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /settings - Get TTS settings', () => {
    test('returns default settings when no settings found', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce(null);

      const app = createTestApp();
      const res = await app.request('/settings');

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        hasApiKey: boolean;
        provider: string;
        voiceId: null;
        model: null;
      };
      expect(body.hasApiKey).toBe(false);
      expect(body.provider).toBe('elevenlabs');
      expect(body.voiceId).toBeNull();
      expect(body.model).toBeNull();
    });

    test('returns settings without exposing api key', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'openai',
        api_key: 'secret-key',
        voice_id: 'alloy',
        model: 'tts-1',
      });

      const app = createTestApp();
      const res = await app.request('/settings');

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        hasApiKey: boolean;
        provider: string;
        voiceId: string;
        model: string;
      };
      expect(body.hasApiKey).toBe(true);
      expect(body.provider).toBe('openai');
      expect(body.voiceId).toBe('alloy');
      expect(body.model).toBe('tts-1');
      expect((body as any).api_key).toBeUndefined();
    });

    test('falls back to elevenlabs for invalid provider value', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'invalid-provider',
        api_key: 'key',
        voice_id: null,
        model: null,
      });

      const app = createTestApp();
      const res = await app.request('/settings');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { provider: string };
      expect(body.provider).toBe('elevenlabs');
    });

    test('returns 500 on database error', async () => {
      mockTtsSettingsDB.get.mockRejectedValueOnce(new Error('DDB error'));

      const app = createTestApp();
      const res = await app.request('/settings');

      expect(res.status).toBe(500);
    });

    test('returns gemini settings correctly', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'gemini',
        api_key: 'gemini-key',
        voice_id: 'Kore',
        model: 'gemini-2.5-flash-preview-tts',
      });

      const app = createTestApp();
      const res = await app.request('/settings');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { provider: string; voiceId: string };
      expect(body.provider).toBe('gemini');
      expect(body.voiceId).toBe('Kore');
    });
  });

  describe('POST /settings - Save TTS settings', () => {
    test('saves settings successfully', async () => {
      mockTtsSettingsDB.put.mockResolvedValueOnce(undefined);

      const app = createTestApp();
      const res = await app.request('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'elevenlabs',
          apiKey: 'test-api-key',
          voiceId: 'ErXwobaYiN019PkySvjV',
          model: 'eleven_multilingual_v2',
        }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; message: string };
      expect(body.success).toBe(true);
      expect(body.message).toContain('saved');
      expect(mockTtsSettingsDB.put).toHaveBeenCalledWith({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'test-api-key',
        voice_id: 'ErXwobaYiN019PkySvjV',
        model: 'eleven_multilingual_v2',
      });
    });

    test('saves settings with null voiceId and model', async () => {
      mockTtsSettingsDB.put.mockResolvedValueOnce(undefined);

      const app = createTestApp();
      const res = await app.request('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai',
          apiKey: 'test-api-key',
        }),
      });

      expect(res.status).toBe(200);
      expect(mockTtsSettingsDB.put).toHaveBeenCalledWith(
        expect.objectContaining({
          voice_id: null,
          model: null,
        }),
      );
    });

    test('returns 400 for invalid provider', async () => {
      const app = createTestApp();
      const res = await app.request('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'invalid-provider',
          apiKey: 'test-api-key',
        }),
      });

      expect(res.status).toBe(400);
    });

    test('returns 400 when apiKey is missing', async () => {
      const app = createTestApp();
      const res = await app.request('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'elevenlabs',
        }),
      });

      expect(res.status).toBe(400);
    });

    test('returns 500 on database error', async () => {
      mockTtsSettingsDB.put.mockRejectedValueOnce(new Error('DDB error'));

      const app = createTestApp();
      const res = await app.request('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'elevenlabs',
          apiKey: 'test-api-key',
        }),
      });

      expect(res.status).toBe(500);
    });
  });

  describe('POST /generate - Generate TTS audio', () => {
    test('returns cached audio URL when already cached in S3', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'test-api-key',
        voice_id: null,
        model: null,
      });
      mockS3Client.send.mockResolvedValueOnce({}); // HeadObject succeeds (cache hit)
      mockGetSignedUrl.mockResolvedValueOnce('https://s3.example.com/audio.mp3');

      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { audioUrl: string; cached: boolean };
      expect(body.audioUrl).toBe('https://s3.example.com/audio.mp3');
      expect(body.cached).toBe(true);
      expect(mockTTSProvider.generate).not.toHaveBeenCalled();
    });

    test('generates new audio when not cached', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'test-api-key',
        voice_id: null,
        model: null,
      });
      // HeadObject throws NotFound (cache miss)
      const notFoundError = new Error('Not found');
      (notFoundError as any).name = 'NotFound';
      mockS3Client.send.mockRejectedValueOnce(notFoundError);
      // TTS generation succeeds
      mockTTSProvider.generate.mockResolvedValueOnce({
        audioBuffer: Buffer.from('audio-data'),
        contentType: 'audio/mpeg',
      });
      // S3 upload succeeds
      mockS3Client.send.mockResolvedValueOnce({});
      // Get signed URL after upload
      mockGetSignedUrl.mockResolvedValueOnce('https://s3.example.com/new-audio.mp3');

      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { audioUrl: string; cached: boolean };
      expect(body.audioUrl).toBe('https://s3.example.com/new-audio.mp3');
      expect(body.cached).toBe(false);
      expect(mockTTSProvider.generate).toHaveBeenCalledTimes(1);
    });

    test('returns 400 when no TTS settings configured', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce(null);

      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('TTS API key not configured');
    });

    test('returns 500 when TTS_AUDIO_BUCKET_NAME is not configured', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'test-api-key',
        voice_id: null,
        model: null,
      });

      const app = createTestApp({ AWS_REGION: 'us-east-1' }); // No bucket name
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      expect(res.status).toBe(500);
    });

    test('returns 400 for invalid provider in settings', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'invalid-provider',
        api_key: 'test-api-key',
        voice_id: null,
        model: null,
      });

      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      expect(res.status).toBe(400);
    });

    test('returns 400 when vocabularyId is missing', async () => {
      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: '日本語' }),
      });

      expect(res.status).toBe(400);
    });

    test('returns 400 when text is missing', async () => {
      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1' }),
      });

      expect(res.status).toBe(400);
    });

    test('returns 503 when S3 cache check fails with unexpected error', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'test-api-key',
        voice_id: null,
        model: null,
      });
      const serviceError = new Error('Service unavailable');
      (serviceError as any).name = 'ServiceUnavailable';
      mockS3Client.send.mockRejectedValueOnce(serviceError);

      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      expect(res.status).toBe(503);
    });

    test('returns 504 when TTS provider times out', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'test-api-key',
        voice_id: null,
        model: null,
      });
      const notFoundError = new Error('Not found');
      (notFoundError as any).name = 'NotFound';
      mockS3Client.send.mockRejectedValueOnce(notFoundError);
      const timeoutError = new Error('Request timeout: TTS generation took too long');
      mockTTSProvider.generate.mockRejectedValueOnce(timeoutError);

      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      expect(res.status).toBe(504);
    });

    test('returns 500 when TTS provider fails', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'test-api-key',
        voice_id: null,
        model: null,
      });
      const notFoundError = new Error('Not found');
      (notFoundError as any).name = 'NotFound';
      mockS3Client.send.mockRejectedValueOnce(notFoundError);
      mockTTSProvider.generate.mockRejectedValueOnce(new Error('API error'));

      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      expect(res.status).toBe(500);
    });

    test('returns 500 when S3 upload fails', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'test-api-key',
        voice_id: null,
        model: null,
      });
      const notFoundError = new Error('Not found');
      (notFoundError as any).name = 'NotFound';
      mockS3Client.send.mockRejectedValueOnce(notFoundError);
      mockTTSProvider.generate.mockResolvedValueOnce({
        audioBuffer: Buffer.from('audio-data'),
        contentType: 'audio/mpeg',
      });
      mockS3Client.send.mockRejectedValueOnce(new Error('S3 upload failed'));

      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      expect(res.status).toBe(500);
    });
  });

  describe('GET /audio/:vocabularyId - Get cached audio URL', () => {
    test('returns presigned URL when audio is cached', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'test-api-key',
        voice_id: null,
        model: null,
      });
      mockS3Client.send.mockResolvedValueOnce({}); // HeadObject succeeds
      mockGetSignedUrl.mockResolvedValueOnce('https://s3.example.com/cached-audio.mp3');

      const app = createTestApp();
      const res = await app.request('/audio/vocab-1');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { audioUrl: string };
      expect(body.audioUrl).toBe('https://s3.example.com/cached-audio.mp3');
    });

    test('returns 404 when audio is not cached', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'test-api-key',
        voice_id: null,
        model: null,
      });
      const notFoundError = new Error('Not found');
      (notFoundError as any).name = 'NotFound';
      mockS3Client.send.mockRejectedValueOnce(notFoundError);

      const app = createTestApp();
      const res = await app.request('/audio/vocab-1');

      expect(res.status).toBe(404);
    });

    test('returns 400 when TTS settings not found', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce(null);

      const app = createTestApp();
      const res = await app.request('/audio/vocab-1');

      expect(res.status).toBe(400);
    });

    test('returns 500 on S3 error', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'test-api-key',
        voice_id: null,
        model: null,
      });
      mockS3Client.send.mockRejectedValueOnce(new Error('S3 error'));

      const app = createTestApp();
      const res = await app.request('/audio/vocab-1');

      expect(res.status).toBe(500);
    });
  });
});

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

const mockAuthConfig = {
  userId: 'test-user-id',
  userEmail: 'test@example.com',
};

vi.mock('../../src/middleware/auth', () => ({
  requireAuth: async (_c: any, next: any) => {
    _c.set('userId', mockAuthConfig.userId);
    _c.set('userEmail', mockAuthConfig.userEmail);
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

// Serialize every argument of a console call to a single string so a test can
// assert that a secret or identity-bearing value does not appear anywhere in
// the logged payload (not just as a top-level property).
//
// Error objects have non-enumerable `name`/`message`/`stack`, so
// JSON.stringify(new Error('secret')) returns '{}' and would hide any secret
// embedded in those properties from the leak assertions. Serialize Error
// arguments via their own properties first, then fall back to JSON.stringify
// for everything else.
function serializeError(error: Error): string {
  return [error.name, error.message, error.stack].filter(Boolean).join('\n');
}

function serializeLogArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return serializeError(arg);
      return JSON.stringify(arg);
    })
    .join('\n');
}

describe('TTS Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthConfig.userId = 'test-user-id';
    mockAuthConfig.userEmail = 'test@example.com';
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

    test('invalid provider value warns with the stored value but without the userId', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'invalid-provider',
        api_key: 'key',
        voice_id: null,
        model: null,
      });

      const app = createTestApp();
      await app.request('/settings');

      expect(warnSpy).toHaveBeenCalled();
      const loggedArg = warnSpy.mock.calls[0][1] as Record<string, unknown>;
      expect(loggedArg).toHaveProperty('storedValue', 'invalid-provider');
      expect(loggedArg).not.toHaveProperty('userId');
      expect(serializeLogArgs(warnSpy.mock.calls[0])).not.toContain('test-user-id');
      warnSpy.mockRestore();
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
      const body = (await res.json()) as {
        audioUrl: string;
        cached: boolean;
        effectiveSettings?: { provider: string; voiceId: string | null; model: string | null };
      };
      expect(body.audioUrl).toBe('https://s3.example.com/audio.mp3');
      expect(body.cached).toBe(true);
      // The cache-hit response echoes the effective settings used to derive the
      // S3 key so clients can detect a GET/POST settings race.
      expect(body.effectiveSettings).toEqual({
        provider: 'elevenlabs',
        voiceId: null,
        model: null,
      });
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
      const body = (await res.json()) as {
        audioUrl: string;
        cached: boolean;
        effectiveSettings?: { provider: string; voiceId: string | null; model: string | null };
      };
      expect(body.audioUrl).toBe('https://s3.example.com/new-audio.mp3');
      expect(body.cached).toBe(false);
      // The generation response reports the effective settings the backend
      // used, so the mobile client can skip caching on a GET/POST race.
      expect(body.effectiveSettings).toEqual({
        provider: 'elevenlabs',
        voiceId: null,
        model: null,
      });
      expect(mockTTSProvider.generate).toHaveBeenCalledTimes(1);
    });

    test('returns a stable code when TTS is not configured', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce(null);

      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'TTS API key not configured. Please configure in Settings.',
        code: 'tts_not_configured',
      });
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
      expect(await res.json()).toEqual({
        error: 'TTS audio bucket not configured',
        code: 'tts_audio_bucket_not_configured',
      });
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
      expect(await res.json()).toEqual({
        error: 'Invalid TTS provider configuration',
        code: 'tts_invalid_provider_configuration',
      });
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

    test('leaves request-validator failures uncoded', async () => {
      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: '', text: '' }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { success: boolean; code?: string };
      expect(body).toMatchObject({ success: false });
      expect(body).not.toHaveProperty('code');
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
      expect(await res.json()).toEqual({
        error: 'Audio service temporarily unavailable. Please try again.',
        code: 'tts_audio_service_unavailable',
      });
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
      expect(await res.json()).toEqual({
        error: 'TTS generation timed out',
        code: 'tts_generation_timeout',
      });
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
      expect(await res.json()).toEqual({
        error: 'Failed to generate TTS audio',
        code: 'tts_generation_failed',
      });
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
      expect(await res.json()).toEqual({
        error: 'Audio was generated but could not be saved. Please try again.',
        code: 'tts_audio_storage_failed',
      });
    });

    test('S3 cache check failure logs sanitized error without s3Key, userId, bucket, or error message', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'test-api-key',
        voice_id: null,
        model: null,
      });
      mockS3Client.send.mockRejectedValueOnce(new Error('S3 connection reset'));

      const app = createTestApp();
      await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      const loggedArg = errorSpy.mock.calls[0][1] as Record<string, unknown>;
      expect(loggedArg).not.toHaveProperty('s3Key');
      expect(loggedArg).not.toHaveProperty('userId');
      expect(loggedArg).not.toHaveProperty('bucket');
      expect(loggedArg).not.toHaveProperty('error');
      expect(loggedArg).not.toHaveProperty('errorMessage');
      expect(loggedArg).toHaveProperty('errorName', 'Error');
      expect(loggedArg).toHaveProperty('category', 's3_cache_lookup');
      // The raw error message must not leak into any serialized log argument.
      expect(serializeLogArgs(errorSpy.mock.calls[0])).not.toContain('S3 connection reset');
      expect(serializeLogArgs(errorSpy.mock.calls[0])).not.toContain('test-user-id');
      expect(serializeLogArgs(errorSpy.mock.calls[0])).not.toContain('test-bucket');
      errorSpy.mockRestore();
    });

    test('provider error logs no upstream body, userId, bucket, or s3 key', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
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
      // Mirrors OpenAIProvider/ElevenLabsProvider/GeminiProvider, which embed the
      // full upstream response body in error.message. The secret and user id
      // embedded here must not reach application logs.
      const SECRET_MARKER = 'sk-leaked-upstream-secret-XYZ';
      mockTTSProvider.generate.mockRejectedValueOnce(
        new Error(`OpenAI TTS API error 401: {"secret":"${SECRET_MARKER}","user":"test-user-id"}`),
      );

      const app = createTestApp();
      await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      const loggedArg = errorSpy.mock.calls[0][1] as Record<string, unknown>;
      expect(loggedArg).not.toHaveProperty('userId');
      expect(loggedArg).not.toHaveProperty('bucket');
      expect(loggedArg).not.toHaveProperty('s3Key');
      expect(loggedArg).not.toHaveProperty('error');
      expect(loggedArg).not.toHaveProperty('errorMessage');
      expect(loggedArg).toHaveProperty('errorName', 'Error');
      expect(loggedArg).toHaveProperty('category', 'provider_generate');
      const serialized = serializeLogArgs(errorSpy.mock.calls[0]);
      expect(serialized).not.toContain(SECRET_MARKER);
      expect(serialized).not.toContain('test-user-id');
      expect(serialized).not.toContain('test-bucket');
      errorSpy.mockRestore();
    });

    test('outer catch logs sanitized error and returns unexpected-error code', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockTtsSettingsDB.get.mockRejectedValueOnce(new Error('DynamoDB connection lost'));

      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: 'Failed to generate TTS audio',
        code: 'tts_unexpected_error',
      });
      const loggedArg = errorSpy.mock.calls[0][1] as Record<string, unknown>;
      expect(loggedArg).toHaveProperty('errorName', 'Error');
      expect(loggedArg).toHaveProperty('category', 'unexpected');
      expect(loggedArg).not.toHaveProperty('errorMessage');
      expect(serializeLogArgs(errorSpy.mock.calls[0])).not.toContain('DynamoDB connection lost');
      errorSpy.mockRestore();
    });

    test('sanitizeError maps an unknown error name to UnknownError and does not leak the raw name', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const SECRET_MARKER = 'sk-leaked-name-secret-XYZ';
      // error.name is writable; a hostile or third-party error can place
      // arbitrary content (secrets, response bodies, object keys) in it.
      // The sanitizer must normalize it through the allowlist and never emit
      // the raw value.
      const hostileError = new Error('upstream body');
      hostileError.name = `HostileError:${SECRET_MARKER}`;
      mockTtsSettingsDB.get.mockRejectedValueOnce(hostileError);

      const app = createTestApp();
      await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      const loggedArg = errorSpy.mock.calls[0][1] as Record<string, unknown>;
      expect(loggedArg).toHaveProperty('errorName', 'UnknownError');
      expect(loggedArg).not.toHaveProperty('errorMessage');
      expect(serializeLogArgs(errorSpy.mock.calls[0])).not.toContain(SECRET_MARKER);
      errorSpy.mockRestore();
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
      const body = (await res.json()) as {
        audioUrl: string;
        effectiveSettings?: { provider: string; voiceId: string | null; model: string | null };
      };
      expect(body.audioUrl).toBe('https://s3.example.com/cached-audio.mp3');
      // The audio lookup response echoes the effective settings used to derive
      // the S3 key so clients can detect a GET settings / GET audio race.
      expect(body.effectiveSettings).toEqual({
        provider: 'elevenlabs',
        voiceId: null,
        model: null,
      });
    });

    test('echoes effective settings with non-null voice and model', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'openai',
        api_key: 'test-api-key',
        voice_id: 'alloy',
        model: 'tts-1',
      });
      mockS3Client.send.mockResolvedValueOnce({}); // HeadObject succeeds
      mockGetSignedUrl.mockResolvedValueOnce('https://s3.example.com/cached-audio.mp3');

      const app = createTestApp();
      const res = await app.request('/audio/vocab-1');

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        audioUrl: string;
        effectiveSettings?: { provider: string; voiceId: string | null; model: string | null };
      };
      expect(body.effectiveSettings).toEqual({
        provider: 'openai',
        voiceId: 'alloy',
        model: 'tts-1',
      });
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

    test('returns 500 when presigned URL generation fails after upload', async () => {
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
      mockS3Client.send.mockResolvedValueOnce({});
      mockGetSignedUrl.mockRejectedValueOnce(new Error('Signing service unavailable'));

      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: 'Audio was saved but could not be accessed. Please try again.',
        code: 'tts_audio_access_failed',
      });
    });

    test('returns 500 when settings lookup fails during generate', async () => {
      mockTtsSettingsDB.get.mockRejectedValueOnce(new Error('Settings DB error'));

      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Failed to generate TTS audio');
    });

    test('returns 401 when userId is missing on generate', async () => {
      mockAuthConfig.userId = '';

      const app = createTestApp();
      const res = await app.request('/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vocabularyId: 'vocab-1', text: '日本語' }),
      });

      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Unauthorized');
    });

    test('returns 401 when userId is missing on get audio', async () => {
      mockAuthConfig.userId = '';

      const app = createTestApp();
      const res = await app.request('/audio/vocab-1');

      expect(res.status).toBe(401);
    });

    test('returns 500 when TTS audio bucket not configured on get audio', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'elevenlabs',
        api_key: 'test-api-key',
        voice_id: null,
        model: null,
      });

      const app = createTestApp({ AWS_REGION: 'us-east-1' });
      const res = await app.request('/audio/vocab-1');

      expect(res.status).toBe(500);
    });

    test('returns 400 when invalid provider in get audio settings', async () => {
      mockTtsSettingsDB.get.mockResolvedValueOnce({
        user_id: 'test-user-id',
        provider: 'invalid-provider',
        api_key: 'test-api-key',
        voice_id: null,
        model: null,
      });

      const app = createTestApp();
      const res = await app.request('/audio/vocab-1');

      expect(res.status).toBe(400);
    });

    test('returns 500 when settings lookup fails on get audio', async () => {
      mockTtsSettingsDB.get.mockRejectedValueOnce(new Error('Settings DB error'));

      const app = createTestApp();
      const res = await app.request('/audio/vocab-1');

      expect(res.status).toBe(500);
    });

    test('returns 401 when userId is missing on save settings', async () => {
      mockAuthConfig.userId = '';

      const app = createTestApp();
      const res = await app.request('/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'elevenlabs',
          apiKey: 'test-api-key',
        }),
      });

      expect(res.status).toBe(401);
    });
  });
});

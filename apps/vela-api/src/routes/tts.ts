import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env } from '../types';
import { ttsSettings as ttsSettingsDB } from '../dynamodb';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { requireAuth, type AuthContext } from '../middleware/auth';
import { createHash } from 'crypto';
import {
  resolveTtsSelection,
  TTS_PROVIDER_REGISTRY,
  TTS_PROVIDERS,
  type TtsApiErrorCode,
} from '@vela/common/contracts/tts';
import { createTTSProvider } from '../tts/factory';

function ttsError(error: string, code: TtsApiErrorCode) {
  return { error, code };
}

type TtsLogCategory =
  | 's3_cache_lookup'
  | 'provider_timeout'
  | 'provider_generate'
  | 's3_upload'
  | 's3_signing'
  | 'unexpected';

/**
 * Normalize an error to an allowlisted log shape. Never log raw error values,
 * `error.message` (providers embed the full upstream response body in it), the
 * user ID, user-scoped S3 object keys (which embed the userId), or bucket
 * names. Only the error class name and an operation category are emitted.
 *
 * `error.name` is writable and not trusted: third-party or deliberately
 * constructed errors can place arbitrary content (response bodies, secrets,
 * object keys) in it. Normalize through a finite allowlist and map anything
 * unknown to a fixed value.
 */
const SAFE_ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'AbortError',
  'TimeoutError',
  'NotFound',
  'NoSuchKey',
  // AWS SDK storage error names — stable, non-secret strings emitted by S3.
  // Preserved so ops can distinguish throttling, permission, timeout, and
  // outage conditions instead of collapsing them to UnknownError.
  'ServiceUnavailable',
  'AccessDenied',
  'ThrottlingException',
  'SlowDown',
]);

function extractErrorName(error: unknown): string {
  if (error instanceof Error) return error.name;
  if (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    typeof (error as { name: unknown }).name === 'string'
  ) {
    return (error as { name: string }).name;
  }
  return 'UnknownError';
}

function sanitizeError(
  error: unknown,
  category: TtsLogCategory,
): {
  operation: TtsLogCategory;
  errorName: string;
  category: TtsLogCategory;
} {
  const rawName = extractErrorName(error);
  const errorName = SAFE_ERROR_NAMES.has(rawName) ? rawName : 'UnknownError';
  return { operation: category, errorName, category };
}

/**
 * Generate a cache key that includes userId, provider, and TTS settings
 * Format: tts/{userId}/{vocabularyId}/{settingsHash}
 */
function generateCacheKey(
  userId: string,
  vocabularyId: string,
  provider: string,
  voiceId: string,
  model: string,
): string {
  const settingsHash = createHash('sha256')
    .update(`${provider}:${voiceId}:${model}`)
    .digest('hex')
    .substring(0, 16);

  return `tts/${userId}/${vocabularyId}/${settingsHash}`;
}

const TTSProviderSchema = z.enum(TTS_PROVIDERS);

const GenerateTTSSchema = z.object({
  vocabularyId: z.string().min(1),
  text: z.string().min(1),
});

const SaveTTSSettingsSchema = z
  .object({
    provider: TTSProviderSchema,
    // Blank/omitted is allowed only when the stored row already holds a key for
    // this same provider; the handler retains that key.
    apiKey: z.string().optional(),
    voiceId: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
  })
  // Stored settings are normalized on read; new writes must be supported now.
  .superRefine(({ provider, voiceId, model }, ctx) => {
    const providerInfo = TTS_PROVIDER_REGISTRY[provider];
    if (model != null && !providerInfo.models.some(({ id }) => id === model)) {
      ctx.addIssue({ code: 'custom', path: ['model'], message: 'Unsupported TTS model' });
    }
    if (voiceId != null && providerInfo.voices !== null && !providerInfo.voices.includes(voiceId)) {
      ctx.addIssue({ code: 'custom', path: ['voiceId'], message: 'Unsupported TTS voice' });
    }
  });

const VocabularyIdParamSchema = z.object({
  vocabularyId: z.string().min(1),
});

const createTTSRoute = (env: Env) => {
  const tts = new Hono<{ Bindings: Env } & AuthContext>();

  const region = env.AWS_REGION || process.env.AWS_REGION || 'us-east-1';
  const s3Client = new S3Client({ region });

  /**
   * POST /api/tts/generate
   * Generate TTS audio for a vocabulary word.
   * Checks S3 cache before calling the configured provider API.
   */
  tts.post('/generate', requireAuth, zValidator('json', GenerateTTSSchema), async (c) => {
    try {
      const { vocabularyId, text } = c.req.valid('json');
      const userId = c.get('userId');

      if (!userId) {
        return c.json({ error: 'Unauthorized: User ID not found' }, 401);
      }

      const settings = await ttsSettingsDB.get(userId);

      if (!settings || !settings.api_key) {
        return c.json(
          ttsError(
            'TTS API key not configured. Please configure in Settings.',
            'tts_not_configured',
          ),
          400,
        );
      }

      const bucketName = env.TTS_AUDIO_BUCKET_NAME || process.env.TTS_AUDIO_BUCKET_NAME;
      if (!bucketName) {
        return c.json(
          ttsError('TTS audio bucket not configured', 'tts_audio_bucket_not_configured'),
          500,
        );
      }

      const providerValue = settings.provider || 'elevenlabs';
      const providerParse = TTSProviderSchema.safeParse(providerValue);
      if (!providerParse.success) {
        return c.json(
          ttsError('Invalid TTS provider configuration', 'tts_invalid_provider_configuration'),
          400,
        );
      }
      const provider = providerParse.data;
      const ttsProvider = createTTSProvider(provider);
      // Resolve persisted null/legacy/unsupported values once, then use exactly
      // these values for the cache key, adapter call and client echo.
      const selection = resolveTtsSelection(provider, settings.model, settings.voice_id);
      const s3Key = generateCacheKey(
        userId,
        vocabularyId,
        selection.provider,
        selection.voiceId,
        selection.model,
      );

      // The effective settings the backend used to derive the cache key. The
      // client compares these against its GET /tts/settings snapshot to detect
      // a settings change between the two requests and avoid caching under a
      // stale identity.
      const effectiveSettings = selection;

      // Check S3 cache first
      try {
        await s3Client.send(new HeadObjectCommand({ Bucket: bucketName, Key: s3Key }));

        const audioUrl = await getSignedUrl(
          s3Client,
          new GetObjectCommand({ Bucket: bucketName, Key: s3Key }),
          { expiresIn: 900 },
        );

        return c.json({ audioUrl, cached: true, effectiveSettings });
      } catch (error: any) {
        if (error.name === 'NotFound' || error.name === 'NoSuchKey') {
          // Cache miss — fall through to generate
        } else {
          console.error('S3 cache check failed', {
            ...sanitizeError(error, 's3_cache_lookup'),
            provider,
          });
          return c.json(
            ttsError(
              'Audio service temporarily unavailable. Please try again.',
              'tts_audio_service_unavailable',
            ),
            503,
          );
        }
      }

      // Generate audio via provider
      let result;
      try {
        result = await ttsProvider.generate({
          text,
          apiKey: settings.api_key,
          voiceId: selection.voiceId,
          model: selection.model,
        });
      } catch (error: any) {
        // Named class, never a message substring: upstream bodies commonly
        // contain the word "timeout" and must not be reclassified.
        if (extractErrorName(error) === 'TimeoutError') {
          console.error('TTS provider timeout', {
            ...sanitizeError(error, 'provider_timeout'),
            provider,
          });
          return c.json(ttsError('TTS generation timed out', 'tts_generation_timeout'), 504);
        }
        console.error('TTS provider error', {
          ...sanitizeError(error, 'provider_generate'),
          provider,
        });
        return c.json(ttsError('Failed to generate TTS audio', 'tts_generation_failed'), 500);
      }

      // Upload to S3
      try {
        await s3Client.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: s3Key,
            Body: result.audioBuffer,
            ContentType: result.contentType,
          }),
        );
      } catch (uploadError: any) {
        console.error('S3 upload failed after successful TTS generation', {
          ...sanitizeError(uploadError, 's3_upload'),
          provider,
        });
        return c.json(
          ttsError(
            'Audio was generated but could not be saved. Please try again.',
            'tts_audio_storage_failed',
          ),
          500,
        );
      }

      let audioUrl: string;
      try {
        audioUrl = await getSignedUrl(
          s3Client,
          new GetObjectCommand({ Bucket: bucketName, Key: s3Key }),
          { expiresIn: 900 },
        );
      } catch (signingError: any) {
        console.error('Failed to generate presigned URL after S3 upload', {
          ...sanitizeError(signingError, 's3_signing'),
        });
        return c.json(
          ttsError(
            'Audio was saved but could not be accessed. Please try again.',
            'tts_audio_access_failed',
          ),
          500,
        );
      }

      return c.json({ audioUrl, cached: false, effectiveSettings });
    } catch (error) {
      console.error('TTS generation error', sanitizeError(error, 'unexpected'));
      return c.json(ttsError('Failed to generate TTS audio', 'tts_unexpected_error'), 500);
    }
  });

  /**
   * GET /api/tts/audio/:vocabularyId
   * Get presigned URL for existing cached audio.
   */
  tts.get(
    '/audio/:vocabularyId',
    requireAuth,
    zValidator('param', VocabularyIdParamSchema),
    async (c) => {
      try {
        const { vocabularyId } = c.req.valid('param');
        const userId = c.get('userId');

        if (!userId) {
          return c.json({ error: 'Unauthorized: User ID not found' }, 401);
        }

        const settings = await ttsSettingsDB.get(userId);
        if (!settings) {
          return c.json(
            ttsError('TTS settings not found. Please configure in Settings.', 'tts_not_configured'),
            400,
          );
        }

        const bucketName = env.TTS_AUDIO_BUCKET_NAME || process.env.TTS_AUDIO_BUCKET_NAME;
        if (!bucketName) {
          return c.json(
            ttsError('TTS audio bucket not configured', 'tts_audio_bucket_not_configured'),
            500,
          );
        }

        const providerValue = settings.provider || 'elevenlabs';
        const providerParse = TTSProviderSchema.safeParse(providerValue);
        if (!providerParse.success) {
          return c.json(
            ttsError('Invalid TTS provider configuration', 'tts_invalid_provider_configuration'),
            400,
          );
        }
        const provider = providerParse.data;
        const selection = resolveTtsSelection(provider, settings.model, settings.voice_id);
        const s3Key = generateCacheKey(
          userId,
          vocabularyId,
          selection.provider,
          selection.voiceId,
          selection.model,
        );

        // The effective settings the backend used to derive the cache key. The
        // client compares these against its GET /tts/settings snapshot to detect
        // a settings change between the two requests and avoid caching under a
        // stale identity.
        const effectiveSettings = selection;

        try {
          await s3Client.send(new HeadObjectCommand({ Bucket: bucketName, Key: s3Key }));

          const audioUrl = await getSignedUrl(
            s3Client,
            new GetObjectCommand({ Bucket: bucketName, Key: s3Key }),
            { expiresIn: 900 },
          );

          return c.json({ audioUrl, effectiveSettings });
        } catch (error: any) {
          if (error.name === 'NotFound' || error.name === 'NoSuchKey') {
            return c.json(
              ttsError('Audio not found. Please generate it first.', 'tts_audio_not_found'),
              404,
            );
          }
          console.error('S3 error', sanitizeError(error, 's3_cache_lookup'));
          return c.json(ttsError('Failed to retrieve audio', 'tts_audio_access_failed'), 500);
        }
      } catch (error) {
        console.error('Get audio error', sanitizeError(error, 'unexpected'));
        return c.json(ttsError('Failed to get audio URL', 'tts_unexpected_error'), 500);
      }
    },
  );

  /**
   * POST /api/tts/settings
   * Save TTS settings (provider, API key, voice, model).
   */
  tts.post('/settings', requireAuth, zValidator('json', SaveTTSSettingsSchema), async (c) => {
    try {
      const { provider, apiKey, voiceId, model } = c.req.valid('json');
      const userId = c.get('userId');

      if (!userId) {
        return c.json({ error: 'Unauthorized: User ID not found' }, 401);
      }

      // A blank/omitted key means "keep the stored key", but only for the same
      // saved provider. Never reuse a credential across providers, and never
      // treat a non-string stored value as a key.
      const providedKey = typeof apiKey === 'string' && apiKey.trim() ? apiKey : null;
      const existing = providedKey ? null : await ttsSettingsDB.get(userId);
      const retainedKey =
        existing?.provider === provider && typeof existing.api_key === 'string'
          ? existing.api_key
          : '';
      const savedKey = providedKey ?? retainedKey;

      if (!savedKey) {
        return c.json(
          ttsError('TTS API key required. Enter a key for this provider.', 'tts_not_configured'),
          400,
        );
      }

      await ttsSettingsDB.put({
        user_id: userId,
        provider,
        api_key: savedKey,
        voice_id: voiceId || null,
        model: model || null,
      });

      return c.json({ success: true, message: 'TTS settings saved successfully' });
    } catch (error) {
      console.error('Save TTS settings error', sanitizeError(error, 'unexpected'));
      return c.json(ttsError('Failed to save TTS settings', 'tts_unexpected_error'), 500);
    }
  });

  /**
   * GET /api/tts/settings
   * Get TTS settings for the authenticated user.
   */
  tts.get('/settings', requireAuth, async (c) => {
    try {
      const userId = c.get('userId');

      if (!userId) {
        return c.json({ error: 'Unauthorized: User ID not found' }, 401);
      }

      const settings = await ttsSettingsDB.get(userId);

      const providerValue = settings?.provider || 'elevenlabs';
      const providerParse = TTSProviderSchema.safeParse(providerValue);
      if (!providerParse.success) {
        // `storedValue` is a malformed provider enum, not identity-bearing or
        // secret. The userId is intentionally omitted from logs.
        console.warn('Invalid provider value in TTS settings, falling back to elevenlabs', {
          storedValue: providerValue,
        });
      }
      const provider = providerParse.success ? providerParse.data : 'elevenlabs';

      return c.json({
        hasApiKey: !!settings?.api_key,
        ...resolveTtsSelection(provider, settings?.model ?? null, settings?.voice_id ?? null),
      });
    } catch (error) {
      console.error('Get TTS settings error', sanitizeError(error, 'unexpected'));
      return c.json({ error: 'Failed to get TTS settings' }, 500);
    }
  });

  return tts;
};

export default createTTSRoute;

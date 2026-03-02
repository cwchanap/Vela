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
import { createTTSProvider } from '../tts/factory';

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

const TTSProviderSchema = z.enum(['elevenlabs', 'openai', 'gemini']);

const GenerateTTSSchema = z.object({
  vocabularyId: z.string().min(1),
  text: z.string().min(1),
});

const SaveTTSSettingsSchema = z.object({
  provider: TTSProviderSchema,
  apiKey: z.string().min(1),
  voiceId: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
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
        return c.json({ error: 'TTS API key not configured. Please configure in Settings.' }, 400);
      }

      const bucketName = env.TTS_AUDIO_BUCKET_NAME || process.env.TTS_AUDIO_BUCKET_NAME;
      if (!bucketName) {
        return c.json({ error: 'TTS audio bucket not configured' }, 500);
      }

      const providerValue = settings.provider || 'elevenlabs';
      const providerParse = TTSProviderSchema.safeParse(providerValue);
      if (!providerParse.success) {
        return c.json({ error: 'Invalid TTS provider configuration' }, 400);
      }
      const provider = providerParse.data;
      const ttsProvider = createTTSProvider(provider);
      const voiceId = settings.voice_id || '';
      const model = settings.model || '';
      const s3Key = generateCacheKey(userId, vocabularyId, provider, voiceId, model);

      // Check S3 cache first
      try {
        await s3Client.send(new HeadObjectCommand({ Bucket: bucketName, Key: s3Key }));

        const audioUrl = await getSignedUrl(
          s3Client,
          new GetObjectCommand({ Bucket: bucketName, Key: s3Key }),
          { expiresIn: 900 },
        );

        return c.json({ audioUrl, cached: true });
      } catch (error: any) {
        if (error.name === 'NotFound' || error.name === 'NoSuchKey') {
          // Cache miss — fall through to generate
        } else {
          console.error('S3 cache check failed', {
            errorName: error.name,
            errorMessage: error.message,
            userId,
            s3Key,
            bucket: bucketName,
          });
          return c.json({ error: 'Audio service temporarily unavailable. Please try again.' }, 503);
        }
      }

      // Generate audio via provider
      let result;
      try {
        result = await ttsProvider.generate({
          text,
          apiKey: settings.api_key,
          voiceId: settings.voice_id,
          model: settings.model,
        });
      } catch (error: any) {
        if (error.message?.includes('timeout')) {
          return c.json({ error: error.message }, 504);
        }
        console.error('TTS provider error:', error);
        return c.json({ error: `Failed to generate TTS audio: ${error.message}` }, 500);
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
          errorName: uploadError.name,
          errorMessage: uploadError.message,
          provider,
          userId,
          s3Key,
        });
        return c.json(
          { error: 'Audio was generated but could not be saved. Please try again.' },
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
          errorName: signingError.name,
          errorMessage: signingError.message,
          userId,
          s3Key,
        });
        return c.json(
          { error: 'Audio was saved but could not be accessed. Please try again.' },
          500,
        );
      }

      return c.json({ audioUrl, cached: false });
    } catch (error) {
      console.error('TTS generation error:', error);
      return c.json(
        { error: error instanceof Error ? error.message : 'Failed to generate TTS' },
        500,
      );
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
          return c.json({ error: 'TTS settings not found. Please configure in Settings.' }, 400);
        }

        const bucketName = env.TTS_AUDIO_BUCKET_NAME || process.env.TTS_AUDIO_BUCKET_NAME;
        if (!bucketName) {
          return c.json({ error: 'TTS audio bucket not configured' }, 500);
        }

        const providerValue = settings.provider || 'elevenlabs';
        const providerParse = TTSProviderSchema.safeParse(providerValue);
        if (!providerParse.success) {
          return c.json({ error: 'Invalid TTS provider configuration' }, 400);
        }
        const provider = providerParse.data;
        const s3Key = generateCacheKey(
          userId,
          vocabularyId,
          provider,
          settings.voice_id || '',
          settings.model || '',
        );

        try {
          await s3Client.send(new HeadObjectCommand({ Bucket: bucketName, Key: s3Key }));

          const audioUrl = await getSignedUrl(
            s3Client,
            new GetObjectCommand({ Bucket: bucketName, Key: s3Key }),
            { expiresIn: 900 },
          );

          return c.json({ audioUrl });
        } catch (error: any) {
          if (error.name === 'NotFound' || error.name === 'NoSuchKey') {
            return c.json({ error: 'Audio not found. Please generate it first.' }, 404);
          }
          console.error('S3 error:', error);
          return c.json({ error: 'Failed to retrieve audio' }, 500);
        }
      } catch (error) {
        console.error('Get audio error:', error);
        return c.json({ error: 'Failed to get audio URL' }, 500);
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

      await ttsSettingsDB.put({
        user_id: userId,
        provider,
        api_key: apiKey,
        voice_id: voiceId || null,
        model: model || null,
      });

      return c.json({ success: true, message: 'TTS settings saved successfully' });
    } catch (error) {
      console.error('Save TTS settings error:', error);
      return c.json(
        { error: error instanceof Error ? error.message : 'Failed to save TTS settings' },
        500,
      );
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

      if (!settings) {
        return c.json({
          hasApiKey: false,
          provider: 'elevenlabs',
          voiceId: null,
          model: null,
        });
      }

      const providerValue = settings.provider || 'elevenlabs';
      const providerParse = TTSProviderSchema.safeParse(providerValue);
      const provider = providerParse.success ? providerParse.data : 'elevenlabs';

      return c.json({
        hasApiKey: !!settings.api_key,
        provider,
        voiceId: settings.voice_id || null,
        model: settings.model || null,
      });
    } catch (error) {
      console.error('Get TTS settings error:', error);
      return c.json({ error: 'Failed to get TTS settings' }, 500);
    }
  });

  return tts;
};

export default createTTSRoute;

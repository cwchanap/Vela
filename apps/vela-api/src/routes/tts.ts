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

/**
 * Default TTS settings for ElevenLabs
 */
const DEFAULT_VOICE_ID = 'ErXwobaYiN019PkySvjV';
const DEFAULT_MODEL = 'eleven_multilingual_v2';

/**
 * Generate a cache key that includes userId and TTS settings
 * This ensures each user gets their own cached audio with their chosen voice/model
 * Format: tts/{userId}/{vocabularyId}/{settingsHash}.mp3
 */
function generateCacheKey(
  userId: string,
  vocabularyId: string,
  voiceId: string,
  model: string,
): string {
  // Create a hash of the voice and model settings to keep keys short
  const settingsHash = createHash('sha256')
    .update(`${voiceId}:${model}`)
    .digest('hex')
    .substring(0, 16); // Use first 16 chars for brevity

  return `tts/${userId}/${vocabularyId}/${settingsHash}.mp3`;
}

// Validation schemas (userId removed - will be extracted from JWT)
const GenerateTTSSchema = z.object({
  vocabularyId: z.string().min(1),
  text: z.string().min(1),
});

const SaveTTSSettingsSchema = z.object({
  apiKey: z.string().min(1),
  voiceId: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
});

const VocabularyIdParamSchema = z.object({
  vocabularyId: z.string().min(1),
});

// Type for authenticated context with userId
type AuthContext = {
  Variables: {
    userId: string;
  };
};

const createTTSRoute = (env: Env) => {
  const tts = new Hono<{ Bindings: Env } & AuthContext>();

  // Secure CORS handler with origin validation
  tts.use('*', async (c, next) => {
    const origin = c.req.header('Origin');

    // Parse allowed origins from environment variable
    const allowedOrigins = env.CORS_ALLOWED_ORIGINS?.split(',').map((o) => o.trim()) || [];

    // Check if the request origin is in the allowlist
    const isAllowedOrigin = origin && allowedOrigins.includes(origin);

    if (isAllowedOrigin) {
      // Set specific origin instead of wildcard
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Access-Control-Allow-Credentials', 'true');
    } else if (origin) {
      // Origin not allowed - return 403 for non-OPTIONS requests
      if (c.req.method !== 'OPTIONS') {
        return c.json({ error: 'CORS policy violation: Origin not allowed' }, 403);
      }
      // For OPTIONS requests with invalid origin, don't set CORS headers
      await next();
      return;
    }

    // Set other CORS headers
    c.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    c.header('Access-Control-Allow-Headers', 'content-type, authorization');

    if (c.req.method === 'OPTIONS') {
      return c.text('', 200);
    }

    await next();
  });

  /**
   * POST /api/tts/generate
   * Generate TTS audio for a vocabulary word using ElevenLabs
   * Requires authentication - userId extracted from JWT token
   */
  tts.post('/generate', requireAuth, zValidator('json', GenerateTTSSchema), async (c) => {
    try {
      const { vocabularyId, text } = c.req.valid('json');
      const userId = c.get('userId'); // Extract from authenticated context

      if (!userId) {
        return c.json({ error: 'Unauthorized: User ID not found' }, 401);
      }

      // Get user's TTS settings from DynamoDB
      const settings = await ttsSettingsDB.get(userId);

      if (!settings || !settings.api_key) {
        return c.json({ error: 'TTS API key not configured. Please configure in Settings.' }, 400);
      }

      const { api_key: apiKey, voice_id: voiceId, model } = settings;

      // Initialize S3 client - use process.env in production
      const region = env.AWS_REGION || process.env.AWS_REGION || 'us-east-1';
      const bucketName = env.TTS_AUDIO_BUCKET_NAME || process.env.TTS_AUDIO_BUCKET_NAME;

      const s3Client = new S3Client({ region });

      if (!bucketName) {
        return c.json({ error: 'TTS audio bucket not configured' }, 500);
      }

      // Generate cache key that includes userId and TTS settings
      // This ensures each user gets their own cached audio with their chosen voice/model
      const effectiveVoiceId = voiceId || DEFAULT_VOICE_ID;
      const effectiveModel = model || DEFAULT_MODEL;
      const s3Key = generateCacheKey(userId, vocabularyId, effectiveVoiceId, effectiveModel);

      try {
        // Use HeadObjectCommand to check if object exists without downloading it
        const headCommand = new HeadObjectCommand({
          Bucket: bucketName,
          Key: s3Key,
        });

        await s3Client.send(headCommand);

        // If we reach here, object exists - return pre-signed URL
        const getCommand = new GetObjectCommand({
          Bucket: bucketName,
          Key: s3Key,
        });
        const audioUrl = await getSignedUrl(s3Client, getCommand, { expiresIn: 3600 });

        return c.json({
          audioUrl,
          cached: true,
        });
      } catch (error: any) {
        // Object doesn't exist (NotFound error), proceed to generate
        if (error.name !== 'NotFound' && error.name !== 'NoSuchKey') {
          console.error('S3 check error:', error);
          // Non-404 errors should be logged but we'll still try to generate
        }
      }

      // Call ElevenLabs API to generate audio with timeout
      const elevenLabsUrl = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId || DEFAULT_VOICE_ID}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      let elevenLabsResponse: Response;
      try {
        elevenLabsResponse = await fetch(elevenLabsUrl, {
          method: 'POST',
          headers: {
            Accept: 'audio/mpeg',
            'Content-Type': 'application/json',
            'xi-api-key': apiKey,
          },
          body: JSON.stringify({
            text,
            model_id: model || DEFAULT_MODEL,
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
            },
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId); // Clear timeout on successful fetch
      } catch (error: any) {
        clearTimeout(timeoutId); // Clear timeout on error
        if (error.name === 'AbortError') {
          return c.json({ error: 'Request timeout: TTS generation took too long' }, 504);
        }
        throw error; // Re-throw other errors to be handled by outer catch
      }

      if (!elevenLabsResponse.ok) {
        const errorText = await elevenLabsResponse.text();
        console.error('ElevenLabs API error:', errorText);
        return c.json(
          {
            error: `Failed to generate TTS audio: ${elevenLabsResponse.statusText}`,
          },
          500,
        );
      }

      // Get audio buffer from ElevenLabs
      const audioBuffer = await elevenLabsResponse.arrayBuffer();

      // Upload to S3
      const putCommand = new PutObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
        Body: Buffer.from(audioBuffer),
        ContentType: 'audio/mpeg',
      });

      await s3Client.send(putCommand);

      // Generate pre-signed URL
      const getCommand = new GetObjectCommand({
        Bucket: bucketName,
        Key: s3Key,
      });

      const audioUrl = await getSignedUrl(s3Client, getCommand, { expiresIn: 3600 });

      return c.json({
        audioUrl,
        cached: false,
      });
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
   * Get audio URL for a vocabulary item
   * Requires authentication to prevent unauthorized access
   */
  tts.get(
    '/audio/:vocabularyId',
    requireAuth,
    zValidator('param', VocabularyIdParamSchema),
    async (c) => {
      try {
        const { vocabularyId } = c.req.valid('param');
        const userId = c.get('userId'); // Extract from authenticated context

        if (!userId) {
          return c.json({ error: 'Unauthorized: User ID not found' }, 401);
        }

        // Get user's TTS settings to determine the correct cache key
        const settings = await ttsSettingsDB.get(userId);

        if (!settings) {
          return c.json({ error: 'TTS settings not found. Please configure in Settings.' }, 400);
        }

        const { voice_id: voiceId, model } = settings;
        const effectiveVoiceId = voiceId || DEFAULT_VOICE_ID;
        const effectiveModel = model || DEFAULT_MODEL;

        // Initialize S3 client - use process.env in production
        const region = env.AWS_REGION || process.env.AWS_REGION || 'us-east-1';
        const bucketName = env.TTS_AUDIO_BUCKET_NAME || process.env.TTS_AUDIO_BUCKET_NAME;

        const s3Client = new S3Client({ region });

        if (!bucketName) {
          return c.json({ error: 'TTS audio bucket not configured' }, 500);
        }

        // Generate user-specific cache key
        const s3Key = generateCacheKey(userId, vocabularyId, effectiveVoiceId, effectiveModel);

        try {
          // Use HeadObjectCommand to verify object exists
          const headCommand = new HeadObjectCommand({
            Bucket: bucketName,
            Key: s3Key,
          });

          await s3Client.send(headCommand);

          // Object exists, generate pre-signed URL
          const getCommand = new GetObjectCommand({
            Bucket: bucketName,
            Key: s3Key,
          });

          const audioUrl = await getSignedUrl(s3Client, getCommand, { expiresIn: 3600 });

          return c.json({ audioUrl });
        } catch (error: any) {
          // Audio not found in S3
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
   * Save TTS settings (ElevenLabs API key, voice ID, model)
   * Requires authentication - userId extracted from JWT token
   */
  tts.post('/settings', requireAuth, zValidator('json', SaveTTSSettingsSchema), async (c) => {
    try {
      const { apiKey, voiceId, model } = c.req.valid('json');
      const userId = c.get('userId'); // Extract from authenticated context

      if (!userId) {
        return c.json({ error: 'Unauthorized: User ID not found' }, 401);
      }

      await ttsSettingsDB.put({
        user_id: userId,
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
   * Get TTS settings for the authenticated user
   * Requires authentication - userId extracted from JWT token
   */
  tts.get('/settings', requireAuth, async (c) => {
    try {
      const userId = c.get('userId'); // Extract from authenticated context

      if (!userId) {
        return c.json({ error: 'Unauthorized: User ID not found' }, 401);
      }

      const settings = await ttsSettingsDB.get(userId);

      if (!settings) {
        return c.json({
          hasApiKey: false,
          voiceId: null,
          model: null,
        });
      }

      return c.json({
        hasApiKey: !!settings.api_key,
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

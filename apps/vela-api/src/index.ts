import { Hono } from 'hono';
import { handle } from 'hono/aws-lambda';
import { llmChat } from './routes/llm-chat';
import { chatHistory } from './routes/chat-history';
import { games } from './routes/games';
import { progress } from './routes/progress';
import { profiles as createProfilesRoute } from './routes/profiles';
import auth from './routes/auth';
import myDictionaries from './routes/my-dictionaries';
import createTTSRoute from './routes/tts';
import type { Env } from './types';
import { serve } from '@hono/node-server';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { Context, Next } from 'hono';
import { initializeAuthVerifier } from './middleware/auth';

const app = new Hono<{ Bindings: Env }>();

if (process.env.NODE_ENV === 'development') {
  // Load .env file manually (prefer app-specific .env, then root .env)
  try {
    const apiEnvPath = resolve(process.cwd(), 'apps/vela-api/.env');
    const rootEnvPath = resolve(process.cwd(), '.env');
    const envPath = existsSync(apiEnvPath) ? apiEnvPath : rootEnvPath;
    const envContent = readFileSync(envPath, 'utf-8');
    const envLines = envContent.split('\n');

    for (const line of envLines) {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').trim();
        process.env[key.trim()] = value;
      }
    }
    console.log(`✅ Loaded .env file from: ${envPath}`);
  } catch (error) {
    console.log(
      '⚠️ Could not load .env file:',
      error instanceof Error ? error.message : String(error),
    );
  }

  // Initialize auth verifier AFTER loading .env so Cognito config is available
  const userPoolId = process.env.VITE_COGNITO_USER_POOL_ID;
  const clientId = process.env.VITE_COGNITO_USER_POOL_CLIENT_ID || process.env.COGNITO_CLIENT_ID;

  if (userPoolId && clientId) {
    initializeAuthVerifier(userPoolId, clientId);
  } else {
    console.warn(
      '⚠️ Cognito configuration missing. Authentication will fail for protected routes.',
    );
  }

  // Mock environment variables for development
  const mockEnv: Env = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    APP_NAME: process.env.APP_NAME || 'Vela Japanese Learning App (Dev)',
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_REGION: process.env.AWS_REGION || 'us-east-1',
    VITE_COGNITO_USER_POOL_ID: process.env.VITE_COGNITO_USER_POOL_ID,
    DDB_ENDPOINT: process.env.DDB_ENDPOINT || process.env.VITE_DDB_ENDPOINT,
    DDB_REGION: process.env.DDB_REGION || process.env.VITE_DDB_REGION,
    DDB_TABLE: process.env.DDB_TABLE || process.env.VITE_DDB_TABLE,
    COGNITO_CLIENT_ID:
      process.env.COGNITO_CLIENT_ID || process.env.VITE_COGNITO_USER_POOL_CLIENT_ID,
    TTS_AUDIO_BUCKET_NAME: process.env.TTS_AUDIO_BUCKET_NAME,
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
  };

  console.log('Environment variables loaded:', {
    AWS_REGION: mockEnv.AWS_REGION,
    VITE_COGNITO_USER_POOL_ID: mockEnv.VITE_COGNITO_USER_POOL_ID ? 'present' : 'missing',
    VITE_COGNITO_USER_POOL_CLIENT_ID: process.env.VITE_COGNITO_USER_POOL_CLIENT_ID
      ? 'present'
      : 'missing',
    COGNITO_CLIENT_ID: mockEnv.COGNITO_CLIENT_ID ? 'present' : 'missing',
    AWS_ACCESS_KEY_ID: mockEnv.AWS_ACCESS_KEY_ID ? 'present' : 'missing',
    DDB_ENDPOINT: mockEnv.DDB_ENDPOINT ? mockEnv.DDB_ENDPOINT : 'not set',
    DDB_TABLE: mockEnv.DDB_TABLE ? mockEnv.DDB_TABLE : 'not set',
  });

  // Add middleware to inject mock environment
  app.use('*', async (c: Context, next: Next) => {
    if (!c.env) {
      // @ts-ignore - Inject mock environment for development
      c.env = mockEnv;
    }
    await next();
  });

  const port = 9005;
  console.log(`🚀 Vela API development server running on port ${port}`);

  serve({
    fetch: app.fetch,
    port,
  });
}

app.get('/', (c) => {
  return c.text('Vela API - Hello Hono!');
});

// Mount the LLM chat routes
app.route('/api/llm-chat', llmChat);

// Mount the chat history routes
app.route('/api/chat-history', chatHistory);

// Mount the games routes
app.route('/api/games', games);

// Mount the progress routes
app.route('/api/progress', progress);

// Mount the profiles routes
if (process.env.NODE_ENV === 'development') {
  const mockEnv: Env = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    APP_NAME: process.env.APP_NAME || 'Vela Japanese Learning App (Dev)',
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_REGION: process.env.AWS_REGION || 'us-east-1',
    VITE_COGNITO_USER_POOL_ID: process.env.VITE_COGNITO_USER_POOL_ID,
    DDB_ENDPOINT: process.env.DDB_ENDPOINT || process.env.VITE_DDB_ENDPOINT,
    DDB_REGION: process.env.DDB_REGION || process.env.VITE_DDB_REGION,
    DDB_TABLE: process.env.DDB_TABLE || process.env.VITE_DDB_TABLE,
    COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID,
    TTS_AUDIO_BUCKET_NAME: process.env.TTS_AUDIO_BUCKET_NAME,
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
  };
  const profiles = createProfilesRoute(mockEnv);
  app.route('/api/profiles', profiles);

  const tts = createTTSRoute(mockEnv);
  app.route('/api/tts', tts);
} else {
  // Production: Initialize auth verifier with Lambda environment variables
  const userPoolId = process.env.VITE_COGNITO_USER_POOL_ID;
  const clientId = process.env.VITE_COGNITO_USER_POOL_CLIENT_ID || process.env.COGNITO_CLIENT_ID;

  if (userPoolId && clientId) {
    initializeAuthVerifier(userPoolId, clientId);
  } else {
    console.warn('⚠️ Cognito configuration missing in production. Authentication will fail.');
  }

  // Production: Create env object from Lambda environment variables
  const prodEnv: Env = {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    APP_NAME: process.env.APP_NAME,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_REGION: process.env.AWS_REGION,
    VITE_COGNITO_USER_POOL_ID: process.env.VITE_COGNITO_USER_POOL_ID,
    DDB_ENDPOINT: process.env.DDB_ENDPOINT,
    DDB_REGION: process.env.DDB_REGION,
    DDB_TABLE: process.env.DDB_TABLE,
    COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID,
    TTS_AUDIO_BUCKET_NAME: process.env.TTS_AUDIO_BUCKET_NAME,
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
  };

  const profiles = createProfilesRoute(prodEnv);
  app.route('/api/profiles', profiles);

  const tts = createTTSRoute(prodEnv);
  app.route('/api/tts', tts);
}

// Mount the auth routes
app.route('/api/auth', auth);

// Mount the my dictionaries routes
app.route('/api/my-dictionaries', myDictionaries);

export const handler = handle(app);

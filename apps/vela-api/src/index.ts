import { Hono } from 'hono';
import { handle } from 'hono/aws-lambda';
import { llmChat } from './routes/llm-chat';
import { chatHistory } from './routes/chat-history';
import { games } from './routes/games';
import { progress } from './routes/progress';
import { profiles as createProfilesRoute } from './routes/profiles';
import auth from './routes/auth';
import myDictionaries from './routes/my-dictionaries';
import srsRouter from './routes/srs';
import dictionaryRouter from './routes/dictionary';
import vocabularyRouter from './routes/vocabulary';
import createTTSRoute from './routes/tts';
import { dsqlHealth } from './routes/dsql-health';
import type { Env } from './types';
import { buildEnv } from './env';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { Context, Next } from 'hono';
import { initializeAuthFromEnv } from './auth-initialization';
import { corsMiddleware } from './middleware/cors';

const app = new Hono<{ Bindings: Env }>();
const bunRuntime = (globalThis as typeof globalThis & { Bun?: any }).Bun ?? null;

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
        const trimmedKey = key.trim();
        // Preserve values already set in the environment (e.g. by Playwright's
        // webServer env) so that test overrides are not clobbered by .env.
        if (!(trimmedKey in process.env)) {
          process.env[trimmedKey] = valueParts.join('=').trim();
        }
      }
    }
    console.log(`✅ Loaded .env file from: ${envPath}`);
  } catch (error) {
    console.log(
      '⚠️ Could not load .env file:',
      error instanceof Error ? error.message : String(error),
    );
  }
}

// Build env once and reuse
const appEnv = buildEnv();

// Initialize auth verifier using values from appEnv for consistency.
initializeAuthFromEnv(appEnv);

if (process.env.NODE_ENV === 'development') {
  console.log('Environment variables loaded:', {
    AWS_REGION: appEnv.AWS_REGION,
    VITE_COGNITO_USER_POOL_ID: appEnv.VITE_COGNITO_USER_POOL_ID ? 'present' : 'missing',
    VITE_COGNITO_USER_POOL_CLIENT_ID: process.env.VITE_COGNITO_USER_POOL_CLIENT_ID
      ? 'present'
      : 'missing',
    COGNITO_CLIENT_ID: appEnv.COGNITO_CLIENT_ID ? 'present' : 'missing',
    COGNITO_MOBILE_CLIENT_ID: appEnv.COGNITO_MOBILE_CLIENT_ID ? 'present' : 'missing',
    AWS_ACCESS_KEY_ID: appEnv.AWS_ACCESS_KEY_ID ? 'present' : 'missing',
    DDB_ENDPOINT: appEnv.DDB_ENDPOINT ? appEnv.DDB_ENDPOINT : 'not set',
    DDB_TABLE: appEnv.DDB_TABLE ? appEnv.DDB_TABLE : 'not set',
  });

  // Add middleware to inject environment for development
  app.use('*', async (c: Context, next: Next) => {
    if (!c.env) {
      (c as Context<{ Bindings: Env }>).env = appEnv;
    }
    await next();
  });

  const port = Number(process.env.PORT) || 9005;
  if (bunRuntime) {
    bunRuntime.serve({
      fetch: app.fetch,
      port,
    });
    console.log(`🚀 Vela API development server running on port ${port}`);
  } else {
    console.log(
      '⚠️ Bun runtime not detected. Run "bun --watch src/index.ts" for the local API dev server.',
    );
  }
}

// Apply centralized CORS middleware globally
app.use('*', corsMiddleware);

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

// Mount the internal DSQL health-check route under the /api prefix so that
// it is reachable externally at /prod/api/internal/dsql-health via API
// Gateway's /api proxy resource.
app.route('/api/internal/dsql-health', dsqlHealth);

// Mount the profiles and TTS routes (both need env for factory pattern)
const profiles = createProfilesRoute(appEnv);
app.route('/api/profiles', profiles);

const tts = createTTSRoute(appEnv);
app.route('/api/tts', tts);

// Mount the auth routes
app.route('/api/auth', auth);

// Mount the my dictionaries routes
app.route('/api/my-dictionaries', myDictionaries);

// Mount the SRS (Spaced Repetition System) routes
app.route('/api/srs', srsRouter);

// Mount the dictionary (Jisho proxy) routes
app.route('/api/dictionary', dictionaryRouter);

// Mount the vocabulary routes (flashcard creation)
app.route('/api/vocabulary', vocabularyRouter);

export const handler = handle(app);

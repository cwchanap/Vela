import { Hono } from 'hono';
import { handle } from 'hono/aws-lambda';
import { llmChat } from './routes/llm-chat';
import { chatHistory } from './routes/chat-history';
import { games } from './routes/games';
import { progress } from './routes/progress';
import { profiles } from './routes/profiles';
import auth from './routes/auth';
import type { Env } from './types';
import { serve } from '@hono/node-server';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Context, Next } from 'hono';

const app = new Hono<{ Bindings: Env }>();

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
app.route('/api/profiles', profiles);

// Mount the auth routes
app.route('/api/auth', auth);

export const handler = handle(app);

if (process.env.NODE_ENV === 'development') {
  // Load .env file manually
  try {
    const envPath = resolve(process.cwd(), '.env');
    const envContent = readFileSync(envPath, 'utf-8');
    const envLines = envContent.split('\n');

    for (const line of envLines) {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        const value = valueParts.join('=').trim();
        process.env[key.trim()] = value;
      }
    }
    console.log('✅ Loaded .env file');
  } catch (error) {
    console.log(
      '⚠️ Could not load .env file:',
      error instanceof Error ? error.message : String(error),
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
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    DDB_ENDPOINT: process.env.DDB_ENDPOINT,
    DDB_REGION: process.env.DDB_REGION,
    DDB_TABLE: process.env.DDB_TABLE,
    COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID,
  };

  console.log('Environment variables loaded:', {
    AWS_REGION: mockEnv.AWS_REGION,
    VITE_COGNITO_USER_POOL_ID: mockEnv.VITE_COGNITO_USER_POOL_ID,
    AWS_ACCESS_KEY_ID: mockEnv.AWS_ACCESS_KEY_ID ? 'present' : 'missing',
    SUPABASE_URL: mockEnv.SUPABASE_URL,
    SUPABASE_ANON_KEY: mockEnv.SUPABASE_ANON_KEY ? 'present' : 'missing',
  });

  // Add middleware to inject mock environment
  app.use('*', async (c: Context, next: Next) => {
    // @ts-ignore - Inject mock environment for development
    c.env = mockEnv;
    await next();
  });

  const port = 9005;
  console.log(`🚀 Vela API development server running on port ${port}`);

  serve({
    fetch: app.fetch,
    port,
  });
}

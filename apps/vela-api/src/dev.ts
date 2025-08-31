import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { llmChat } from './routes/llm-chat';
import { chatHistory } from './routes/chat-history';
import type { Env } from './types';

const app = new Hono<{ Bindings: Env }>();

// Mock environment variables for development
const mockEnv: Env = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  APP_NAME: process.env.APP_NAME || 'Vela Japanese Learning App (Dev)',
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  DDB_ENDPOINT: process.env.DDB_ENDPOINT,
  DDB_REGION: process.env.DDB_REGION,
  DDB_TABLE: process.env.DDB_TABLE,
};

// Add middleware to inject mock environment
app.use('*', async (c, next) => {
  // @ts-ignore - Inject mock environment for development
  c.env = mockEnv;
  await next();
});

app.get('/', (c) => {
  return c.text('Vela API - Development Server');
});

// Mount the LLM chat routes
app.route('/api/llm-chat', llmChat);

// Mount the chat history routes
app.route('/api/chat-history', chatHistory);

const port = 3001;
console.log(`🚀 Vela API development server running on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});

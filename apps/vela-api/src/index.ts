import { Hono } from 'hono';
import { handle } from 'hono/aws-lambda';
import { llmChat } from './routes/llm-chat';
import { chatHistory } from './routes/chat-history';
import { games } from './routes/games';
import { progress } from './routes/progress';
import { profiles } from './routes/profiles';
import auth from './routes/auth';
import type { Env } from './types';

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

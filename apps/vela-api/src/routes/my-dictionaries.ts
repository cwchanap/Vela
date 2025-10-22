import { Hono } from 'hono';
import {
  GetUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { myDictionaries } from '../dynamodb';
import type { Env } from '../types';

const app = new Hono<{ Bindings: Env }>();

const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

// CORS middleware
app.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
  c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (c.req.method === 'OPTIONS') {
    return c.text('', 200);
  }
  await next();
});

// Helper to validate token and extract user ID from Cognito
async function getUserIdFromToken(authHeader: string | undefined): Promise<string | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  try {
    const accessToken = authHeader.substring(7);

    // IMPORTANT: Validate token with Cognito to verify signature and prevent forgery
    const getUserCommand = new GetUserCommand({
      AccessToken: accessToken,
    });

    const userResponse = await cognitoClient.send(getUserCommand);

    // IMPORTANT: Return email to match existing saved_sentences table data
    // The saved_sentences table was created with email as the user_id partition key
    // (unlike chat_history which uses Cognito sub)
    const email = userResponse.UserAttributes?.find((attr) => attr.Name === 'email')?.Value;

    return email || null;
  } catch (error) {
    console.error('Token validation error:', error);
    return null;
  }
}

// Save a sentence
app.post('/', async (c) => {
  try {
    const userId = await getUserIdFromToken(c.req.header('Authorization'));

    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const body = await c.req.json();
    const { sentence, sourceUrl, context } = body;

    if (!sentence || typeof sentence !== 'string' || sentence.trim().length === 0) {
      return c.json({ error: 'Sentence is required' }, 400);
    }

    const result = await myDictionaries.create(userId, sentence.trim(), sourceUrl, context);

    return c.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    console.error('Error saving sentence:', error);
    return c.json({ error: 'Failed to save sentence' }, 500);
  }
});

// Get user's saved sentences
app.get('/', async (c) => {
  try {
    const userId = await getUserIdFromToken(c.req.header('Authorization'));

    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const limit = parseInt(c.req.query('limit') || '50', 10);

    const sentences = await myDictionaries.getByUser(userId, limit);

    return c.json({
      success: true,
      data: sentences,
    });
  } catch (error: any) {
    console.error('Error fetching saved sentences:', error);
    return c.json({ error: 'Failed to fetch saved sentences' }, 500);
  }
});

// Delete a saved sentence
app.delete('/:sentenceId', async (c) => {
  try {
    const userId = await getUserIdFromToken(c.req.header('Authorization'));

    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const sentenceId = c.req.param('sentenceId');

    if (!sentenceId) {
      return c.json({ error: 'Sentence ID is required' }, 400);
    }

    await myDictionaries.delete(userId, sentenceId);

    return c.json({
      success: true,
      message: 'Sentence deleted successfully',
    });
  } catch (error: any) {
    console.error('Error deleting sentence:', error);
    return c.json({ error: 'Failed to delete sentence' }, 500);
  }
});

export default app;

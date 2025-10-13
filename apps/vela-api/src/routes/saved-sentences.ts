import { Hono, Context } from 'hono';
import {
  GetUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { savedSentences } from '../dynamodb';
import type { Env } from '../types';

type Variables = {
  userId: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

// Middleware to verify authentication and extract user ID
async function authMiddleware(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  next: () => Promise<void>,
) {
  try {
    const authHeader = c.req.header('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized: No access token provided' }, 401);
    }

    const accessToken = authHeader.substring(7);

    const getUserCommand = new GetUserCommand({
      AccessToken: accessToken,
    });

    const userResponse = await cognitoClient.send(getUserCommand);
    const email = userResponse.UserAttributes?.find((attr) => attr.Name === 'email')?.Value;

    if (!email) {
      return c.json({ error: 'Unauthorized: User email not found' }, 401);
    }

    // Store user ID in context for use in routes
    c.set('userId', email);
    await next();
  } catch (error: any) {
    console.error('Auth middleware error:', error);

    if (error.name === 'NotAuthorizedException' || error.name === 'InvalidParameterException') {
      return c.json({ error: 'Unauthorized: Invalid or expired token' }, 401);
    }

    return c.json({ error: 'Authentication failed' }, 500);
  }
}

// Apply auth middleware to all routes
app.use('*', authMiddleware);

// Save a sentence
app.post('/', async (c) => {
  try {
    const userId = c.get('userId');
    const body = await c.req.json();
    const { sentence, sourceUrl, context } = body;

    if (!sentence || typeof sentence !== 'string' || sentence.trim().length === 0) {
      return c.json({ error: 'Sentence is required' }, 400);
    }

    const result = await savedSentences.create(userId, sentence.trim(), sourceUrl, context);

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
    const userId = c.get('userId');
    const limit = parseInt(c.req.query('limit') || '50', 10);

    const sentences = await savedSentences.getByUser(userId, limit);

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
    const userId = c.get('userId');
    const sentenceId = c.req.param('sentenceId');

    if (!sentenceId) {
      return c.json({ error: 'Sentence ID is required' }, 400);
    }

    await savedSentences.delete(userId, sentenceId);

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

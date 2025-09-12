import { Hono } from 'hono';
import {
  CognitoIdentityProviderClient,
  AdminConfirmSignUpCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const app = new Hono();

const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

// Auto-confirm user endpoint
app.post('/auto-confirm', async (c) => {
  try {
    const { email } = await c.req.json();

    if (!email) {
      return c.json({ error: 'Email is required' }, 400);
    }

    const userPoolId = process.env.VITE_COGNITO_USER_POOL_ID;
    if (!userPoolId) {
      return c.json({ error: 'User pool ID not configured' }, 500);
    }

    // Auto-confirm the user using admin API
    const command = new AdminConfirmSignUpCommand({
      UserPoolId: userPoolId,
      Username: email,
    });

    await cognitoClient.send(command);

    console.log(`✅ User ${email} auto-confirmed successfully`);
    return c.json({ success: true, message: 'User auto-confirmed successfully' });
  } catch (error) {
    console.error('Auto-confirm error:', error);
    return c.json({ error: 'Failed to auto-confirm user' }, 500);
  }
});

export default app;

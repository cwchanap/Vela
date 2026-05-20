import { Hono } from 'hono';
import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  AdminUserGlobalSignOutCommand,
  GetUserCommand,
  InitiateAuthCommandOutput,
} from '@aws-sdk/client-cognito-identity-provider';
import type { Env } from '../types';
import { requireAuth, type AuthContext } from '../middleware/auth';

const app = new Hono<{ Bindings: Env } & AuthContext>();

const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

// Refresh token endpoint
app.post('/refresh', async (c) => {
  try {
    const { refreshToken } = await c.req.json();

    if (!refreshToken) {
      return c.json({ error: 'Refresh token is required' }, 400);
    }

    const clientId = process.env.COGNITO_CLIENT_ID || process.env.VITE_COGNITO_USER_POOL_CLIENT_ID;
    if (!clientId) {
      return c.json({ error: 'Cognito client ID not configured' }, 500);
    }

    const authCommand = new InitiateAuthCommand({
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: clientId,
      AuthParameters: {
        REFRESH_TOKEN: refreshToken,
      },
    });

    const authResponse: InitiateAuthCommandOutput = await cognitoClient.send(authCommand);

    if (authResponse.AuthenticationResult) {
      return c.json({
        success: true,
        message: 'Token refreshed successfully',
        tokens: {
          accessToken: authResponse.AuthenticationResult.AccessToken,
          idToken: authResponse.AuthenticationResult.IdToken,
          // Refresh token is not returned in REFRESH_TOKEN_AUTH flow, use the existing one
          refreshToken: refreshToken,
        },
      });
    } else {
      return c.json({ error: 'Token refresh failed' }, 401);
    }
  } catch (error: any) {
    console.error('Token refresh error:', error);

    if (error.name === 'NotAuthorizedException') {
      return c.json({ error: 'Invalid or expired refresh token' }, 401);
    }

    return c.json({ error: 'Token refresh failed', name: error?.name }, 500);
  }
});

// Sign out endpoint
app.post('/signout', async (c) => {
  try {
    const authHeader = c.req.header('Authorization');

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const accessToken = authHeader.substring(7);

      const userPoolId = c.env.VITE_COGNITO_USER_POOL_ID;
      if (userPoolId) {
        // Get username from access token to perform global sign out
        try {
          const getUserCommand = new GetUserCommand({
            AccessToken: accessToken,
          });
          const userResponse = await cognitoClient.send(getUserCommand);

          if (userResponse.Username) {
            const signOutCommand = new AdminUserGlobalSignOutCommand({
              UserPoolId: userPoolId,
              Username: userResponse.Username,
            });
            await cognitoClient.send(signOutCommand);
          }
        } catch (error) {
          console.log('Could not perform global sign out:', error);
        }
      }
    }

    return c.json({ success: true, message: 'Sign out successful' });
  } catch (error) {
    console.error('Sign out error:', error);
    return c.json({ error: 'Sign out failed' }, 500);
  }
});

// Session check endpoint
app.get('/session', requireAuth, async (c) => {
  try {
    const userId = c.get('userId');
    const userEmail = c.get('userEmail');

    return c.json({
      authenticated: true,
      user: {
        userId,
        email: userEmail,
      },
    });
  } catch (error: any) {
    console.error('Session check error:', error);
    return c.json({ authenticated: false, message: 'Session check failed' }, 500);
  }
});

export default app;

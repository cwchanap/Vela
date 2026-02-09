import { Hono } from 'hono';
import {
  CognitoIdentityProviderClient,
  AdminConfirmSignUpCommand,
  ListUsersCommand,
  InitiateAuthCommand,
  AdminUserGlobalSignOutCommand,
  GetUserCommand,
  InitiateAuthCommandOutput,
} from '@aws-sdk/client-cognito-identity-provider';
import type { Env } from '../types';

const app = new Hono<{ Bindings: Env }>();

const cognitoClient = new CognitoIdentityProviderClient({
  region: process.env.AWS_REGION || 'us-east-1',
});

// Auto-confirm user endpoint (development only)
app.post('/auto-confirm', async (c) => {
  if (process.env.NODE_ENV !== 'development') {
    return c.json({ error: 'This endpoint is only available in development mode' }, 403);
  }

  try {
    const { email } = await c.req.json();

    if (!email) {
      return c.json({ error: 'Email is required' }, 400);
    }

    const userPoolId = process.env.VITE_COGNITO_USER_POOL_ID;
    if (!userPoolId) {
      return c.json({ error: 'User pool ID not configured' }, 500);
    }

    // First, find the user by email to get their username
    const listUsersCommand = new ListUsersCommand({
      UserPoolId: userPoolId,
      Filter: `email = "${email}"`,
    });

    const usersResponse = await cognitoClient.send(listUsersCommand);

    if (!usersResponse.Users || usersResponse.Users.length === 0) {
      return c.json({ error: 'User not found' }, 404);
    }

    const user = usersResponse.Users[0];
    const username = user.Username;

    if (!username) {
      return c.json({ error: 'User username not found' }, 500);
    }

    // Auto-confirm the user using admin API
    const confirmCommand = new AdminConfirmSignUpCommand({
      UserPoolId: userPoolId,
      Username: username,
    });

    await cognitoClient.send(confirmCommand);

    console.log(`✅ User ${email} (username: ${username}) auto-confirmed successfully`);
    return c.json({ success: true, message: 'User auto-confirmed successfully' });
  } catch (error) {
    console.error('Auto-confirm error:', error);
    return c.json({ error: 'Failed to auto-confirm user' }, 500);
  }
});

// Sign in endpoint
app.post('/signin', async (c) => {
  try {
    const { email, password } = await c.req.json();

    if (!email || !password) {
      return c.json({ error: 'Email and password are required' }, 400);
    }

    const userPoolId = c.env.VITE_COGNITO_USER_POOL_ID || process.env.VITE_COGNITO_USER_POOL_ID;
    if (!userPoolId) {
      return c.json({ error: 'User pool ID not configured' }, 500);
    }

    // Proceed with authentication
    const clientId = process.env.COGNITO_CLIENT_ID || process.env.VITE_COGNITO_USER_POOL_CLIENT_ID;
    if (!clientId) {
      return c.json({ error: 'Cognito client ID not configured' }, 500);
    }

    console.log('Cognito signin params', {
      userPoolId,
      clientId,
      region: process.env.AWS_REGION || 'us-east-1',
    });

    const authCommand = new InitiateAuthCommand({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: clientId,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    });

    const authResponse = await cognitoClient.send(authCommand);

    if (authResponse.AuthenticationResult) {
      return c.json({
        success: true,
        message: 'Sign in successful',
        tokens: {
          accessToken: authResponse.AuthenticationResult.AccessToken,
          refreshToken: authResponse.AuthenticationResult.RefreshToken,
          idToken: authResponse.AuthenticationResult.IdToken,
        },
      });
    } else {
      return c.json({ error: 'Authentication failed' }, 401);
    }
  } catch (error: any) {
    console.error('Sign in error:', error);

    if (error.name === 'NotAuthorizedException') {
      return c.json({ error: 'Invalid email or password' }, 401);
    } else if (error.name === 'UserNotConfirmedException') {
      return c.json({ error: 'User not confirmed. Please check your email.' }, 401);
    }

    return c.json({ error: 'Sign in failed', name: error?.name }, 500);
  }
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
app.get('/session', async (c) => {
  try {
    const authHeader = c.req.header('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ authenticated: false, message: 'No access token provided' });
    }

    const accessToken = authHeader.substring(7);

    const getUserCommand = new GetUserCommand({
      AccessToken: accessToken,
    });

    const userResponse = await cognitoClient.send(getUserCommand);

    return c.json({
      authenticated: true,
      user: {
        username: userResponse.Username,
        email: userResponse.UserAttributes?.find((attr) => attr.Name === 'email')?.Value,
        emailVerified:
          userResponse.UserAttributes?.find((attr) => attr.Name === 'email_verified')?.Value ===
          'true',
      },
    });
  } catch (error: any) {
    console.error('Session check error:', error);

    if (error.name === 'NotAuthorizedException' || error.name === 'InvalidParameterException') {
      return c.json({ authenticated: false, message: 'Invalid or expired token' });
    }

    return c.json({ authenticated: false, message: 'Session check failed' }, 500);
  }
});

export default app;

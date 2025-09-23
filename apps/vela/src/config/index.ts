// Environment configuration
export const config = {
  // Cognito configuration
  cognito: {
    userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID || '',
    userPoolClientId: import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID || '',
    region: import.meta.env.VITE_AWS_REGION || '',
  },

  // AI service configuration
  ai: {
    // Client no longer uses provider API keys directly; calls are proxied via AWS Lambda API.
    // Keep empty to avoid bundling secrets into the frontend.
    openaiApiKey: '',
    googleApiKey: '',
    openrouterApiKey: '',
  },

  // App configuration
  app: {
    name: import.meta.env.VITE_APP_NAME || 'Japanese Learning App',
    version: import.meta.env.VITE_APP_VERSION || '1.0.0',
    isDev: import.meta.env.DEV,
    isProd: import.meta.env.PROD,
  },

  // API configuration
  api: {
    url: import.meta.env.VITE_API_URL || '/api/',
  },

  // Development configuration
  dev: {
    devMode: import.meta.env.VITE_DEV_MODE === 'true',
  },
} as const;

// Validation function to check required environment variables
export const validateConfig = () => {
  try {
    const requiredVars = [
      'VITE_COGNITO_USER_POOL_ID',
      'VITE_COGNITO_USER_POOL_CLIENT_ID',
      'VITE_AWS_REGION',
    ];

    // Ensure import.meta.env exists
    if (typeof import.meta === 'undefined' || !import.meta.env) {
      console.warn('Environment variables not available in this context');
      return true;
    }

    const missingVars = requiredVars.filter((varName) => !import.meta.env[varName]);

    if (missingVars.length > 0 && import.meta.env.PROD) {
      console.error('Missing required environment variables:', missingVars);
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }

    return true;
  } catch (error) {
    console.warn('Config validation skipped:', error);
    return true; // Allow app to continue in development
  }
};

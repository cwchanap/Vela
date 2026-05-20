// Environment configuration
type ConfigEnv = Record<string, unknown> | null | undefined;

const getCurrentOrigin = (): string => {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }

  return 'http://localhost:9000';
};

const parseCsvEnv = (value: unknown, fallback: string[]): string[] => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return fallback;
  }

  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return entries.length > 0 ? entries : fallback;
};

const defaultRedirectSignIn = [`${getCurrentOrigin()}/auth/callback`];
const defaultRedirectSignOut = [`${getCurrentOrigin()}/auth/login`];

const isMissingEnvValue = (value: unknown): boolean => {
  return (
    value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
  );
};

export const config = {
  // Cognito configuration
  cognito: {
    userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID || '',
    userPoolClientId: import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID || '',
    region: import.meta.env.VITE_AWS_REGION || '',
    oauth: {
      domain: import.meta.env.VITE_COGNITO_OAUTH_DOMAIN?.trim() || '',
      redirectSignIn: parseCsvEnv(
        import.meta.env.VITE_COGNITO_REDIRECT_SIGN_IN,
        defaultRedirectSignIn,
      ),
      redirectSignOut: parseCsvEnv(
        import.meta.env.VITE_COGNITO_REDIRECT_SIGN_OUT,
        defaultRedirectSignOut,
      ),
      responseType: 'code' as const,
      providers: ['Google'] as const,
    },
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
export const validateConfig = (env?: ConfigEnv) => {
  const resolvedEnv = env === undefined ? import.meta.env : env;

  try {
    const requiredVars = [
      'VITE_COGNITO_USER_POOL_ID',
      'VITE_COGNITO_USER_POOL_CLIENT_ID',
      'VITE_AWS_REGION',
      'VITE_COGNITO_OAUTH_DOMAIN',
    ];

    if (!resolvedEnv) {
      console.warn('Environment variables not available in this context');
      return true;
    }

    const missingVars = requiredVars.filter((varName) => isMissingEnvValue(resolvedEnv[varName]));

    if (missingVars.length > 0 && resolvedEnv.PROD) {
      console.error('Missing required environment variables:', missingVars);
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }

    return true;
  } catch (error) {
    if (resolvedEnv?.PROD) {
      throw error;
    }

    console.warn('Config validation skipped:', error);
    return true; // Allow app to continue in development
  }
};

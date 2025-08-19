// Environment configuration
export const config = {
  // Supabase configuration
  supabase: {
    url: import.meta.env.VITE_SUPABASE_URL || '',
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
  },

  // AI service configuration
  ai: {
    // Client no longer uses provider API keys directly; calls are proxied via Supabase Edge Functions.
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

  // Development configuration
  dev: {
    devMode: import.meta.env.VITE_DEV_MODE === 'true',
  },
} as const;

// Validation function to check required environment variables
export const validateConfig = () => {
  try {
    const requiredVars = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];

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

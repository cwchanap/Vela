import type { Env } from './types';

/**
 * Build the Env object from process.env.
 * In development, applies fallbacks for common env var aliases.
 */
export function buildEnv(): Env {
  const isDev = process.env.NODE_ENV === 'development';
  return {
    APP_NAME: process.env.APP_NAME || (isDev ? 'Vela Japanese Learning App (Dev)' : undefined),
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_REGION: process.env.AWS_REGION || (isDev ? 'us-east-1' : undefined),
    VITE_COGNITO_USER_POOL_ID: process.env.VITE_COGNITO_USER_POOL_ID,
    DDB_ENDPOINT: process.env.DDB_ENDPOINT || (isDev ? process.env.VITE_DDB_ENDPOINT : undefined),
    DDB_REGION: process.env.DDB_REGION || (isDev ? process.env.VITE_DDB_REGION : undefined),
    DDB_TABLE: process.env.DDB_TABLE || (isDev ? process.env.VITE_DDB_TABLE : undefined),
    COGNITO_CLIENT_ID:
      process.env.COGNITO_CLIENT_ID ||
      (isDev ? process.env.VITE_COGNITO_USER_POOL_CLIENT_ID : undefined),
    TTS_AUDIO_BUCKET_NAME: process.env.TTS_AUDIO_BUCKET_NAME,
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    CORS_ALLOWED_ORIGINS:
      process.env.CORS_ALLOWED_ORIGINS ||
      (isDev
        ? 'http://localhost:9000,http://127.0.0.1:9000,http://localhost:9100,http://127.0.0.1:9100,capacitor://localhost'
        : undefined),
    CORS_ALLOWED_EXTENSION_IDS: process.env.CORS_ALLOWED_EXTENSION_IDS,
    AURORA_DB_CLUSTER_ARN: process.env.AURORA_DB_CLUSTER_ARN,
    AURORA_DB_ENDPOINT: process.env.AURORA_DB_ENDPOINT,
    AURORA_DB_NAME: process.env.AURORA_DB_NAME,
    AURORA_DB_USER: process.env.AURORA_DB_USER,
  };
}

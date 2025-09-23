// Centralized environment loader for the API (development/local only)
// Ensures process.env is populated before other modules initialize

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

try {
  // Try app-specific .env first, then root .env
  const apiEnvPath = resolve(process.cwd(), 'apps/vela-api/.env');
  const rootEnvPath = resolve(process.cwd(), '.env');
  const envPath = existsSync(apiEnvPath) ? apiEnvPath : existsSync(rootEnvPath) ? rootEnvPath : '';

  if (envPath) {
    const envContent = readFileSync(envPath, 'utf-8');
    for (const rawLine of envContent.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = line.substring(0, eqIdx).trim();
      const value = line.substring(eqIdx + 1).trim();
      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
    if (process.env.NODE_ENV !== 'test') {
      console.log(`✅ (env) Loaded .env from: ${envPath}`);
    }
  }

  // Map VITE_* vars commonly present in root .env to server-side names
  const sanitize = (v?: string) => {
    if (!v) return undefined;
    const s = v.trim();
    if (!s || s === 'undefined' || s === 'null') return undefined;
    return s;
  };

  const viteEndpoint = sanitize(process.env.VITE_DDB_ENDPOINT);
  const viteRegion = sanitize(process.env.VITE_DDB_REGION);
  const viteTable = sanitize(process.env.VITE_DDB_TABLE);

  const currentEndpoint = sanitize(process.env.DDB_ENDPOINT);
  const currentRegion = sanitize(process.env.DDB_REGION);
  const currentTable = sanitize(process.env.DDB_TABLE);

  if (!currentEndpoint && viteEndpoint) process.env.DDB_ENDPOINT = viteEndpoint;
  if (!currentRegion && viteRegion) process.env.DDB_REGION = viteRegion;
  if (!currentTable && viteTable) process.env.DDB_TABLE = viteTable;

  // For local DynamoDB usage, the AWS SDK still expects credentials to exist
  const ep = sanitize(process.env.DDB_ENDPOINT);
  const isLocal =
    !!ep && (ep.includes('localhost') || ep.includes('127.0.0.1') || ep.includes(':8000'));
  if (isLocal) {
    process.env.AWS_ACCESS_KEY_ID = sanitize(process.env.AWS_ACCESS_KEY_ID) || 'local';
    process.env.AWS_SECRET_ACCESS_KEY = sanitize(process.env.AWS_SECRET_ACCESS_KEY) || 'local';
  }
} catch (error) {
  console.log(
    '⚠️ (env) Failed to load .env:',
    error instanceof Error ? error.message : String(error),
  );
}

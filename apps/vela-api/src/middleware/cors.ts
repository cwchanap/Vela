import type { Context, Next } from 'hono';
import type { Env } from '../types';

/**
 * Utility function to check if an origin is allowed based on CORS configuration.
 *
 * This checks both CORS_ALLOWED_ORIGINS (web origins) and CORS_ALLOWED_EXTENSION_IDS
 * (browser extension origins) to determine if the request origin is permitted.
 *
 * @param origin - The Origin header value from the request
 * @param env - The environment object containing CORS configuration
 * @returns An object with isAllowed flag, isWebOrigin flag, hasConfiguredOrigins flag, and the allowed origin string
 */
export function isAllowedOrigin(
  origin: string | undefined,
  env: Env | undefined,
): {
  isAllowed: boolean;
  isWebOrigin: boolean;
  hasConfiguredOrigins: boolean;
  allowedOrigin?: string;
} {
  // Parse allowed web origins from environment variable
  const corsConfig = env?.CORS_ALLOWED_ORIGINS || process.env.CORS_ALLOWED_ORIGINS;
  const allowedOrigins =
    corsConfig
      ?.split(',')
      .map((o) => o.trim())
      .filter(Boolean) || [];

  // Parse allowed extension IDs from environment variable
  const extensionIdsConfig =
    env?.CORS_ALLOWED_EXTENSION_IDS || process.env.CORS_ALLOWED_EXTENSION_IDS;
  const allowedExtensionIds =
    extensionIdsConfig
      ?.split(',')
      .map((id: string) => id.trim())
      .filter(Boolean) || [];

  // Check if any CORS configuration is present (either web origins or extension IDs)
  const hasConfiguredOrigins = allowedOrigins.length > 0 || allowedExtensionIds.length > 0;

  if (!origin) {
    return { isAllowed: false, isWebOrigin: false, hasConfiguredOrigins };
  }

  // Build full extension origin URIs from the allowed extension IDs
  const allowedExtensionOrigins = new Set<string>();
  for (const extId of allowedExtensionIds) {
    allowedExtensionOrigins.add(`chrome-extension://${extId}`);
    allowedExtensionOrigins.add(`moz-extension://${extId}`);
  }

  // Check if origin is a whitelisted extension origin
  const isWhitelistedExtensionOrigin = allowedExtensionOrigins.has(origin);

  // Check if origin is in the allowed web origins list
  const isAllowedWebOrigin = allowedOrigins.includes(origin);

  return {
    isAllowed: isAllowedWebOrigin || isWhitelistedExtensionOrigin,
    isWebOrigin: isAllowedWebOrigin,
    hasConfiguredOrigins,
    allowedOrigin: isAllowedWebOrigin || isWhitelistedExtensionOrigin ? origin : undefined,
  };
}

/**
 * Centralized CORS middleware for the Vela API
 *
 * This middleware:
 * - Validates request origins against an allowlist from environment variables
 * - Returns 403 for disallowed origins on non-OPTIONS requests
 * - Returns 204 for OPTIONS requests with disallowed origins (without CORS headers)
 * - Sets appropriate CORS headers for allowed origins
 * - Handles preflight OPTIONS requests
 * - Uses a whitelist for browser extension origins to prevent unauthorized access
 */
export const corsMiddleware = async (c: Context<{ Bindings: Env }>, next: Next) => {
  const origin = c.req.header('Origin');

  // Parse allowed origins from environment variable (comma-separated)
  // Fall back to process.env if c.env is not available (e.g., in production before env injection)
  const corsConfig = c.env?.CORS_ALLOWED_ORIGINS || process.env.CORS_ALLOWED_ORIGINS;
  const allowedOrigins = corsConfig?.split(',').map((o) => o.trim()) || [];

  // Parse allowed extension IDs from environment variable (comma-separated)
  // These should be the extension IDs without the chrome-extension:// prefix
  const extensionIdsConfig =
    c.env?.CORS_ALLOWED_EXTENSION_IDS || process.env.CORS_ALLOWED_EXTENSION_IDS;
  const allowedExtensionIds = extensionIdsConfig?.split(',').map((id: string) => id.trim()) || [];

  // Build full extension origin URIs from the allowed extension IDs
  const allowedExtensionOrigins = new Set<string>();
  for (const extId of allowedExtensionIds) {
    if (extId) {
      allowedExtensionOrigins.add(`chrome-extension://${extId}`);
      allowedExtensionOrigins.add(`moz-extension://${extId}`);
    }
  }

  // Check if origin is a whitelisted extension origin
  const isWhitelistedExtensionOrigin =
    typeof origin === 'string' && allowedExtensionOrigins.has(origin);

  // Check if origin is in the allowed origins list (web origins)
  const isAllowedWebOrigin = !!origin && allowedOrigins.includes(origin);

  const isAllowedOrigin = isAllowedWebOrigin || isWhitelistedExtensionOrigin;

  if (origin && !isAllowedOrigin) {
    // Origin not allowed - return 403 for non-OPTIONS requests
    if (c.req.method !== 'OPTIONS') {
      return c.json({ error: 'CORS policy violation: Origin not allowed' }, 403);
    }

    // For OPTIONS requests with invalid origin, return 204 without CORS headers
    // This is more standard than returning 404
    return new Response(null, { status: 204 });
  }

  if (isAllowedOrigin && origin) {
    // Set specific origin instead of wildcard for security
    c.header('Access-Control-Allow-Origin', origin);
    // Only allow credentials for explicitly whitelisted web origins, not for extensions
    // This prevents credential leakage to unauthorized extensions
    if (isAllowedWebOrigin) {
      c.header('Access-Control-Allow-Credentials', 'true');
    }
  }

  // Set other CORS headers
  c.header('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
  c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');

  if (c.req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: c.res.headers,
    });
  }

  await next();
};

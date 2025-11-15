import type { Context, Next } from 'hono';
import type { Env } from '../types';

/**
 * Centralized CORS middleware for the Vela API
 *
 * This middleware:
 * - Validates request origins against an allowlist from environment variables
 * - Returns 403 for disallowed origins on non-OPTIONS requests
 * - Returns 204 for OPTIONS requests with disallowed origins (without CORS headers)
 * - Sets appropriate CORS headers for allowed origins
 * - Handles preflight OPTIONS requests
 */
export const corsMiddleware = async (c: Context<{ Bindings: Env }>, next: Next) => {
  const origin = c.req.header('Origin');

  // Parse allowed origins from environment variable (comma-separated)
  const allowedOrigins = c.env?.CORS_ALLOWED_ORIGINS?.split(',').map((o) => o.trim()) || [];

  const isAllowedOrigin = origin && allowedOrigins.includes(origin);

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
    c.header('Access-Control-Allow-Credentials', 'true');
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

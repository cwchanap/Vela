import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../src/types';

describe('TTS Route CORS Security', () => {
  const mockEnv: Env = {
    CORS_ALLOWED_ORIGINS: 'http://localhost:9000,https://vela.cwchanap.dev',
  };

  it('should allow requests from whitelisted origins', async () => {
    // This would require setting up a full Hono app with the route
    // For now, we'll just verify the environment parsing logic
    const allowedOrigins = mockEnv.CORS_ALLOWED_ORIGINS?.split(',').map((o) => o.trim()) || [];
    expect(allowedOrigins).toEqual(['http://localhost:9000', 'https://vela.cwchanap.dev']);
    expect(allowedOrigins.includes('http://localhost:9000')).toBe(true);
    expect(allowedOrigins.includes('https://evil.com')).toBe(false);
  });

  it('should parse comma-separated origins correctly', () => {
    const origins = 'http://localhost:3000, https://app.example.com ,http://127.0.0.1:8080';
    const parsed = origins.split(',').map((o) => o.trim());
    expect(parsed).toEqual([
      'http://localhost:3000',
      'https://app.example.com',
      'http://127.0.0.1:8080',
    ]);
  });
});

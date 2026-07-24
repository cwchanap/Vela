import { describe, test, expect, afterEach } from 'bun:test';
import { buildEnv } from '../src/env';

describe('buildEnv', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('dev fallback CORS_ALLOWED_ORIGINS', () => {
    test('includes capacitor://localhost', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.CORS_ALLOWED_ORIGINS;

      const env = buildEnv();

      expect(env.CORS_ALLOWED_ORIGINS).toContain('capacitor://localhost');
    });

    test('includes port 9100 origins', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.CORS_ALLOWED_ORIGINS;

      const env = buildEnv();
      const origins = env.CORS_ALLOWED_ORIGINS!;

      expect(origins).toContain('http://localhost:9100');
      expect(origins).toContain('http://127.0.0.1:9100');
    });

    test('includes port 9000 origins', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.CORS_ALLOWED_ORIGINS;

      const env = buildEnv();
      const origins = env.CORS_ALLOWED_ORIGINS!;

      expect(origins).toContain('http://localhost:9000');
      expect(origins).toContain('http://127.0.0.1:9000');
    });
  });

  test('explicit CORS_ALLOWED_ORIGINS overrides the dev fallback', () => {
    process.env.NODE_ENV = 'development';
    process.env.CORS_ALLOWED_ORIGINS = 'https://staging.example.com';

    const env = buildEnv();

    expect(env.CORS_ALLOWED_ORIGINS).toBe('https://staging.example.com');
  });

  test('CORS_ALLOWED_ORIGINS is undefined in non-dev mode without env var', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.CORS_ALLOWED_ORIGINS;

    const env = buildEnv();

    expect(env.CORS_ALLOWED_ORIGINS).toBeUndefined();
  });
});

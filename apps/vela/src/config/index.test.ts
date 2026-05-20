import { afterEach, describe, expect, it, vi } from 'vitest';

const importConfigWithEnv = async (envOverrides: Record<string, string | boolean | undefined>) => {
  const env = import.meta.env as unknown as Record<string, unknown>;
  const originalValues = new Map<string, unknown>();

  for (const key of Object.keys(envOverrides)) {
    originalValues.set(key, env[key]);
    const value = envOverrides[key];

    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  vi.resetModules();

  try {
    return await import('./index');
  } finally {
    for (const [key, value] of originalValues) {
      if (value === undefined) {
        delete env[key];
      } else {
        env[key] = value;
      }
    }

    vi.resetModules();
  }
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('config', () => {
  // Note: config is loaded at import time with import.meta.env, so we test the validateConfig function
  // and the exported config structure through the actual module

  describe('config object', () => {
    it('exports a config object', async () => {
      const { config } = await import('./index');
      expect(config).toBeDefined();
      expect(typeof config).toBe('object');
    });

    it('has cognito configuration', async () => {
      const { config } = await import('./index');
      expect(config.cognito).toBeDefined();
      expect(typeof config.cognito.userPoolId).toBe('string');
      expect(typeof config.cognito.userPoolClientId).toBe('string');
      expect(typeof config.cognito.region).toBe('string');
    });

    it('has Cognito OAuth configuration', async () => {
      const { config } = await import('./index');

      expect(config.cognito.oauth).toBeDefined();
      expect(typeof config.cognito.oauth.domain).toBe('string');
      expect(Array.isArray(config.cognito.oauth.redirectSignIn)).toBe(true);
      expect(Array.isArray(config.cognito.oauth.redirectSignOut)).toBe(true);
      expect(config.cognito.oauth.responseType).toBe('code');
      expect(config.cognito.oauth.providers).toEqual(['Google']);
    });

    it('trims Cognito OAuth domain', async () => {
      const { config } = await importConfigWithEnv({
        VITE_COGNITO_OAUTH_DOMAIN: ' vela-local-auth.auth.us-east-1.amazoncognito.com ',
      });

      expect(config.cognito.oauth.domain).toBe('vela-local-auth.auth.us-east-1.amazoncognito.com');
    });

    it('parses comma-separated OAuth redirect values', async () => {
      const { config } = await importConfigWithEnv({
        VITE_COGNITO_REDIRECT_SIGN_IN: ' https://a.example/cb, ,https://b.example/cb ',
        VITE_COGNITO_REDIRECT_SIGN_OUT: ' https://a.example/out, ,https://b.example/out ',
      });

      expect(config.cognito.oauth.redirectSignIn).toEqual([
        'https://a.example/cb',
        'https://b.example/cb',
      ]);
      expect(config.cognito.oauth.redirectSignOut).toEqual([
        'https://a.example/out',
        'https://b.example/out',
      ]);
    });

    it('falls back to current-origin OAuth redirects for empty redirect values', async () => {
      const { config } = await importConfigWithEnv({
        VITE_COGNITO_REDIRECT_SIGN_IN: '',
        VITE_COGNITO_REDIRECT_SIGN_OUT: '   ',
      });

      expect(config.cognito.oauth.redirectSignIn).toEqual([
        `${window.location.origin}/auth/callback`,
      ]);
      expect(config.cognito.oauth.redirectSignOut).toEqual([
        `${window.location.origin}/auth/login`,
      ]);
    });

    it('has ai configuration with empty keys', async () => {
      const { config } = await import('./index');
      expect(config.ai).toBeDefined();
      expect(config.ai.openaiApiKey).toBe('');
      expect(config.ai.googleApiKey).toBe('');
      expect(config.ai.openrouterApiKey).toBe('');
    });

    it('has app configuration', async () => {
      const { config } = await import('./index');
      expect(config.app).toBeDefined();
      expect(typeof config.app.name).toBe('string');
      expect(typeof config.app.version).toBe('string');
    });

    it('has api configuration', async () => {
      const { config } = await import('./index');
      expect(config.api).toBeDefined();
      expect(typeof config.api.url).toBe('string');
    });

    it('has dev configuration', async () => {
      const { config } = await import('./index');
      expect(config.dev).toBeDefined();
      expect(typeof config.dev.devMode).toBe('boolean');
    });

    it('uses configured api url or defaults to /api/', async () => {
      const { config } = await import('./index');
      expect(config.api.url).toBe(import.meta.env.VITE_API_URL || '/api/');
    });

    it('uses configured app name or defaults to Japanese Learning App', async () => {
      const { config } = await import('./index');
      expect(config.app.name).toBe(import.meta.env.VITE_APP_NAME || 'Japanese Learning App');
    });

    it('defaults app version when VITE_APP_VERSION is not set', async () => {
      const { config } = await import('./index');
      expect(config.app.version).toBe('1.0.0');
    });
  });

  describe('validateConfig', () => {
    it('is a function that can be called', async () => {
      const { validateConfig } = await import('./index');
      expect(typeof validateConfig).toBe('function');
    });

    it('returns true when called', async () => {
      const { validateConfig } = await import('./index');
      const result = validateConfig();
      expect(result).toBe(true);
    });

    it('returns true even in development environment without env vars', async () => {
      const { validateConfig } = await import('./index');
      // In test/dev environment, even with missing vars, it returns true
      const result = validateConfig();
      expect(result).toBe(true);
    });

    it('does not throw when called multiple times', async () => {
      const { validateConfig } = await import('./index');
      expect(() => {
        validateConfig();
        validateConfig();
        validateConfig();
      }).not.toThrow();
    });

    it('warns and returns true when import.meta.env is unavailable', async () => {
      const { validateConfig } = await import('./index');
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(validateConfig(null)).toBe(true);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Environment variables not available in this context',
      );
    });

    it('throws in production when required variables are missing', async () => {
      const { validateConfig } = await import('./index');
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const env = {
        PROD: true,
        VITE_COGNITO_USER_POOL_ID: '',
        VITE_COGNITO_USER_POOL_CLIENT_ID: '',
        VITE_AWS_REGION: '',
        VITE_COGNITO_OAUTH_DOMAIN: '',
      };

      expect(() => validateConfig(env)).toThrow(
        'Missing required environment variables: VITE_COGNITO_USER_POOL_ID, VITE_COGNITO_USER_POOL_CLIENT_ID, VITE_AWS_REGION, VITE_COGNITO_OAUTH_DOMAIN',
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith('Missing required environment variables:', [
        'VITE_COGNITO_USER_POOL_ID',
        'VITE_COGNITO_USER_POOL_CLIENT_ID',
        'VITE_AWS_REGION',
        'VITE_COGNITO_OAUTH_DOMAIN',
      ]);
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('requires OAuth domain in production', async () => {
      const { validateConfig } = await import('./index');
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const env = {
        PROD: true,
        VITE_COGNITO_USER_POOL_ID: 'pool-id',
        VITE_COGNITO_USER_POOL_CLIENT_ID: 'client-id',
        VITE_AWS_REGION: 'us-east-1',
        VITE_COGNITO_OAUTH_DOMAIN: '',
      };

      expect(() => validateConfig(env)).toThrow(
        'Missing required environment variables: VITE_COGNITO_OAUTH_DOMAIN',
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith('Missing required environment variables:', [
        'VITE_COGNITO_OAUTH_DOMAIN',
      ]);
    });

    it('requires non-blank OAuth domain in production', async () => {
      const { validateConfig } = await import('./index');
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const env = {
        PROD: true,
        VITE_COGNITO_USER_POOL_ID: 'pool-id',
        VITE_COGNITO_USER_POOL_CLIENT_ID: 'client-id',
        VITE_AWS_REGION: 'us-east-1',
        VITE_COGNITO_OAUTH_DOMAIN: '   ',
      };

      expect(() => validateConfig(env)).toThrow(
        'Missing required environment variables: VITE_COGNITO_OAUTH_DOMAIN',
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith('Missing required environment variables:', [
        'VITE_COGNITO_OAUTH_DOMAIN',
      ]);
    });
  });
});

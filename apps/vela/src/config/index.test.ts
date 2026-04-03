import { afterEach, describe, expect, it, vi } from 'vitest';

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

    it('defaults api url to /api/ when VITE_API_URL is not set', async () => {
      const { config } = await import('./index');
      // In test environment VITE_API_URL is not set, so fallback applies
      expect(config.api.url).toBe('/api/');
    });

    it('defaults app name when VITE_APP_NAME is not set', async () => {
      const { config } = await import('./index');
      expect(config.app.name).toBe('Japanese Learning App');
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
      };

      expect(() => validateConfig(env)).toThrow(
        'Missing required environment variables: VITE_COGNITO_USER_POOL_ID, VITE_COGNITO_USER_POOL_CLIENT_ID, VITE_AWS_REGION',
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith('Missing required environment variables:', [
        'VITE_COGNITO_USER_POOL_ID',
        'VITE_COGNITO_USER_POOL_CLIENT_ID',
        'VITE_AWS_REGION',
      ]);
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
  });
});

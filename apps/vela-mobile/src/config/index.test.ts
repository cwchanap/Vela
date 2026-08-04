import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, validateConfig } from './index';

const validProductionEnv = {
  PROD: true,
  VITE_MOBILE_API_URL: 'https://vela.cwchanap.dev/api/',
  VITE_COGNITO_USER_POOL_ID: 'us-east-1_example',
  VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID: 'mobileclient123',
  VITE_COGNITO_OAUTH_DOMAIN: 'vela.auth.us-east-1.amazoncognito.com',
  VITE_AWS_REGION: 'us-east-1',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('config', () => {
  it('exports a config object with api.url', () => {
    expect(config).toBeDefined();
    expect(typeof config.api.url).toBe('string');
  });

  it('reads VITE_MOBILE_API_URL', () => {
    expect(config.api.url).toBe(import.meta.env.VITE_MOBILE_API_URL || '');
  });

  it('exposes the mobile Cognito configuration from the build environment', () => {
    expect(config.auth).toEqual({
      userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID || '',
      mobileClientId: import.meta.env.VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID || '',
      oauthDomain: import.meta.env.VITE_COGNITO_OAUTH_DOMAIN || '',
      region: import.meta.env.VITE_AWS_REGION || '',
      callbackUri: 'dev.cwchanap.vela.oauth:/oauth/callback',
    });
  });
});

describe('validateConfig', () => {
  it('is a function', () => {
    expect(typeof validateConfig).toBe('function');
  });

  it('warns and returns true when import.meta.env is unavailable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(validateConfig(null)).toBe(true);
    expect(warn).toHaveBeenCalledWith('Environment variables not available in this context');
  });

  it.each([
    'VITE_MOBILE_API_URL',
    'VITE_COGNITO_USER_POOL_ID',
    'VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID',
    'VITE_COGNITO_OAUTH_DOMAIN',
    'VITE_AWS_REGION',
  ])('throws in production when %s is missing', (missingKey) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = { ...validProductionEnv } as Record<string, string | boolean>;
    delete env[missingKey];
    expect(() => validateConfig(env)).toThrow(missingKey);
    expect(error).toHaveBeenCalled();
  });

  it('throws in production when VITE_MOBILE_API_URL is blank', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = { ...validProductionEnv, VITE_MOBILE_API_URL: '   ' };
    expect(() => validateConfig(env)).toThrow(
      'Missing required environment variable: VITE_MOBILE_API_URL',
    );
  });

  it('throws in production when VITE_MOBILE_API_URL is relative', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = { ...validProductionEnv, VITE_MOBILE_API_URL: '/api/' };
    expect(() => validateConfig(env)).toThrow(/must be a valid absolute http\(s\) URL/);
  });

  it('throws in production for a malformed URL like "https://"', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = { ...validProductionEnv, VITE_MOBILE_API_URL: 'https://' };
    expect(() => validateConfig(env)).toThrow(/must be a valid absolute http\(s\) URL/);
  });

  it('throws in production for a non-http protocol', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = { ...validProductionEnv, VITE_MOBILE_API_URL: 'ftp://example.com/api/' };
    expect(() => validateConfig(env)).toThrow(/must be a valid absolute http\(s\) URL/);
  });

  it('passes in production with a valid absolute URL', () => {
    expect(() => validateConfig(validProductionEnv)).not.toThrow();
    expect(validateConfig(validProductionEnv)).toBe(true);
  });

  it('throws in production when VITE_MOBILE_API_URL is plain http:', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = { ...validProductionEnv, VITE_MOBILE_API_URL: 'http://203.0.113.10/api/' };
    expect(() => validateConfig(env)).toThrow(/must be https: in production/);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('must be https: in production'));
  });

  it('throws in production for an http: localhost URL', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = { ...validProductionEnv, VITE_MOBILE_API_URL: 'http://localhost:9005/api/' };
    expect(() => validateConfig(env)).toThrow(/must be https: in production/);
  });

  it('allows http: in dev (e.g. http://localhost for local API)', () => {
    const env = {
      ...validProductionEnv,
      PROD: false,
      VITE_MOBILE_API_URL: 'http://localhost:9005/api/',
    };
    expect(() => validateConfig(env)).not.toThrow();
    expect(validateConfig(env)).toBe(true);
  });

  it('warns but does not throw in dev when URL is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const env = { ...validProductionEnv, PROD: false } as Record<string, string | boolean>;
    delete env.VITE_MOBILE_API_URL;
    expect(validateConfig(env)).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      'VITE_MOBILE_API_URL not set — API calls will fail until configured.',
    );
  });

  it('warns but does not throw in dev when URL is relative', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const env = { ...validProductionEnv, PROD: false, VITE_MOBILE_API_URL: '/api/' };
    expect(validateConfig(env)).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not a valid absolute URL'));
  });

  it.each([
    'VITE_COGNITO_USER_POOL_ID',
    'VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID',
    'VITE_COGNITO_OAUTH_DOMAIN',
    'VITE_AWS_REGION',
  ])('warns but does not throw in development when %s is missing', (missingKey) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const env = { ...validProductionEnv, PROD: false } as Record<string, string | boolean>;
    delete env[missingKey];
    expect(() => validateConfig(env)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(missingKey));
  });

  it.each([
    'https://vela.auth.us-east-1.amazoncognito.com',
    'vela.auth.us-east-1.amazoncognito.com/oauth2/authorize',
    'vela.auth.us-east-1.amazoncognito.com?query=value',
    'vela.auth.us-east-1.amazoncognito.com#fragment',
    ['user:password', 'vela.auth.us-east-1.amazoncognito.com'].join('@'),
    'vela.auth.us-east-1.amazoncognito.com:443',
  ])('rejects non-host-only OAuth domain %s in production', (oauthDomain) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      validateConfig({ ...validProductionEnv, VITE_COGNITO_OAUTH_DOMAIN: oauthDomain }),
    ).toThrow(/VITE_COGNITO_OAUTH_DOMAIN must be a valid host-only domain/);
  });

  it.each([
    ['VITE_COGNITO_USER_POOL_ID', ' us-east-1_example'],
    ['VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID', 'mobile client'],
  ])('rejects whitespace in %s in production', (key, value) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => validateConfig({ ...validProductionEnv, [key]: value })).toThrow(
      new RegExp(`${key} must not contain whitespace`),
    );
  });

  it('rejects a user pool whose region prefix differs from the configured region', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      validateConfig({ ...validProductionEnv, VITE_COGNITO_USER_POOL_ID: 'us-west-2_example' }),
    ).toThrow(/VITE_COGNITO_USER_POOL_ID must start with the configured VITE_AWS_REGION/);
  });
});

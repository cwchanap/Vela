import { afterEach, describe, expect, it, vi } from 'vitest';
import { config, validateConfig } from './index';

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

  it('throws in production when VITE_MOBILE_API_URL is missing', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = { PROD: true };
    expect(() => validateConfig(env)).toThrow(
      'Missing required environment variable: VITE_MOBILE_API_URL',
    );
    expect(error).toHaveBeenCalledWith(
      'Missing required environment variable: VITE_MOBILE_API_URL',
    );
  });

  it('throws in production when VITE_MOBILE_API_URL is blank', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = { PROD: true, VITE_MOBILE_API_URL: '   ' };
    expect(() => validateConfig(env)).toThrow(
      'Missing required environment variable: VITE_MOBILE_API_URL',
    );
  });

  it('throws in production when VITE_MOBILE_API_URL is relative', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = { PROD: true, VITE_MOBILE_API_URL: '/api/' };
    expect(() => validateConfig(env)).toThrow(/must be a valid absolute http\(s\) URL/);
  });

  it('throws in production for a malformed URL like "https://"', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = { PROD: true, VITE_MOBILE_API_URL: 'https://' };
    expect(() => validateConfig(env)).toThrow(/must be a valid absolute http\(s\) URL/);
  });

  it('throws in production for a non-http protocol', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = { PROD: true, VITE_MOBILE_API_URL: 'ftp://example.com/api/' };
    expect(() => validateConfig(env)).toThrow(/must be a valid absolute http\(s\) URL/);
  });

  it('passes in production with a valid absolute URL', () => {
    const env = { PROD: true, VITE_MOBILE_API_URL: 'https://vela.cwchanap.dev/api/' };
    expect(() => validateConfig(env)).not.toThrow();
    expect(validateConfig(env)).toBe(true);
  });

  it('throws in production when VITE_MOBILE_API_URL is plain http:', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = { PROD: true, VITE_MOBILE_API_URL: 'http://203.0.113.10/api/' };
    expect(() => validateConfig(env)).toThrow(/must be https: in production/);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('must be https: in production'));
  });

  it('throws in production for an http: localhost URL', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = { PROD: true, VITE_MOBILE_API_URL: 'http://localhost:9005/api/' };
    expect(() => validateConfig(env)).toThrow(/must be https: in production/);
  });

  it('allows http: in dev (e.g. http://localhost for local API)', () => {
    const env = { PROD: false, VITE_MOBILE_API_URL: 'http://localhost:9005/api/' };
    expect(() => validateConfig(env)).not.toThrow();
    expect(validateConfig(env)).toBe(true);
  });

  it('warns but does not throw in dev when URL is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const env = { PROD: false };
    expect(validateConfig(env)).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      'VITE_MOBILE_API_URL not set — API calls will fail until configured.',
    );
  });

  it('warns but does not throw in dev when URL is relative', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const env = { PROD: false, VITE_MOBILE_API_URL: '/api/' };
    expect(validateConfig(env)).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not a valid absolute URL'));
  });
});

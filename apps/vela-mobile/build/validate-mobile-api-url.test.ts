// @vitest-environment node
//
// The plugin's config hook invokes loadMobileApiUrl, which reads .env files
// from disk via node:fs and reads process.env directly. The tests also
// reassign process.env wholesale in afterEach to isolate env state between
// cases. No DOM globals are needed, so the node environment is the natural
// fit for these filesystem-and-env-driven tests.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  validateMobileApiUrl,
  validateMobileApiUrlPlugin,
} from './validate-mobile-api-url';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe('validateMobileApiUrl', () => {
  it('throws when the URL is undefined', () => {
    expect(() => validateMobileApiUrl(undefined)).toThrow(
      'VITE_MOBILE_API_URL is missing',
    );
  });

  it('throws when the URL is an empty string', () => {
    expect(() => validateMobileApiUrl('')).toThrow('VITE_MOBILE_API_URL is missing');
  });

  it('throws when the URL is whitespace-only', () => {
    expect(() => validateMobileApiUrl('   ')).toThrow('VITE_MOBILE_API_URL is missing');
  });

  it('throws when the URL is a relative path', () => {
    expect(() => validateMobileApiUrl('/api/')).toThrow(
      /must be a valid absolute http\(s\) URL with a hostname/,
    );
  });

  it('throws for a protocol-less hostname', () => {
    expect(() => validateMobileApiUrl('vela.cwchanap.dev/api/')).toThrow(
      /must be a valid absolute http\(s\) URL with a hostname/,
    );
  });

  it('throws for "https://" with no hostname', () => {
    expect(() => validateMobileApiUrl('https://')).toThrow(
      /must be a valid absolute http\(s\) URL with a hostname/,
    );
  });

  it('throws for a non-http protocol', () => {
    expect(() => validateMobileApiUrl('ftp://example.com/api/')).toThrow(
      /must be a valid absolute http\(s\) URL with a hostname/,
    );
  });

  it('includes the offending value in the malformed-URL message', () => {
    expect(() => validateMobileApiUrl('/api/')).toThrow(
      'got: /api/',
    );
  });

  it('passes for a valid https URL with a hostname and path', () => {
    expect(() => validateMobileApiUrl('https://vela.cwchanap.dev/api/')).not.toThrow();
  });

  it('passes for a valid http URL when requireHttps is not set (local dev / simulator)', () => {
    // The default contract allows http: so dev-mode callers (local/simulator
    // builds) can target http://localhost or LAN IPs without opting out of
    // validation. The production build plugin sets requireHttps=true.
    expect(() => validateMobileApiUrl('http://localhost:9005/api/')).not.toThrow();
  });

  it('passes for an https URL with a trailing path but no trailing slash', () => {
    expect(() => validateMobileApiUrl('https://staging.vela.example/api')).not.toThrow();
  });

  it('rejects http: when requireHttps is true (production contract)', () => {
    // Mirrors src/config/index.ts validateConfig() rejecting http: when PROD
    // is true. The build-time and runtime contracts must agree, otherwise a
    // misconfigured release passes the build guard and crashes at app boot.
    expect(() => validateMobileApiUrl('http://example.com/api/', { requireHttps: true })).toThrow(
      /must be https: in production/,
    );
  });

  it('includes the offending value in the requireHttps message', () => {
    expect(() => validateMobileApiUrl('http://example.com/api/', { requireHttps: true })).toThrow(
      'got: http://example.com/api/',
    );
  });

  it('passes for an https URL when requireHttps is true', () => {
    expect(() =>
      validateMobileApiUrl('https://vela.cwchanap.dev/api/', { requireHttps: true }),
    ).not.toThrow();
  });
});

describe('validateMobileApiUrlPlugin', () => {
  // The plugin's config hook is what Vite invokes at build time. Driving it
  // directly avoids shelling out to a full Vite build while still exercising
  // the mode/skip/validate branches a real build would hit.
  function invokeConfigHook(
    mode: string,
    options: { skipValidation?: boolean; envDir?: string } = {},
  ) {
    const plugin = validateMobileApiUrlPlugin(options.envDir ?? '/nonexistent-root');
    const configHook = plugin.config;
    if (typeof configHook !== 'function') {
      throw new Error('plugin.config is not a function');
    }
    return configHook({}, { mode });
  }

  it('is a Vite plugin named validate-mobile-api-url', () => {
    const plugin = validateMobileApiUrlPlugin('/root');
    expect(plugin.name).toBe('validate-mobile-api-url');
  });

  it('is a no-op in development mode (no throw even with no env)', () => {
    expect(() => invokeConfigHook('development')).not.toThrow();
  });

  it('is a no-op in non-production modes (e.g. test)', () => {
    expect(() => invokeConfigHook('test')).not.toThrow();
  });

  it('bypasses validation when MOBILE_SKIP_ENV_VALIDATION=true in production', () => {
    process.env.MOBILE_SKIP_ENV_VALIDATION = 'true';
    // No .env files at /nonexistent-root, so without the bypass this would
    // throw "VITE_MOBILE_API_URL is missing".
    expect(() => invokeConfigHook('production')).not.toThrow();
  });

  it('does not bypass when MOBILE_SKIP_ENV_VALIDATION is set but not "true"', () => {
    process.env.MOBILE_SKIP_ENV_VALIDATION = 'false';
    expect(() => invokeConfigHook('production')).toThrow(
      'VITE_MOBILE_API_URL is missing',
    );
  });

  it('throws in production when .env.production is absent (no env files at root)', () => {
    delete process.env.MOBILE_SKIP_ENV_VALIDATION;
    expect(() => invokeConfigHook('production')).toThrow(
      'VITE_MOBILE_API_URL is missing',
    );
  });

  it('accepts a VITE_MOBILE_API_URL from process.env in production', () => {
    // loadEnv gives existing process.env values final priority, so exporting
    // VITE_MOBILE_API_URL should satisfy the guard even without .env.production.
    // This is the exact path the PR CI workflow now exercises.
    delete process.env.MOBILE_SKIP_ENV_VALIDATION;
    process.env.VITE_MOBILE_API_URL = 'https://example.invalid/api/';
    expect(() => invokeConfigHook('production')).not.toThrow();
  });

  it('rejects a malformed VITE_MOBILE_API_URL from process.env in production', () => {
    delete process.env.MOBILE_SKIP_ENV_VALIDATION;
    process.env.VITE_MOBILE_API_URL = '/api/';
    expect(() => invokeConfigHook('production')).toThrow(
      /must be a valid absolute http\(s\) URL with a hostname/,
    );
  });

  it('rejects an http: VITE_MOBILE_API_URL in production (requireHttps contract)', () => {
    // The plugin only runs in production mode, so it must require HTTPS to
    // match the runtime validateConfig() contract. Otherwise a misconfigured
    // release passes the build guard and crashes at app boot.
    delete process.env.MOBILE_SKIP_ENV_VALIDATION;
    process.env.VITE_MOBILE_API_URL = 'http://example.com/api/';
    expect(() => invokeConfigHook('production')).toThrow(
      /must be https: in production/,
    );
  });
});

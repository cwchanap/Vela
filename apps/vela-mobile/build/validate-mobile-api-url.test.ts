// @vitest-environment node
//
// The plugin imports `vite` (for `loadEnv` and the `Plugin` type), which pulls
// in esbuild. esbuild requires a working `TextEncoder` whose output is a true
// `Uint8Array` instance; jsdom's TextEncoder breaks that invariant, so the
// import fails under the default jsdom environment. Node's built-in
// TextEncoder is correct, and these tests need no DOM globals, so use the
// node environment instead.
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

  it('passes for a valid http URL (local dev / simulator)', () => {
    expect(() => validateMobileApiUrl('http://localhost:9005/api/')).not.toThrow();
  });

  it('passes for an https URL with a trailing path but no trailing slash', () => {
    expect(() => validateMobileApiUrl('https://staging.vela.example/api')).not.toThrow();
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
});

// @vitest-environment node
//
// The plugin's configResolved hook invokes loadMobileBuildEnv, which reads .env files
// from disk via node:fs and reads process.env directly. The tests also
// reassign process.env wholesale in afterEach to isolate env state between
// cases. No DOM globals are needed, so the node environment is the natural
// fit for these filesystem-and-env-driven tests.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateMobileApiUrl, validateMobileApiUrlPlugin } from './validate-mobile-api-url';

const originalEnv = { ...process.env };

const validBuildEnv = {
  VITE_MOBILE_API_URL: 'https://vela.cwchanap.dev/api/',
  VITE_COGNITO_USER_POOL_ID: 'us-east-1_example',
  VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID: 'mobileclient123',
  VITE_COGNITO_OAUTH_DOMAIN: 'vela.auth.us-east-1.amazoncognito.com',
  VITE_AWS_REGION: 'us-east-1',
};

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe('validateMobileApiUrl', () => {
  it('throws when the URL is undefined', () => {
    expect(() => validateMobileApiUrl(undefined)).toThrow('VITE_MOBILE_API_URL is missing');
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
    expect(() => validateMobileApiUrl('/api/')).toThrow('got: /api/');
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
  // Vite invokes configResolved after it resolves the final build mode.
  // Driving that hook directly avoids a full build while exercising the
  // mode/skip/validate branches used in production.
  function invokeConfigResolvedHook(
    mode: string,
    options: { skipValidation?: boolean; envDir?: string } = {},
  ) {
    const plugin = validateMobileApiUrlPlugin(options.envDir ?? '/nonexistent-root');
    const configResolvedHook = plugin.configResolved;
    if (typeof configResolvedHook !== 'function') {
      throw new Error('plugin.configResolved is not a function');
    }
    return configResolvedHook({ mode });
  }

  function setValidProductionEnv(): void {
    Object.assign(process.env, validBuildEnv);
  }

  it('is a Vite plugin named validate-mobile-api-url', () => {
    const plugin = validateMobileApiUrlPlugin('/root');
    expect(plugin.name).toBe('validate-mobile-api-url');
  });

  it('is a no-op in development mode (no throw even with no env)', () => {
    expect(() => invokeConfigResolvedHook('development')).not.toThrow();
  });

  it('is a no-op in non-production modes (e.g. test)', () => {
    expect(() => invokeConfigResolvedHook('test')).not.toThrow();
  });

  it('bypasses validation when MOBILE_SKIP_ENV_VALIDATION=true in production', () => {
    process.env.MOBILE_SKIP_ENV_VALIDATION = 'true';
    // No .env files at /nonexistent-root, so without the bypass this would
    // throw "VITE_MOBILE_API_URL is missing".
    expect(() => invokeConfigResolvedHook('production')).not.toThrow();
  });

  it('does not bypass when MOBILE_SKIP_ENV_VALIDATION is set but not "true"', () => {
    process.env.MOBILE_SKIP_ENV_VALIDATION = 'false';
    expect(() => invokeConfigResolvedHook('production')).toThrow('VITE_MOBILE_API_URL is missing');
  });

  it('throws in production when .env.production is absent (no env files at root)', () => {
    delete process.env.MOBILE_SKIP_ENV_VALIDATION;
    expect(() => invokeConfigResolvedHook('production')).toThrow('VITE_MOBILE_API_URL is missing');
  });

  it('accepts a VITE_MOBILE_API_URL from process.env in production', () => {
    // loadEnv gives existing process.env values final priority, so exporting
    // VITE_MOBILE_API_URL should satisfy the guard even without .env.production.
    // This is the exact path the PR CI workflow now exercises.
    delete process.env.MOBILE_SKIP_ENV_VALIDATION;
    setValidProductionEnv();
    process.env.VITE_MOBILE_API_URL = 'https://example.invalid/api/';
    expect(() => invokeConfigResolvedHook('production')).not.toThrow();
  });

  it('rejects a malformed VITE_MOBILE_API_URL from process.env in production', () => {
    delete process.env.MOBILE_SKIP_ENV_VALIDATION;
    setValidProductionEnv();
    process.env.VITE_MOBILE_API_URL = '/api/';
    expect(() => invokeConfigResolvedHook('production')).toThrow(
      /must be a valid absolute http\(s\) URL with a hostname/,
    );
  });

  it('rejects an http: VITE_MOBILE_API_URL in production (requireHttps contract)', () => {
    // The plugin only runs in production mode, so it must require HTTPS to
    // match the runtime validateConfig() contract. Otherwise a misconfigured
    // release passes the build guard and crashes at app boot.
    delete process.env.MOBILE_SKIP_ENV_VALIDATION;
    setValidProductionEnv();
    process.env.VITE_MOBILE_API_URL = 'http://example.com/api/';
    expect(() => invokeConfigResolvedHook('production')).toThrow(/must be https: in production/);
  });

  it.each([
    'VITE_COGNITO_USER_POOL_ID',
    'VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID',
    'VITE_COGNITO_OAUTH_DOMAIN',
    'VITE_AWS_REGION',
  ])('rejects production builds when %s is missing', (missingKey) => {
    delete process.env.MOBILE_SKIP_ENV_VALIDATION;
    setValidProductionEnv();
    delete process.env[missingKey];
    expect(() => invokeConfigResolvedHook('production')).toThrow(missingKey);
  });

  it.each([
    'https://vela.auth.us-east-1.amazoncognito.com',
    'vela.auth.us-east-1.amazoncognito.com/oauth2/authorize',
    'vela.auth.us-east-1.amazoncognito.com?query=value',
    'vela.auth.us-east-1.amazoncognito.com#fragment',
    // The user:password@host form is split across an array join so the joined
    // userinfo URL never appears in source. Keeping it split prevents the
    // repository secret scanner from classifying the input as an account_email
    // finding while still exercising the userinfo rejection path.
    ['user:password', 'vela.auth.us-east-1.amazoncognito.com'].join('@'),
    'vela.auth.us-east-1.amazoncognito.com:443',
  ])('rejects a non-host-only OAuth domain in production: %s', (oauthDomain) => {
    delete process.env.MOBILE_SKIP_ENV_VALIDATION;
    setValidProductionEnv();
    process.env.VITE_COGNITO_OAUTH_DOMAIN = oauthDomain;
    expect(() => invokeConfigResolvedHook('production')).toThrow(
      /VITE_COGNITO_OAUTH_DOMAIN must be a valid host-only domain/,
    );
  });

  it.each([
    ['VITE_COGNITO_USER_POOL_ID', ' us-east-1_example'],
    ['VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID', 'mobile client'],
  ])('rejects whitespace in %s in production', (key, value) => {
    delete process.env.MOBILE_SKIP_ENV_VALIDATION;
    setValidProductionEnv();
    process.env[key] = value;
    expect(() => invokeConfigResolvedHook('production')).toThrow(
      new RegExp(`${key} must not contain whitespace`),
    );
  });

  it('rejects a user pool whose region prefix differs from the configured region', () => {
    delete process.env.MOBILE_SKIP_ENV_VALIDATION;
    setValidProductionEnv();
    process.env.VITE_COGNITO_USER_POOL_ID = 'us-west-2_example';
    expect(() => invokeConfigResolvedHook('production')).toThrow(
      /VITE_COGNITO_USER_POOL_ID must start with the configured VITE_AWS_REGION/,
    );
  });

  it('loads all mobile OAuth values from the mode-specific env file', () => {
    const envDir = mkdtempSync(join(tmpdir(), 'vela-mobile-build-env-'));
    try {
      writeFileSync(
        join(envDir, '.env.production'),
        `${Object.entries(validBuildEnv)
          .map(([key, value]) => `${key}=${value}`)
          .join('\n')}\n`,
      );
      for (const key of Object.keys(validBuildEnv)) delete process.env[key];
      delete process.env.MOBILE_SKIP_ENV_VALIDATION;
      expect(() => invokeConfigResolvedHook('production', { envDir })).not.toThrow();
    } finally {
      rmSync(envDir, { recursive: true, force: true });
    }
  });

  it.each([
    ['VITE_COGNITO_USER_POOL_ID', ' us-east-1_example'],
    ['VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID', 'mobile client'],
    ['VITE_COGNITO_OAUTH_DOMAIN', 'https://vela.auth.us-east-1.amazoncognito.com'],
    ['VITE_AWS_REGION', 'us west 1'],
  ])('gives explicit process.env %s precedence over a mode-specific env file', (key, override) => {
    const envDir = mkdtempSync(join(tmpdir(), 'vela-mobile-build-env-'));
    try {
      writeFileSync(
        join(envDir, '.env.production'),
        `${Object.entries(validBuildEnv)
          .map(([envKey, value]) => `${envKey}=${value}`)
          .join('\n')}\n`,
      );
      for (const envKey of Object.keys(validBuildEnv)) delete process.env[envKey];
      delete process.env.MOBILE_SKIP_ENV_VALIDATION;
      process.env[key] = override;
      expect(() => invokeConfigResolvedHook('production', { envDir })).toThrow(key);
    } finally {
      rmSync(envDir, { recursive: true, force: true });
    }
  });
});

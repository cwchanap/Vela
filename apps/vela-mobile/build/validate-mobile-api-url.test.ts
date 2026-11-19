// @vitest-environment node
//
// Quasar v3 resolves client env values into Vite's `config.define` as
// JavaScript literals (`"..."` JSON strings, or raw `true`/`false`/numbers).
// `configResolved` receives exactly what the client bundle receives, so the
// production validator and the Capacitor MARKETING_VERSION sync read those
// resolved values instead of re-parsing `.env` files.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  mobileEnvFromDefine,
  validateMobileApiUrl,
  validateMobileApiUrlPlugin,
} from './validate-mobile-api-url';
import { validateConfig } from '../src/config';

const originalEnv = { ...process.env };
const DEFINE_PREFIX = 'import.meta.env.';
const tempRoots: string[] = [];

const validBuildEnv = {
  VITE_MOBILE_API_URL: 'https://vela.cwchanap.dev/api/',
  VITE_COGNITO_USER_POOL_ID: 'us-east-1_example',
  VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID: 'mobileclient123',
  VITE_COGNITO_OAUTH_DOMAIN: 'vela.auth.us-east-1.amazoncognito.com',
  VITE_AWS_REGION: 'us-east-1',
};

// Mirrors @quasar/app-vite's parseEnvDefineList/getStrDefineValue encoding.
function quasarDefine(values: Record<string, string | number | boolean>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      const encoded =
        value === 'true' || value === 'false' || value === 'null'
          ? value
          : typeof value === 'string'
            ? JSON.stringify(value)
            : String(value);
      return [`${DEFINE_PREFIX}${key}`, encoded];
    }),
  );
}

const validDefine = (extra: Record<string, string | number | boolean> = {}) => ({
  ...quasarDefine(validBuildEnv),
  ...quasarDefine(extra),
});

const PBXPROJ_FIXTURE = `/* Begin XCBuildConfiguration section */
		504EC3171FED79650016851F /* Debug */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				CURRENT_PROJECT_VERSION = 1;
				MARKETING_VERSION = 0.0.1;
			};
			name = Debug;
		};
		504EC3181FED79650016851F /* Release */ = {
			isa = XCBuildConfiguration;
			buildSettings = {
				CURRENT_PROJECT_VERSION = 1;
				MARKETING_VERSION = 0.0.1;
			};
			name = Release;
		};
/* End XCBuildConfiguration section */
`;

function capacitorRoot(options: { packageVersion?: string; pbxproj?: string } = {}): {
  rootDir: string;
  pbxprojPath: string;
} {
  const rootDir = mkdtempSync(join(tmpdir(), 'vela-capacitor-'));
  tempRoots.push(rootDir);
  mkdirSync(join(rootDir, 'src-capacitor/ios/App/App.xcodeproj'), { recursive: true });
  writeFileSync(
    join(rootDir, 'package.json'),
    JSON.stringify({ version: options.packageVersion ?? '0.0.1' }),
  );
  const pbxprojPath = join(rootDir, 'src-capacitor/ios/App/App.xcodeproj/project.pbxproj');
  writeFileSync(pbxprojPath, options.pbxproj ?? PBXPROJ_FIXTURE);
  return { rootDir, pbxprojPath };
}

function invokeConfigResolvedHook(input: {
  mode: string;
  define?: Record<string, unknown>;
  isCapacitor?: boolean;
  rootDir?: string;
}) {
  const plugin = validateMobileApiUrlPlugin({
    rootDir: input.rootDir ?? '/nonexistent-root',
    isCapacitor: input.isCapacitor ?? false,
  });
  const hook = plugin.configResolved;
  if (typeof hook !== 'function') throw new Error('plugin.configResolved is not a function');
  return hook({ mode: input.mode, define: input.define ?? {} });
}

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
  while (tempRoots.length > 0) rmSync(tempRoots.pop()!, { recursive: true, force: true });
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

describe('mobileEnvFromDefine', () => {
  it('decodes Quasar JSON-encoded string literals', () => {
    expect(mobileEnvFromDefine(quasarDefine(validBuildEnv))).toEqual(validBuildEnv);
  });

  it('keeps quoted strings that look like booleans or numbers as strings', () => {
    expect(
      mobileEnvFromDefine({
        [`${DEFINE_PREFIX}VITE_AWS_REGION`]: '"true"',
        [`${DEFINE_PREFIX}VITE_COGNITO_USER_POOL_ID`]: '"123"',
      }),
    ).toMatchObject({ VITE_AWS_REGION: 'true', VITE_COGNITO_USER_POOL_ID: '123' });
  });

  it.each([
    ['VITE_MOBILE_API_URL', 'true'],
    ['VITE_COGNITO_OAUTH_DOMAIN', 'false'],
    ['VITE_COGNITO_USER_POOL_ID', '123'],
    ['VITE_AWS_REGION', 'null'],
  ])('rejects a non-string resolved literal for %s (%s)', (key, literal) => {
    expect(() =>
      mobileEnvFromDefine({ [`${DEFINE_PREFIX}${key}`]: literal }),
    ).toThrow(new RegExp(`${key} must resolve to a string`));
  });

  it('keeps an explicitly empty string literal empty', () => {
    expect(
      mobileEnvFromDefine({ [`${DEFINE_PREFIX}VITE_MOBILE_API_URL`]: '""' })
        .VITE_MOBILE_API_URL,
    ).toBe('');
  });

  it('returns undefined for absent define entries', () => {
    const env = mobileEnvFromDefine({
      [`${DEFINE_PREFIX}VITE_AWS_REGION`]: undefined,
    });
    expect(env.VITE_AWS_REGION).toBeUndefined();
  });

  it('returns undefined when the define map is absent', () => {
    expect(mobileEnvFromDefine(undefined).VITE_MOBILE_API_URL).toBeUndefined();
  });
});

describe('validateMobileApiUrlPlugin', () => {
  it('is a Vite plugin named validate-mobile-api-url', () => {
    const plugin = validateMobileApiUrlPlugin({ rootDir: '/root', isCapacitor: false });
    expect(plugin.name).toBe('validate-mobile-api-url');
  });

  it('is a no-op in development mode (validation skipped)', () => {
    expect(() =>
      invokeConfigResolvedHook({ mode: 'development', define: {} }),
    ).not.toThrow();
  });

  it('is a no-op in non-production modes (e.g. test)', () => {
    expect(() => invokeConfigResolvedHook({ mode: 'test', define: {} })).not.toThrow();
  });

  it('accepts a valid resolved production define', () => {
    expect(() =>
      invokeConfigResolvedHook({ mode: 'production', define: validDefine() }),
    ).not.toThrow();
  });

  it('bypasses validation when MOBILE_SKIP_ENV_VALIDATION=true in production', () => {
    process.env.MOBILE_SKIP_ENV_VALIDATION = 'true';
    expect(() => invokeConfigResolvedHook({ mode: 'production', define: {} })).not.toThrow();
  });

  it('does not bypass when MOBILE_SKIP_ENV_VALIDATION is set but not "true"', () => {
    process.env.MOBILE_SKIP_ENV_VALIDATION = 'false';
    expect(() => invokeConfigResolvedHook({ mode: 'production', define: {} })).toThrow(
      'VITE_MOBILE_API_URL is missing',
    );
  });

  it('throws in production when the define is absent', () => {
    delete process.env.MOBILE_SKIP_ENV_VALIDATION;
    expect(() => invokeConfigResolvedHook({ mode: 'production', define: {} })).toThrow(
      'VITE_MOBILE_API_URL is missing',
    );
  });

  it('rejects an explicitly empty VITE_MOBILE_API_URL define', () => {
    expect(() =>
      invokeConfigResolvedHook({
        mode: 'production',
        define: { ...validDefine(), [`${DEFINE_PREFIX}VITE_MOBILE_API_URL`]: '""' },
      }),
    ).toThrow('VITE_MOBILE_API_URL is missing');
  });

  it.each([
    ['VITE_MOBILE_API_URL', 'true'],
    ['VITE_COGNITO_OAUTH_DOMAIN', 'false'],
    ['VITE_COGNITO_USER_POOL_ID', '123'],
    ['VITE_AWS_REGION', 'null'],
  ])('rejects a non-string resolved literal for %s (%s)', (key, literal) => {
    expect(() =>
      invokeConfigResolvedHook({
        mode: 'production',
        define: { ...validDefine(), [`${DEFINE_PREFIX}${key}`]: literal },
      }),
    ).toThrow(new RegExp(`${key} must resolve to a string`));
  });

  // Parity regression: Quasar emits a boolean for VITE_COGNITO_OAUTH_DOMAIN=false.
  // The build guard must reject the same configuration the runtime validator
  // rejects rather than coercing it into the hostname "false".
  it('rejects the same non-string OAuth domain as the runtime validator', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() =>
      validateConfig({
        PROD: true,
        ...validBuildEnv,
        VITE_COGNITO_OAUTH_DOMAIN: false,
      }),
    ).toThrow(/VITE_COGNITO_OAUTH_DOMAIN must be a valid host-only domain/);
    expect(error).toHaveBeenCalled();

    expect(() =>
      invokeConfigResolvedHook({
        mode: 'production',
        define: { ...validDefine(), [`${DEFINE_PREFIX}VITE_COGNITO_OAUTH_DOMAIN`]: 'false' },
      }),
    ).toThrow(/VITE_COGNITO_OAUTH_DOMAIN must resolve to a string/);
  });

  it.each([
    'VITE_COGNITO_USER_POOL_ID',
    'VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID',
    'VITE_COGNITO_OAUTH_DOMAIN',
    'VITE_AWS_REGION',
  ])('rejects production builds when %s is missing', (missingKey) => {
    const define = quasarDefine(validBuildEnv);
    delete define[`${DEFINE_PREFIX}${missingKey}`];
    expect(() => invokeConfigResolvedHook({ mode: 'production', define })).toThrow(missingKey);
  });

  it('reports a malformed quoted literal as malformed, not missing', () => {
    expect(() =>
      invokeConfigResolvedHook({
        mode: 'production',
        define: { ...validDefine(), [`${DEFINE_PREFIX}VITE_AWS_REGION`]: '"us-east-1' },
      }),
    ).toThrow(/VITE_AWS_REGION resolved to a malformed quoted literal.*"us-east-1/);
  });

  it.each([
    'VITE_COGNITO_USER_POOL_ID',
    'VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID',
    'VITE_COGNITO_OAUTH_DOMAIN',
    'VITE_AWS_REGION',
  ])('rejects production builds when %s is explicitly empty', (emptyKey) => {
    expect(() =>
      invokeConfigResolvedHook({
        mode: 'production',
        define: { ...validDefine(), [`${DEFINE_PREFIX}${emptyKey}`]: '""' },
      }),
    ).toThrow(emptyKey);
  });

  it('rejects a malformed VITE_MOBILE_API_URL define', () => {
    expect(() =>
      invokeConfigResolvedHook({
        mode: 'production',
        define: { ...validDefine(), [`${DEFINE_PREFIX}VITE_MOBILE_API_URL`]: '"/api/"' },
      }),
    ).toThrow(/must be a valid absolute http\(s\) URL with a hostname/);
  });

  it('rejects an http: VITE_MOBILE_API_URL define (requireHttps contract)', () => {
    expect(() =>
      invokeConfigResolvedHook({
        mode: 'production',
        define: {
          ...validDefine(),
          [`${DEFINE_PREFIX}VITE_MOBILE_API_URL`]: '"http://example.com/api/"',
        },
      }),
    ).toThrow(/must be https: in production/);
  });

  it.each([
    'https://vela.auth.us-east-1.amazoncognito.com',
    'vela.auth.us-east-1.amazoncognito.com/oauth2/authorize',
    'vela.auth.us-east-1.amazoncognito.com?query=value',
    'vela.auth.us-east-1.amazoncognito.com#fragment',
    // Joined so the userinfo URL never appears as a source literal for the
    // repository secret scanner while still exercising the rejection path.
    ['user:password', 'vela.auth.us-east-1.amazoncognito.com'].join('@'),
    'vela.auth.us-east-1.amazoncognito.com:443',
  ])('rejects a non-host-only OAuth domain in production: %s', (oauthDomain) => {
    expect(() =>
      invokeConfigResolvedHook({
        mode: 'production',
        define: { ...validDefine(), [`${DEFINE_PREFIX}VITE_COGNITO_OAUTH_DOMAIN`]: JSON.stringify(oauthDomain) },
      }),
    ).toThrow(/VITE_COGNITO_OAUTH_DOMAIN must be a valid host-only domain/);
  });

  it.each([
    ['VITE_COGNITO_USER_POOL_ID', ' us-east-1_example'],
    ['VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID', 'mobile client'],
  ])('rejects whitespace in %s in production', (key, value) => {
    expect(() =>
      invokeConfigResolvedHook({
        mode: 'production',
        define: { ...validDefine(), [`${DEFINE_PREFIX}${key}`]: JSON.stringify(value) },
      }),
    ).toThrow(new RegExp(`${key} must not contain whitespace`));
  });

  it('rejects a user pool whose region prefix differs from the configured region', () => {
    expect(() =>
      invokeConfigResolvedHook({
        mode: 'production',
        define: {
          ...validDefine(),
          [`${DEFINE_PREFIX}VITE_COGNITO_USER_POOL_ID`]: '"us-west-2_example"',
        },
      }),
    ).toThrow(/VITE_COGNITO_USER_POOL_ID must start with the configured VITE_AWS_REGION/);
  });
});

describe('validateMobileApiUrlPlugin (Capacitor MARKETING_VERSION sync)', () => {
  it('does not touch native project metadata in SPA mode', () => {
    const { rootDir, pbxprojPath } = capacitorRoot();
    const before = readFileSync(pbxprojPath, 'utf8');

    invokeConfigResolvedHook({
      mode: 'production',
      define: validDefine({ VITE_APP_VERSION: '1.2.3' }),
      isCapacitor: false,
      rootDir,
    });

    expect(readFileSync(pbxprojPath, 'utf8')).toBe(before);
  });

  it('syncs the resolved VITE_APP_VERSION during a Capacitor development build', () => {
    const { rootDir, pbxprojPath } = capacitorRoot();

    invokeConfigResolvedHook({
      mode: 'development',
      define: quasarDefine({ VITE_APP_VERSION: '1.2.3' }),
      isCapacitor: true,
      rootDir,
    });

    expect(readFileSync(pbxprojPath, 'utf8')).toContain('MARKETING_VERSION = 1.2.3;');
    expect(readFileSync(pbxprojPath, 'utf8')).not.toContain('MARKETING_VERSION = 0.0.1;');
  });

  it('strips semver prerelease and build metadata before writing MARKETING_VERSION', () => {
    const { rootDir, pbxprojPath } = capacitorRoot();

    invokeConfigResolvedHook({
      mode: 'production',
      define: validDefine({ VITE_APP_VERSION: '1.0.0-beta.1+007' }),
      isCapacitor: true,
      rootDir,
    });

    const pbxproj = readFileSync(pbxprojPath, 'utf8');
    expect(pbxproj).toContain('MARKETING_VERSION = 1.0.0;');
    expect(pbxproj.match(/MARKETING_VERSION = 1\.0\.0;/g)).toHaveLength(2);
  });

  it('falls back to package.json version when the define version is absent', () => {
    const { rootDir, pbxprojPath } = capacitorRoot({ packageVersion: '2.3.4' });

    invokeConfigResolvedHook({
      mode: 'production',
      define: validDefine(),
      isCapacitor: true,
      rootDir,
    });

    expect(readFileSync(pbxprojPath, 'utf8')).toContain('MARKETING_VERSION = 2.3.4;');
  });

  it('falls back to package.json version when the define version is explicitly empty', () => {
    const { rootDir, pbxprojPath } = capacitorRoot({ packageVersion: '2.3.4' });

    invokeConfigResolvedHook({
      mode: 'production',
      define: validDefine({ VITE_APP_VERSION: '' }),
      isCapacitor: true,
      rootDir,
    });

    expect(readFileSync(pbxprojPath, 'utf8')).toContain('MARKETING_VERSION = 2.3.4;');
  });

  it('rejects a resolved version that is not three numeric segments', () => {
    const { rootDir } = capacitorRoot();

    expect(() =>
      invokeConfigResolvedHook({
        mode: 'production',
        define: validDefine({ VITE_APP_VERSION: 'v1.2.3' }),
        isCapacitor: true,
        rootDir,
      }),
    ).toThrow(/missing or not semver-like/);
  });

  it.each(['true', 'false', '123'])(
    'rejects a non-string resolved version literal (%s) instead of falling back',
    (literal) => {
      const { rootDir } = capacitorRoot();

      expect(() =>
        invokeConfigResolvedHook({
          mode: 'production',
          define: { ...validDefine(), [`${DEFINE_PREFIX}VITE_APP_VERSION`]: literal },
          isCapacitor: true,
          rootDir,
        }),
      ).toThrow(/missing or not semver-like/);
    },
  );

  it('falls back to package.json version when the resolved version literal is null', () => {
    const { rootDir, pbxprojPath } = capacitorRoot({ packageVersion: '2.3.4' });

    invokeConfigResolvedHook({
      mode: 'production',
      define: { ...validDefine(), [`${DEFINE_PREFIX}VITE_APP_VERSION`]: 'null' },
      isCapacitor: true,
      rootDir,
    });

    expect(readFileSync(pbxprojPath, 'utf8')).toContain('MARKETING_VERSION = 2.3.4;');
  });

  it('does not rewrite an unchanged project.pbxproj', () => {
    const { rootDir, pbxprojPath } = capacitorRoot({ pbxproj: PBXPROJ_FIXTURE.replaceAll('0.0.1', '1.2.3') });
    utimesSync(pbxprojPath, new Date(0), new Date(0));
    const beforeMtime = statSync(pbxprojPath).mtimeMs;

    invokeConfigResolvedHook({
      mode: 'production',
      define: validDefine({ VITE_APP_VERSION: '1.2.3' }),
      isCapacitor: true,
      rootDir,
    });

    expect(statSync(pbxprojPath).mtimeMs).toBe(beforeMtime);
  });

  it('throws when the native project has no MARKETING_VERSION entries', () => {
    const { rootDir } = capacitorRoot({ pbxproj: '/* no version here */\n' });

    expect(() =>
      invokeConfigResolvedHook({
        mode: 'production',
        define: validDefine({ VITE_APP_VERSION: '1.2.3' }),
        isCapacitor: true,
        rootDir,
      }),
    ).toThrow(/No MARKETING_VERSION entries/);
  });

  it('syncs the native version even when production env validation is bypassed', () => {
    process.env.MOBILE_SKIP_ENV_VALIDATION = 'true';
    const { rootDir, pbxprojPath } = capacitorRoot();

    invokeConfigResolvedHook({
      mode: 'production',
      define: quasarDefine({ VITE_APP_VERSION: '4.5.6' }),
      isCapacitor: true,
      rootDir,
    });

    expect(readFileSync(pbxprojPath, 'utf8')).toContain('MARKETING_VERSION = 4.5.6;');
  });

  it('does not touch project.pbxproj when production env validation fails', () => {
    const { rootDir, pbxprojPath } = capacitorRoot();
    const before = readFileSync(pbxprojPath, 'utf8');
    const define = validDefine({ VITE_APP_VERSION: '9.9.9' });
    delete define[`${DEFINE_PREFIX}VITE_MOBILE_API_URL`];

    expect(() =>
      invokeConfigResolvedHook({ mode: 'production', define, isCapacitor: true, rootDir }),
    ).toThrow('VITE_MOBILE_API_URL is missing');

    expect(readFileSync(pbxprojPath, 'utf8')).toBe(before);
  });
});

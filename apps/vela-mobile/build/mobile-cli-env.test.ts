// @vitest-environment node
//
// The standalone mobile CLIs (verify:deployed-config, verify:m1-foundation)
// run outside Quasar/Vite and read the plain KEY=VALUE files written by
// packages/cdk/scripts/inject-env.ts. This reader deliberately implements
// neither variable interpolation nor Quasar's resolved-value semantics: the
// Quasar-resolved build define remains authoritative for bundle values.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isCI } from 'ci-info';
import { isCiEnvironment, loadMobileCliEnv } from './mobile-cli-env';

const roots: string[] = [];

function makeRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'vela-cli-env-'));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(root, name), content);
  }
  return root;
}

const productionFile = [
  'VITE_MOBILE_API_URL=https://vela.example/api/',
  'VITE_COGNITO_USER_POOL_ID=us-east-1_POOL',
  'VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID=client123',
  'VITE_COGNITO_OAUTH_DOMAIN=auth.example',
  'VITE_AWS_REGION=us-east-1',
].join('\n');

const productionWithoutClientId = [
  'VITE_MOBILE_API_URL=https://vela.example/api/',
  'VITE_COGNITO_USER_POOL_ID=us-east-1_POOL',
  'VITE_COGNITO_OAUTH_DOMAIN=auth.example',
  'VITE_AWS_REGION=us-east-1',
].join('\n');

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('isCiEnvironment (must match Quasar getAppEnv / ci-info isCI)', () => {
  it('uses ci-info isCI for the real process.env', () => {
    expect(isCiEnvironment(process.env)).toBe(isCI);
  });

  it.each([
    [{ CI: 'true' }, true],
    [{ CI: '1' }, true],
    // ci-info only opts out on the exact string 'false'; '0' is truthy.
    [{ CI: '0' }, true],
    [{ CI: 'false' }, false],
    [{ CI: 'false', BUILD_ID: '1' }, false],
    [{ BUILD_NUMBER: '42' }, true],
    [{ BUILD_ID: 'abc' }, true],
    [{ RUN_ID: '9' }, true],
    [{ CI_NAME: 'codeship' }, true],
    [{ CONTINUOUS_INTEGRATION: 'true' }, true],
    // An empty CI falls through to the other variables.
    [{ CI: '' }, false],
    [{ CI: '', RUN_ID: '9' }, true],
    [{}, false],
  ])('classifies %j as CI=%s', (env, expected) => {
    expect(isCiEnvironment(env)).toBe(expected);
  });

  it('skips .env.local for CI=0 and generic CI variables, like Quasar', () => {
    const root = makeRoot({
      '.env.local': 'VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID=localclient\n',
    });

    for (const env of [{ CI: '0' }, { BUILD_NUMBER: '7' }]) {
      expect(loadMobileCliEnv(root, env).VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID).toBeUndefined();
    }
  });
});

describe('loadMobileCliEnv', () => {
  it('reads the exact generated .env.production values', () => {
    const root = makeRoot({ '.env.production': `${productionFile}\n` });

    expect(loadMobileCliEnv(root, {})).toEqual({
      VITE_MOBILE_API_URL: 'https://vela.example/api/',
      VITE_COGNITO_USER_POOL_ID: 'us-east-1_POOL',
      VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID: 'client123',
      VITE_COGNITO_OAUTH_DOMAIN: 'auth.example',
      VITE_AWS_REGION: 'us-east-1',
    });
  });

  it('applies .env, .env.local then .env.production in order outside CI', () => {
    const root = makeRoot({
      '.env': 'VITE_AWS_REGION=us-east-1\nVITE_COGNITO_OAUTH_DOMAIN=env.example\n',
      '.env.local': 'VITE_COGNITO_OAUTH_DOMAIN=local.example\n',
      '.env.production': 'VITE_COGNITO_OAUTH_DOMAIN=production.example\n',
    });

    const env = loadMobileCliEnv(root, {});
    expect(env.VITE_AWS_REGION).toBe('us-east-1');
    expect(env.VITE_COGNITO_OAUTH_DOMAIN).toBe('production.example');
  });

  it('skips .env.local when CI is set', () => {
    const root = makeRoot({
      '.env.local': 'VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID=localclient\n',
      '.env.production': `${productionWithoutClientId}\n`,
    });

    // The key exists only in .env.local, so the assertion fails if CI
    // currently loads that file (rather than being masked by .env.production).
    expect(
      loadMobileCliEnv(root, { CI: 'true' }).VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID,
    ).toBeUndefined();
    expect(loadMobileCliEnv(root, {}).VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID).toBe(
      'localclient',
    );
  });

  it('loads .env.local when CI is explicitly false or unset', () => {
    const root = makeRoot({
      '.env.local': 'VITE_MOBILE_API_URL=https://local.example/api/\n',
    });

    expect(loadMobileCliEnv(root, { CI: 'false' }).VITE_MOBILE_API_URL).toBe(
      'https://local.example/api/',
    );
    expect(loadMobileCliEnv(root, {}).VITE_MOBILE_API_URL).toBe('https://local.example/api/');
  });

  it('applies .env.production.local after .env.production', () => {
    const root = makeRoot({
      '.env.production': `${productionFile}\n`,
      '.env.production.local': 'VITE_AWS_REGION=local-region\n',
    });

    const env = loadMobileCliEnv(root, {});
    expect(env.VITE_AWS_REGION).toBe('local-region');
    expect(env.VITE_MOBILE_API_URL).toBe('https://vela.example/api/');
  });

  it('gives a direct process override precedence over every file', () => {
    const root = makeRoot({
      '.env.production': `${productionFile}\nVITE_AWS_REGION=file-region\n`,
    });

    expect(
      loadMobileCliEnv(root, { VITE_AWS_REGION: 'process-region' }).VITE_AWS_REGION,
    ).toBe('process-region');
  });

  it('keeps an explicitly empty process override empty instead of falling back to a file', () => {
    const root = makeRoot({ '.env.production': `${productionFile}\n` });

    expect(loadMobileCliEnv(root, { VITE_MOBILE_API_URL: '' }).VITE_MOBILE_API_URL).toBe('');
  });

  it('returns undefined for keys absent from every source', () => {
    const root = makeRoot({});

    expect(loadMobileCliEnv(root, {})).toEqual({
      VITE_MOBILE_API_URL: undefined,
      VITE_COGNITO_USER_POOL_ID: undefined,
      VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID: undefined,
      VITE_COGNITO_OAUTH_DOMAIN: undefined,
      VITE_AWS_REGION: undefined,
    });
  });

  it('does not interpolate $VAR references (generated files are literal)', () => {
    const root = makeRoot({
      '.env.production': 'BASE=one\nVITE_AWS_REGION=$BASE\n',
    });

    expect(loadMobileCliEnv(root, {}).VITE_AWS_REGION).toBe('$BASE');
  });

  it('ignores non-mobile keys', () => {
    const root = makeRoot({ '.env.production': 'UNRELATED=value\nVITE_API_URL=/api/\n' });

    expect(loadMobileCliEnv(root, {})).toEqual({
      VITE_MOBILE_API_URL: undefined,
      VITE_COGNITO_USER_POOL_ID: undefined,
      VITE_COGNITO_MOBILE_USER_POOL_CLIENT_ID: undefined,
      VITE_COGNITO_OAUTH_DOMAIN: undefined,
      VITE_AWS_REGION: undefined,
    });
  });
});

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
import { loadMobileCliEnv } from './mobile-cli-env';

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

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
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
      '.env': 'VITE_COGNITO_OAUTH_DOMAIN=env.example\n',
      '.env.local': 'VITE_MOBILE_API_URL=https://local.example/api/\n',
      '.env.production': `${productionFile}\n`,
    });

    expect(loadMobileCliEnv(root, { CI: 'true' }).VITE_MOBILE_API_URL).toBe(
      'https://vela.example/api/',
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
      '.env.production': 'BASE=one\nVITE_APP_VERSION=$BASE\nVITE_AWS_REGION=us-east-1\n',
    });

    const env = loadMobileCliEnv(root, {});
    expect(env.VITE_AWS_REGION).toBe('us-east-1');
    expect((env as Record<string, string | undefined>).VITE_APP_VERSION).toBeUndefined();
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

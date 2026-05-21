import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(extensionRoot, '../..');

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

type PackageJson = {
  scripts?: Record<string, string>;
};

describe('extension local testing workflow', () => {
  it('provides one root command that starts the app, API, and extension test runner', () => {
    const rootPackage = readJson<PackageJson>(resolve(repoRoot, 'package.json'));
    const appPackage = readJson<PackageJson>(resolve(repoRoot, 'apps/vela/package.json'));
    const apiPackage = readJson<PackageJson>(resolve(repoRoot, 'apps/vela-api/package.json'));
    const extensionPackage = readJson<PackageJson>(resolve(extensionRoot, 'package.json'));

    expect(rootPackage.scripts?.['dev:extension-test']).toBe(
      'turbo run dev:extension-test --parallel --filter=./apps/vela --filter=./apps/vela-api --filter=./apps/vela-ext',
    );
    expect(appPackage.scripts?.['dev:extension-test']).toBe('bun run dev');
    expect(apiPackage.scripts?.['dev:extension-test']).toBe('bun run dev');
    const extensionTestScript = extensionPackage.scripts?.['dev:extension-test'];
    expect(extensionTestScript).toContain('http://localhost:9000');
    expect(extensionTestScript).toContain('VELA_EXT_TEST_MODE=1');
    expect(extensionTestScript).toContain('VITE_API_URL=http://localhost:9005/api');
    expect(extensionTestScript).toContain('wxt');
    expect(extensionTestScript).toContain('curl');
  });

  it('overrides the local extension API URL for production builds', () => {
    const productionEnv = readText(resolve(extensionRoot, '.env.production'));

    expect(productionEnv).toContain('VITE_API_URL=https://vela.cwchanap.dev/api');
    expect(productionEnv).not.toContain('localhost:9005');
  });

  it('configures WXT to auto-launch Chrome only for extension test mode', () => {
    const config = readText(resolve(extensionRoot, 'wxt.config.ts'));

    expect(config).toContain('const isExtensionTestMode = process.env.VELA_EXT_TEST_MODE ===');
    expect(config).toContain('webExt:');
    expect(config).toContain('disabled: !isExtensionTestMode');
    expect(config).toContain("startUrls: ['http://localhost:9000/auth/login'");
    expect(config).toContain("'--user-data-dir=.wxt/chrome-data'");
    expect(config).toContain("'--remote-debugging-port=9222'");
    expect(config).not.toContain('runner:');
  });

  it('serves a Japanese fixture page from the Vela app for context-menu testing', () => {
    const fixture = readText(resolve(repoRoot, 'apps/vela/public/extension-test.html'));

    expect(fixture).toContain('<title>Vela Extension Test Fixture</title>');
    expect(fixture).toContain('今日は新しい単語を三つ覚えました。');
    expect(fixture).toContain('Select a sentence, right-click, then choose Add vocab to Vela.');
  });
});

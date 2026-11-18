import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import capacitorConfig from '../../src-capacitor/capacitor.config.ts';

const capacitorRoot = resolve(__dirname, '../../src-capacitor');
const packageJson = JSON.parse(readFileSync(resolve(capacitorRoot, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
};
const capacitorPlugins = capacitorConfig.plugins as
  | {
      Keyboard?: { resize?: string };
      CapacitorHttp?: { enabled?: boolean };
    }
  | undefined;

function dependencyMajor(name: string): string | undefined {
  return packageJson.dependencies[name]?.match(/\d+/u)?.[0];
}

describe('Capacitor plugin contracts', () => {
  it('preserves the native app identity and web output directory', () => {
    expect(capacitorConfig.appId).toBe('com.vela.app');
    expect(capacitorConfig.appName).toBe('Vela');
    expect(capacitorConfig.webDir).toBe('www');
  });

  it('pins Keyboard to Capacitor major 7', () => {
    expect(packageJson.dependencies['@capacitor/keyboard']).toMatch(/^\^7\./);
  });

  it('uses native WebView keyboard resize', () => {
    expect(capacitorPlugins?.Keyboard?.resize).toBe('native');
  });

  it('keeps Browser and Preferences on the same major as Capacitor core', () => {
    const coreMajor = dependencyMajor('@capacitor/core');
    expect(dependencyMajor('@capacitor/browser')).toBe(coreMajor);
    expect(dependencyMajor('@capacitor/preferences')).toBe(coreMajor);
  });

  it('does not enable the global Capacitor HTTP fetch/XMLHttpRequest patch', () => {
    expect(capacitorPlugins?.CapacitorHttp?.enabled).not.toBe(true);
    expect(packageJson.dependencies['@capacitor-community/http']).toBeUndefined();
  });

  it('resolves typed Capacitor plugins from Vitest', async () => {
    expect((await import('@capacitor/app')).App).toBeDefined();
    expect((await import('@capacitor/browser')).Browser).toBeDefined();
    expect((await import('@capacitor/core')).Capacitor).toBeDefined();
    expect((await import('@capacitor/core')).CapacitorHttp.request).toBeTypeOf('function');
    expect((await import('@capacitor/keyboard')).Keyboard).toBeDefined();
    expect((await import('@capacitor/preferences')).Preferences).toBeDefined();
  });

  it('installs Browser and Preferences in the Capacitor package tree', () => {
    for (const plugin of ['browser', 'preferences']) {
      const pluginPackage = resolve(
        capacitorRoot,
        'node_modules',
        '@capacitor',
        plugin,
        'package.json',
      );
      expect(readFileSync(pluginPackage, 'utf8')).toContain(`"name": "@capacitor/${plugin}"`);
    }
  });
});

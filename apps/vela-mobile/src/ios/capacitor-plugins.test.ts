import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const capacitorRoot = resolve(__dirname, '../../src-capacitor');
const packageJson = JSON.parse(readFileSync(resolve(capacitorRoot, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
};
const capacitorConfig = JSON.parse(
  readFileSync(resolve(capacitorRoot, 'capacitor.config.json'), 'utf8'),
) as { plugins?: { Keyboard?: { resize?: string } } };

describe('Capacitor plugin contracts', () => {
  it('pins Keyboard to Capacitor major 7', () => {
    expect(packageJson.dependencies['@capacitor/keyboard']).toMatch(/^\^7\./);
  });

  it('uses native WebView keyboard resize', () => {
    expect(capacitorConfig.plugins?.Keyboard?.resize).toBe('native');
  });

  it('resolves typed Capacitor plugins from Vitest', async () => {
    expect((await import('@capacitor/app')).App).toBeDefined();
    expect((await import('@capacitor/core')).Capacitor).toBeDefined();
    expect((await import('@capacitor/keyboard')).Keyboard).toBeDefined();
  });
});

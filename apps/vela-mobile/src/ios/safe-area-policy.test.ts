import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { safeAreaPolicy } from './safe-area-policy';

const capacitorConfig = JSON.parse(
  readFileSync(resolve(__dirname, '../../src-capacitor/capacitor.config.json'), 'utf8'),
) as { ios?: { contentInset?: string } };

describe('safeAreaPolicy', () => {
  it('matches the native content-inset configuration', () => {
    expect(capacitorConfig.ios?.contentInset).toBe(safeAreaPolicy.contentInset);
  });

  it('uses the only valid headerless-top owner for the selected mode', () => {
    expect(safeAreaPolicy).toEqual(
      capacitorConfig.ios?.contentInset === 'always'
        ? {
            contentInset: 'always',
            headerlessTopOwner: 'native-scroll-view',
          }
        : {
            contentInset: 'never',
            headerlessTopOwner: 'css',
          },
    );
  });
});
